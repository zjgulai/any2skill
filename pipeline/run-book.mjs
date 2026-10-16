/**
 * 全书运行（ticket 09）· 第二个命令行接缝
 *
 *   node pipeline/run-book.mjs --layer2 stub                       # 全书 13 个源文件，零调用（离线可复跑）
 *   node pipeline/run-book.mjs --layer2 deepseek --concurrency 3   # 真实模型；文件级并发
 *   node pipeline/run-book.mjs --dry-run                           # 只列文件与成本口径，不跑流水线
 *   node pipeline/run-book.mjs --from pipeline/registry/<id>.book-receipt.json --file chapter2   # 按文件查询
 *   node pipeline/run-book.mjs --verify-isolation <book-receipt.json>   # 重跑污染隔离检查（可复跑项）
 *
 * ## 它为什么是「第二个接缝」而不是「给 run.mjs 加一个 --all」
 *
 * `run.mjs` 的接缝是**一个内容源文件**：它的位置参数、回执文件名（`run-<id>`）、退出码语义
 * 都按「一次一个文件」定义。把一个目录塞进同一个位置参数，会让回执身份、退出码与
 * `--objects-fixture` 这些既有语义全部产生二义（「三个文件里有一个失败，退出码是几？」）。
 *
 * 因此本命令**不重新实现任何一层**：它对每个文件调用的是同一个 `pipeline/run.mjs`
 * （子进程、同一套 flags、同一份退出码），自己只做三件 run.mjs 按定义不做的事——
 * ① 确定性枚举；② 跨文件的聚合回执；③ 把运行期文件访问账本并进来做污染隔离断言。
 *
 * ## 不交互
 *
 * 全书运行**不读 stdin、不等待确认**：任何一个「要不要继续」的提问都会让它无法无人值守地跑完
 * （ticket 09 的硬要求）。进度打在 stderr，回执写在文件里。
 *
 * ## 污染隔离（ADR-001 / 规格 D9）
 *
 * 卡 01 的路径守卫挡在**入口**；本命令补的是**反向证据**：一次完整全书运行的运行期访问清单里
 * 不含基准目录。做法是让本进程与每个子进程都带上 `--require pipeline/tools/fs-ledger.cjs`
 * （`pipeline/tools/fs-ledger.cjs` 在模块图加载前接管 `node:fs` 的导出，因此链路里
 * 任何一处直接读文件都会被记录，包括绕过任何包装的读法）。
 *
 * **隔离不是「没记录就算过」**：子进程数必须等于账本文件数，缺一即判缺；
 * 账本缺席或截断时本命令**拒绝**给出隔离结论（抛错，退出码 4）。
 */

import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_BENCHMARK_DIR,
  DEFAULT_REPO_ROOT,
  DEFAULT_SOURCE_KEY,
  DEFAULT_SOURCE_ROOT,
  SourcePathError,
  assertAllowedSource,
  resolveRealPath,
  sha256Hex,
  sourceBookRoot,
} from './tools/anchor-index.mjs'
import { assertIsolation, loadLedger, mergeLedgers, summarizeLedger } from './tools/fs-ledger.mjs'
import { crossChapterObjectsFile, isCrossChapterObjectsFile } from './tools/cluster-proposer.mjs'
import { EXIT, PIPELINE_VERSION, RECEIPT_SCHEMA_VERSION, REGISTRY_DIR, CLI_FLAGS } from './run.mjs'
import { findReceiptSourcePathByFileKey } from './propose-clusters.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = path.join(HERE, 'run.mjs')
const LEDGER_PRELOAD = path.join(HERE, 'tools', 'fs-ledger.cjs')

/**
 * 聚合回执的 schema 版本。
 *
 * v1 → v2（2026-10-12）：`totals.judge.enabled` 的口径从「**每个**文件都跑了判定者」
 * 改为「**至少一个**文件真的跑了判定者」，并新增 `allFilesJudged` 与 `filesJudged`。
 * 旧口径在混合回放时会印出「未启用 + 560 次调用」的自相矛盾读数（见测试钉住）。
 * 逐文件行与其余字段未变；读 v1 回执的旧代码不受影响（`--from` 不校验版本）。
 */
const BOOK_RECEIPT_SCHEMA_VERSION = 'book-receipt/v2'
/** 文件级并发的上限：不是性能调优，是**别把自己打成限流**。 */
const MAX_CONCURRENCY = 8
const LEDGER_DIR = path.join(REGISTRY_DIR, 'fs-ledger')

/* ──────────────────────────── 确定性枚举 ──────────────────────────── */

/**
 * 枚举全书源文件。
 *
 * **按文件名排序**，不按 `readdir` 的返回顺序：目录顺序是文件系统的性质，不是内容的性质，
 * 而本命令的产物身份（`bookRunId`）与聚合回执的行序都必须只由内容决定
 * （ticket 09：「同一输入重复运行……不因并发或顺序而变化」）。
 */
