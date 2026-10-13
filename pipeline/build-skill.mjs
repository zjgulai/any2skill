#!/usr/bin/env node
/**
 * 环 4 装配 CLI（tracer bullet 第一版，ticket 10；簇入口见 ticket 11 / ADR-024）。
 *
 * 用法：
 *   node pipeline/build-skill.mjs --root-anchor chapter4#h2-2 --slug <name> --title <标题> [--dry-run]
 *   node pipeline/build-skill.mjs --cluster chapter4-s1 [--slug <覆盖>] [--title <覆盖>] [--dry-run]
 *
 * 两种入口的分工（ADR-024 决策 2）：
 *   `--root-anchor`  手工挑一个文档子树（tracer bullet 的路径，保留作参照）；
 *   `--cluster`      消费环 3 产出的簇定义（`pipeline/knowledge/clusters.json`），
 *                    按**划分算法决定的**锚点集与对象集装配。slug 与 title 缺省取自候选。
 *
 * ## 副作用清单（本文件写什么，跑之前先说清）
 *
 *   `--dry-run`  只读盘、只打印，**不写任何文件**。
 *   真实运行     写 `pipeline/registry/build/<slug>/SKILL.md`（暂存）
 *                与 `pipeline/registry/build/<slug>/skill-contract.json`（契约侧车）
 *                与 `pipeline/registry/build/<slug>/gate-receipt.json`（门禁回执）。
 *                门禁**通过**时，额外把 SKILL.md 拷进 `skills/<slug>/SKILL.md`（发布区）。
 *                门禁不通过时**不拷**——发布区只接收通过门禁的产物（ADR-002 平面隔离）。
 *
 * 本命令**不发出任何模型调用**。第一版装配器刻意是确定性的：引入生成就会把
 * 「对象够不够装」这个待测问题用生成内容填平（详见 skill-builder.mjs 的文件头）。
 *
 * ## 输入过滤（这是本命令的一条硬规则）
 *
 * 只消费**最近一次门禁通过的**对象。判定依据是最新一份 `run-*.receipt.json` 的
 * `objectVerdicts[].status === 'pass'`。没有回执时本命令**拒绝装配**——
 * 「没有判定记录」不等于「都通过了」，把未判定的对象装进 skill 是把门禁一的结论静默作废。
 *
 * 簇入口的引用**不静默打折**：候选引用的锚点不在本章索引里、或对象不在对象文件里，
 * 一律抛错停下——一条被悄悄丢掉的引用会让产出的 skill 看起来完整而实际缺证据。
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from './tools/anchor-index.mjs'
import {
  GAP_CODES,
  assembleSkill,
  buildPublishedPath,
  buildStagingPath,
  collectClusterObjects,
  collectCodePointers,
  collectCrossChapterAntipatterns,
  deriveCluster,
  unwrapObjectsFile,
} from './tools/skill-builder.mjs'
import { SKILL_REASON_CODES, verifySkill } from './tools/verify-skill.mjs'
import { CLUSTERS_REL_PATH } from './tools/cluster-proposer.mjs'

export const EXIT = Object.freeze({
  PASS: 0,
  SKILL_REJECTED: 3,
  RUN_FAILED: 4,
})

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    dryRun: false,
    json: false,
    repoRoot: DEFAULT_REPO_ROOT,
    rootAnchor: null,
    slug: null,
    title: null,
    source: null,
    receipt: null,
    cluster: null,
  }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--json') flags.json = true
    else if (a === '--root-anchor') (flags.rootAnchor = need(i, a)), (i += 1)
    else if (a === '--cluster') (flags.cluster = need(i, a)), (i += 1)
    else if (a === '--slug') (flags.slug = need(i, a)), (i += 1)
    else if (a === '--title') (flags.title = need(i, a)), (i += 1)
    else if (a === '--source') (flags.source = need(i, a)), (i += 1)
    else if (a === '--receipt') (flags.receipt = need(i, a)), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a.startsWith('--')) throw new Error(`未知参数：${a}`)
    else throw new Error(`未知位置参数：${a}（本命令不接受位置参数）`)
  }
  return flags
}

/** slug 的合法性在门禁里也查一遍；这里先挡一下，避免把非法名写进目录。 */
export function assertSlug(slug) {
  if (!slug) throw new Error('--slug 必填')
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error(`--slug 只允许小写字母/数字/连字符：${slug}`)
  if (slug.length > 64) throw new Error(`--slug 长度 ${slug.length} > 64`)
  for (const bad of ['anthropic', 'claude']) {
    if (slug.includes(bad)) throw new Error(`--slug 不得包含 ${bad}`)
  }
}

