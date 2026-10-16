/**
 * 第 1 层 · 确定性锚点索引（ticket 01）
 *
 * 职责：解析内容源 .md 的标题层级，产出章节/小节锚点索引，为后续所有知识对象的
 * sourceRefs 提供物理锚点。本模块全程不使用 LLM，必须可逐字节复现。
 *
 * 三条关键约定（约束来源：docs/specs/01-pipeline-spec.md 的 D3）：
 *   1. 锚点标识 = 文件名（去扩展名）+ 该文件内**按层级独立**的序号，不含行号。
 *      因此文件重排版后标识不变，失效检测交给内容哈希。
 *   2. 行号区间 = [标题行, 下一个任意层级标题行 - 1]，闭区间。该约定使区间天然嵌套。
 *   3. 内容哈希覆盖锚点区间内容，用于识别「所依赖源版本已变更」。
 */

import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 本模块所在位置推导出的仓库根；调用方可用 opts.repoRoot 覆盖（测试需要）。 */
export const DEFAULT_REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

/**
 * 允许的源正文根目录（相对于仓库根）。
 * 这是路径守卫的正向白名单：解析后的路径必须落在其内。
 */
/**
 * 源键与源根（ticket 18：多源参数化的单一真源）。
 *
 * 约定：`sources/<sourceKey>/book/`＝源正文、`sources/<sourceKey>/code/`＝配套代码镜像。
 * 缺省源键 `ai-agent-book-zh` 保持第一源的全部既有行为逐字节不变；
 * 第二个源（rust-book-cn）只是换一个键——路径写死点全部从这里取。
 */
export const DEFAULT_SOURCE_KEY = 'ai-agent-book-zh'
export const sourceBookRoot = (key = DEFAULT_SOURCE_KEY) => path.join('sources', key, 'book')
export const sourceCodeRoot = (key = DEFAULT_SOURCE_KEY) => path.join('sources', key, 'code')

export const DEFAULT_SOURCE_ROOT = sourceBookRoot()

/** 盲测基准目录（相对于仓库根）。生成链路任何环节不得读取；本模块显式拒绝。 */
export const DEFAULT_BENCHMARK_DIR = 'benchmark'

/** 解析错误：输入路径不合法（含路径守卫拒绝）。属「工程问题」，非内容问题。 */
export class SourcePathError extends Error {
  constructor(message) {
    super(message)
    this.name = 'SourcePathError'
  }
}

/**
 * 把可能尚不存在的路径解析为绝对路径：先尝试 realpath（处理 symlink），
 * 失败则退回「最近存在的祖先 realpath + 剩余部分」，避免对不存在路径误判。
 *
 * 导出的原因：路径守卫的**两侧**必须走同一套解析，否则会拿「已 realpath 的输入」
 * 去比「未 realpath 的白名单根」——在 macOS 上 os.tmpdir() 返回 /var/folders/…
 * 而 realpath 是 /private/var/folders/…，两者字面不等，会把合法内容源判成越界。
 */
export function resolveRealPath(input) {
  let abs = path.resolve(input)
  const tail = []
  for (;;) {
    try {
      return path.join(realpathSync(abs), ...tail)
    } catch {
      const parent = path.dirname(abs)
      if (parent === abs) return path.resolve(input)
      tail.unshift(path.basename(abs))
      abs = parent
    }
  }
}

/**
 * 路径守卫（ticket 01 / Q14）：内容源必须是源正文根目录内的文件，且不得位于盲测基准目录内。
 * 拒绝时抛错，绝不静默产出空索引。
 */
