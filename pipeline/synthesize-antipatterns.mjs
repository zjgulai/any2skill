#!/usr/bin/env node
/**
 * 跨章综合 CLI（ticket 06）。
 *
 * 用法：
 *   node pipeline/synthesize-antipatterns.mjs --themes T02,T12 --model <id> --base-url <url>
 *   node pipeline/synthesize-antipatterns.mjs --themes T02 --model <id> --base-url <url> --no-judge
 *   node pipeline/synthesize-antipatterns.mjs --list        # 只列主题，不调用模型
 *
 * ## 副作用清单
 *
 *   总是写：`pipeline/registry/<producerRunId>.antipattern-raw.json`（第 2 层原始响应，逐主题）
 *           `pipeline/registry/<runId>.antipattern-receipt.json`（回执，**不含对象正文**）
 *           `pipeline/registry/<runId>.antipattern-verdicts.json`（逐对象判定明细）
 *           `pipeline/knowledge/antipatterns.objects.json`（全量对象，供一次查询）
 *   `--list` 只读，不写任何东西、不调用模型。
 *
 *   **两个身份不是同一个**（见 `synthRawRunId` / `synthRunId`）：raw 只由生产者侧输入决定，
 *   回执与判定表再叠加判据身份与流水线版本。这样换判据不会覆盖上一次的判定表，
 *   同时已付费的原始响应仍可被 `replayThemeFromRaw` 免调用重放。
 *
 * ## 为什么判定者默认开
 *
 * 本卡的机制验证要回答的第一个问题就是「判定者会不会把跨章主张全判不充分」。
 * 关掉判定者跑一次，得到的是一份**看起来通过了**的产出——而它恰恰绕过了本轮最想量的那个量。
 * 因此默认开，要关必须显式 `--no-judge`。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from './tools/anchor-index.mjs'
import {
  ANTIPATTERN_MARKS,
  DEFAULT_MAX_PATTERNS_PER_THEME,
  MARK_MEANING,
  SYNTH_ID_PREFIX,
  buildDistribution,
  loadThemeSourceLines,
  replayThemeFromRaw,
  synthPromptFingerprint,
  synthesizeTheme,
} from './tools/antipattern-synthesis.mjs'
import { THEMES_REL_PATH } from './tools/theme-proposer.mjs'
import { CATALOG_REL_PATH } from './tools/theme-catalog.mjs'
import { verifyObjects, REASON_CODES, REASON_OWNER } from './tools/verifier.mjs'
import { judgeObject, describeJudgeRoute, judgePromptFingerprint } from './tools/judge.mjs'
import {
  createUsageLedger,
  resolveJudgeLlmConfig,
  resolveLlmConfig,
  LlmConfigError,
  normalizeReasoningEffort,
  urlHost,
} from './tools/llm-client.mjs'
// `PIPELINE_VERSION` 从这里取，不另立常量：它是**整条流水线**的版本号，
// 复制一份就等于有第二个真源，迟早会与 run.mjs 那份漂开。
import { PIPELINE_VERSION } from './run.mjs'

export const SYNTH_RECEIPT_SCHEMA_VERSION = 'antipattern-receipt/v1'
/** 半成品格式。v2 把**用量**与原始正文一起存——用量是跨进程的，不能只活在本次进程的账本里。 */
export const PARTIAL_RAW_SCHEMA_VERSION = 'antipattern-partial-raw/v2'

const readJson = async (abs) => JSON.parse(await readFile(abs, 'utf8'))

/** 读得到就返回对象，文件不存在返回 null。**只有 ENOENT 算「不存在」**——
 *  权限、损坏的 JSON 一律照抛，否则一个坏掉的半成品会被读成「没有半成品」而静默重跑一遍。 */