async function listBookSources(repoRoot, { sourceRoot = DEFAULT_SOURCE_ROOT } = {}) {
  const rootAbs = path.join(repoRoot, sourceRoot)
  const entries = await readdir(rootAbs)
  const md = entries.filter((f) => f.endsWith('.md')).sort()
  const out = []
  for (const name of md) {
    const rel = path.join(sourceRoot, name)
    // 每个文件都过一遍卡 01 的路径守卫：枚举本身也不给越界留后门。
    const abs = assertAllowedSource(path.join(repoRoot, rel), { repoRoot, sourceRoot })
    const buf = await readFile(abs)
    out.push({ fileKey: name.replace(/\.md$/, ''), path: rel, abs, bytes: buf.byteLength, sha256: `sha256:${sha256Hex(buf.toString('utf8'))}` })
  }
  return out
}

/**
 * 全书运行标识。
 *
 * **只由声明式输入决定**：文件清单（路径 + 内容哈希）+ 第 2 层实现 + 模型 + 门禁是否含判定者
 * + 流水线版本。刻意**不含**「这次实际产出了什么」——与 `run.mjs` 的 `computeRunId` 不同，
 * 那里的指纹含对象集合（同一输入的真实模型两次产出不同 → 两份回执并存）。
 * 全书这一层要的是「同一本书、同一套配置 → 同一份聚合回执」，否则每跑一次就多一份
 * 「全书回执」，读者无法判断哪一份对应当前的对象平面。
 * 对象层面的漂移由**各文件的 runId** 记录在回执行内，不在这一层折叠掉。
 *
 * **并发度不进指纹**：串行与并行必须产出同一身份，否则「串并行等价」无法用身份来断言。
 */
export function computeBookRunId({ sources, layer2, modelId, judgeApplied, pipelineVersion = PIPELINE_VERSION }) {
  const fingerprint = [
    sources.map((s) => `${s.path}\t${s.sha256}`).join('\n'),
    `layer2:${layer2}`,
    `model:${modelId ?? 'default'}`,
    `gate:${judgeApplied ? 'full' : 'deterministic-only'}`,
    `pipeline:v${pipelineVersion}`,
  ].join('\n')
  return `book-${sha256Hex(fingerprint).slice(0, 12)}`
}

function bookReceiptPathFor(bookRunId) {
  return path.join(REGISTRY_DIR, `${bookRunId}.book-receipt.json`)
}

/**
 * 全书身份里 `gate:` 段的取值：**配置层面**判定者是否可能生效。
 *
 * 这里刻意不照抄 `run.mjs` 的「本次实际有没有调用判定者」口径——那一个要等子进程回来才知道，
 * 而 bookRunId 必须在运行**之前**定下来（编排进程的账本文件名用它，见 `fs-ledger.cjs` 的 outPath）。
 * 两处口径的关系写清楚了才算数：`stub` 路径在 `run.mjs` 里判定者必被关（无从调用），
 * `--no-judge` 显式关闭，因此这里的 `false` 是「实际也不会跑」的准确预测；
 * 纯回放运行的残留差异（预测 `full`、实际 0 次调用）由回执 `totals.judge.*` 的**实际值**承担，
 * 不假装身份能覆盖它。
 */
function judgeAppliedFor(flags, passthrough) {
  return flags.layer2 !== 'stub' && !passthrough.includes('--no-judge')
}

/* ──────────────────────────── 反模式分布 ──────────────────────────── */

/** 跨章综合的落盘文件名（卡 06，按源命名空间见 `crossChapterObjectsFile`）。在 `collectAntipatterns` 里单独成块，不得混进逐章统计。 */

/** `chapter4#h2-2` → `chapter4`；无 `#` 时退回文件基名。 */
function chapterOfRef(ref) {
  const s = String(ref ?? '')
  const head = s.includes('#') ? s.slice(0, s.indexOf('#')) : s
  return path.basename(head).replace(/\.md$/, '')
}

/**
 * 反模式分布（承 06；**不设阈值**）。
 *
 * 「跨章」的判据是**引用的章节数 ≥2**，取自每条反模式自己声明的 `sourceRefs`——
 * 不是「引用了多少个锚点」（同一章的两个锚点不是跨章），也不是任何相似度阈值。
 */
function antipatternDistribution(objects, { label }) {
  const aps = objects.filter((o) => o?.objectType === 'AntiPattern')
  const withChapters = aps.map((o) => {
    const chapters = [...new Set((o.sourceRefs ?? []).map((r) => chapterOfRef(r.anchor ?? r.file)))]
    return { id: o.id, chapters: chapters.sort(), anchorCount: (o.sourceRefs ?? []).length }
  })
  const cross = withChapters.filter((a) => a.chapters.length >= 2)
  const referencedChapters = {}
  for (const a of withChapters) for (const c of a.chapters) referencedChapters[c] = (referencedChapters[c] ?? 0) + 1
  return {
    label,
    total: aps.length,
    crossChapter: cross.length,
    crossChapterRatio: aps.length === 0 ? null : Number((cross.length / aps.length).toFixed(4)),
    sourceRefsPerObject: {
      mean: aps.length === 0 ? null : Number((withChapters.reduce((s, a) => s + a.anchorCount, 0) / aps.length).toFixed(2)),
      max: aps.length === 0 ? null : Math.max(...withChapters.map((a) => a.anchorCount)),
    },
    referencedChapters: Object.fromEntries(Object.entries(referencedChapters).sort()),
    crossChapterIds: cross.map((a) => a.id).sort(),
  }
}

