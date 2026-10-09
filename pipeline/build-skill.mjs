#!/usr/bin/env node
/**
 * 环 4 装配 CLI（tracer bullet 第一版，ticket 10）。
 *
 * 用法：
 *   node pipeline/build-skill.mjs --root-anchor chapter4#h2-2 --slug <name> --title <标题> [--dry-run]
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
 */
export async function findLatestAntipatternVerdicts({ repoRoot }) {
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
      hits.push({ file: abs, mtime: st.mtimeMs, runId: j.runId, verdicts: j.verdicts || [] })
    } catch {
      // 坏文件不参与挑选。
    }
  }
  hits.sort((a, b) => b.mtime - a.mtime)
  return hits.length ? hits[0] : null
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
    if (!flags.rootAnchor) throw new Error('--root-anchor 必填（形如 chapter4#h2-2）')
    assertSlug(flags.slug)
    if (!flags.title) throw new Error('--title 必填（SKILL.md 的 H1 标题）')

    const chapterKey = String(flags.rootAnchor).split('#')[0]
    const sourceRel = flags.source || path.join('sources', 'ai-agent-book-zh', 'book', `${chapterKey}.md`)

    // ── 读盘 ──────────────────────────────────────────────────────────────
    const index = await buildAnchorIndex(path.join(repoRoot, sourceRel), { repoRoot })
    const objectsPath = path.join(repoRoot, 'pipeline', 'knowledge', `${chapterKey}.objects.json`)
    const allObjects = unwrapObjectsFile(
      JSON.parse(await readFile(objectsPath, 'utf8')),
      rel(objectsPath),
    )
    const apPath = path.join(repoRoot, 'pipeline', 'knowledge', 'antipatterns.objects.json')
    let allAntipatterns = []
    let antipatternsFileState = 'loaded'
    try {
      allAntipatterns = unwrapObjectsFile(JSON.parse(await readFile(apPath, 'utf8')), rel(apPath))
    } catch (err) {
      if (err.code === 'ENOENT') {
        // 文件确实不存在是一种状态；形状不对是另一种。两者都记录，不混为一谈。
        allAntipatterns = []
        antipatternsFileState = 'missing'
      } else {
        throw err
      }
    }

    // ── 门禁一的结论是环 4 的前置，不是可选项 ─────────────────────────────
    const found = flags.receipt
      ? { file: path.resolve(repoRoot, flags.receipt), receipt: JSON.parse(await readFile(path.resolve(repoRoot, flags.receipt), 'utf8')) }
      : await findLatestReceipt(sourceRel, { repoRoot })
    if (!found) {
      process.stderr.write(
        `拒绝装配：未找到 ${sourceRel} 的判定回执。\n` +
          `原因：环 4 只能消费门禁一判过「通过」的对象。没有回执 ≠ 对象都通过了。\n` +
          `先跑：node pipeline/run.mjs ${sourceRel} --layer2 deepseek ...\n`,
      )
      return EXIT.RUN_FAILED
    }
    const passSet = passedObjectIds(found.receipt)

    // 跨章反模式走**它自己那次运行**的判定表，不能拿 chapter 的回执代判（见
    // findLatestAntipatternVerdicts 的说明）。缺判定表时一律不纳入——未判定 ≠ 通过。
    const apVerdicts = await findLatestAntipatternVerdicts({ repoRoot })
    const apVerdictById = new Map((apVerdicts?.verdicts || []).map((v) => [v.objectId, v]))
    const apPassSet = new Set(
      [...apVerdictById.entries()].filter(([, v]) => v.status === 'pass').map(([id]) => id),
    )

    const cluster = deriveCluster(index.anchors, flags.rootAnchor)
    const inCluster = collectClusterObjects(allObjects, cluster.anchors)
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

    const assembled = assembleSkill({
      cluster,
      objects: kept,
      antipatterns: crossKept,
      codePointers,
      slug: flags.slug,
      skillTitle: flags.title,
    })

    const verdict = await verifySkill({
      markdown: assembled.markdown,
      contract: assembled.contract,
      anchorIndexes: [index],
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
        anchorIndexHash: index.sourceHash,
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
        gateReceiptFile: rel(found.file),
        gateReceiptRunId: found.receipt.runId,
      },
    }

    const staging = buildStagingPath(flags.slug, { repoRoot })
    const receiptOut = path.join(path.dirname(staging), 'gate-receipt.json')
    const contractOut = path.join(path.dirname(staging), 'skill-contract.json')

    const summary = {
      slug: flags.slug,
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