const readJsonIfExists = async (abs) => {
  try {
    return JSON.parse(await readFile(abs, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    themes: null,
    list: false,
    json: false,
    noJudge: false,
    repoRoot: DEFAULT_REPO_ROOT,
    model: null,
    baseUrl: null,
    provider: null,
    reasoningEffort: null,
    judgeModel: null,
    judgeReasoningEffort: null,
    maxTokens: null,
    maxPatterns: null,
    resume: true,
  }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--themes') (flags.themes = need(i, a)), (i += 1)
    else if (a === '--list') flags.list = true
    else if (a === '--json') flags.json = true
    else if (a === '--no-judge') flags.noJudge = true
    else if (a === '--no-resume') flags.resume = false
    else if (a === '--model') (flags.model = need(i, a)), (i += 1)
    else if (a === '--base-url') (flags.baseUrl = need(i, a)), (i += 1)
    else if (a === '--provider') (flags.provider = need(i, a)), (i += 1)
    else if (a === '--reasoning-effort') (flags.reasoningEffort = need(i, a)), (i += 1)
    else if (a === '--judge-model') (flags.judgeModel = need(i, a)), (i += 1)
    else if (a === '--judge-reasoning-effort') (flags.judgeReasoningEffort = need(i, a)), (i += 1)
    else if (a === '--max-tokens') (flags.maxTokens = Number(need(i, a))), (i += 1)
    else if (a === '--max-patterns') (flags.maxPatterns = Number(need(i, a))), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a.startsWith('--')) throw new Error(`未知参数：${a}`)
    else throw new Error(`未知位置参数：${a}（本命令不接受位置参数）`)
  }
  return flags
}

/** 载入全部锚点索引。文件清单取自主题清单里的目录记录，因此顺序确定、不随目录变化。 */
async function loadIndices({ repoRoot, manifest, catalog }) {
  const files = catalog?.files ?? manifest.catalog.files
  const indices = []
  for (const f of files) {
    const p = path.join(repoRoot, 'pipeline', 'knowledge', `${f.fileKey}.anchors.json`)
    indices.push(await readJson(p))
  }
  return indices
}

function buildAnchorEntries(indices) {
  const map = new Map()
  for (const index of indices) {
    for (const a of index.anchors) map.set(a.anchor, a)
  }
  return map
}

const digestRunId = (payload) =>
  `run-${createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 12)}`

/**
 * 生产者身份：**决定这批原始响应是什么**的全部输入。它命名 raw 与半成品。
 *
 * 为什么必须与判定产物分开命名（这一条是踩过之后拆的）：
 * 续跑（`replayThemeFromRaw`）只认 `prior.runId === 本次 raw 身份`，也就是说
 * **身份一换，已经付过钱的原始响应就再也读不到**。而该模块明写的设计意图是
 * 「付过钱的产出不得因**下游**改动而重花一次」——改判据提示词、改合并规则、
 * 改版本号都属于下游。把判据身份塞进这一个 id，就同时毁掉这条路径：
 * 判据换代要重买全部主题的原始响应。
 *
 * 于是拆成两个：raw 只用生产者侧身份，判定产物（回执 / 判定表）再叠加判据身份。
 * 两者都写进回执与判定表，可以互相引用。
 */
export function synthRawRunId({ themeIds, promptFingerprint, catalogHash, modelId }) {
  return digestRunId({
    kind: 'raw',
    themeIds: [...themeIds].sort(),
    promptFingerprint,
    catalogHash,
    // 模型必须进身份。少了它，换模型后重跑会**复用上一个模型的原始响应**——
    // 而回执里写的是新模型的 id。那是一次会静默发生的归因错误。
    modelId,
  })
}

/**
 * 判定产物身份：生产者身份 **+ 判据身份 + 流水线版本**。它命名回执与判定表。
 *
 * `judgeEnabled` 是布尔，表达不了「哪一版判据」——这正是上一次的缺口：
 * 判据 `judge-prompt/v1 → v2` 之后，判定表与回执照旧落在同一个 runId 上，
 * 判据身份只能逐个打开文件、从 `judge.instanceId` 前缀反推。
 * `pipelineVersion` 覆盖提示词之外的流水线改动（合并规则、标记规则、物化逻辑）。
 *
 * `kind` 进摘要，使两个 id **在任何配置下都不相等**：否则一份「未启用判定者」
 * 的产物身份可能碰巧与 raw 身份同形，读者无法只凭文件名分辨它装的是哪一类。
 */