/** 对象文件两种形状：第 2 层的裸数组，与跨章综合的 `{objects:[…]}`。不猜——形状不认识就抛。 */
export function objectsOf(parsed) {
  if (Array.isArray(parsed)) return parsed
  if (parsed && Array.isArray(parsed.objects)) return parsed.objects
  throw new Error(`对象文件形状不可识别：期望数组或 {objects:[…]}，实际顶层键为 ${Object.keys(parsed ?? {}).join(',')}`)
}

/* ──────────────────────────── 并发执行 ──────────────────────────── */

/** 有界并发，**结果按输入顺序返回**（并发度不得改变产物的顺序性质）。 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next
      next += 1
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return results
}

/* ──────────────────────────── 参数 ──────────────────────────── */

export function parseBookArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    json: false,
    dryRun: false,
    ledger: true,
    repoRoot: DEFAULT_REPO_ROOT,
    concurrency: 1,
    layer2: 'stub',
    // 源键（ticket 18）：本命令**自己消费**它（要枚举书源）并原样注入每个子进程——
    // 透传白名单管不到它，因为编排进程自己也要用同一个值。
    sourceKey: DEFAULT_SOURCE_KEY,
    from: null,
    file: null,
    verifyIsolation: null,
  }
  const passthrough = []
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new SourcePathError(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--json') flags.json = true
    else if (a === '--dry-run') flags.dryRun = true
    else if (a === '--no-ledger') flags.ledger = false
    else if (a === '--repo-root') flags.repoRoot = path.resolve(need(i, a)), (i += 1)
    else if (a === '--concurrency') flags.concurrency = Number(need(i, a)), (i += 1)
    else if (a === '--layer2') flags.layer2 = need(i, a), (i += 1), passthrough.push('--layer2', flags.layer2)
    else if (a === '--source-key') flags.sourceKey = need(i, a), (i += 1), passthrough.push('--source-key', flags.sourceKey)
    else if (a === '--from') flags.from = need(i, a), (i += 1)
    else if (a === '--file') flags.file = need(i, a), (i += 1)
    else if (a === '--verify-isolation') flags.verifyIsolation = need(i, a), (i += 1)
    else if (CLI_FLAGS[a] !== undefined) {
      // 透传的是 `run.mjs` 的开关，取值型必须连**取值**一起带走——只带走开关名会让
      // 子进程把它后面的那个词当成位置参数（源文件），从而去跑一个不存在的文件。
      passthrough.push(a)
      if (CLI_FLAGS[a].kind === 'value') {
        passthrough.push(need(i, a))
        i += 1
      }
    } else if (a.startsWith('--')) {
      throw new SourcePathError(`未知参数：${a}（本命令自己的开关见 main 的用法说明；run.mjs 的开关可原样透传）`)
    } else {
      throw new SourcePathError(`未知的位置参数：${a}（本命令的源文件清单来自目录枚举，不接受单个文件）`)
    }
  }
  if (!Number.isInteger(flags.concurrency) || flags.concurrency < 1 || flags.concurrency > MAX_CONCURRENCY) {
    throw new SourcePathError(`--concurrency 必须是 1..${MAX_CONCURRENCY} 的整数，实际为 ${flags.concurrency}`)
  }
  return { flags, passthrough }
}

/* ──────────────────────────── 隔离账本 ──────────────────────────── */

/**
 * 把本进程与全部子进程的账本合并、断言，并给出**可进回执的形状**。
 *
 * `expectedProcesses` 是「应当有多少份账本」——由调用方按**实际启动了几个进程**给出。
 * 缺一份就判缺：这是本函数与「读一读账本看有没有命中」的全部区别。
 */
async function collectIsolation(repoRoot, { ledgerPaths, expectedProcesses, label }) {
  const loaded = []
  const missing = []
  for (const abs of ledgerPaths) {
    const l = await loadLedger(abs)
    if (l === null) missing.push(path.relative(repoRoot, abs))
    loaded.push(l)
  }
  const merged = mergeLedgers(loaded)
  const summary = summarizeLedger(merged, { repoRoot, benchmarkDir: DEFAULT_BENCHMARK_DIR, skillsDir: 'skills', sourceRoot: 'sources' })
  const complete = missing.length === 0 && summary.ledgerFiles === expectedProcesses
  return {
    label,
    summary,
    missing,
    expectedProcesses,
    complete,
    note: complete
      ? `账本齐备：${summary.ledgerFiles} 份进程账本，合计 ${summary.recordCount} 条访问记录，` +
        `其中落在 ${DEFAULT_BENCHMARK_DIR}/ 内的 ${summary.benchmark.total} 条。`
      : `账本**不齐**：应有 ${expectedProcesses} 份，实到 ${summary.ledgerFiles} 份，缺 ${missing.length} 份` +
        `（${missing.join(', ') || '—'}）。缺少记录不等于没有访问，本次不得据此判隔离通过。`,
  }
}

/* ──────────────────────────── 跑一个文件 ──────────────────────────── */

/**
 * 一个源文件 = 一个 `run.mjs` 子进程 = 一份运行期访问账本。
 *
 * 子进程而不是「进程内调用 runPipeline」的理由：`run.mjs` 的运行失败路径（工程问题）会
 * 自己写一份失败回执并给出退出码 4——那是 `main()` 的职责。进程内调用要么把它重写一遍
 * （第二个真源），要么把工程问题伪装成抛错。
 */