export function assertAllowedSource(filePath, opts = {}) {
  // 仓库根、白名单根与基准目录统一 realpath 解析——与输入侧同口径（见 resolveRealPath 注释）。
  const repoRoot = resolveRealPath(opts.repoRoot ?? DEFAULT_REPO_ROOT)
  const sourceRoot = resolveRealPath(path.resolve(repoRoot, opts.sourceRoot ?? DEFAULT_SOURCE_ROOT))
  const benchmarkDir = resolveRealPath(
    path.resolve(repoRoot, opts.benchmarkDir ?? DEFAULT_BENCHMARK_DIR),
  )

  const real = resolveRealPath(filePath)

  const within = (child, parent) => child === parent || child.startsWith(parent + path.sep)

  if (within(real, benchmarkDir)) {
    throw new SourcePathError(
      `拒绝读取盲测基准目录：${real}\n` +
        `生成链路任何环节不得读取 ${path.relative(repoRoot, benchmarkDir)}/（污染隔离，ADR-001）。`,
    )
  }

  if (!within(real, sourceRoot)) {
    throw new SourcePathError(
      `内容源必须位于 ${path.relative(repoRoot, sourceRoot)}/ 之内，实际为：${real}`,
    )
  }

  if (!real.endsWith('.md')) {
    throw new SourcePathError(`内容源必须是 .md 文件，实际为：${real}`)
  }

  return real
}

/**
 * 围栏状态机：逐行判定每个行号是否位于代码块内部。
 *
 * 守卫在前、匹配在后：`.md` 正文里会嵌入 markdown 示例（实测 chapter2.md 的
 * ```text 块内就有以两个井号开头的行），若先匹配标题再判断围栏，这些示例行会被
 * 误认为真标题并污染整份索引。
 *
 * 围栏规则（CommonMark 的常用子集）：以至少三个反引号开头，可带语言标记；
 * 闭栏要求同为反引号、≥ 开栏长度、且无语言标记。
 *
 * @returns {boolean[]} 与行号一一对应（index 0 对应第 1 行）
 */