/** 取与某源文件相关的最近一份回执。口径：`source.path` 精确相等，按 `createdAt` 取最新。 */
export async function findLatestReceipt(sourceRelPath, { repoRoot }) {
  const dir = path.join(repoRoot, 'pipeline', 'registry')
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const candidates = []
  for (const n of names) {
    if (!/^run-.*\.receipt\.json$/.test(n)) continue
    try {
      const j = JSON.parse(await readFile(path.join(dir, n), 'utf8'))
      if (j.source && j.source.path === sourceRelPath && j.createdAt) {
        candidates.push({ file: path.join(dir, n), receipt: j })
      }
    } catch {
      // 坏回执不参与挑选，但也不静默——下面会把跳过的计数报出来。
      candidates.push({ file: path.join(dir, n), receipt: null })
    }
  }
  const good = candidates.filter((c) => c.receipt)
  good.sort((a, b) => String(b.receipt.createdAt).localeCompare(String(a.receipt.createdAt)))
  return good.length ? good[0] : null
}

/** 从回执里取「确定通过」的对象 id 集合。**双判据都过**才算过。 */
export function passedObjectIds(receipt) {
  const set = new Set()
  for (const v of receipt.objectVerdicts || []) {
    if (v.status === 'pass') set.add(v.objectId)
  }
  return set
}

/**
 * 取最新的跨章反模式判定表。
 *
 * 为什么不能拿 chapter 的回执去判反模式：反模式由**另一次运行**产出（卡 06 的
 * `synthesize-antipatterns.mjs`），它的对象 id（`AP-SYNTH-*`）根本不在 chapter4 回执的
 * `objectVerdicts` 里。第一版装配器图省事复用了 chapter 的回执，结果把两条**已被判拒绝**的
 * 反模式当成了「不存在」——两者在产物里长得一样，但原因完全不同。
 *
 * `expectRunId` 给出**对象文件自己声明的身份**时，优先取同身份的那份判定表。
 * 「最新 mtime」只说明哪份文件最后被写，不说明它与对象文件是**同一次运行**的产物——
 * 两次综合之间只要有一次是 `--no-judge`，最新那份就可能是一张没过判据的判定表。
 * 取不到同身份时仍然回退到最新（不让装配整体失败），但把 `identityMatch` 如实报出去。
 */
export async function findLatestAntipatternVerdicts({ repoRoot, expectRunId = null }) {
  const dir = path.join(repoRoot, 'pipeline', 'registry')
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  const hits = []
  for (const n of names) {
    if (!/^run-.*\.antipattern-verdicts\.json$/.test(n)) continue
    const abs = path.join(dir, n)
    try {
      const st = await stat(abs)
      const j = JSON.parse(await readFile(abs, 'utf8'))
      hits.push({
        file: abs,
        mtime: st.mtimeMs,
        runId: j.runId,
        judgeEnabled: j.judgeEnabled ?? null,
        pipelineVersion: j.pipelineVersion ?? null,
        verdicts: j.verdicts || [],
      })
    } catch {
      // 坏文件不参与挑选。
    }
  }
  const identical = expectRunId === null ? [] : hits.filter((h) => h.runId === expectRunId)
  const pool = identical.length > 0 ? identical : hits
  pool.sort((a, b) => b.mtime - a.mtime)
  if (pool.length === 0) return null
  const picked = pool[0]
  return {
    ...picked,
    candidateCount: hits.length,
    identityMatch: expectRunId !== null && picked.runId === expectRunId,
  }
}

/**
 * 从 `clusters.json` 里取一个候选的簇定义（ticket 11 / ADR-024 决策 2）。
 *
 * 簇定义取自**知识平面**的 `clusters.json`（而非 registry 里的候选书），
 * 因为它是划分的原始记录；候选书是派生账，两者不一致时应先重跑聚类而不是将就。
 * 引用不静默打折：候选没有任何锚点、或 skillId 不存在，都在这里抛错。
 */