function runOneFile({ sourceRel, repoRoot, passthrough, ledgerPath, env }) {
  return new Promise((resolve) => {
    const audit = typeof ledgerPath === 'string' && ledgerPath !== ''
    const argv = [...(audit ? ['--require', LEDGER_PRELOAD] : []), CLI, sourceRel, '--json', '--repo-root', repoRoot, ...passthrough]
    const childEnv = { ...env }
    // `--no-ledger` 必须**真的**不装钩子，而不是「装了但不报」。留一个没人读的账本，
    // 下次有人顺手把它捡起来，就会拿一份「关了审计的运行」当隔离证据。
    if (audit) childEnv.DSH_FS_LEDGER = ledgerPath
    else delete childEnv.DSH_FS_LEDGER
    const child = spawn(process.execPath, argv, { cwd: repoRoot, env: childEnv })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code, signal) => {
      let receipt = null
      let parseError = null
      try {
        receipt = JSON.parse(stdout)
      } catch (err) {
        parseError = err.message
      }
      resolve({ exitCode: code ?? EXIT.RUN_FAILED, signal: signal ?? null, receipt, stdout, stderr, parseError })
    })
  })
}

/* ──────────────────────────── 主流程 ──────────────────────────── */

async function runBook(input) {
  const repoRoot = resolveRealPath(input.repoRoot ?? DEFAULT_REPO_ROOT)
  const { flags, passthrough } = input
  const startedAt = new Date().toISOString()

  const sourceKey = flags.sourceKey ?? DEFAULT_SOURCE_KEY
  const sourceRoot = sourceBookRoot(sourceKey)
  const sources = await listBookSources(repoRoot, { sourceRoot })
  if (sources.length === 0) throw new Error(`源正文目录内没有任何 .md：${sourceRoot}（源键 ${sourceKey}）`)

  const judgeApplied = judgeAppliedFor(flags, passthrough)
  const modelId = readFlagValue(passthrough, '--llm-model')
  const bookRunId = computeBookRunId({ sources, layer2: flags.layer2, modelId, judgeApplied })

  const ledgerDirAbs = path.join(repoRoot, LEDGER_DIR)
  await mkdir(ledgerDirAbs, { recursive: true })

  // 「本次有没有审计」由**预载是否已经挂上**决定，不由一个可能被误传的开关决定：
  // 没挂上预载的进程，其子进程也不该产出账本（否则会出现一份「谁也没读」的假证据）。
  const audit = Boolean(process.env.DSH_FS_LEDGER)

  // 编排进程自己的账本改名为**由内容决定**的名字（预载在退出时才读这个环境变量，见
  // `fs-ledger.cjs` 的 outPath）。
  if (audit) {
    process.env.DSH_FS_LEDGER = path.join(ledgerDirAbs, `${bookRunId}.orchestrator.json`)
  }

  const tasks = sources.map((s) => ({
    source: s,
    ledgerPath: audit ? path.join(ledgerDirAbs, `${bookRunId}.${s.fileKey}.json`) : null,
  }))

  const log = (msg) => process.stderr.write(msg)
  log(`全书运行 ${bookRunId}：${sources.length} 个源文件，第 2 层 ${flags.layer2}，并发 ${flags.concurrency}\n`)

  let done = 0
  const results = await mapWithConcurrency(tasks, flags.concurrency, async (t, index) => {
    // 进度标签用**任务自己的序号**，不用共享的完成计数：并发下后者会变成「第 5 个开始、
    // 第 4 个完成」这种读起来像乱序的编号，而这份日志是要进仓当证据的。
    const label = `[${index + 1}/${tasks.length}] ${t.source.fileKey}`
    const t0 = Date.now()
    log(`  ${label} …\n`)
    const r = await runOneFile({
      sourceRel: t.source.path,
      repoRoot,
      passthrough,
      ledgerPath: t.ledgerPath,
      env: process.env,
    })
    done += 1
    const secs = ((Date.now() - t0) / 1000).toFixed(0)
    log(
      `  ${label} 退出码 ${r.exitCode}·${secs}s` +
        (r.receipt ? `（对象 ${r.receipt.counts.objects}，通过 ${r.receipt.counts.passed}，拒绝 ${r.receipt.counts.rejected}）` : '（无回执）') +
        `  [已完成 ${done}/${tasks.length}]\n`,
    )
    return { task: t, result: r }
  })

  // ---- 逐文件行 ----
  const files = results.map(({ task, result }) => {
    const rc = result.receipt
    return {
      fileKey: task.source.fileKey,
      path: task.source.path,
      sha256: task.source.sha256,
      bytes: task.source.bytes,
      exitCode: result.exitCode,
      runId: rc?.runId ?? null,
      receiptPath: rc ? path.join(REGISTRY_DIR, `${rc.runId}.receipt.json`) : null,
      counts: rc?.counts ?? null,
      reasonCodes: rc?.reasonCodes?.byCode ?? null,
      coverage: rc?.coverage
        ? {
            indexAnchors: rc.coverage.indexAnchors,
            processedAnchors: rc.coverage.processedAnchors,
            coveredAnchors: rc.coverage.coveredAnchors,
            withoutObjects: rc.coverage.withoutObjects,
          }
        : null,
      objectTypes: rc?.counts?.objectTypes ?? null,
      model: rc?.model ? { modelId: rc.model.modelId, calls: rc.model.calls, tokens: rc.model.tokens, failedCalls: rc.model.failedCalls } : null,
      judge: rc?.judge ? { enabled: rc.judge.enabled, calls: rc.judge.calls ?? 0, tokens: rc.judge.tokens ?? null, summary: rc.judge.summary ?? null } : null,
      verificationGate: rc?.verificationGate ?? null,
      engineeringFailure: rc?.engineeringFailure ?? null,
      childStderr: result.stderr.trim() === '' ? null : result.stderr.trim().slice(0, 4000),
      noReceipt: rc === null,
      noReceiptReason: result.parseError,
    }
  })

  // ---- 聚合 ----
  const totals = aggregateTotals(files)
  const antipatterns = await collectAntipatterns(repoRoot, { sourceKey })

  // ---- 隔离 ----
  //
  // **两份证据分开报，因为它们的可断言时点不同。**
  // 子进程账本在子进程退出时就写完了，本回执写下时它们已齐备 → 可以当场断言；
  // 编排进程的账本由预载在**本进程退出时**落盘，比本回执晚一步 →
  // 只能记录它**将**落在哪里，不能假装已经读到。
  // 把「一份还没写出来的账本」并进 `complete` 判定，会让每一次运行都报「账本不齐」，
  // 而一条永远为假的告警等于没有告警。
  const childrenIsolation = await collectIsolation(repoRoot, {
    ledgerPaths: tasks.map((t) => t.ledgerPath).filter((p) => typeof p === 'string'),
    expectedProcesses: tasks.length,
    label: '全书运行·子进程',
  })
  const orchestratorLedgerPath = process.env.DSH_FS_LEDGER ?? null

  const exitCode = files.some((f) => f.exitCode === EXIT.RUN_FAILED) ? EXIT.RUN_FAILED : files.some((f) => f.exitCode === EXIT.OBJECT_REJECTED) ? EXIT.OBJECT_REJECTED : EXIT.PASS

  const receipt = {
    schemaVersion: BOOK_RECEIPT_SCHEMA_VERSION,
    receiptSchemaVersion: RECEIPT_SCHEMA_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    bookRunId,
    createdAt: startedAt,
    finishedAt: new Date().toISOString(),
    sourceRoot: DEFAULT_SOURCE_ROOT,
    inputs: {
      layer2: flags.layer2,
      concurrency: flags.concurrency,
      passthrough,
      judgeApplied,
      sourceKey,
      sourceRoot,
      sources: sources.map((s) => ({ fileKey: s.fileKey, path: s.path, sha256: s.sha256, bytes: s.bytes })),
    },
    exitCode,
    files,
    totals,
    antipatterns,
    isolation: {
      children: {
        expectedProcesses: childrenIsolation.expectedProcesses,
        complete: childrenIsolation.complete,
        missing: childrenIsolation.missing,
        note: childrenIsolation.note,
        ledger: childrenIsolation.summary,
      },
      orchestratorLedgerPath,
      verifyCommand: `node pipeline/run-book.mjs --verify-isolation ${bookReceiptPathFor(bookRunId)}`,
      note:
        '子进程账本已齐备并可当场断言（见 children）。编排进程自己的账本在**本进程退出时**落盘，' +
        '因此不在上面的汇总里——把两边合起来复核用上面的 verifyCommand。' +
        '账本缺席或截断时该命令**拒绝**给出隔离结论（不按「没有记录」判通过）。',
    },
  }

  return { exitCode, receipt, repoRoot, bookRunId }
}