export function computeFencedFlags(lines) {
  const flags = new Array(lines.length).fill(false)
  let openLen = 0
  let i = 0
  while (i < lines.length) {
    if (openLen === 0) {
      const m = /^(`{3,})(.*)$/.exec(lines[i])
      if (m) openLen = m[1].length
      i += 1
      continue
    }
    const m = /^(`{3,})\s*$/.exec(lines[i])
    if (m && m[1].length >= openLen) openLen = 0
    flags[i] = true
    i += 1
  }
  return flags
}

/** 标题行匹配：1–6 个井号 + 至少一个空白 + 非空标题。 */
const HEADING_RE = /^(#{1,6})[ \t]+(.+?)[ \t]*$/

/** 行尾属性标记（如 `{.unnumbered}`）——属正文结构标记，不计入标题文本。 */
const TRAILING_ATTR_RE = /\s*\{[^}]*\}\s*$/

/**
 * 正文归一化：LF 化 + 去行尾空白。
 *
 * **单一定义**。它同时决定「行号」与「内容哈希」两个口径，因此凡是按行号取正文的模块
 * （第 1 层索引、ticket 06 的锚点目录）都必须走这一个函数。各写一份的后果是：
 * 目录里的「首行摘录」与索引里的 `lineStart` 指向不同的行，而两边看起来都对。
 */
export function normalizeSourceLines(raw) {
  return raw.split(/\r\n|\n|\r/).map((l) => l.replace(/[ \t]+$/, ''))
}

/** 计算锚点区间内容的规范化字节，用于哈希。 */
export function anchorContent(lines, lineStart, lineEnd) {
  return lines.slice(lineStart - 1, lineEnd).join('\n')
}

export function sha256Hex(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * 解析单个内容源文件为锚点索引。
 *
 * @param {string} filePath 内容源 .md 路径（未经守卫校验；调用方应先过 assertAllowedSource）
 * @param {{repoRoot?: string}} [opts]
 */
export function buildAnchorIndex(filePath, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT

  return readFile(filePath, 'utf8').then((raw) => {
    // 归一化为 LF 并去掉行尾空白，使哈希不受 CRLF 与行尾空格影响。
    // 行尾空白不承载语义，纳入哈希只会让「无意义的排版差异」被误报为源版本变更。
    const lines = normalizeSourceLines(raw)

    const fenced = computeFencedFlags(lines)

    const fileKey = path.basename(filePath).replace(/\.md$/, '')
    const fileHash = sha256Hex(lines.join('\n'))

    /** @type {{line:number, level:number, title:string, ordinal:number}[]} */
    const found = []
    const counters = new Map()

    for (let i = 0; i < lines.length; i += 1) {
      if (fenced[i]) continue
      const m = HEADING_RE.exec(lines[i])
      if (!m) continue
      const level = m[1].length
      const ordinal = (counters.get(level) ?? 0) + 1
      counters.set(level, ordinal)
      found.push({
        line: i + 1,
        level,
        title: m[2].replace(TRAILING_ATTR_RE, '').trim(),
        ordinal,
      })
    }

    if (found.length === 0) {
      throw new SourcePathError(
        `未在 ${filePath} 中解析到任何标题行——拒绝产出空索引（空索引会被下游误读为「该文件无内容」）。`,
      )
    }

    const anchors = found.map((h, idx) => {
      const lineStart = h.line
      // 下一个任意层级标题的前一行；无后续标题则到文件末尾。
      const lineEnd = idx + 1 < found.length ? found[idx + 1].line - 1 : lines.length
      const text = anchorContent(lines, lineStart, lineEnd)
      return {
        anchor: `${fileKey}#h${h.level}-${h.ordinal}`,
        file: path.relative(repoRoot, filePath),
        level: h.level,
        title: h.title,
        lineStart,
        lineEnd,
        contentHash: `sha256:${sha256Hex(text)}`,
        contentBytes: Buffer.byteLength(text, 'utf8'),
      }
    })

    return {
      schemaVersion: 'anchor-index/v1',
      sourceFile: path.relative(repoRoot, filePath),
      fileKey,
      totalLines: lines.length,
      sourceHash: `sha256:${fileHash}`,
      anchorCount: anchors.length,
      levelCounts: [1, 2, 3, 4, 5, 6].reduce((acc, lv) => {
        const n = anchors.filter((a) => a.level === lv).length
        if (n > 0) acc[`h${lv}`] = n
        return acc
      }, {}),
      anchors,
    }
  })
}

/** 锚点索引的落盘路径（pipeline/knowledge/）。 */
function anchorIndexPath(filePath, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  const fileKey = path.basename(filePath).replace(/\.md$/, '')
  return path.join(repoRoot, 'pipeline', 'knowledge', `${fileKey}.anchors.json`)
}

/** 落盘锚点索引。 */
export async function writeAnchorIndex(index, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  const outPath = anchorIndexPath(opts.sourceFile ?? path.join(repoRoot, index.sourceFile), {
    repoRoot,
  })
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(index, null, 2) + '\n', 'utf8')
  return outPath
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(argv) {
  const args = argv.slice(2)
  const asJson = args.includes('--json')
  const sourceKeyIdx = args.indexOf('--source-key')
  const sourceKey = sourceKeyIdx >= 0 ? args[sourceKeyIdx + 1] : DEFAULT_SOURCE_KEY
  const positional = args.filter((a, i) => !a.startsWith('--') && (sourceKeyIdx < 0 || i !== sourceKeyIdx + 1))
  const target = positional[0]

  if (!target) {
    process.stderr.write(
      '用法：node pipeline/tools/anchor-index.mjs <内容源.md> [--source-key <key>] [--json]\n' +
        `内容源必须位于 ${sourceBookRoot(sourceKey)}/ 之内。\n`,
    )
    return 2
  }

  let allowed
  try {
    allowed = assertAllowedSource(path.resolve(target), { sourceRoot: sourceBookRoot(sourceKey) })
  } catch (err) {
    if (err instanceof SourcePathError) {
      process.stderr.write(`[路径守卫] ${err.message}\n`)
      return 2
    }
    throw err
  }

  return buildAnchorIndex(allowed)
    .then(async (index) => {
      const outPath = await writeAnchorIndex(index, { sourceFile: allowed })
      if (asJson) process.stdout.write(JSON.stringify(index, null, 2) + '\n')
      else
        process.stdout.write(
          `${index.sourceFile}：${index.anchorCount} 个锚点 ` +
            `(${Object.entries(index.levelCounts)
              .map(([k, v]) => `${k}=${v}`)
              .join(' ')})\n已写入 ${path.relative(DEFAULT_REPO_ROOT, outPath)}\n`,
        )
      return 0
    })
    .catch((err) => {
      process.stderr.write(`运行失败：${err.message}\n`)
      return 1
    })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const code = await main(process.argv)
  process.exitCode = code
}
