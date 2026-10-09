/**
 * 锚点目录（ticket 06）——**按主题组织输入**的第一步，也是唯一一步不花钱的。
 *
 * ## 这个模块解决什么
 *
 * 卡 06 要求跨章综合的输入「按主题组织、而非按章节顺序」。要按主题组织，先得知道
 * 全书有哪些可被引用的落点，以及每个落点讲的是什么。锚点目录就是这份清单：
 * 每个锚点一行——**出处标识 + 层级 + 标题 + 首行摘录**——不含正文。
 *
 * 刻意**不含正文**：目录是给「主题提案」这一步用的，那一步只判断「哪几节在讲同一件事」，
 * 不需要读全文。把全书正文塞进去会让一次目录级的调用变成一次全文级的调用，并且
 * 让提案阶段的判断被正文细节稀释。正文留到综合调用时按主题**只取该主题的锚点**。
 *
 * ## 与第 1 层的关系
 *
 * 本模块**不重算**锚点：它调 `buildAnchorIndex`。两者共用 `normalizeSourceLines`
 * 的行号口径（见该函数的注释），因此目录里的 `lineStart` 与索引里的 `lineStart`
 * 是同一个值，不是「碰巧一致」。
 *
 * 目录只是**视图**，不是新真源：它可以从 13 份锚点索引完全重建。落盘的理由是
 * 让主题提案那一次模型调用**可复现**——回执与 `themes.json` 都要引用一个目录哈希，
 * 而哈希必须对着一个能重新打开的文件算，不能对着内存里的东西算。
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import {
  DEFAULT_REPO_ROOT,
  DEFAULT_SOURCE_ROOT,
  assertAllowedSource,
  buildAnchorIndex,
  normalizeSourceLines,
} from './anchor-index.mjs'

export const CATALOG_SCHEMA_VERSION = 'anchor-catalog/v1'

/** 目录的相对落盘路径。 */
export const CATALOG_REL_PATH = path.join('pipeline', 'knowledge', 'anchor-catalog.json')

/**
 * 首行摘录的长度上限（字符）。
 *
 * 取 80 的依据：够放下一句话（实测标题之外的首行多为 20–60 字），又不至于让
 * 336 个锚点的目录膨胀到需要分片。这个数字**只影响提案阶段的输入，不影响任何判据**，
 * 因此改它不需要重跑下游——但它进目录哈希，所以改它会让旧的主题清单标记为过期。
 */
export const EXCERPT_MAX_CHARS = 80

/**
 * 列出内容源目录下的 `.md`，按文件名**确定性排序**。
 *
 * 为什么排序必须显式：目录哈希与「哪个文件排第一」都会影响提案调用的输入，
 * 而 `readdir` 的顺序由文件系统给出，不保证跨机器一致。少了这一行，
 * 同一份内容在两台机器上会算出不同的目录哈希。
 */
export async function listSourceFiles(opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  const sourceRoot = path.join(repoRoot, opts.sourceRoot ?? DEFAULT_SOURCE_ROOT)
  const names = await readdir(sourceRoot)
  return names
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((n) => path.join(sourceRoot, n))
}

/** 去掉行内的 markdown 强调与行内代码标记，供摘录用（只影响可读性，不影响判据）。 */
export function stripInlineMarkdown(text) {
  return String(text ?? '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .trim()
}

/**
 * 取锚点的摘录：标题行**之下**的第一行有内容的正文。
 *
 * 不含标题行本身——标题已经在 `title` 字段里，重复一次只会浪费预算，
 * 并让模型以为「标题 + 摘录」是一个整体。
 */
export function anchorExcerpt(lines, lineStart, lineEnd, maxChars = EXCERPT_MAX_CHARS) {
  for (let i = lineStart; i < lineEnd; i += 1) {
    const raw = lines[i]
    if (raw === undefined) break
    const cleaned = stripInlineMarkdown(raw)
    if (cleaned === '') continue
    return cleaned.length > maxChars ? `${cleaned.slice(0, maxChars)}…` : cleaned
  }
  return ''
}

/**
 * 构建锚点目录。
 *
 * @returns {Promise<{schemaVersion:string, files:object[], anchors:object[], catalogHash:string}>}
 */
export async function buildAnchorCatalog(opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  const files = opts.files ?? (await listSourceFiles({ repoRoot, sourceRoot: opts.sourceRoot }))
  const maxChars = opts.excerptMaxChars ?? EXCERPT_MAX_CHARS

  const fileEntries = []
  const anchors = []

  for (const absPath of files) {
    // 路径守卫随第 1 层一同生效：目录是**从**内容源派生的，所以它必须走与索引同一条入口。
    // 少这一行，本模块就成了绕过 01 守卫的第二条读源路径（卡 09 要求隔离写在代码里，
    // 不是「约定本模块只被合法调用方使用」）。
    assertAllowedSource(absPath, { repoRoot })
    const index = await buildAnchorIndex(absPath, { repoRoot })
    const raw = await readFile(absPath, 'utf8')
    const lines = normalizeSourceLines(raw)
    const fileKey = index.fileKey

    fileEntries.push({
      file: index.sourceFile,
      fileKey,
      sourceHash: index.sourceHash,
      anchorCount: index.anchorCount,
      levelCounts: index.levelCounts,
    })

    for (const a of index.anchors) {
      anchors.push({
        file: a.file,
        fileKey,
        anchor: a.anchor,
        level: a.level,
        title: a.title,
        lineStart: a.lineStart,
        lineEnd: a.lineEnd,
        contentBytes: a.contentBytes,
        excerpt: anchorExcerpt(lines, a.lineStart, a.lineEnd, maxChars),
      })
    }
  }

  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    files: fileEntries,
    anchors,
    catalogHash: catalogHash({ files: fileEntries, anchors }),
  }
}

/**
 * 目录哈希：对**内容而不管时间**。
 *
 * 刻意不含 `createdAt` 之类的字段——哈希的用途是回答「这次提案看到的是不是同一份目录」，
 * 而不是「这份目录什么时候生成的」。把时间戳算进去会让同一个内容每次都有不同的哈希，
 * 于是「目录变了没有」这个问题永远答成「变了」。
 */
export function catalogHash({ files, anchors }) {
  const canonical = JSON.stringify({ files, anchors })
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`
}

/** 落盘目录。落盘是为了让哈希可被重新核对，不是因为下游需要读它。 */
export async function writeAnchorCatalog(catalog, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  const outPath = path.join(repoRoot, opts.relPath ?? CATALOG_REL_PATH)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(
    outPath,
    `${JSON.stringify({ ...catalog, createdAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  )
  return outPath
}
