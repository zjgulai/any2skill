/**
 * 引文门禁的「排版差异误杀」规模与成因测量（离线，零模型调用）
 *
 * 背景：chapter4 按当前提示词重产时出现 2 条 QUOTE_MISMATCH，逐字符复算后发现
 * 与票据 04 放宽 `**` 时属于同一失效模式：**模型复述的是渲染后的文本，而判据比的是
 * markdown 源**。本脚本在**盘上已有的全部对象产出**上把这类差异逐条归因，再决定是否动判据。
 *
 * 判据与 `pipeline/tools/verifier.mjs` 的 checkDeterministic 逐条对齐：
 *   strict     = anchorText.includes(normalizeText(quote))
 *   normalized = N(anchorText).includes(N(quote))
 *   anchorText = **索引区间**的正文（不采信对象自带行号，verifier.mjs:522–534）
 *   锚点解析不出来时才退回全量源文；本语料的锚点全部可解析，故不涉及。
 *
 * 归因方式：在现行归一化 N0 之上，对每个不命中的引文**穷举 5 个补丁的全部子集**（2^5=32），
 * 取能使其命中的**最小子集**作为成因。这样「到底差在哪一种字符」不必靠读代码猜。
 *
 * 语料边界（写清楚，免得读者高估这份测量）：
 *   - 产出对象的**只有 chapter4**（11 份对象集，来自 11 次真实运行）与 `antipatterns`
 *     （跨 7 章的跨章综合产物）。其余章在盘上**只有索引、没有对象**，因此未被覆盖。
 *   - 独立单位是**运行**，不是对象：同一对象 id 会在多份对象集里重复出现，
 *     382 个对象不等于 382 个独立样本。
 *   - 只测**主引文**（`evidenceQuote` 对 `sourceRefs[0]`）。AntiPattern 的次级引文
 *     （`sourceRefs[n].quote`，verifier 走另一条 `refQuoteComparisons` 分支）不在本测量内。
 *
 * 复现方式：
 *   node analysis/quote-gate-measure.mjs
 *   node analysis/quote-gate-measure.mjs --json > analysis/quote-gate-measure.json
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { normalizeText, normalizeForQuoteComparison } from '../pipeline/tools/verifier.mjs'
import {
  QUOTE_NORMALIZATION,
  quoteHitsRegion,
} from '../pipeline/tools/verifier.mjs'

const REPO = path.resolve(import.meta.dirname, '..')
const INDEX_DIR = 'pipeline/knowledge'
const CHAPTER4_SETS_DIRS = ['pipeline/knowledge/history', 'pipeline/registry/tier-probe']
const CHAPTER4_SETS_EXTRA = ['pipeline/knowledge/chapter4.objects.json']
const ANTIPATTERN_PATH = 'pipeline/knowledge/antipatterns.objects.json'

/**
 * 五个候选补丁，都加在现行归一化 N0 之上。
 *
 * 命名刻意用「字符类别」而不是「哪一次运行」——判据若要放宽，放宽的是**类别**，
 * 而类别要能说不清就说不清：补丁越少，放宽幅度越小。
 */
