/**
 * 运行期文件访问账本 · 预载（ticket 09 的污染隔离证据）
 *
 *   DSH_FS_LEDGER=/abs/path.json node --require pipeline/tools/fs-ledger.cjs <入口>.mjs
 *
 * ## 它解决什么问题
 *
 * 卡 01 的路径守卫把「基准目录」挡在**入口**——它证明的是「不合法的输入进不来」。
 * 但卡 09 要的是**反向**的证据：一次完整的全书运行，**确实没有**从任何环节读到基准目录。
 * 两件事不能互相替代：守卫检查的是调用方交给流水线的那个参数，而账本记录的是进程真正
 * 向内核要过的每一个路径——包括流水线自己拼出来的、调用方从未见过的路径。
 *
 * ## 为什么是「预载」而不是「在流水线里加一层包装」
 *
 * 包装只能覆盖**从包装走**的读写：将来任何一处直接 `import { readFile } from 'node:fs/promises'`
 * 都会静默绕过它，而账本照样交出一份「干净」的报告——**零命中不是证据，是方法错误**。
 * 预载在模块图加载**之前**替换 `node:fs` 与 `node:fs/promises` 的导出，因此在这个进程里
 * 无论谁、怎么写，都走同一份记录。
 *
 * Node 的 CJS 与 ESM 对本内置模块共用同一个导出对象，所以 `import { readFile } from
 * 'node:fs/promises'` 拿到的是**被替换后**的函数（实测：Node v26.7.0，见
 * `pipeline/tools/test/fs-ledger.test.mjs` 的「ESM 命名导入也被记录」用例）。
 *
 * ## 边界（诚实的部分）
 *
 * - 只覆盖 **Node 的 fs 接口**。子进程若不继承本预载，其访问不进本账本；因此调用方
 *   （`pipeline/run-book.mjs`）对**每一个**子进程都显式传 `--require` 与独立的账本路径，
 *   并在聚合回执里断言「子进程数 == 账本文件数」，缺一即报缺，不按「没记录=没发生」处理。
 * - 记录的是**路径字符串**，不是 inode。经软链间接访问的路径以调用方传入的形式记录；
 *   比对时两侧都做 realpath 归一（与路径守卫同口径），因此软链不构成绕过。
 * - `process.on('exit')` 之外（SIGKILL）写不出账本。写不出就是「没有记录」，
 *   调用方据此判缺，不判通过。
 *
 * 未设置 `DSH_FS_LEDGER` 时不装任何钩子：零开销、零副作用。
 */

'use strict'

const fs = require('fs')
const fsp = require('fs/promises')
const { fileURLToPath } = require('url')

const LEDGER_SCHEMA_VERSION = 'fs-ledger/v1'
/** 记录上限：超出即丢弃并置 `truncated=true`。截断的账本不等于完整账本，读方必须看见这个标志。 */
const MAX_RECORDS = 200000

const OUT = process.env.DSH_FS_LEDGER

/**
 * 落盘路径**在退出时才读**（而不是像 `OUT` 那样在加载时冻结）。
 *
 * 理由：编排进程的账本文件名想带自己的运行身份，而那个身份要读完源文件才算得出来——
 * 比本模块加载晚。冻结在加载时，就只能用一个 pid 之类的临时名，事后再靠回执里记的路径去找。
 * 中途改名（`process.env.DSH_FS_LEDGER = …`）使名字由内容决定；若进程在那之前就死了，
 * 账本仍会落在临时名下——那仍是可发现的证据，不是丢失的记录。
 */
const outPath = () => process.env.DSH_FS_LEDGER || OUT

