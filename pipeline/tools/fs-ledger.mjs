/**
 * 运行期文件访问账本 · 汇总与断言（ticket 09）
 *
 * 写入侧是预载 `fs-ledger.cjs`；本模块只做**读 + 判**，不写盘、不装钩子。
 * 拆成两个文件是刻意的：`.cjs` 必须在模块图加载前生效（占用进程内的 fs 导出），
 * 其余部分则是普通 ESM 纯函数，可以被离线测试直接调用。
 *
 * 判据口径（与路径守卫**同一套 realpath 归一**，因此软链不构成绕过）：
 * 一条访问是否「落在基准目录内」，用 `resolveRealPath` 归一后再比前缀——
 * 而不是比字符串，也不是看调用方写的相对路径长什么样。
 */

import path from 'node:path'
import { readFile as defaultReadFile } from 'node:fs/promises'

import { DEFAULT_BENCHMARK_DIR, resolveRealPath } from './anchor-index.mjs'
import fsLedgerSchema from './fs-ledger-schema.cjs'

// 版本常量的单一真源在 `fs-ledger-schema.cjs`（写入侧 `fs-ledger.cjs` 也从那里取）；
// 在这里转出只是为了保持本模块的既有导出面。
export const { LEDGER_SCHEMA_VERSION } = fsLedgerSchema

/**
 * 读取一份账本；文件不存在返回 null（「没有记录」不等于「没有访问」——由调用方判缺）。
 *
 * **校验 schema 版本**：读方按自己的版本解释写方的产物，是所有字段级误解的温床；
 * 版本不认识时抛错而不是当空处理——一份「读不懂的账本」不等于「不存在的账本」。
 */
export async function loadLedger(absPath, { readFile = defaultReadFile } = {}) {
  let parsed
  try {
    parsed = JSON.parse(await readFile(absPath, 'utf8'))
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
  if (parsed?.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new Error(
      `账本 schema 版本不认识：${absPath} 声明 ${JSON.stringify(parsed?.schemaVersion ?? null)}，` +
        `期望 ${LEDGER_SCHEMA_VERSION}——拒绝按「没有记录」处理（见 fs-ledger-schema.cjs）。`,
    )
  }
  return parsed
}

/**
 * 合并多份账本（编排进程一份 + 每个子进程各一份）。
 *
 * **不去重、不按 pid 折叠**：同一路径被两个进程各读一次是两个事实，
 * 折叠会让「谁读的」这个问题失去答案。
 */
export function mergeLedgers(ledgers) {
  const present = ledgers.filter((l) => l !== null && l !== undefined)
  const records = []
  const processes = []
  let truncated = false
  for (const l of present) {
    if (l.truncated) truncated = true
    processes.push({ pid: l.pid, entry: l.argv?.[0] ?? null, cwd: l.cwd ?? null, recordCount: l.recordCount ?? (l.records ?? []).length })
    for (const r of l.records ?? []) records.push({ ...r, pid: l.pid, cwd: l.cwd ?? null })
  }
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    ledgerFiles: present.length,
    truncated,
    processes,
    recordCount: records.length,
    records,
  }
}

/**
 * 汇总：把「一长串访问」压成可断言、可进回执的形状。
 *
 * @param merged  mergeLedgers 的产出
 * @param opts.repoRoot  仓库根（相对路径按各记录自己的 cwd 还原，见下）
 * @param opts.benchmarkDir / opts.skillsDir / opts.sourceRoot  相对仓库根的目录名
 */