/** 从透传参数里读一个取值型 flag。 */
function readFlagValue(passthrough, name) {
  const i = passthrough.indexOf(name)
  return i >= 0 && passthrough[i + 1] !== undefined ? passthrough[i + 1] : null
}

/**
 * 聚合计数。
 *
 * 每一格都**从逐文件行复算**，不另存一份手工维护的小计：`totals` 与 `files[]` 不一致
 * 是这类回执最典型的失效方式（改了一处忘了另一处），而它恰好可以用一条纯函数断言钉住。
 */
export function aggregateTotals(files) {
  const sum = (pick) => files.reduce((s, f) => s + (pick(f) ?? 0), 0)
  const objectTypes = {}
  const reasonCodesByCode = {}
  for (const f of files) {
    for (const [k, v] of Object.entries(f.objectTypes ?? {})) objectTypes[k] = (objectTypes[k] ?? 0) + v
    for (const [k, v] of Object.entries(f.reasonCodes ?? {})) reasonCodesByCode[k] = (reasonCodesByCode[k] ?? 0) + v
  }
  return {
    files: files.length,
    filesPassed: files.filter((f) => f.exitCode === EXIT.PASS).length,
    filesRejected: files.filter((f) => f.exitCode === EXIT.OBJECT_REJECTED).length,
    filesFailed: files.filter((f) => f.exitCode === EXIT.RUN_FAILED).length,
    filesWithoutReceipt: files.filter((f) => f.noReceipt).length,
    anchors: sum((f) => f.coverage?.indexAnchors),
    processedAnchors: sum((f) => f.coverage?.processedAnchors),
    coveredAnchors: sum((f) => f.coverage?.coveredAnchors),
    anchorsWithoutObjects: sum((f) => f.coverage?.withoutObjects?.count),
    objects: sum((f) => f.counts?.objects),
    passed: sum((f) => f.counts?.passed),
    rejected: sum((f) => f.counts?.rejected),
    objectTypes,
    reasonCodesByCode,
    model: {
      calls: sum((f) => f.model?.calls),
      inputTokens: sum((f) => f.model?.tokens?.input),
      outputTokens: sum((f) => f.model?.tokens?.output),
      failedCalls: sum((f) => f.model?.failedCalls),
    },
    judge: {
      // 「本次运行判定者生效了吗」与「是不是**每个**文件都过了判定者」是两个问题。
      // 旧实现把后者填进 `enabled`，于是混合回放（12 个文件跑、1 个文件回放）时会出现
      // `enabled:false` + `calls:560` 这种自相矛盾的读数，报告行据此印出「未启用」。
      // 现在各归其名：`enabled` = 至少一个文件真的过了判定者；`allFilesJudged` = 全部文件都过了。
      enabled: files.some((f) => f.judge?.enabled === true || (f.judge?.calls ?? 0) > 0),
      allFilesJudged: files.every((f) => f.judge?.enabled === true),
      filesJudged: files.filter((f) => f.judge?.enabled === true).length,
      calls: sum((f) => f.judge?.calls),
      inputTokens: sum((f) => f.judge?.tokens?.input),
      outputTokens: sum((f) => f.judge?.tokens?.output),
    },
  }
}