export async function loadClusterCandidate(repoRoot, skillId) {
  const abs = path.join(repoRoot, CLUSTERS_REL_PATH)
  let doc
  try {
    doc = JSON.parse(await readFile(abs, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`簇定义不存在：${CLUSTERS_REL_PATH}——先跑 pipeline/propose-clusters.mjs（环 3）。`)
    }
    throw err
  }
  const known = []
  for (const ch of Array.isArray(doc.chapters) ? doc.chapters : []) {
    for (const s of Array.isArray(ch.skills) ? ch.skills : []) {
      if (s?.skillId) known.push(s.skillId)
      if (s?.skillId !== skillId) continue
      const units = (Array.isArray(ch.units) ? ch.units : []).filter((u) =>
        (Array.isArray(s.unitIds) ? s.unitIds : []).includes(u.unitId),
      )
      const anchorIds = [...new Set(units.flatMap((u) => (Array.isArray(u.anchors) ? u.anchors : [])))]
      const objectIds = [...new Set(units.flatMap((u) => (Array.isArray(u.objectIds) ? u.objectIds : [])))]
      if (anchorIds.length === 0 || objectIds.length === 0) {
        throw new Error(`候选 ${skillId} 没有锚点或对象——拒绝装配空簇（检查 clusters.json 的单元成员）。`)
      }
      return {
        skillId,
        fileKey: ch.fileKey,
        name: typeof s.name === 'string' ? s.name : '',
        trigger: typeof s.trigger === 'string' ? s.trigger : '',
        rationale: typeof s.rationale === 'string' ? s.rationale : '',
        units: Array.isArray(s.unitIds) ? s.unitIds : [],
        anchorIds,
        objectIds,
      }
    }
  }
  throw new Error(
    `clusters.json 里没有 skillId=${skillId} 的候选。现有候选：${known.length ? known.join(', ') : '（无）'}`,
  )
}

/**
 * 两种装配入口共用的读盘：锚点索引、对象文件、跨章反模式及其判定表、门禁回执与通过集。
 *
 * 抽出来的理由不是「少写几行」，是**门禁二与环 4 必须看到同一批对象**：触发盲测要测的是
 * 「发布出去的那份会怎样」，若两边各自过滤（比如一边忘掉门禁通过集），被测的就成了另一份
 * 东西——而两份在产物里长得一样。
 */
export async function loadAssemblyInputs(repoRoot, { chapterKey, sourceRel }) {
  const rel = (p) => path.relative(repoRoot, p)
  const index = await buildAnchorIndex(path.join(repoRoot, sourceRel), { repoRoot })
  const objectsPath = path.join(repoRoot, 'pipeline', 'knowledge', `${chapterKey}.objects.json`)
  const allObjects = unwrapObjectsFile(
    JSON.parse(await readFile(objectsPath, 'utf8')),
    rel(objectsPath),
  )

  const apPath = path.join(repoRoot, 'pipeline', 'knowledge', 'antipatterns.objects.json')
  let allAntipatterns = []
  let antipatternsRunId = null
  try {
    const apRaw = JSON.parse(await readFile(apPath, 'utf8'))
    // 对象文件自己声明的身份。它决定去取**哪一份**判定表——不是「最新的那一份」。
    antipatternsRunId = typeof apRaw.runId === 'string' ? apRaw.runId : null
    allAntipatterns = unwrapObjectsFile(apRaw, rel(apPath))
  } catch (err) {
    if (err.code === 'ENOENT') {
      // 文件确实不存在是一种状态：跨章池按空处理，读取方按「没有」显示，不假装判定过。
      allAntipatterns = []
    } else {
      throw err
    }
  }

  const found = await findLatestReceipt(sourceRel, { repoRoot })
  const passSet = found ? passedObjectIds(found.receipt) : new Set()
  const apVerdicts = await findLatestAntipatternVerdicts({ repoRoot, expectRunId: antipatternsRunId })
  const apVerdictById = new Map((apVerdicts?.verdicts || []).map((v) => [v.objectId, v]))
  const apPassSet = new Set(
    [...apVerdictById.entries()].filter(([, v]) => v.status === 'pass').map(([id]) => id),
  )

  return { index, objectsPath, allObjects, allAntipatterns, antipatternsRunId, apVerdicts, apVerdictById, apPassSet, found, passSet }
}

