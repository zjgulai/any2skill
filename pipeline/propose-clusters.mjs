#!/usr/bin/env node
/**
 * 环 3 · 语义聚类 CLI（ticket 11，决策见 ADR-024）。
 *
 * 用法：
 *   node pipeline/propose-clusters.mjs --dry-run [--chapter <fileKey>]
 *   node pipeline/propose-clusters.mjs --model <id> --base-url <url> [--chapter <fileKey>] [--no-resume]
 *
 * ## 副作用清单（本文件写什么，跑之前先说清）
 *
 *   `--dry-run`    只读盘、只打印：枚举输入、跑门禁过滤、报每章的规模与调用预算，**不写任何文件、不发任何调用**。
 *   真实运行       每个待跑章一次模型调用（复用命中的章 0 次），逐章把结果写进
 *                  `pipeline/knowledge/clusters.partial.json`（续跑用，*.partial.json 已被 .gitignore 忽略）；
 *                  全部完成后写 `pipeline/knowledge/clusters.json` 与
 *                  `pipeline/registry/skill-candidates.json` 两份正式产物。
 *   `--chapter <k>` 单章模式：只跑（或复用）该章，**只更新 partial 并打印**，不碰两份正式产物。
 *
 * ## 两条前置纪律（都拒绝静默近似）
 *
 *   1. **输入只取门禁一判过「通过」的对象**——判定依据是该源文件最新一份 `run-*.receipt.json`
 *      的 `objectVerdicts[].status === 'pass'`（与环 4 同一口径、同一函数）。缺回执即拒绝开工：
 *      「没有判定记录」不等于「都通过了」，也避免白花聚类调用的钱。
 *   2. **跨章综合产物不参与聚类**（`antipatterns.objects.json`）——它不是任何一章第 2 层的产出，
 *      与 `run-book` 的反模式统计同一口径。
 */

import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, DEFAULT_SOURCE_KEY, buildAnchorIndex, sourceBookRoot } from './tools/anchor-index.mjs'
import { resolveLlmConfig, LlmConfigError, normalizeReasoningEffort } from './tools/llm-client.mjs'
import { unwrapObjectsFile } from './tools/skill-builder.mjs'
import { findLatestReceipt, passedObjectIds } from './build-skill.mjs'
import {
  CLUSTERS_SCHEMA_VERSION,
  SKILL_CANDIDATES_SCHEMA_VERSION,
  clusterPromptFingerprint,
  anchorsOfObject,
  buildClusterUserPrompt,
  buildClusterSystemPrompt,
  candidatesFromChapters,
  chapterInputHash,
  crossChapterDisposition,
  diagnosticsOf,
  proposeChapterClusters,
  readPartialClusters,
  summaryOfObject,
  writeClusters,
  writePartialClusters,
  writeSkillCandidates,
  listClusterInputFiles,
  CROSS_CHAPTER_OBJECTS_FILE,
} from './tools/cluster-proposer.mjs'

export const EXIT = Object.freeze({
  PASS: 0,
  RUN_FAILED: 4,
})

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    dryRun: false,
    json: false,
    repoRoot: DEFAULT_REPO_ROOT,
    model: null,
    baseUrl: null,
    provider: null,
    reasoningEffort: null,
    maxTokens: null,
    chapter: null,
    sourceKey: DEFAULT_SOURCE_KEY,
    resume: true,
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
    else if (a === '--no-resume') flags.resume = false
    else if (a === '--chapter') (flags.chapter = need(i, a)), (i += 1)
    else if (a === '--source-key') (flags.sourceKey = need(i, a)), (i += 1)
    else if (a === '--model') (flags.model = need(i, a)), (i += 1)
    else if (a === '--base-url') (flags.baseUrl = need(i, a)), (i += 1)
    else if (a === '--provider') (flags.provider = need(i, a)), (i += 1)
    else if (a === '--reasoning-effort') (flags.reasoningEffort = need(i, a)), (i += 1)
    else if (a === '--max-tokens') (flags.maxTokens = Number(need(i, a))), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a.startsWith('--')) throw new Error(`未知参数：${a}`)
    else throw new Error(`未知位置参数：${a}（本命令不接受位置参数）`)
  }
  return flags
}

const KNOWLEDGE_REL = path.join('pipeline', 'knowledge')
const REGISTRY_REL = path.join('pipeline', 'registry')