export function summarizeLedger(merged, opts = {}) {
  const repoRoot = resolveRealPath(opts.repoRoot)
  const benchmarkDir = resolveRealPath(path.resolve(repoRoot, opts.benchmarkDir ?? DEFAULT_BENCHMARK_DIR))
  const skillsDir = resolveRealPath(path.resolve(repoRoot, opts.skillsDir ?? 'skills'))
  const sourceRoot = resolveRealPath(path.resolve(repoRoot, opts.sourceRoot ?? 'sources'))

  const within = (child, parent) => child === parent || child.startsWith(parent + path.sep)
  const rel = (abs) => (within(abs, repoRoot) ? path.relative(repoRoot, abs) : abs)

  const benchmarkRecords = []
  const skillsWrites = []
  const sourceReads = []
  const outsideRepo = []
  const readTargets = new Set()
  const writeTargets = new Set()
  const byMode = { read: 0, write: 0, meta: 0 }

  for (const r of merged.records ?? []) {
    // 相对路径先按**该记录所属进程**的 cwd 还原：编排进程与子进程的 cwd 可能不同，
    // 用同一个 cwd 去解析两边的相对路径，会把「找到」变成「找不到」（或反过来）。
    const abs = resolveRealPath(path.isAbsolute(r.path) ? r.path : path.resolve(r.cwd ?? repoRoot, r.path))
    if (byMode[r.mode] !== undefined) byMode[r.mode] += 1
    if (within(abs, benchmarkDir)) benchmarkRecords.push({ ...r, abs })
    if (within(abs, skillsDir) && r.mode === 'write') skillsWrites.push({ ...r, abs })
    if (within(abs, sourceRoot) && r.mode === 'read') sourceReads.push({ ...r, abs })
    if (!within(abs, repoRoot)) outsideRepo.push({ ...r, abs })
    if (r.mode === 'read') readTargets.add(rel(abs))
    if (r.mode === 'write') writeTargets.add(rel(abs))
  }

  const uniq = (xs) => [...new Set(xs)].sort()
  const benchOf = (mode) => benchmarkRecords.filter((r) => r.mode === mode)

  return {
    ledgerFiles: merged.ledgerFiles ?? 0,
    processes: merged.processes ?? [],
    truncated: Boolean(merged.truncated),
    recordCount: merged.recordCount ?? 0,
    byMode,
    distinctPaths: { read: readTargets.size, write: writeTargets.size },
    benchmark: {
      total: benchmarkRecords.length,
      // **判据只看这两项**：`read` 是取到内容，`write` 是改了对照物。
      reads: benchOf('read').length,
      writes: benchOf('write').length,
      // `meta` 不算违规，但要能看见——否则「0 条」会让人以为是完全没碰过，
      // 而真实情况是路径守卫每次都 realpath 了它一下（见下 note）。
      meta: benchOf('meta').length,
      metaOps: uniq(benchOf('meta').map((r) => r.op)),
      paths: uniq(benchmarkRecords.map((r) => rel(r.abs))),
      note:
        '`meta` 是 stat/realpath/access 这类**只问路径本身**的调用：卡 01 的路径守卫要判定' +
        '「这个输入是否落在基准目录内」，就必须先解析基准目录自己。它拿到了存在性与解析后的路径，' +
        '**没有读到任何内容**，因此不计入污染；列目录（可能看到那批对照物文件名）与读文件都归 `read`。',
    },
    skillsWrites: uniq(skillsWrites.map((r) => rel(r.abs))),
    sourceReads: uniq(sourceReads.map((r) => rel(r.abs))),
    readTargets: [...readTargets].sort(),
    writeTargets: [...writeTargets].sort(),
    outsideRepo: uniq(outsideRepo.map((r) => `${r.mode} ${r.abs}`)),
  }
}

/**
 * 污染隔离的断言。**抛错而不是返回布尔**：调用方漏检时，抛错比 `if (!ok)` 更难被静默忽略。
 *
 * 三层判定，各自独立：
 *   ① 账本必须存在且未截断——截断的账本覆盖不到尾部，不能作为「零命中」的证据；
 *   ② 基准目录的读与写都必须为 0（写入同样是污染：会改动对照物本身）；
 *   ③ `skills/` 不得被本命令写入（它只接收门禁全通过的成品，规格 D9）。
 */
export function assertIsolation(summary, opts = {}) {
  const label = opts.label ?? '全书运行'
  if (!summary || summary.ledgerFiles === 0) {
    throw new Error(
      `${label}：运行期文件访问账本**缺席**。没有记录 ≠ 没有访问——` +
        '该次运行不得被当作「隔离已验证」，请用 --require pipeline/tools/fs-ledger.cjs 重跑。',
    )
  }
  if (summary.truncated) {
    throw new Error(`${label}：账本被截断（记录数超过上限），尾部访问不可见，零命中不成立。`)
  }
  if (summary.benchmark.reads > 0 || summary.benchmark.writes > 0) {
    throw new Error(
      `${label}：检测到对盲测基准目录的**内容**访问 ${summary.benchmark.reads + summary.benchmark.writes} 次` +
        `（读 ${summary.benchmark.reads} / 写 ${summary.benchmark.writes}）：${summary.benchmark.paths.join(', ')}` +
        `（另有 ${summary.benchmark.meta} 次仅问路径的调用${summary.benchmark.metaOps.length ? `：${summary.benchmark.metaOps.join('/')}` : ''}，不计入）`,
    )
  }
  if (summary.skillsWrites.length > 0) {
    throw new Error(`${label}：本命令不得写 skills/，实测写入：${summary.skillsWrites.join(', ')}`)
  }
  return true
}