/** 跨章判定表与对象不同源时的告警文本（没有问题时返回 null）。两种入口共用同一句。 */
export function antipatternIdentityWarning(apVerdicts, antipatternsRunId) {
  if (apVerdicts === null || apVerdicts.identityMatch === true) return null
  return (
    `⚠ 跨章判定表与反模式对象**不是同一次运行的产物**：` +
    `对象声明 ${antipatternsRunId ?? '(无身份)'}，取到的判定表是 ${apVerdicts.runId}` +
    `（registry 里有 ${apVerdicts.candidateCount} 份候选，按 mtime 回退挑选）。\n` +
    `  两者不同源时，「通过」的含义无法核实——请先重跑 pipeline/synthesize-antipatterns.mjs。\n`
  )
}

/**
 * 由候选的簇定义构造环 4 的 `cluster` 与簇内对象集（簇模式的唯一构造点）。
 *
 * 引用**逐条解析**，解析不到即停——静默丢一条引用会让产物看起来完整而实际缺证据。
 */
export function clusterFromCandidate(clusterDef, index, allObjects, { objectsLabel = '对象文件' } = {}) {
  const byAnchor = new Map(index.anchors.map((a) => [a.anchor, a]))
  const missingAnchors = clusterDef.anchorIds.filter((id) => !byAnchor.has(id))
  if (missingAnchors.length > 0) {
    throw new Error(
      `候选 ${clusterDef.skillId} 引用了本章索引里不存在的锚点：${missingAnchors.join(', ')}` +
        '——拒绝装配（先核对 clusters.json 与源文是否同一批输入）。',
    )
  }
  const cluster = {
    rootAnchor: clusterDef.skillId,
    title: clusterDef.name || clusterDef.skillId,
    level: null,
    anchors: clusterDef.anchorIds.map((id) => byAnchor.get(id)),
  }
  const want = new Set(clusterDef.objectIds)
  const inCluster = allObjects.filter((o) => want.has(o.id))
  const missingObjects = clusterDef.objectIds.filter((id) => !inCluster.some((o) => o.id === id))
  if (missingObjects.length > 0) {
    throw new Error(
      `候选 ${clusterDef.skillId} 引用的对象不在 ${objectsLabel} 里：${missingObjects.slice(0, 5).join(', ')}` +
        (missingObjects.length > 5 ? ` 等共 ${missingObjects.length} 个` : ''),
    )
  }
  return { cluster, inCluster }
}