/** 枚举知识平面里的聚类输入文件（排除跨章综合产物）。 */
export async function enumerateClusterInputs(repoRoot) {
  let names = []
  try {
    names = await readdir(path.join(repoRoot, KNOWLEDGE_REL))
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  return listClusterInputFiles(names).map((n) => ({ fileKey: n.replace(/\.objects\.json$/, ''), fileName: n }))
}

/**
 * 按 fileKey 在**全部源**里找一份回执（ticket 18 段③的源过滤）。
 *
 * 两个源的知识对象会共处同一个 `pipeline/knowledge/`（产物单源命名空间是本仓的既有假设，
 * 见卡 18 未决）——枚举时不能只看「有没有回执」，还要看「回执属于哪个源」：
 * 属于别的源 = 本次跳过并**记录下来**，不属于任何源 = 真缺回执，照旧拒绝。
 */
export async function findReceiptSourcePathByFileKey(repoRoot, fileKey) {
  const dir = path.join(repoRoot, REGISTRY_REL)
  let names = []
  try {
    names = await readdir(dir)
  } catch {
    return null
  }
  for (const n of names) {
    if (!/^run-.*\.receipt\.json$/.test(n)) continue
    try {
      const j = JSON.parse(await readFile(path.join(dir, n), 'utf8'))
      if (j.source && typeof j.source.path === 'string' && path.basename(j.source.path) === `${fileKey}.md`) {
        return j.source.path
      }
    } catch {
      // 坏回执不参与判定。
    }
  }
  return null
}

/**
 * 每章的输入准备：读对象、跑门禁过滤、算复用键。**不发调用、不写盘**。
 * 缺回执的章进 `missingReceipts`——调用方在任何模型调用发生**之前**统一拒绝。
 */
export async function prepareChapterInputs(repoRoot, { modelId, sourceKey = DEFAULT_SOURCE_KEY }) {
  const inputs = []
  const missingReceipts = []
  const skippedOtherSource = []
  for (const { fileKey, fileName } of await enumerateClusterInputs(repoRoot)) {
    const objectsPathRel = path.join(KNOWLEDGE_REL, fileName)
    const raw = await readFile(path.join(repoRoot, objectsPathRel))
    const allObjects = unwrapObjectsFile(JSON.parse(raw.toString('utf8')), objectsPathRel)
    const sourceRel = path.join(sourceBookRoot(sourceKey), `${fileKey}.md`)
    const found = await findLatestReceipt(sourceRel, { repoRoot })
    if (!found) {
      const otherSourcePath = await findReceiptSourcePathByFileKey(repoRoot, fileKey)
      if (otherSourcePath !== null) {
        skippedOtherSource.push({ fileKey, receiptSourcePath: otherSourcePath })
        continue
      }
      missingReceipts.push({ fileKey, sourceRel })
      continue
    }
    const passSet = passedObjectIds(found.receipt)
    const kept = allObjects.filter((o) => passSet.has(o.id))
    const excluded = allObjects.filter((o) => !passSet.has(o.id)).map((o) => o.id)
    const rows = kept.map((o) => ({
      id: o.id,
      objectType: o.objectType,
      summary: summaryOfObject(o),
      anchors: anchorsOfObject(o),
    }))
    const chapterTitle = await chapterTitleOf(repoRoot, sourceRel)
    inputs.push({
      fileKey,
      chapterTitle,
      objectsPathRel,
      objectsSha256: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
      gateReceiptFile: path.relative(repoRoot, found.file),
      gateReceiptRunId: found.receipt.runId ?? null,
      objectsTotal: allObjects.length,
      kept,
      rows,
      gateExcluded: excluded,
      inputHash: chapterInputHash({ fileKey, chapterTitle, rows, modelId }),
      sourceRel,
    })
  }
  return { inputs, missingReceipts, skippedOtherSource }
}

/**
 * 章的标题：从源文件的锚点索引取第一个锚点（h1）的标题。取不到时返回 null——
 * 不编造标题。它参与复用键（标题真的出现在提示词里），所以必须在算键之前拿到。
 */
async function chapterTitleOf(repoRoot, sourceRel) {
  try {
    const idx = await buildAnchorIndex(path.join(repoRoot, sourceRel), { repoRoot })
    return idx.anchors?.[0]?.title ?? null
  } catch {
    return null
  }
}

const usageOf = (u) => ({
  calls: 1,
  promptTokens: u?.prompt_tokens ?? u?.input_tokens ?? null,
  completionTokens: u?.completion_tokens ?? u?.output_tokens ?? null,
})

function sumUsage(list) {
  const out = { calls: 0, promptTokens: 0, completionTokens: 0 }
  for (const u of list) {
    out.calls += 1
    out.promptTokens += u?.promptTokens ?? 0
    out.completionTokens += u?.completionTokens ?? 0
  }
  return out
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
    const modelId = flags.model ?? process.env.ANY2SKILLS_LLM_MODEL ?? null
    let { inputs, missingReceipts, skippedOtherSource } = await prepareChapterInputs(repoRoot, { modelId, sourceKey: flags.sourceKey })

    if (flags.chapter) {
      inputs = inputs.filter((c) => c.fileKey === flags.chapter)
      missingReceipts = missingReceipts.filter((c) => c.fileKey === flags.chapter)
      skippedOtherSource = skippedOtherSource.filter((c) => c.fileKey === flags.chapter)
      if (inputs.length === 0 && missingReceipts.length === 0) {
        throw new Error(`--chapter ${flags.chapter} 在知识平面里没有对应的对象文件`)
      }
    }

    if (skippedOtherSource.length > 0) {
      process.stderr.write(
        `本次源键 ${flags.sourceKey}：跳过 ${skippedOtherSource.length} 个属于**其他源**的文件（回执在别的 sources/ 根下）——\n` +
          skippedOtherSource.slice(0, 5).map((x) => `  · ${x.fileKey}（回执来源 ${x.receiptSourcePath}）`).join('\n') +
          (skippedOtherSource.length > 5 ? `\n  …共 ${skippedOtherSource.length} 个` : '') +
          '\n',
      )
    }

    if (missingReceipts.length > 0) {
      process.stderr.write(
        '拒绝开工：以下源文件没有门禁一的判定回执，无法确定「哪些对象通过」——\n' +
          missingReceipts.map((m) => `  · ${m.fileKey}（缺 ${m.sourceRel} 的回执）`).join('\n') +
          '\n先跑：node pipeline/run.mjs <该文件> --layer2 deepseek …\n' +
          '（没有回执 ≠ 对象都通过了；此处提前拒绝，也避免为注定要重做的聚类白付模型调用。）\n',
      )
      return EXIT.RUN_FAILED
    }

    const partial = flags.resume ? await readPartialClusters(repoRoot) : null
    const reusableOf = (c) =>
      partial &&
      partial.promptFingerprint === clusterPromptFingerprint() &&
      partial.chapters?.[c.fileKey]?.inputHash === c.inputHash
        ? partial.chapters[c.fileKey]
        : null

    // ---- dry-run：只报规模，不花钱、不写盘 ----
    if (flags.dryRun) {
      const rows_ = inputs.map((c) => {
        const user = buildClusterUserPrompt({ fileKey: c.fileKey, chapterTitle: c.chapterTitle, rows: c.rows })
        const reusable = reusableOf(c)
        return {
          fileKey: c.fileKey,
          objectsTotal: c.objectsTotal,
          gatePassed: c.rows.length,
          gateExcluded: c.gateExcluded.length,
          userPromptChars: user.length,
          willReuse: Boolean(reusable),
        }
      })
      const out = {
        dryRun: true,
        promptFingerprint: clusterPromptFingerprint(),
        systemPromptChars: buildClusterSystemPrompt().length,
        chapters: rows_,
        plannedCalls: rows_.filter((r) => !r.willReuse).length,
      }
      if (flags.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
      else {
        process.stdout.write(`[dry-run] 未调用模型、未写任何文件。\n提示词指纹：${out.promptFingerprint}\n`)
        for (const r of rows_) {
          process.stdout.write(
            `  ${r.fileKey.padEnd(18)} 对象 ${String(r.objectsTotal).padStart(3)}（通过 ${String(r.gatePassed).padStart(3)}，除外 ${r.gateExcluded}）` +
              `  用户提示词 ${r.userPromptChars} 字符${r.willReuse ? '  [可复用，不调用]' : ''}\n`,
          )
        }
        process.stdout.write(`计划模型调用：${out.plannedCalls} 次\n`)
      }
      return EXIT.PASS
    }

    // ---- 解析路由（真实调用前先解析，配置错误不该等到付钱后才发现） ----
    let config
    try {
      config = await resolveLlmConfig({
        env: process.env,
        overrides: {
          ...(flags.model ? { modelId: flags.model } : {}),
          ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
          ...(flags.provider ? { provider: flags.provider } : {}),
          ...(flags.reasoningEffort
            ? { reasoningEffort: normalizeReasoningEffort(flags.reasoningEffort) }
            : {}),
        },
      })
    } catch (err) {
      if (err instanceof LlmConfigError) {
        process.stderr.write(`[LLM 配置] ${err.message}\n`)
        return EXIT.RUN_FAILED
      }
      throw err
    }
    // 模型的真实取值以路由解析为准（--model 与凭据缺省可能不同），因此复用键在解析后**重算一次**。
    // 在此之前用 flags/环境变量的取值会让同一模型算出两个键——那正是「同输入不同身份」。
    const resolvedModelId = config.modelId ?? modelId
    inputs = inputs.map((c) => ({
      ...c,
      inputHash: chapterInputHash({ fileKey: c.fileKey, chapterTitle: c.chapterTitle, rows: c.rows, modelId: resolvedModelId }),
    }))

    let partialDoc = partial ?? {
      schemaVersion: `${CLUSTERS_SCHEMA_VERSION}-partial`,
      promptFingerprint: clusterPromptFingerprint(),
      chapters: {},
    }
    if (partialDoc.promptFingerprint !== clusterPromptFingerprint()) {
      // 提示词变了：旧 partial 一律作废（身份不可辨的缓存比没有缓存更危险）。
      process.stderr.write('提示词指纹已变化——旧 partial 作废，本次全部重跑。\n')
      partialDoc = { schemaVersion: `${CLUSTERS_SCHEMA_VERSION}-partial`, promptFingerprint: clusterPromptFingerprint(), chapters: {} }
    }

    const chapterRecords = []
    let proposed = 0
    let reused = 0
    for (const c of inputs) {
      const reusable = flags.resume && partialDoc.chapters[c.fileKey]?.inputHash === c.inputHash
        ? partialDoc.chapters[c.fileKey]
        : null
      if (reusable) {
        reused += 1
        chapterRecords.push({ ...reusable, status: 'reused' })
        process.stdout.write(`  ${c.fileKey}：复用（输入身份一致，0 次调用）\n`)
        continue
      }
      const record = await proposeChapterClusters({
        config,
        fileKey: c.fileKey,
        chapterTitle: c.chapterTitle,
        objects: c.kept,
        createdAt: new Date().toISOString(),
        ...(Number.isFinite(flags.maxTokens) ? { maxTokens: flags.maxTokens } : {}),
      })
      proposed += 1
      chapterRecords.push(record)
      partialDoc.chapters[c.fileKey] = record
      await writePartialClusters(partialDoc, repoRoot)
      process.stdout.write(
        `  ${c.fileKey}：单元 ${record.units.length} / 候选 ${record.skills.length}` +
          `（未归类 ${record.coverage.unassigned.length}，未解析 id ${record.coverage.unresolvedObjectIds.length}）\n`,
      )
      if (record.finishReason === 'length') {
        process.stderr.write(`⚠ ${c.fileKey} 的响应被输出上限截断（finish_reason=length）——该章结果可疑，建议调大 --max-tokens 重跑。\n`)
      }
    }

    if (flags.chapter) {
      const rec = chapterRecords[0]
      const out = { chapter: rec, partial: rel(path.join(repoRoot, 'pipeline', 'knowledge', 'clusters.partial.json')) }
      process.stdout.write(flags.json ? `${JSON.stringify(out, null, 2)}\n` : `单章模式：已更新 partial（未写正式产物）。\n`)
      return EXIT.PASS
    }

    const orderedChapters = [...chapterRecords].sort((a, b) => a.fileKey.localeCompare(b.fileKey))
    const objectsFiles = inputs.map((c) => ({
      fileKey: c.fileKey,
      path: c.objectsPathRel,
      sha256: c.objectsSha256,
      gateReceiptFile: c.gateReceiptFile,
      gateReceiptRunId: c.gateReceiptRunId,
      objectsTotal: c.objectsTotal,
      gatePassed: c.rows.length,
      gateExcluded: c.gateExcluded,
    }))

    const clustersDoc = {
      schemaVersion: CLUSTERS_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      promptFingerprint: clusterPromptFingerprint(),
      model: { modelId: resolvedModelId },
      input: { objectsFiles },
      chapters: orderedChapters,
      totals: {
        chapters: orderedChapters.length,
        units: orderedChapters.reduce((s, c) => s + c.units.length, 0),
        skills: orderedChapters.reduce((s, c) => s + c.skills.length, 0),
        gatePassed: orderedChapters.reduce((s, c) => s + c.coverage.gatePassed, 0),
        unassigned: orderedChapters.reduce((s, c) => s + c.coverage.unassigned.length, 0),
        unresolvedObjectIds: orderedChapters.reduce((s, c) => s + c.coverage.unresolvedObjectIds.length, 0),
        duplicates: orderedChapters.reduce((s, c) => s + c.coverage.duplicates.length, 0),
        unitsWithoutSkill: orderedChapters.reduce((s, c) => s + c.coverage.unitsWithoutSkill.length, 0),
        usage: {
          proposed,
          reused,
          ...sumUsage(orderedChapters.filter((c) => c.status === 'proposed').map((c) => usageOf(c.usage))),
        },
      },
    }
    const clustersAbs = await writeClusters(clustersDoc, repoRoot)

    // 跨章综合物：读不到就如实记 absent（与 run-book 同一口径），不按「没有」处理。
    let dispositionBlock
    try {
      const apRaw = JSON.parse(await readFile(path.join(repoRoot, KNOWLEDGE_REL, CROSS_CHAPTER_OBJECTS_FILE), 'utf8'))
      const apObjects = unwrapObjectsFile(apRaw, CROSS_CHAPTER_OBJECTS_FILE)
      dispositionBlock = {
        status: 'present',
        declaredRunId: apRaw.runId ?? null,
        items: crossChapterDisposition(apObjects),
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        dispositionBlock = { status: 'absent', note: `盘上没有 ${CROSS_CHAPTER_OBJECTS_FILE}（先跑卡 06 的命令再回看本块）。` }
      } else {
        throw err
      }
    }

    const candidates = candidatesFromChapters(orderedChapters)
    const candidatesDoc = {
      schemaVersion: SKILL_CANDIDATES_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      clustersFile: rel(clustersAbs),
      clustersSha256: `sha256:${createHash('sha256').update(await readFile(clustersAbs)).digest('hex')}`,
      candidates,
      crossChapterDisposition: dispositionBlock,
      diagnostics: diagnosticsOf(orderedChapters, candidates),
    }
    const candidatesAbs = await writeSkillCandidates(candidatesDoc, repoRoot)

    const t = clustersDoc.totals
    const summary = {
      clusters: rel(clustersAbs),
      candidates: rel(candidatesAbs),
      modelId: resolvedModelId,
      promptFingerprint: clustersDoc.promptFingerprint,
      totals: t,
      disposition:
        dispositionBlock.status === 'present'
          ? dispositionBlock.items.reduce((acc, it) => {
              acc[it.decision] = (acc[it.decision] ?? 0) + 1
              return acc
            }, {})
          : dispositionBlock.status,
    }
    if (flags.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    else {
      process.stdout.write(
        `聚类完成：${t.chapters} 章 / 单元 ${t.units} / 候选 ${t.skills}（本轮调用 ${proposed} 次，复用 ${reused} 章）\n` +
          `产物：${rel(clustersAbs)}\n      ${rel(candidatesAbs)}\n` +
          `覆盖：门禁通过 ${t.gatePassed}，未归类 ${t.unassigned}，未解析 id ${t.unresolvedObjectIds}，重复归属 ${t.duplicates}，无候选单元 ${t.unitsWithoutSkill}\n` +
          (t.unassigned + t.unresolvedObjectIds + t.duplicates + t.unitsWithoutSkill > 0
            ? '⚠ 有对象未被完整归类——明细在 clusters.json 各章的 coverage 里（不静默丢弃，但也不掩盖）。\n'
            : '') +
          (dispositionBlock.status === 'present'
            ? `跨章综合物：${dispositionBlock.items.length} 条结论已落盘（独立候选待门禁二验证 ${dispositionBlock.items.filter((i) => i.decision !== 'distribute-to-pitfalls').length} / 分发 ${dispositionBlock.items.filter((i) => i.decision === 'distribute-to-pitfalls').length}）\n`
            : `跨章综合物：${dispositionBlock.status}\n`) +
          `诊断：候选 ${candidatesDoc.diagnostics.candidateCount} 个；章级对照 ${candidatesDoc.diagnostics.reference.observedSkills} / ${candidatesDoc.diagnostics.reference.observedChapters} 章` +
          `（基准 ${candidatesDoc.diagnostics.reference.skillsPerChapter} skill/章，仅诊断）\n`,
      )
    }
    return EXIT.PASS
  } catch (err) {
    process.stderr.write(`聚类失败：${err?.message ?? err}\n`)
    if (err?.rawText) {
      process.stderr.write('（原始响应已随错误携带，可从 partial 或错误对象取回，无需重新付费。）\n')
    }
    return EXIT.RUN_FAILED
  }
}

export { parseArgs }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