export function synthRunId({
  themeIds,
  promptFingerprint,
  catalogHash,
  modelId,
  judgeEnabled,
  judgePromptFingerprint,
  pipelineVersion,
}) {
  return digestRunId({
    kind: 'artifacts',
    themeIds: [...themeIds].sort(),
    promptFingerprint,
    catalogHash,
    modelId,
    judgeEnabled,
    // 未启用判定者时记 null，**不记常量**：那是一次「本次没有判据」的事实，
    // 而不是「本次用的是这一版判据」。若记常量，判据换代会让 `--no-judge`
    // 的产物身份跟着漂移——纯噪声。
    judgePromptFingerprint: judgeEnabled ? judgePromptFingerprint : null,
    pipelineVersion,
  })
}

async function writeJson(absPath, value) {
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

/**
 * 写产物前先把同一路径上的旧产物归档。
 *
 * **这一条是丢了数据之后补的。** 本命令的 runId 只由**输入**决定（主题集合、提示词指纹、
 * 目录哈希、模型），因此「同一批对象再判一遍」会算出同一个 runId、写进同一个文件，
 * 把上一次判定者的逐条结果**静默覆盖**。实测踩到：第一次判定 5 条被拒、第二次 3 条，
 * 而第一次那 5 条**分别是谁、为什么被拒**已经查不到了——两次判定之间的差异
 * （本轮唯一能测到判定者噪声的样本）就这样没了。
 *
 * 归档而不是改 runId：runId 的语义是「这批输入的身份」，把时间戳掺进去就毁了它
 * （同一输入该有同一身份）。重复运行是**运行事件**，两者分开记。
 */
async function archiveIfExists(absPath, { repoRoot }) {
  try {
    const raw = await readFile(absPath, 'utf8')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = path.join(
      repoRoot,
      'pipeline',
      'registry',
      'history',
      `${path.basename(absPath, '.json')}.${stamp}.json`,
    )
    await mkdir(path.dirname(dest), { recursive: true })
    await writeFile(dest, raw, 'utf8')
    return path.relative(repoRoot, dest)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

async function main(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return 2
  }

  const repoRoot = flags.repoRoot
  const manifest = await readJson(path.join(repoRoot, THEMES_REL_PATH))
  let catalog = null
  try {
    catalog = await readJson(path.join(repoRoot, CATALOG_REL_PATH))
  } catch {
    /* 目录缺失时退回主题清单里记录的目录快照（它够用来定位索引文件） */
  }

  if (flags.list) {
    for (const t of manifest.themes) {
      process.stdout.write(
        `${t.id}  ${t.name}  [${t.chapterKeys.length} 章: ${t.chapterKeys.join(',')}]\n`,
      )
    }
    return 0
  }

  const wanted = flags.themes === null ? null : flags.themes.split(',').map((s) => s.trim()).filter(Boolean)
  const selected =
    wanted === null ? manifest.themes : manifest.themes.filter((t) => wanted.includes(t.id))
  if (selected.length === 0) {
    process.stderr.write(`--themes 没有匹配到任何主题（清单里有：${manifest.themes.map((t) => t.id).join(', ')}）\n`)
    return 2
  }
  const unknown = (wanted ?? []).filter((w) => !manifest.themes.some((t) => t.id === w))
  if (unknown.length > 0) {
    process.stderr.write(`--themes 里有清单中不存在的主题：${unknown.join(', ')}\n`)
    return 2
  }

  const indices = await loadIndices({ repoRoot, manifest, catalog })
  const anchorEntries = buildAnchorEntries(indices)

  // ---- 路由解析放在**任何模型调用之前**：配置错误不该等到付过钱才暴露 ----
  let producerConfig
  let judgeConfig = null
  try {
    producerConfig = await resolveLlmConfig({
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
    if (!flags.noJudge) {
      judgeConfig = await resolveJudgeLlmConfig({
        env: process.env,
        overrides: {
          ...(flags.model ? { modelId: flags.model } : {}),
          ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
          ...(flags.provider ? { provider: flags.provider } : {}),
          ...(flags.reasoningEffort
            ? { reasoningEffort: normalizeReasoningEffort(flags.reasoningEffort) }
            : {}),
        },
        judgeOverrides: {
          ...(flags.judgeModel ? { modelId: flags.judgeModel } : {}),
          ...(flags.judgeReasoningEffort
            ? { reasoningEffort: normalizeReasoningEffort(flags.judgeReasoningEffort) }
            : {}),
        },
      })
    }
  } catch (err) {
    if (err instanceof LlmConfigError) {
      process.stderr.write(`[LLM 配置] ${err.message}\n`)
      return 2
    }
    throw err
  }

  const maxPatterns = Number.isFinite(flags.maxPatterns)
    ? flags.maxPatterns
    : DEFAULT_MAX_PATTERNS_PER_THEME
  const producerLedger = createUsageLedger()
  const judgeLedger = createUsageLedger()
  const judgeApplied = judgeConfig !== null

  // 身份分两层：`rawRunId` 只由生产者侧输入决定（它定位**已付费的原始响应**），
  // `runId` 再叠加判据身份与流水线版本（它定位回执与判定表）。详见两个函数的 docstring。
  const producerIdentity = {
    themeIds: selected.map((t) => t.id),
    promptFingerprint: synthPromptFingerprint({ maxPatterns }),
    catalogHash: manifest.catalogHash,
    modelId: producerConfig.modelId,
  }
  const rawRunId = synthRawRunId(producerIdentity)
  const runId = synthRunId({
    ...producerIdentity,
    judgeEnabled: judgeApplied,
    judgePromptFingerprint: judgePromptFingerprint(),
    pipelineVersion: PIPELINE_VERSION,
  })

  // ---- 逐主题综合（**边跑边落盘**） ----
  //
  // 落盘时机是这一段的全部要点。第一版把写盘放在**全部主题之后**，T12 截断时整轮崩溃，
  // 已付费跑完的 T02 连同其原始响应一起丢了——这就是把「付过钱的产出」押在
  // 「后面每一个主题都成功」上的代价。现在每完成一个主题当场写一次。
  // 半成品用 **raw 身份**命名，不用 `runId`。它装的是原始响应，因此它的身份就该只由
  // 「这批原始响应是什么」决定；用判定产物身份命名会让判据换代顺手废掉这份付费产出。
  const partialRawPath = path.join(
    repoRoot,
    'pipeline',
    'registry',
    `${rawRunId}.antipattern-raw.partial.json`,
  )
  const partialObjectsPath = path.join(
    repoRoot,
    'pipeline',
    'knowledge',
    'antipatterns.objects.partial.json',
  )

  const writePartialRaw = () =>
    writeJson(partialRawPath, {
      schemaVersion: PARTIAL_RAW_SCHEMA_VERSION,
      runId: rawRunId,
      entries: rawEntries,
    })

  // 续跑：半成品是「已经付过费的产出」。只有 raw 身份一致才续——它含主题集合、生产者
  // 提示词指纹、目录哈希与模型，任一变化都说明这批原始响应不再对应本次要产出的东西。
  // **判据身份与流水线版本刻意不参与**：换判据不必重买原始响应，那正是 `replayThemeFromRaw` 的用途。
  //
  // `rawEntries[themeId] = { text, usage, modelId }`：用量**挂在它买到的那份原始响应上**。
  // 第一版把用量只放在本次进程的账本里，于是续跑时回执显示「生产者 0 次调用」——
  // 而事实是那批对象是**上一次**调用付的钱。账本跟着进程走，产出却是跨进程的，两者必须分开记。
  let rawEntries = {}
  if (flags.resume !== false) {
    const prior = await readJsonIfExists(partialRawPath)
    if (prior !== null && prior.runId === rawRunId) {
      if (prior.entries !== undefined) {
        rawEntries = prior.entries
      } else if (prior.rawByTheme !== undefined) {
        // v1 半成品：只有正文，没有用量。用量**记为未知，不记为 0**——
        // 把「不知道花了多少」写成「花了 0」会让成本统计凭空变漂亮。
        for (const [k, v] of Object.entries(prior.rawByTheme)) rawEntries[k] = { text: v, usage: null }
      }
      const n = Object.keys(rawEntries).length
      if (n > 0) process.stdout.write(`[续跑] 复用 ${n} 个主题的原始响应（零模型调用）\n`)
    } else if (prior !== null) {
      process.stderr.write(
        `[续跑] 忽略旧半成品：其身份 ${prior.runId} 与本次 ${rawRunId} 不一致（主题集合/生产者提示词/目录/模型有一项变了）\n`,
      )
    }
  }

  const allObjects = []
  const allMarks = []
  const allMerges = []
  const unresolvedAnchors = []
  const perTheme = []
  const themeFailures = []
  const createdAt = new Date().toISOString()

  for (const theme of selected) {
    const reused = Object.prototype.hasOwnProperty.call(rawEntries, theme.id)
    let out
    try {
      if (reused) {
        // 免费重放：物化、合并、标记全在本地跑完，一次模型调用都不发。
        out = replayThemeFromRaw({
          rawText: rawEntries[theme.id].text,
          theme,
          anchorEntries,
          createdAt,
          maxPatterns,
        })
      } else {
        const linesByFile = await loadThemeSourceLines({ theme, repoRoot })
        const callsBefore = producerLedger.calls
        const tokensBefore = { ...producerLedger.tokens }
        const detailBefore = { ...producerLedger.tokensDetail }
        out = await synthesizeTheme({
          config: producerConfig,
          theme,
          linesByFile,
          anchorEntries,
          ledger: producerLedger,
          createdAt,
          maxPatterns,
          ...(Number.isFinite(flags.maxTokens) ? { maxTokens: flags.maxTokens } : {}),
        })
        // **当场落盘**，且把这一次的用量差一并存下来——差值是「本次调用买到这份正文所付的钱」。
        rawEntries[theme.id] = {
          text: out.rawText,
          modelId: producerConfig.modelId,
          inputBytes: out.inputBytes,
          usage: {
            calls: producerLedger.calls - callsBefore,
            input: producerLedger.tokens.input - tokensBefore.input,
            output: producerLedger.tokens.output - tokensBefore.output,
            reasoning: producerLedger.tokensDetail.reasoning - detailBefore.reasoning,
            cachedInput: producerLedger.tokensDetail.cachedInput - detailBefore.cachedInput,
          },
          finishReason: out.finishReason,
          reasoningChars: out.reasoningChars,
        }
        await writePartialRaw()
      }
    } catch (err) {
      // 一个主题失败**不带走其余主题**。整轮中止的代价不是「少一个主题」，
      // 是「后面所有已排队的主题一条都不再跑」，而重来一遍要重新付钱。
      if (typeof err?.rawText === 'string' && err.rawText !== '') {
        rawEntries[theme.id] = { text: err.rawText, usage: null, failed: true }
        await writePartialRaw()
      }
      themeFailures.push({ themeId: theme.id, message: err.message })
      perTheme.push({ themeId: theme.id, outcome: 'failed', error: err.message })
      process.stderr.write(`✗ ${theme.id} 失败：${err.message.split('\n')[0]}\n`)
      continue
    }

    allObjects.push(...out.objects)
    allMarks.push(...out.marks)
    allMerges.push(...out.merges)
    unresolvedAnchors.push(...out.unresolvedAnchors)
    perTheme.push({
      themeId: theme.id,
      name: theme.name,
      outcome: 'ok',
      reusedRaw: reused,
      chapterCount: theme.chapterKeys.length,
      chapters: theme.chapterKeys,
      inputBytes: out.inputBytes,
      objectsProduced: out.objects.length,
      objectIds: out.objects.map((o) => o.id),
      merges: out.merges.length,
      unresolvedAnchors: out.unresolvedAnchors.map((u) => u.anchor),
      usage: out.usage,
      finishReason: out.finishReason,
      reasoningChars: out.reasoningChars,
      marks: out.marks.map((m) => ({ id: m.id, mark: m.mark, chapters: m.chapters })),
    })
    // 对象也当场落盘：模型调用已付费，物化是免费的，没有理由把这两件事绑在一起等。
    await writeJson(partialObjectsPath, {
      schemaVersion: 'knowledge-objects/v1',
      runId,
      objects: allObjects,
      complete: false,
    })
    process.stdout.write(
      `${theme.id} 完成：产出 ${out.objects.length} 条（合并 ${out.merges.length} 条，输入 ${out.inputBytes} 字节）` +
        `${reused ? '（复用原始响应，零调用）' : ''}\n`,
    )
  }

  if (allObjects.length === 0) {
    process.stderr.write('没有任何主题产出对象——不写回执（缺数据集的回执会被读成「跑通了但没东西」）\n')
    return 1
  }

  // ---- 第 3 层：多份索引一起传（跨章出处必须都能解析到） ----
  const verification = await verifyObjects(allObjects, indices, {
    repoRoot,
    ...(judgeApplied
      ? {
          judgeFn: judgeObject,
          judgeConfig,
          judgeLedger,
        }
      : {}),
  })

  const passById = new Map(verification.verdicts.map((v) => [v.objectId, v]))
  const marks = allMarks.map((m) => ({
    ...m,
    verdict: passById.get(m.id)?.status ?? 'unknown',
    reasonCode: passById.get(m.id)?.reasonCode ?? null,
  }))

  // 分布只统计**通过**的对象：把被拒的算进去，「跨章占比」里会混进一批
  // 「引文根本没命中」的东西，而它们的跨章与否没有意义。
  const passedIds = new Set(verification.verdicts.filter((v) => v.status === 'pass').map((v) => v.objectId))
  const distribution = buildDistribution(marks.filter((m) => passedIds.has(m.id)))
  const distributionAll = buildDistribution(marks)

  // 累计用量：把每个主题**当初买到它的那次调用**的用量加总。
  // 缺用量的（v1 半成品）逐条列出，**不按 0 计入**——「不知道花了多少」与「没花钱」
  // 在成本表里必须长得不一样，否则续跑会让账越算越小。
  const cumulativeUsage = { calls: 0, input: 0, output: 0, reasoning: 0, cachedInput: 0 }
  const usageUnknownThemes = []
  for (const [id, entry] of Object.entries(rawEntries)) {
    if (entry === null || typeof entry !== 'object' || entry.usage === null || entry.usage === undefined) {
      usageUnknownThemes.push(id)
      continue
    }
    cumulativeUsage.calls += entry.usage.calls ?? 0
    cumulativeUsage.input += entry.usage.input ?? 0
    cumulativeUsage.output += entry.usage.output ?? 0
    cumulativeUsage.reasoning += entry.usage.reasoning ?? 0
    cumulativeUsage.cachedInput += entry.usage.cachedInput ?? 0
  }

  const receipt = {
    schemaVersion: SYNTH_RECEIPT_SCHEMA_VERSION,
    runId,
    // 原始响应那一侧的身份。回执同时给出两者，使「这份回执对应哪份 raw」不必靠文件名猜。
    producerRunId: rawRunId,
    // 第 2 层的回执一直有这个字段，本命令此前**没有**——于是「这份回执是哪一版流水线产的」
    // 只能靠 createdAt 加 git 历史反推，而流水线版本不完整时那件事做不出来。
    pipelineVersion: PIPELINE_VERSION,
    createdAt,
    themes: {
      manifestPath: THEMES_REL_PATH,
      catalogHash: manifest.catalogHash,
      selected: selected.map((t) => t.id),
      total: manifest.themes.length,
    },
    promptFingerprint: synthPromptFingerprint({ maxPatterns }),
    model: {
      provider: producerConfig.provider,
      modelId: producerConfig.modelId,
      baseUrlHost: urlHost(producerConfig.baseUrl),
      // **本次调用**的用量。续跑时它是 0，而这**不代表这批对象没花钱**。
      thisRun: {
        calls: producerLedger.calls,
        tokens: { ...producerLedger.tokens },
        tokensDetail: { ...producerLedger.tokensDetail },
        failedCalls: producerLedger.failedCalls,
        retries: producerLedger.retries,
      },
      // **本 runId 的累计**用量：把每个主题当初买到它的那次调用的用量加总。
      // 成本归属必须跟着 runId（产出物的身份）走，而不是跟着进程走——
      // 续跑一遍会让「本次 0 次调用」被读成「这批对象免费」。
      cumulative: { ...cumulativeUsage, usageUnknownThemes },
      billing: 'real（真实模型调用，按服务商计费）',
      configSource: {
        modelId: producerConfig.modelSource,
        baseUrl: producerConfig.baseUrlSource,
        apiKey: producerConfig.apiKeySource,
        reasoningEffort: producerConfig.reasoningEffortSource,
      },
      reasoningEffort: producerConfig.reasoningEffort ?? null,
    },
    judge: judgeApplied ? describeJudgeRoute(judgeConfig, judgeLedger) : { enabled: false },
    perTheme,
    // 失败的主题逐条列出。它们与「对象被拒」是两回事：前者是**工程问题**（本次没产出），
    // 后者是**内容问题**（产出了但不过判据）。混在一起会让「模型抽得不好」与
    // 「这次跑崩了」在回执里长得一样。
    themeFailures,
    merges: allMerges,
    unresolvedAnchors,
    // 标记与分布是卡 06 的核心产出。`byMark` 的键集合是封闭的，逐条列出含义，
    // 使回执不依赖外部文档就能被解读。
    marks: {
      codeMeaning: Object.fromEntries(ANTIPATTERN_MARKS.map((c) => [c, MARK_MEANING_LOCAL[c]])),
      distribution,
      distributionAll,
      perObject: marks,
    },
    verification: {
      summary: verification.summary,
      // 逐条给出修复责任方：回执的价值在于能回答「这批拒绝该找谁」，而不是只给一堆码。
      reasonCodeOwners: Object.fromEntries(REASON_CODES.map((c) => [c, REASON_OWNER[c]])),
      // 逐条 sourceRef 引文的比对结果汇总。它回答的是本卡特有的一句话：
      // 「跨章对象的每一条出处，是不是都真的在它自己那一章里命中过」。
      // 第一次真跑时逐条明细**没有落盘**，于是「那 5 条为什么被拒」无处可查——
      // 这是本模块第一版最贵的一个疏漏。
      refQuoteCheck: {
        objectsWithRefQuotes: verification.verdicts.filter((v) => (v.refQuoteComparisons ?? []).length > 0).length,
        totalRefQuotes: verification.verdicts.reduce((n, v) => n + (v.refQuoteComparisons ?? []).length, 0),
        acceptedByStrict: verification.verdicts.reduce(
          (n, v) => n + (v.refQuoteComparisons ?? []).filter((c) => c.acceptedBy === 'strict').length,
          0,
        ),
        acceptedByNormalization: verification.verdicts.reduce(
          (n, v) => n + (v.refQuoteComparisons ?? []).filter((c) => c.acceptedBy === 'normalization').length,
          0,
        ),
        missed: verification.verdicts.reduce(
          (n, v) => n + (v.refQuoteComparisons ?? []).filter((c) => c.acceptedBy === null).length,
          0,
        ),
      },
    },
    counts: {
      themesRequested: selected.length,
      themesRun: perTheme.filter((t) => t.outcome === 'ok').length,
      themesFailed: themeFailures.length,
      objectsProduced: allObjects.length,
      passed: verification.summary.passed,
      rejected: verification.summary.rejected,
    },
  }

  // raw 用生产者身份命名（与半成品同一身份，续跑才找得到）；回执与判定表用判定产物身份。
  const rawPath = path.join(repoRoot, 'pipeline', 'registry', `${rawRunId}.antipattern-raw.json`)
  const receiptPath = path.join(repoRoot, 'pipeline', 'registry', `${runId}.antipattern-receipt.json`)
  const verdictsPath = path.join(repoRoot, 'pipeline', 'registry', `${runId}.antipattern-verdicts.json`)
  const objectsPath = path.join(repoRoot, 'pipeline', 'knowledge', 'antipatterns.objects.json')

  // 旧产物先归档，再写新的。重复运行是**运行事件**，不该静默覆盖上一次的记录。
  // 身份拆开之后这条**不再是判据换代的主要防线**（换判据本来就换文件名了），
  // 但仍然是「同一身份重跑」的防线，且是四份产物唯一的兜底。
  const archived = []
  for (const p of [rawPath, receiptPath, verdictsPath, objectsPath]) {
    const dest = await archiveIfExists(p, { repoRoot })
    if (dest !== null) archived.push(dest)
  }

  await writeJson(rawPath, {
    schemaVersion: PARTIAL_RAW_SCHEMA_VERSION,
    runId: rawRunId,
    entries: rawEntries,
  })
  await writeJson(receiptPath, receipt)
  // 逐对象判定明细单独落盘，**不塞进回执**：回执要能一屏读完（卡 08 的「体量可控」），
  // 而明细要能回答「这一条为什么被拒」。两件事的读者不同，混在一起两件事都做不好。
  //
  // v1 → v2：判定表原来**自己不声明判据身份**——顶层只有 schemaVersion / runId / verdicts，
  // 而 runId 里没有判据；判据身份只能逐个对象打开 `judge.instanceId` 反推前缀。这是个
  // 真实的可读性缺口（分辨 v1 与 v2 两份判定表要写脚本），补上三个身份字段。
  await writeJson(verdictsPath, {
    schemaVersion: 'antipattern-verdicts/v2',
    runId,
    producerRunId: rawRunId,
    judgeEnabled: judgeApplied,
    judgePromptVersion: judgeApplied ? receipt.judge.promptVersion : null,
    judgePromptFingerprint: judgeApplied ? receipt.judge.promptFingerprint : null,
    pipelineVersion: PIPELINE_VERSION,
    verdicts: verification.verdicts,
  })
  await writeJson(objectsPath, {
    schemaVersion: 'knowledge-objects/v1',
    runId,
    objectType: 'AntiPattern',
    idPrefix: SYNTH_ID_PREFIX,
    source: 'antipattern-synthesis',
    complete: themeFailures.length === 0,
    objects: allObjects,
  })

  const out = {
    runId,
    producerRunId: rawRunId,
    receipt: path.relative(repoRoot, receiptPath),
    objects: path.relative(repoRoot, objectsPath),
    objectsRaw: path.relative(repoRoot, rawPath),
    objectsVerdicts: path.relative(repoRoot, verdictsPath),
    archivedPriorRuns: archived,
    themeFailures,
    counts: receipt.counts,
    distribution,
    byReasonCode: verification.summary.byReasonCode,
    judge: verification.summary.judge,
    producerTokens: { ...producerLedger.tokens, ...producerLedger.tokensDetail },
    judgeTokens: { ...judgeLedger.tokens, ...judgeLedger.tokensDetail },
  }
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
  } else {
    process.stdout.write(
      `\n综合完成：${receipt.counts.themesRun}/${selected.length} 个主题成功` +
        `${themeFailures.length > 0 ? `（${themeFailures.length} 个失败）` : ''}` +
        ` → ${allObjects.length} 条对象，通过 ${verification.summary.passed} / 拒绝 ${verification.summary.rejected}\n` +
        `判定者：${judgeApplied ? `${verification.summary.judge.calls} 次调用` : '未启用'}\n` +
        `跨章分布（仅通过者）：${distribution.multiChapter}/${distribution.total}` +
        `（跨章占比 ${distribution.crossChapterRatio.numerator}/${distribution.crossChapterRatio.denominator}` +
        `${distribution.crossChapterRatio.decimal === null ? '' : ` = ${distribution.crossChapterRatio.decimal}`}）\n` +
        `标记分布：${JSON.stringify(distribution.byMark)}\n` +
        `被引用章节：${JSON.stringify(distribution.chaptersCited)}\n` +
        `拒绝理由码：${JSON.stringify(verification.summary.byReasonCode)}\n` +
        `对象：${path.relative(repoRoot, objectsPath)}\n回执：${path.relative(repoRoot, receiptPath)}\n`,
    )
  }
  // 有主题失败就退回非零码。**这一条必须自己给**：调用方常常把本命令接在管道里，
  // 那时退出码来自管道最后一环而不是本进程——实测踩到过，崩溃被报成 exit 0。
  return themeFailures.length > 0 ? 1 : 0
}

/** 回执里逐条列出标记含义，使回执自身可读（**单一真源**：与 synthesis 模块的 MARK_MEANING 同源）。 */
const MARK_MEANING_LOCAL = MARK_MEANING

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