/**
 * 全书反模式分布。两块**分开报**，因为它们来自两次不同的运行、身份不同：
 *   - `fromLayer2`：本次全书提取产出的 AntiPattern（按定义单锚点，跨章恒为 0——这正是
 *     它需要与下一块分开看的原因，否则「跨章占比 0%」会被误读成「书里没有跨章反模式」）；
 *   - `crossChapter`：跨章综合的对象集（卡 06 的命令产出）。
 */
export async function collectAntipatterns(repoRoot, { sourceKey = DEFAULT_SOURCE_KEY } = {}) {
  const knowledge = path.join(repoRoot, 'pipeline', 'knowledge')
  const ownRoot = path.normalize(sourceBookRoot(sourceKey))
  const perFile = []
  for (const name of (await readdir(knowledge)).filter((f) => f.endsWith('.objects.json')).sort()) {
    // `antipatterns*.objects.json`（任何源）是**跨章综合**的产物（卡 06 的命令），不是「各章第 2 层提取」。
    // 不排除它会把同一批对象报两次：`fromLayer2` 里混入合成对象后，「跨章恒为 0」的前提被破坏，
    // 且 `crossChapterIds` 会变成一串 AP-SYNTH id，读者会以为「章内」也能产出跨章对象。
    // 实测（2026-10-12 全书跑）：58 = 44 真·章内 + 14 合成；首跑回执的「章内 28」同病。
    if (isCrossChapterObjectsFile(name)) continue
    // 归属过滤（卡 19）：知识平面跨源共处，回执的 `source.path` 决定这个文件属于哪个源。
    // 属于别的源 → 不进本源的分布表。没有回执 → 归属未知，照旧纳入（本块是诊断表，不是门禁）。
    const fileKey = name.replace(/\.objects\.json$/, '')
    const receiptSource = await findReceiptSourcePathByFileKey(repoRoot, fileKey)
    if (receiptSource !== null && path.normalize(path.dirname(receiptSource)) !== ownRoot) continue
    const parsed = JSON.parse(await readFile(path.join(knowledge, name), 'utf8'))
    const objects = objectsOf(parsed)
    if (!objects.some((o) => o?.objectType === 'AntiPattern')) continue
    perFile.push({ file: name, objects })
  }
  const layer2Objects = perFile.flatMap((f) => f.objects)

  const apFile = crossChapterObjectsFile(sourceKey)
  let crossChapter = { status: 'absent', note: `盘上没有跨章综合的对象集（pipeline/knowledge/${apFile}）；先跑卡 06 的命令再回看本块。` }
  try {
    const parsed = JSON.parse(await readFile(path.join(knowledge, apFile), 'utf8'))
    const objects = objectsOf(parsed)
    crossChapter = {
      status: 'present',
      declaredRunId: parsed.runId ?? null,
      declaredComplete: parsed.complete ?? null,
      ...antipatternDistribution(objects, { label: '跨章综合（卡 06 的命令产出）' }),
    }
  } catch (err) {
    if (!err || err.code !== 'ENOENT') {
      crossChapter = { status: 'unreadable', note: String(err?.message ?? err) }
    }
  }

  return {
    fromLayer2: antipatternDistribution(layer2Objects, { label: '全书各章第 2 层提取（本章内综合）' }),
    perFile: perFile.map((f) => ({ file: f.file, ...antipatternDistribution(f.objects, { label: f.file }) })),
    crossChapter,
    runIdNote:
      '`fromLayer2` 是本次运行的产物；`crossChapter` 由卡 06 的命令**单独**产出，有自己的运行身份（上面已声明），' +
      '两者不可互相代替，也不共用同一个 runId。',
  }
}

/* ──────────────────────────── 报告 / 复核模式 ──────────────────────────── */

/**
 * 报告行的判定者段（导出以便测试钉住口径）。
 *
 * 「未启用」只允许出现在**调用数为 0** 时——旧实现按 `judge.enabled`（当时语义是
 * 「每个文件都跑了判定者」）来印，混合回放时会把 560 次调用印成「未启用」。
 */