async function main(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return EXIT.RUN_FAILED
  }
  const repoRoot = flags.repoRoot
  const rel = (p) => path.relative(repoRoot, p)

  try {
    if (flags.cluster && flags.rootAnchor) {
      throw new Error('--cluster 与 --root-anchor 互斥：簇模式按划分产物装配，不再手挑子树')
    }
    if (!flags.cluster && !flags.rootAnchor) {
      throw new Error('--root-anchor 或 --cluster 必填（前者形如 chapter4#h2-2；后者是 clusters.json 里的 skillId）')
    }

    // 簇模式：slug/title 缺省取自候选（skillId 本身就是合法 slug；允许显式覆盖）。
    let clusterDef = null
    if (flags.cluster) {
      clusterDef = await loadClusterCandidate(repoRoot, flags.cluster)
      if (flags.slug === null) flags.slug = clusterDef.skillId
      if (flags.title === null) flags.title = clusterDef.name || clusterDef.skillId
    }
    assertSlug(flags.slug)
    if (!flags.title) throw new Error('--title 必填（SKILL.md 的 H1 标题）')

    const chapterKey = clusterDef ? clusterDef.fileKey : String(flags.rootAnchor).split('#')[0]
    const sourceRel = flags.source || path.join('sources', 'ai-agent-book-zh', 'book', `${chapterKey}.md`)

    // ── 读盘（两种入口共用；门禁二走同一函数，保证被测对象与发布对象是同一批） ──
    const loaded = await loadAssemblyInputs(repoRoot, { chapterKey, sourceRel })
    const { index, objectsPath, allObjects, allAntipatterns, antipatternsRunId, apVerdicts, apVerdictById, apPassSet } = loaded

    // ── 门禁一的结论是环 4 的前置，不是可选项 ─────────────────────────────
    const found = flags.receipt
      ? { file: path.resolve(repoRoot, flags.receipt), receipt: JSON.parse(await readFile(path.resolve(repoRoot, flags.receipt), 'utf8')) }
      : loaded.found
    if (!found) {
      process.stderr.write(
        `拒绝装配：未找到 ${sourceRel} 的判定回执。\n` +
          `原因：环 4 只能消费门禁一判过「通过」的对象。没有回执 ≠ 对象都通过了。\n` +
          `先跑：node pipeline/run.mjs ${sourceRel} --layer2 deepseek ...\n`,
      )
      return EXIT.RUN_FAILED
    }
    const passSet = flags.receipt ? passedObjectIds(found.receipt) : loaded.passSet

    // 跨章反模式走**它自己那次运行**的判定表，不能拿 chapter 的回执代判（见
    // findLatestAntipatternVerdicts 的说明）。缺判定表时一律不纳入——未判定 ≠ 通过。
    const identityWarning = antipatternIdentityWarning(apVerdicts, antipatternsRunId)
    if (identityWarning) process.stderr.write(identityWarning)

    let cluster
    let inCluster
    if (clusterDef) {
      ;({ cluster, inCluster } = clusterFromCandidate(clusterDef, index, allObjects, { objectsLabel: rel(objectsPath) }))
    } else {
      cluster = deriveCluster(index.anchors, flags.rootAnchor)
      inCluster = collectClusterObjects(allObjects, cluster.anchors)
    }
    const excluded = inCluster.filter((o) => !passSet.has(o.id))
    const kept = inCluster.filter((o) => passSet.has(o.id))
    const crossChapter = collectCrossChapterAntipatterns(allAntipatterns, cluster.anchors)
    const crossExcluded = crossChapter.filter((o) => !apPassSet.has(o.id))
    const crossKept = crossChapter.filter((o) => apPassSet.has(o.id))
    const crossExcludedDetail = crossExcluded.map((o) => ({
      id: o.id,
      reasonCode: apVerdictById.get(o.id)?.reasonCode || (apVerdicts ? 'NOT_IN_VERDICTS' : 'NO_VERDICTS_FILE'),
    }))

    // 配套代码目录的来源。实测口径：镜像到 sources/ai-agent-book-zh/code/<chapter>/，
    // 见该目录下的 MIRROR-MANIFEST.md。不存在时返回空数组，由装配器记 NO_SOURCE 缺口。
    const codeRootRel = path.join('sources', 'ai-agent-book-zh', 'code', chapterKey)
    const codePointers = collectCodePointers(path.join(repoRoot, codeRootRel), {
      relPrefix: codeRootRel,
    })

    // ── 装配与校验所需的**全部**锚点索引 ──────────────────────────────────
    // 本簇那一章 + 被采用的跨章反模式声明出处所在的各章。
    //
    // 为什么必须补齐：跨章反模式的出处按定义在别的章节。只给本簇索引时，「契约里每个
    // sourceRefs[].file 都要能在索引里解析、并在深度阅读段回链」这条判据必然失败——
    // 而它失败得**看起来像内容错误**（「锚点不可解析」），实际是我们没给足比对范围。
    // 索引一律**按源文重建**（与主索引同一函数、同一口径），不读盘上可能过期的 `.anchors.json`。
    const indexByFile = new Map([[index.sourceFile, index]])
    const referencedFiles = new Set()
    for (const ap of crossKept) {
      for (const r of ap.sourceRefs || []) if (r && r.file) referencedFiles.add(r.file)
    }
    const extraIndexFiles = [...referencedFiles].filter((f) => !indexByFile.has(f)).sort()
    for (const f of extraIndexFiles) {
      indexByFile.set(f, await buildAnchorIndex(path.join(repoRoot, f), { repoRoot }))
    }
    const anchorIndexes = [...indexByFile.values()]

    const assembled = assembleSkill({
      cluster,
      objects: kept,
      antipatterns: crossKept,
      codePointers,
      slug: flags.slug,
      skillTitle: flags.title,
      anchorIndexes,
      ...(clusterDef ? { skillId: clusterDef.skillId } : {}),
    })

    const verdict = await verifySkill({
      markdown: assembled.markdown,
      contract: assembled.contract,
      // 传**全部**索引，不是只传本簇那一章。跨章反模式的出处按定义落在别的章节，
      // 只给它本簇的索引，校验器只能报 `SOURCEREF_UNRESOLVED`——而校验器本身早就支持多份
      // （`Array.isArray(anchorIndexes)`）。单章假设是遗留缺陷，此前被 `crossChapterKept` 恒为 0 盖住。
      anchorIndexes,
      repoRoot,
      sectionCountsExpected: assembled.sectionCounts,
    })

    // 双口径判定已作废（ADR-021）：条目数不再入判据，那处解释歧义已被定夺。
    // 保留的只有「契约记录数 vs 正文实际数」这条与条目数无关的一致性检查。

    const contract = {
      ...assembled.contract,
      freshness: { state: 'fresh', asOf: new Date().toISOString() },
      gapCodes: assembled.gaps.map((g) => g.code),
      gateReceipt: {
        passed: verdict.passed,
        reasonCodes: verdict.reasonCodes,
        bytes: verdict.checks.bytes,
        markdownHash: verdict.markdownHash,
        checkedAt: new Date().toISOString(),
      },
      provenance: {
        sourceFile: sourceRel,
        // 主索引（本簇那一章）的哈希，语义不变——旧回执与新回执在这个字段上可比。
        anchorIndexHash: index.sourceHash,
        // 本次装配**实际用到**的全部索引及其哈希。跨章出处一进 skill，单值字段就答不了
        // 「这份契约是按哪些章装的」，而那正是 provenance 存在的目的。
        anchorIndexHashes: Object.fromEntries(
          anchorIndexes.map((idx) => [idx.sourceFile, idx.sourceHash]),
        ),
        objectsFile: rel(objectsPath),
        objectsFileSha256: `sha256:${createHash('sha256').update(JSON.stringify(allObjects)).digest('hex')}`,
        objectsTotal: allObjects.length,
        objectsInCluster: inCluster.length,
        objectsKept: kept.length,
        objectsExcludedByGate: excluded.map((o) => o.id),
        crossChapterTotal: allAntipatterns.length,
        crossChapterInCluster: crossChapter.length,
        crossChapterKept: crossKept.length,
        crossChapterExcludedByGate: crossExcludedDetail,
        antipatternVerdictsFile: apVerdicts ? rel(apVerdicts.file) : null,
        antipatternVerdictsRunId: apVerdicts ? apVerdicts.runId : null,
        // 对象与判定表是否同源。回执里必须看得见——「不是同源」这件事若只写在 stderr 上，
        // 审计者读的却是回执，那就等于没记。
        antipatternVerdictsIdentityMatch: apVerdicts ? apVerdicts.identityMatch : null,
        antipatternObjectsRunId: antipatternsRunId,
        gateReceiptFile: rel(found.file),
        gateReceiptRunId: found.receipt.runId,
        // 簇来源（ticket 11）：「按划分装配」与「按子树装配」是两条来源路径，
        // 事后核对不能靠猜——两种入口在 provenance 里必须可辨。
        ...(clusterDef
          ? {
              clusterSource: 'clusters.json',
              clusterSkillId: clusterDef.skillId,
              clusterUnits: clusterDef.units,
              clustersFile: CLUSTERS_REL_PATH,
            }
          : { clusterSource: 'root-anchor', clusterRootAnchor: cluster.rootAnchor }),
      },
    }

    const staging = buildStagingPath(flags.slug, { repoRoot })
    const receiptOut = path.join(path.dirname(staging), 'gate-receipt.json')
    const contractOut = path.join(path.dirname(staging), 'skill-contract.json')

    const summary = {
      slug: flags.slug,
      clusterSource: clusterDef ? 'clusters.json' : 'root-anchor',
      rootAnchor: cluster.rootAnchor,
      clusterAnchors: cluster.anchors.length,
      clusterTitle: cluster.title,
      objectsInCluster: inCluster.length,
      objectsKept: kept.length,
      crossChapterAntipatternsInCluster: crossChapter.length,
      crossChapterAntipatternsKept: crossKept.length,
      crossChapterExcluded: crossExcludedDetail,
      sectionCounts: assembled.sectionCounts,
      gaps: assembled.gaps,
      gate: {
        passed: verdict.passed,
        reasonCodes: verdict.reasonCodes,
        failures: verdict.failures,
        bytes: verdict.checks.bytes,
        sizeLimitBytes: verdict.checks.sizeLimitBytes,
      },
      riskFlags: assembled.riskFlags,
      artifacts: flags.dryRun
        ? { staged: null, contract: null, receipt: null, published: null }
        : {
            staged: rel(staging),
            contract: rel(contractOut),
            receipt: rel(receiptOut),
            published: verdict.passed ? rel(buildPublishedPath(flags.slug, { repoRoot })) : null,
          },
    }

    if (!flags.dryRun) {
      await mkdir(path.dirname(staging), { recursive: true })
      await writeFile(staging, assembled.markdown, 'utf8')
      await writeFile(contractOut, `${JSON.stringify(contract, null, 2)}\n`, 'utf8')
      await writeFile(receiptOut, `${JSON.stringify({ ...summary, verdict }, null, 2)}\n`, 'utf8')
      if (verdict.passed) {
        const pub = buildPublishedPath(flags.slug, { repoRoot })
        await mkdir(path.dirname(pub), { recursive: true })
        await writeFile(pub, assembled.markdown, 'utf8')
      }
    }

    if (flags.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    } else {
      const o = process.stdout
      o.write(`簇：${cluster.rootAnchor} 「${cluster.title}」（${cluster.anchors.length} 个锚点）\n`)
      o.write(`对象：簇内 ${inCluster.length} 个，门禁通过 ${kept.length} 个`)
      o.write(excluded.length ? `，**被门禁排除 ${excluded.length} 个：${excluded.map((x) => x.id).join(', ')}**\n` : '\n')
      o.write(`跨章反模式：引用本簇 ${crossChapter.length} 条，门禁通过 ${crossKept.length} 条`)
      if (crossExcludedDetail.length) {
        o.write(
          `，**被门禁排除 ${crossExcludedDetail.length} 条**：` +
            crossExcludedDetail.map((x) => `${x.id}(${x.reasonCode})`).join(', '),
        )
      }
      o.write('\n')
      if (!apVerdicts) {
        o.write('⚠ 未找到跨章反模式的判定表（run-*.antipattern-verdicts.json）——本簇的常见陷阱段只由簇内对象填充。\n')
      }
      o.write(`配套代码目录：${codePointers.length} 个（来源 ${codeRootRel}）\n`)
      const names = {
        whenToUse: '何时使用',
        principles: '核心原则',
        patterns: '实践模式',
        pitfalls: '常见陷阱',
        code: '配套代码',
        reading: '深度阅读',
      }
      o.write('段落条目数：\n')
      for (const [k, v] of Object.entries(assembled.sectionCounts)) {
        o.write(`  ${names[k] || k}：${v}\n`)
      }
      if (assembled.gaps.length) {
        o.write(`\n缺口 ${assembled.gaps.length} 条：\n`)
        for (const g of assembled.gaps) {
          o.write(`  [${g.code}] ${g.heading}：${g.detail}\n`)
        }
      }
      o.write(
        `\n门禁一：${verdict.passed ? '通过' : `不通过（${verdict.reasonCodes.join(', ')}）`}` +
          `  体积 ${verdict.checks.bytes} / ${verdict.checks.sizeLimitBytes} 字节\n`,
      )
      for (const f of verdict.failures) o.write(`  ✗ [${f.code}] ${f.where || f.at || ''} ${f.detail}\n`)
      if (assembled.riskFlags.length) {
        o.write('风险标记（不导致拒绝；按 ADR-006 门禁三路由到功效抽样重点）：\n')
        for (const r of assembled.riskFlags) o.write(`  ⚑ [${r.flag}] ${r.detail}\n`)
      }
      if (!flags.dryRun) {
        o.write(`\n暂存：${rel(staging)}\n契约：${rel(contractOut)}\n回执：${rel(receiptOut)}\n`)
        o.write(
          verdict.passed
            ? `已发布：${rel(buildPublishedPath(flags.slug, { repoRoot }))}\n`
            : `**未发布**——发布区只接收通过门禁的产物（ADR-002 平面隔离）。\n`,
        )
      }
    }

    return verdict.passed ? EXIT.PASS : EXIT.SKILL_REJECTED
  } catch (err) {
    process.stderr.write(`装配失败：${err.message}\n`)
    return EXIT.RUN_FAILED
  }
}

export { GAP_CODES, SKILL_REASON_CODES, main }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