if (OUT && OUT.trim() !== '') {
  // 先抓住原始函数：账本自己写盘时不得再被记一笔（否则账本会记录自己，且递归）。
  const origWriteFileSync = fs.writeFileSync
  const startedAt = Date.now()

  const records = []
  let truncated = false

  const push = (op, target, mode) => {
    if (records.length >= MAX_RECORDS) {
      truncated = true
      return
    }
    records.push({ op, path: target, mode })
  }

  /** `fs` 的第一个参数可以是 string / Buffer / URL / fd；只记能还原成路径的那些。 */
  const targetOf = (arg) => {
    if (typeof arg === 'string') return arg
    if (arg instanceof URL) return arg.protocol === 'file:' ? fileURLToPath(arg) : arg.href
    if (Buffer.isBuffer(arg)) return arg.toString('utf8')
    if (typeof arg === 'number') return `fd:${arg}`
    if (arg && typeof arg === 'object' && typeof arg.path === 'string') return arg.path
    return String(arg)
  }

  /**
   * 三类，**必须分开**：污染判据只认前两类。
   *
   * `read` 是「取到内容」（读文件、列目录、开读句柄）；
   * `meta` 是「问一句这路径是什么」（realpath / stat / access）；
   * 两者混成一个 `read` 会把**路径守卫自己**记成污染源——守卫要判定「这个输入是否落在
   * 基准目录内」，就必须先 realpath 基准目录本身（`assertAllowedSource` 逐次调用）。
   * 那是守卫**生效**的证据，不是读了基准目录里的东西：它拿到的只有「存在/不存在」与
   * 解析后的路径，内容一个字都没读。
   * 反过来，把 `meta` 一概不算又太宽：`readdir` 会真的列出基准目录里的文件名，
   * 而那正是污染（方案 R4 的对照物就是那批文件），所以它归 `read`。
   */
  const READ_OPS = [
    'readFile', 'readFileSync', 'readdir', 'readdirSync',
    'opendir', 'opendirSync', 'createReadStream',
  ]
  const META_OPS = [
    'realpath', 'realpathSync', 'stat', 'statSync', 'lstat', 'lstatSync',
    'access', 'accessSync', 'existsSync', 'readlink', 'readlinkSync',
  ]
  const WRITE_OPS = [
    'writeFile', 'writeFileSync', 'appendFile', 'appendFileSync', 'mkdir', 'mkdirSync',
    'rm', 'rmSync', 'rmdir', 'rmdirSync', 'unlink', 'unlinkSync', 'rename', 'renameSync',
    'truncate', 'truncateSync', 'chmod', 'chmodSync', 'utimes', 'utimesSync',
    'createWriteStream', 'mkdtemp', 'mkdtempSync', 'copyFile', 'copyFileSync',
  ]

  const patch = (obj, op, mode) => {
    const orig = obj[op]
    if (typeof orig !== 'function') return
    if (orig.__fsLedgerWrapped) return
    const wrapped = function (...args) {
      push(op, targetOf(args[0]), mode)
      return orig.apply(this, args)
    }
    wrapped.__fsLedgerWrapped = true
    obj[op] = wrapped
  }

  // `open` 的读写方向由 flags 决定，单独处理（它是 readFile/createReadStream 之外的常见直达路径）。
  const patchOpen = (obj, op, sync) => {
    const orig = obj[op]
    if (typeof orig !== 'function' || orig.__fsLedgerWrapped) return
    const wrapped = function (...args) {
      const flags = typeof args[1] === 'string' ? args[1] : ''
      const writes = /[wa+]/.test(flags)
      push(op, targetOf(args[0]), writes ? 'write' : 'read')
      if (!sync && typeof args[1] === 'number') return orig.apply(this, args) // fd 形式
      return orig.apply(this, args)
    }
    wrapped.__fsLedgerWrapped = true
    obj[op] = wrapped
  }

  for (const target of [fs, fsp]) {
    for (const op of READ_OPS) patch(target, op, 'read')
    for (const op of META_OPS) patch(target, op, 'meta')
    for (const op of WRITE_OPS) patch(target, op, 'write')
    patchOpen(target, 'open', false)
    patchOpen(target, 'openSync', true)
  }
  if (fs.promises && fs.promises !== fsp) {
    for (const op of READ_OPS) patch(fs.promises, op, 'read')
    for (const op of META_OPS) patch(fs.promises, op, 'meta')
    for (const op of WRITE_OPS) patch(fs.promises, op, 'write')
    patchOpen(fs.promises, 'open', false)
  }

  const writeOut = () => {
    const dest = outPath()
    if (!dest || dest.trim() === '') return
    const ledger = {
      schemaVersion: LEDGER_SCHEMA_VERSION,
      pid: process.pid,
      argv: process.argv.slice(1),
      cwd: process.cwd(),
      startedAt: startedAtIso,
      endedAt: new Date().toISOString(),
      recordCount: records.length,
      truncated,
      records,
    }
    try {
      // 用原始函数：账本自己不是被审计对象，写它这一笔不入账（见文件头「边界」）。
      origWriteFileSync(dest, JSON.stringify(ledger, null, 1) + '\n')
    } catch {
      // 写不出账本就等于「没有记录」；调用方据此判缺。此处不抛，避免把被审计进程搞崩。
    }
  }

  const startedAtIso = new Date(startedAt).toISOString()
  process.on('exit', writeOut)
}

module.exports = { LEDGER_SCHEMA_VERSION }