export function judgeSummaryLine(judge, files) {
  if (!(judge?.calls > 0)) return '判定者 未启用'
  return `判定者 调用 ${judge.calls} 次（${judge.filesJudged}/${files} 个文件过了判定者）token ${judge.inputTokens}+${judge.outputTokens}`
}

function printFileRow(f, out = process.stdout) {
  const c = f.counts ?? {}
  out.write(
    `${String(f.fileKey).padEnd(18)} 退出 ${f.exitCode}  锚点 ${String(f.coverage?.indexAnchors ?? '?').padStart(3)}` +
      `  对象 ${String(c.objects ?? '?').padStart(4)}  通过 ${String(c.passed ?? '?').padStart(4)}  拒绝 ${String(c.rejected ?? '?').padStart(3)}` +
      `  token ${f.model?.tokens ? `${f.model.tokens.input}+${f.model.tokens.output}` : '—'}` +
      `  ${f.runId ?? '(无回执)'}\n`,
  )
}

async function reportFrom(repoRoot, receiptPath, fileKey) {
  const receipt = JSON.parse(await readFile(path.resolve(repoRoot, receiptPath), 'utf8'))
  const rows = fileKey ? receipt.files.filter((f) => f.fileKey === fileKey) : receipt.files
  if (fileKey && rows.length === 0) throw new Error(`聚合回执里没有这个文件：${fileKey}（可选：${receipt.files.map((f) => f.fileKey).join(', ')}）`)
  process.stdout.write(`聚合回执 ${receipt.bookRunId}（${receipt.files.length} 个文件，退出码 ${receipt.exitCode}）\n`)
  for (const f of rows) printFileRow(f)
  const t = receipt.totals
  process.stdout.write(
    `合计：锚点 ${t.anchors}（有产出 ${t.coveredAnchors}）对象 ${t.objects} 通过 ${t.passed} 拒绝 ${t.rejected}` +
      `；token ${t.model.inputTokens}+${t.model.outputTokens}；理由码 ${JSON.stringify(t.reasonCodesByCode)}\n`,
  )
  process.stdout.write(`反模式：章内 ${receipt.antipatterns.fromLayer2.total} 条，跨章综合 ${receipt.antipatterns.crossChapter.status === 'present' ? `${receipt.antipatterns.crossChapter.total} 条（跨章 ${receipt.antipatterns.crossChapter.crossChapter}）` : receipt.antipatterns.crossChapter.status}\n`)
  return receipt
}

/**
 * 污染隔离的可复跑检查项（ticket 09：「不是一次性人工目测」）。
 *
 * 读的是**跑了之后**的最终账本（含编排进程那份——它比回执晚一步落盘），
 * 因此这条检查与回执里那份汇总不是同一个东西：回执给的是当时的证据，这里给的是最终的结论。
 */
async function verifyIsolation(repoRoot, receiptPath) {
  const receipt = JSON.parse(await readFile(path.resolve(repoRoot, receiptPath), 'utf8'))
  const bookRunId = receipt.bookRunId
  const ledgerPaths = [
    ...receipt.files.map((f) => path.join(repoRoot, LEDGER_DIR, `${bookRunId}.${f.fileKey}.json`)),
    receipt.isolation.orchestratorLedgerPath,
  ].filter(Boolean)
  const isolated = await collectIsolation(repoRoot, { ledgerPaths, expectedProcesses: receipt.files.length + 1, label: '全书运行' })
  assertIsolation(isolated.summary, { label: '全书运行' })
  if (!isolated.complete) throw new Error(isolated.note)
  process.stdout.write(
    `污染隔离检查通过：${isolated.summary.ledgerFiles} 份账本 / ${isolated.summary.recordCount} 条访问记录；` +
      `${DEFAULT_BENCHMARK_DIR}/ 内内容访问 0 条（仅问路径的调用 ${isolated.summary.benchmark.meta} 条，不计）；` +
      `skills/ 写入 0 条；sources/ 下的读取目标 ${isolated.summary.sourceReads.length} 个。\n`,
  )
  return isolated
}

/* ──────────────────────────── CLI ──────────────────────────── */

/**
 * 账本自举：本命令默认把自己重新拉起一次并挂上预载。
 *
 * 为什么不靠「记得加 --require」：那样隔离就成了**使用者的纪律**，而规格 D9 要求它落在代码里。
 * 关了账本（`--no-ledger`）仍可运行，但回执里会写明账本缺席，`--verify-isolation` 会据此拒绝出结论。
 */
async function armLedger(repoRoot, argv) {
  if (process.env.DSH_FS_LEDGER) return null // 已经在被审计的进程里
  const ledgerPath = path.join(repoRoot, LEDGER_DIR, `orchestrator-${process.pid}.json`)
  await mkdir(path.dirname(ledgerPath), { recursive: true })
  const r = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', LEDGER_PRELOAD, fileURLToPath(import.meta.url), ...argv.slice(2)], {
      stdio: 'inherit',
      env: { ...process.env, DSH_FS_LEDGER: ledgerPath },
    })
    child.on('close', (code) => resolve(code ?? EXIT.RUN_FAILED))
  })
  return { ledgerPath, exitCode: r }
}