export const PATCHES = {
  // 行内代码标记：源 `tool_search`，模型复述渲染后的 tool_search
  inlineCode: (t) => t.replace(/`/g, ''),
  // 引用块标记：源 >>实验组：，模型引成 实验组：
  // 注意：现行归一化已把换行塌成空格，因此**不能**锚在行首（`^` + m 标志在这里永远不命中
  // ——本脚本第一版就写成了那样，于是这一整类被误报成「任何补丁都救不回」）。
  // 改成「紧跟在空白或串首的一串 >」，并在补丁顺序里排在 whitespace 之前执行。
  blockquoteMarker: (t) => t.replace(/(^|\s)>+/g, '$1'),
  // 反斜杠转义：源 \u201c，模型复述成 \\u201c
  backslashEscape: (t) => t.replace(/\\\\/g, '\\'),
  // 中文弯引号 ↔ ASCII 直引号：模型把 “能力” 复述成 "能力"
  quoteStyle: (t) => t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'"),
  // 全部空白：源里两段以空行相隔，模型拼成一段连续引文。
  // 注意这一条比「只把换行视为可删/可留」**更宽**，故它的计数是该类的**上界**。
  whitespace: (t) => t.replace(/\s+/g, ''),
}

/**
 * 补丁的**固定执行顺序**。
 *
 * 不按子集枚举顺序执行，是因为补丁之间不交换：`blockquoteMarker` 依赖空白仍在，
 * 而 `whitespace` 会把空白抹掉。顺序写死，枚举的只是「用哪几个」，不是「按什么次序」。
 */
const PATCH_ORDER = ['inlineCode', 'blockquoteMarker', 'backslashEscape', 'quoteStyle', 'whitespace']

const PATCH_LABEL = {
  inlineCode: '行内代码标记 `',
  blockquoteMarker: '引用块标记 >',
  backslashEscape: '反斜杠转义 \\\\ → \\',
  quoteStyle: '中文弯引号 → ASCII 直引号',
  whitespace: '空白 / 段落边界（上界）',
}

/**
 * **冻结**的旧归一化（v6 及以前）。
 *
 * 为什么要在这里留一份副本而不是直接 import：本文件的用途是「这条判据当初误杀了多少、
 * 误杀在哪一类」——那个问题问的是**改动前**的判据。直接 import 会让它随着判据一起变，
 * 于是同一份语料每次复算都得到不同数字，证据就不可复核了。
 * 现行判据是什么，由下面 `currentGate` 一节单独回答。
 */
export const LEGACY_N0 = (text) =>
  String(text ?? '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/\*([^*\n]+?)\*/gs, '$1')
    .replace(/\s+/g, ' ')
    .trim()

/** 冻结的旧严格比对（verifier 当年也是先 normalizeText 再 includes）。 */
const legacyStrict = (haystack, quote) => haystack.includes(normalizeText(quote))

const sha256Hex = (text) => createHash('sha256').update(text).digest('hex')

function* combinations(list, size, start = 0, acc = []) {
  if (acc.length === size) {
    yield [...acc]
    return
  }
  for (let i = start; i < list.length; i += 1) {
    acc.push(list[i])
    yield* combinations(list, size, i + 1, acc)
    acc.pop()
  }
}

/** 穷举补丁子集，找能命中的最小子集。返回补丁名数组，或 null（无一子集可救）。 */
export function minimalCause({ quote, anchorText }) {
  const hay0 = LEGACY_N0(anchorText)
  const q0 = LEGACY_N0(quote)
  if (hay0.includes(q0)) return []

  const apply = (text, names) => {
    const set = new Set(names)
    return PATCH_ORDER.filter((n) => set.has(n)).reduce((acc, n) => PATCHES[n](acc), text)
  }

  for (let size = 1; size <= PATCH_ORDER.length; size += 1) {
    for (const combo of combinations(PATCH_ORDER, size)) {
      if (apply(hay0, combo).includes(apply(q0, combo))) return combo
    }
  }
  return null
}

/**
 * 「只忽略空白、不加任何标记类补丁」能否救回。这是 whitespace 那一类里**最窄**的一档。
 *
 * 名字改过一次：它原先叫 pureLineJoinOnly，但实现是 `whitespace` 补丁——那是
 * **去掉全部空白**，不是「只把换行视为可删」。名字会撒谎，实测结果就跟着撒谎
 * （我据此向上汇报过一次错误的 9 条，见 ADR-018 的更正记录）。
 */
export function blankOnlySaves({ quote, anchorText, extra = [] }) {
  const apply = (t) => {
    const set = new Set(['whitespace', ...extra])
    return PATCH_ORDER.filter((n) => set.has(n)).reduce((acc, n) => PATCHES[n](acc), t)
  }
  const h = apply(LEGACY_N0(anchorText))
  const q = apply(LEGACY_N0(quote))
  return q !== '' && h.includes(q)
}

/**
 * 「只把**源里的换行**视为可删/可留」能否救回：行内空白仍须一致。
 *
 * 与已在 prototype 阶段验证过的写法逐行对齐（见 ADR-018 的复算记录）：
 *   载体 = 逐行做 LEGACY_N0（并剥行首引用块标记）、丢掉空行、用 '' 拼接 —— 换行消失，行内空格保留
 *   引文 = LEGACY_N0
 *   匹配 = 把引文里的每个空格写成可选（` ?`），再对整个载体做正则
 */
export function lineBreakOnlySaves({ quote, anchorText }) {
  // 刻意**不**剥行首的 `>`：引用块标记是另一个类，混进来会把它的功劳算到换行头上
  // （本函数的第一版就混了，于是「只看换行能救几条」被报成 9 而不是 8）。
  const perLine = (l) => LEGACY_N0(String(l))
  const hay = String(anchorText)
    .split(/\r\n|\n|\r/)
    .map(perLine)
    .filter((l) => l !== '')
    .join('')
  const q = LEGACY_N0(quote)
  if (q === '') return false
  const pat = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, ' ?')
  return new RegExp(pat, 's').test(hay)
}

/** 逐条对齐 verifier.mjs:362–396 的判定。 */
export function classifyQuote({ quote, anchorText }) {
  const quoteIsString = typeof quote === 'string' && quote !== ''
  if (!quoteIsString) return { kind: 'NO_QUOTE' }
  if (legacyStrict(anchorText, quote)) return { kind: 'STRICT' }
  // 注意这一行问的是**冻结的旧归一化**，不是现行判据——见 LEGACY_N0 的注释。
  if (LEGACY_N0(anchorText).includes(LEGACY_N0(quote))) {
    return { kind: 'LEGACY_NORMALIZED' }
  }
  const cause = minimalCause({ quote, anchorText })
  return cause === null ? { kind: 'UNEXPLAINED' } : { kind: 'EXPLAINED', cause }
}

// ---------------------------------------------------------------------------
// 语料
// ---------------------------------------------------------------------------

/** 惰性载入某章的正文行与锚点表；索引缺失即返回 null（该章无产出，也就不该被测量）。 */
function makeSourceLoader(repo) {
  const cache = new Map()
  return async function load(fileRel) {
    if (cache.has(fileRel)) return cache.get(fileRel)
    const fileKey = path.basename(fileRel).replace(/\.md$/, '')
    const indexRel = `${INDEX_DIR}/${fileKey}.anchors.json`
    let entry = null
    try {
      const index = JSON.parse(await readFile(path.join(repo, indexRel), 'utf8'))
      const lines = normalizeText(await readFile(path.join(repo, fileRel), 'utf8')).split('\n')
      entry = { indexRel, byAnchor: new Map(index.anchors.map((a) => [a.anchor, a])), lines }
    } catch {
      entry = null
    }
    cache.set(fileRel, entry)
    return entry
  }
}

/** 语料条目：每份对象集带一个「对象数组怎么取」的取法。按内容 sha256 去重。 */
export async function collectCorpus(repo) {
  const files = []
  for (const rel of CHAPTER4_SETS_EXTRA) files.push({ rel, pick: (j) => j })
  for (const dir of CHAPTER4_SETS_DIRS) {
    let names
    try {
      names = await readdir(path.join(repo, dir))
    } catch {
      continue
    }
    for (const n of names) {
      if (n.endsWith('.objects.json')) files.push({ rel: path.join(dir, n), pick: (j) => j })
    }
  }
  files.push({ rel: ANTIPATTERN_PATH, pick: (j) => j.objects, label: 'antipatterns（跨章）' })

  const seen = new Map()
  const out = []
  for (const { rel, pick, label } of files.sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
    const text = await readFile(path.join(repo, rel), 'utf8')
    const sha = sha256Hex(text)
    const objects = pick(JSON.parse(text))
    if (!Array.isArray(objects)) continue
    if (seen.has(sha)) {
      out.push({ rel, sha, duplicateOf: seen.get(sha) })
      continue
    }
    seen.set(sha, rel)
    out.push({ rel, sha, objects, label })
  }
  return out
}

async function buildResult() {
  const loadSource = makeSourceLoader(REPO)
  const corpus = await collectCorpus(REPO)
  const perFile = []
  const failing = []
  let strict = 0
  let legacyNormalized = 0
  let noQuote = 0
  let unresolved = 0
  let total = 0

  for (const set of corpus) {
    if (set.duplicateOf) {
      perFile.push({ file: set.rel, duplicateOf: set.duplicateOf })
      continue
    }
    const chapters = new Set()
    for (const obj of set.objects) {
      total += 1
      const ref = Array.isArray(obj?.sourceRefs) ? obj.sourceRefs[0] : null
      const src = ref ? await loadSource(ref.file) : null
      const entry = src && ref ? src.byAnchor.get(ref.anchor) : undefined
      if (!src || !Entry_ok(entry)) {
        unresolved += 1
        continue
      }
      chapters.add(path.basename(ref.file).replace(/\.md$/, ''))
      const anchorText = src.lines.slice(entry.lineStart - 1, entry.lineEnd).join('\n')
      const r = classifyQuote({ quote: obj.evidenceQuote, anchorText })
      if (r.kind === 'STRICT') strict += 1
      else if (r.kind === 'LEGACY_NORMALIZED') legacyNormalized += 1
      else if (r.kind === 'NO_QUOTE') noQuote += 1
      else {
        const blankOnly = r.kind === 'EXPLAINED' ? blankOnlySaves({ quote: obj.evidenceQuote, anchorText }) : false
        const lineBreakOnly =
          r.kind === 'EXPLAINED' ? lineBreakOnlySaves({ quote: obj.evidenceQuote, anchorText }) : false
        failing.push({
          file: set.rel,
          fileLabel: set.label ?? set.rel,
          objectId: obj.id,
          chapter: path.basename(ref.file).replace(/\.md$/, ''),
          anchor: ref.anchor,
          kind: r.kind,
          cause: r.cause ?? null,
          savedByBlankOnly: blankOnly,
          savedByLineBreakOnly: lineBreakOnly,
        })
      }
    }
    perFile.push({ file: set.rel, label: set.label ?? null, objects: set.objects.length, chapters: [...chapters].sort() })
  }

  const byCause = {}
  for (const f of failing) {
    if (f.kind !== 'EXPLAINED') continue
    const key = f.cause.join(' + ')
    byCause[key] = (byCause[key] ?? 0) + 1
  }

  const byChapter = {}
  for (const f of failing) byChapter[f.chapter] = (byChapter[f.chapter] ?? 0) + 1

  // ---- 现行判据（v7 起）在同一语料上的结论 ----
  // 这一段回答的是「改动之后还剩几条被拒」，与上面的历史归因无关。
  // 头部是**现行**的 normalizeForQuoteComparison（import 进来的那个，会随判据演化）。
  const currentGate = { rejects: [], normalization: QUOTE_NORMALIZATION }
  for (const set of corpus) {
    if (set.duplicateOf) continue
    for (const obj of set.objects) {
      const ref = Array.isArray(obj?.sourceRefs) ? obj.sourceRefs[0] : null
      const src = ref ? await loadSource(ref.file) : null
      const entry = src && ref ? src.byAnchor.get(ref.anchor) : undefined
      if (!src || !Entry_ok(entry)) continue
      const anchorText = src.lines.slice(entry.lineStart - 1, entry.lineEnd).join('\n')
      const quote = obj.evidenceQuote
      if (typeof quote !== 'string' || quote === '') continue
      if (anchorText.includes(normalizeText(quote))) continue
      if (quoteHitsRegion(normalizeForQuoteComparison(anchorText), normalizeForQuoteComparison(quote))) continue
      currentGate.rejects.push({
        file: set.rel,
        objectId: obj.id,
        chapter: path.basename(ref.file).replace(/\.md$/, ''),
        anchor: ref.anchor,
      })
    }
  }
  currentGate.rejectCount = currentGate.rejects.length

  return {
    schemaVersion: 'quote-gate-measurement/v1',
    note: '零模型调用。判据逐条对齐 verifier.mjs:362–396；成因由 2^5 补丁子集穷举取最小子集得到。',
    caveats: [
      '独立单位是运行而非对象：同一对象 id 在多份对象集里重复出现。',
      '盘上有产出的只有 chapter4 与 antipatterns（跨 7 章）；其余章只有索引、没有对象。',
      '只测主引文 evidenceQuote 对 sourceRefs[0]；AntiPattern 的次级引文不在内。',
      'whitespace 补丁比「只把换行视为可删/可留」宽，故其计数是上界；savedByNarrowLineJoinAlone 给出下界侧的证据。',
    ],
    corpus: { sets: perFile.filter((f) => !f.duplicateOf).length, duplicates: perFile.filter((f) => f.duplicateOf).length },
    totalObjectsMeasured: total,
    strict,
    legacyNormalized,
    rejectedByGate: failing.length,
    rejectionRate: total === 0 ? null : `${((failing.length / total) * 100).toFixed(1)}%`,
    noQuote,
    unresolved,
    byCause,
    byChapter,
    currentGate,
    unexplained: failing.filter((f) => f.kind === 'UNEXPLAINED'),
    failing,
    perFile,
  }
}

const Entry_ok = (e) => e !== undefined && Number.isFinite(e.lineStart) && Number.isFinite(e.lineEnd)

async function main() {
  const r = await buildResult()

  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(r, null, 2) + '\n')
    return
  }

  console.log(`语料：${r.corpus.sets} 份对象集（另有 ${r.corpus.duplicates} 份重复，已去重）`)
  console.log(`对象总数：${r.totalObjectsMeasured}（独立单位是对象集，不是对象）\n`)
  console.log(`  原样命中（strict）          ${String(r.strict).padStart(4)}`)
  console.log(`  旧归一化放过（改动前）        ${String(r.legacyNormalized).padStart(4)}`)
  console.log(`  被门禁拒绝                   ${String(r.rejectedByGate).padStart(4)}  ${r.rejectionRate}`)
  console.log(`  其中没有引文字段              ${String(r.noQuote).padStart(4)}`)
  console.log(`  锚点解析不出来                ${String(r.unresolved).padStart(4)}`)
  console.log('')
  console.log('被拒条目的直接成因（取最小补丁子集）：')
  for (const [k, n] of Object.entries(r.byCause).sort((a, b) => b[1] - a[1])) {
    const label = k.split(' + ').map((x) => PATCH_LABEL[x] ?? x).join(' + ')
    console.log(`  ${String(n).padStart(4)}  ${label}`)
  }
  const un = r.failing.filter((f) => f.kind === 'UNEXPLAINED').length
  console.log(`  ${String(un).padStart(4)}  任何补丁子集都救不回`)
  console.log('')
  console.log(`其中「只忽略空白」就能救回：${r.failing.filter((f) => f.savedByBlankOnly).length} 条`)
  console.log(`再窄一档「只把源里的换行视为可删/可留」能救回：${r.failing.filter((f) => f.savedByLineBreakOnly).length} 条`)
  console.log(`按章分布：${JSON.stringify(r.byChapter)}`)
  console.log('')
  console.log(`现行判据（${r.currentGate.normalization}）在同一语料上仍拒：${r.currentGate.rejectCount} 条`)
  for (const x of r.currentGate.rejects) console.log(`  ${x.objectId}  [${x.file.replace(/^pipeline\//, '')}]`)
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) await main()