export async function main(argv) {
  let parsed
  try {
    parsed = parseBookArgs(argv)
  } catch (err) {
    process.stderr.write(
      `参数错误：${err.message}\n` +
        '用法：node pipeline/run-book.mjs [--layer2 stub|deepseek] [--concurrency 1..8] [--dry-run] [--json]\n' +
        '      [--no-ledger] [--repo-root <dir>] [--source-key <key>（缺省 ai-agent-book-zh；决定 sources/<key>/book）]\n' +
        '      [--from <book-receipt.json> [--file <key>]]\n' +
        '      [--verify-isolation <book-receipt.json>] [run.mjs 的生产者/判定者路由开关]\n',
    )
    return EXIT.RUN_FAILED
  }
  const { flags, passthrough } = parsed
  const repoRoot = resolveRealPath(flags.repoRoot)

  try {
    if (flags.verifyIsolation) {
      await verifyIsolation(repoRoot, flags.verifyIsolation)
      return EXIT.PASS
    }
    if (flags.from) {
      await reportFrom(repoRoot, flags.from, flags.file)
      return EXIT.PASS
    }
    if (flags.dryRun) {
      const sources = await listBookSources(repoRoot)
      const judgeApplied = judgeAppliedFor(flags, passthrough)
      const bookRunId = computeBookRunId({ sources, layer2: flags.layer2, modelId: readFlagValue(passthrough, '--llm-model'), judgeApplied })
      process.stdout.write(`全书运行（dry-run，零模型调用）${bookRunId}\n`)
      let anchors = 0
      for (const s of sources) {
        let n = null
        try {
          const idx = JSON.parse(await readFile(path.join(repoRoot, 'pipeline', 'knowledge', `${s.fileKey}.anchors.json`), 'utf8'))
          n = idx.anchorCount ?? (idx.anchors ?? []).length
        } catch {
          n = null
        }
        if (typeof n === 'number') anchors += n
        process.stdout.write(`  ${String(s.fileKey).padEnd(18)} ${String(s.bytes).padStart(9)} 字节  锚点 ${n ?? '（需现场构建）'}\n`)
      }
      process.stdout.write(`合计：${sources.length} 个文件，${anchors} 个锚点（已有索引合计）\n`)
      return EXIT.PASS
    }

    if (flags.ledger) {
      const armed = await armLedger(repoRoot, argv)
      if (armed) return armed.exitCode
    }

    const { exitCode, receipt } = await runBook({ flags, passthrough, repoRoot })

    // 不静默覆盖：同一身份的回执已存在时先归档（与对象平面的 archiveIfExists 同一条纪律）。
    const receiptAbs = path.join(repoRoot, bookReceiptPathFor(receipt.bookRunId))
    await archiveIfExists(repoRoot, receiptAbs)
    await writeFile(receiptAbs, JSON.stringify(receipt, null, 2) + '\n')

    // 隔离结论在**回执落盘之后**才判定：违规时既报错退出，也把证据留在盘上。
    // 反过来做（先判定再写）会让最需要取证的那一次运行什么都不留下。
    assertIsolation(receipt.isolation.children.ledger, { label: '全书运行·子进程' })
    if (!receipt.isolation.children.complete) throw new Error(receipt.isolation.children.note)

    if (flags.json) process.stdout.write(JSON.stringify(receipt, null, 2) + '\n')
    else {
      process.stdout.write(`全书运行 ${receipt.bookRunId}（${receipt.files.length} 个文件，退出码 ${exitCode}）\n`)
      for (const f of receipt.files) printFileRow(f)
      const t = receipt.totals
      process.stdout.write(
        `合计：锚点 ${t.anchors}（有产出 ${t.coveredAnchors}，零产出 ${t.anchorsWithoutObjects}）对象 ${t.objects} ` +
          `通过 ${t.passed} 拒绝 ${t.rejected}；第 2 层调用 ${t.model.calls} 次 token ${t.model.inputTokens}+${t.model.outputTokens}` +
          `；${judgeSummaryLine(t.judge, t.files)}\n` +
          `理由码：${JSON.stringify(t.reasonCodesByCode)}\n` +
          `反模式：章内 ${receipt.antipatterns.fromLayer2.total} 条（跨章 ${receipt.antipatterns.fromLayer2.crossChapter}）；` +
          `跨章综合 ${receipt.antipatterns.crossChapter.status === 'present' ? `${receipt.antipatterns.crossChapter.total} 条 / 跨章 ${receipt.antipatterns.crossChapter.crossChapter} 条（${(receipt.antipatterns.crossChapter.crossChapterRatio * 100).toFixed(0)}%）` : receipt.antipatterns.crossChapter.status}\n` +
          `隔离：${receipt.isolation.note}\n` +
          `回执：${bookReceiptPathFor(receipt.bookRunId)}\n`,
      )
    }
    return exitCode
  } catch (err) {
    process.stderr.write(`全书运行失败：${err?.message ?? err}\n`)
    if (err?.stack && process.env.DSH_BOOK_DEBUG) process.stderr.write(err.stack + '\n')
    return EXIT.RUN_FAILED
  }
}

async function archiveIfExists(repoRoot, absPath) {
  try {
    await stat(absPath)
  } catch {
    return null
  }
  const historyDir = path.join(repoRoot, REGISTRY_DIR, 'history')
  await mkdir(historyDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const dest = path.join(historyDir, `${path.basename(absPath, '.book-receipt.json')}.book-receipt.${stamp}.json`)
  await rename(absPath, dest)
  return dest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
