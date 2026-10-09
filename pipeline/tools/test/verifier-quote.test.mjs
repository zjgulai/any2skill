/**
 * 引文判据的口径测试（ticket 04 期间按实测证据修订）
 *
 * 背景（实测，不是推测）：真实第 2 层复制引文时会去掉 markdown 的 `**` 强调标记——
 * 它复述的是渲染后的文本。两轮 chapter4 的全部 9 条 `QUOTE_MISMATCH`，逐字符比对后
 * 差异**只有 `**`**（相似度 0.90–0.98），去掉标记后 9 条全部命中，没有一条是改写。
 * 若维持字节相等，被判死的对象里 16% 死于排版标记而非知识问题（规格 D7 的 R6）。
 *
 * 本文件钉住两件事，缺一不可：
 *   1. 排版差异**不再**导致拒绝，且回执里能看出「是靠归一化放过的」；
 *   2. 真正的改写**仍然**被拒——放宽只放宽到「同一段文字的不同表示」，不越过它。
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import {
  QUOTE_NORMALIZATION,
  normalizeForQuoteComparison,
  quoteHitsRegion,
  verifyObjects,
} from '../../tools/verifier.mjs'

const REPO = DEFAULT_REPO_ROOT
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'

let IDX
let REF
let QUOTE // 一段确实来自锚点区间、且**含 `**` 强调标记**的原文
let REGION

before(async () => {
  IDX = await buildAnchorIndex(path.join(REPO, SOURCE_REL), { repoRoot: REPO })
  // 挑一个正文里带 ** 的锚点——实测这类锚点正是误杀的来源。
  const raw = await readFile(path.join(REPO, SOURCE_REL), 'utf8')
  const lines = raw.split(/\r\n|\n|\r/).map((l) => l.replace(/[ \t]+$/, ''))
  let hit = null
  for (const a of IDX.anchors) {
    const region = lines.slice(a.lineStart - 1, a.lineEnd).join('\n')
    const m = /\*\*[^*\n]+\*\*[^\n]{0,40}/.exec(region)
    if (m) {
      hit = { a, region, quote: m[0] }
      break
    }
  }
  assert.ok(hit, '本章应存在带 markdown 强调标记的正文——否则本文件的用例没测到真问题')
  REF = {
    file: IDX.sourceFile,
    anchor: hit.a.anchor,
    title: hit.a.title,
    lineStart: hit.a.lineStart,
    lineEnd: hit.a.lineEnd,
    contentHash: hit.a.contentHash,
  }
  REGION = hit.region
  QUOTE = hit.quote
})

const concept = (quote) => ({
  id: 'CHAPTER4-H2-1-CONCEPT-01',
  objectType: 'Concept',
  revision: 1,
  status: 'candidate',
  createdAt: '2026-10-08T00:00:00.000Z',
  sourceRefs: [{ ...REF }],
  evidenceQuote: quote,
  canonicalTerm: 'x',
  aliases: [],
  definition: 'x',
  examples: ['x'],
})

const judgeOne = async (quote) => {
  const { verdicts } = await verifyObjects([concept(quote)], IDX, { repoRoot: REPO })
  return verdicts[0]
}

describe('04 · 引文判据：排版差异不算问题，改写仍是问题', () => {
  it('原文原样引 → 严格命中', async () => {
    const v = await judgeOne(QUOTE)
    assert.equal(v.status, 'pass')
    assert.deepEqual(v.quoteComparison.acceptedBy, 'strict')
    assert.equal(v.quoteComparison.strict, true)
    assert.equal(v.quoteComparison.scope, 'anchor-region')
  })

  it('去掉 `**` 强调标记 → 通过，但回执里标明「是靠归一化放过的」', async () => {
    const stripped = QUOTE.replace(/\*\*/g, '')
    assert.notEqual(stripped, QUOTE)
    const v = await judgeOne(stripped)
    assert.equal(v.status, 'pass', '排版差异不该导致拒绝')
    assert.equal(v.quoteComparison.strict, false)
    assert.equal(v.quoteComparison.acceptedBy, 'normalization')
    assert.equal(v.quoteComparison.normalization, QUOTE_NORMALIZATION)
  })

  it('把换行换成空格（引用跨行时的常见改写）→ 通过', async () => {
    const flattened = QUOTE.replace(/\n+/g, ' ').trim()
    const v = await judgeOne(flattened)
    assert.equal(v.status, 'pass')
  })

  it('真正的改写（同义替换）→ 仍然被拒，且理由码是 QUOTE_MISMATCH', async () => {
    // 取原句并把一个实词换掉：这是「归纳时改写了原文」的典型形态。
    const paraphrase = `${QUOTE.slice(0, 8)}被彻底改写过的措辞${QUOTE.slice(8)}`
    const v = await judgeOne(paraphrase)
    assert.equal(v.status, 'reject')
    assert.equal(v.reasonCode, 'QUOTE_MISMATCH')
    assert.equal(v.quoteComparison.acceptedBy, null)
    assert.match(v.failures[0].detail, /不止是排版差异/)
  })

  it('凭空编造的引文 → 被拒', async () => {
    const v = await judgeOne('这句话在这本书里任何地方都不存在，是模型自己编出来的。')
    assert.equal(v.reasonCode, 'QUOTE_MISMATCH')
  })

  it('空引文 → 被拒（不是「没可比对就放过」）', async () => {
    // 空引文同时命中两条判据（schema 的 minLength 1 与引文命中的非空要求），
    // 按优先级出处族在前、字段族在后，主码落在 SCHEMA_INVALID。要点是：**一定被拒**。
    const v = await judgeOne('')
    assert.equal(v.status, 'reject')
    assert.equal(v.reasonCode, 'SCHEMA_INVALID')
    assert.deepEqual(v.failures.map((f) => f.code).sort(), ['QUOTE_MISMATCH', 'SCHEMA_INVALID'])
  })

  it('归一化不碰下划线：`web_search` 与 `websearch` 不得被视为同一段文字', () => {
    // 下划线在正文里是真标识符；剥掉它会把不同的东西变成相同的东西——那是放松到危险方向。
    assert.notEqual(
      normalizeForQuoteComparison('调用 web_search 工具'),
      normalizeForQuoteComparison('调用 websearch 工具'),
    )
  })

  it('归一化抹掉渲染后不可见的四类标记：强调 / 引用块 / 行内代码 / 反斜杠转义', () => {
    assert.equal(normalizeForQuoteComparison('**粗体** 与 普通'), '粗体与普通')
    assert.equal(normalizeForQuoteComparison('> **实验组**：实现'), '实验组：实现')
    assert.equal(normalizeForQuoteComparison('  > 缩进的引用'), '缩进的引用')
    assert.equal(normalizeForQuoteComparison('OpenAI 的 `tool_search` 与 `defer_loading`'), 'OpenAI的tool_search与defer_loading')
    assert.equal(normalizeForQuoteComparison('弯引号（\\u201c和\\u201d）'), '弯引号（\\u201c和\\u201d）')
    assert.equal(normalizeForQuoteComparison('弯引号（\\\\u201c和\\\\u201d）'), '弯引号（\\u201c和\\u201d）')
  })

  it('空白整体忽略：换行、空行、行内空格两个方向都不算差异', () => {
    assert.equal(normalizeForQuoteComparison('a\n\n  b'), 'ab')
    assert.equal(normalizeForQuoteComparison('a b'), 'ab')
    // 方向一：源里是换行、空行，引文里没有
    assert.equal(normalizeForQuoteComparison('击穿 KV Cache。\n\n答案有三层'), normalizeForQuoteComparison('击穿 KV Cache。答案有三层'))
    // 方向二：源里是行内空格（此处紧跟在 `**` 之后），引文里没有
    assert.equal(
      normalizeForQuoteComparison('**从被动选择到主动发现。** 更进一步的思路'),
      normalizeForQuoteComparison('从被动选择到主动发现。更进一步的思路'),
    )
  })

  it('归一化仍不碰中文弯引号：那是字符替换，不是零宽差异（用户拍板不放宽）', () => {
    assert.notEqual(
      normalizeForQuoteComparison('声明“我需要什么能力”'),
      normalizeForQuoteComparison('声明"我需要什么能力"'),
    )
  })

  it('只有空白的引文不得被判成命中（归一化会把空串变成 includes 的恒真匹配）', () => {
    // 这是往**放松**方向跑偏的静默失效：`anything.includes('')` 恒为真。
    assert.equal(quoteHitsRegion(normalizeForQuoteComparison('任何正文'), normalizeForQuoteComparison('   ')), false)
    assert.equal(quoteHitsRegion(normalizeForQuoteComparison('任何正文'), normalizeForQuoteComparison('')), false)
    assert.equal(quoteHitsRegion(normalizeForQuoteComparison('任何正文'), normalizeForQuoteComparison('正文')), true)
  })

  it('弯引号被替换的引文仍被拒：沿用实测样本（history/chapter4.b01d756d 的同类）', async () => {
    const strictQuote = QUOTE
    const swapped = strictQuote.replace(/“/g, '"').replace(/”/g, '"')
    if (swapped === strictQuote) return // 该样本没有弯引号，跳过（不得据此断言更多）
    const v = await judgeOne(swapped)
    assert.equal(v.status, 'reject')
    assert.equal(v.reasonCode, 'QUOTE_MISMATCH')
  })

  it('判据的放宽幅度有界：内部删掉任何一个非空白字都必被拒', async () => {
    // 扫描式验证。两类删除**刻意排除**，因为放过它们是设计意图而非漏洞：
    //   ① 首尾字：删掉首字或尾字得到的是**更短的前缀/后缀**，它仍是原文的子串——
    //      这在旧判据下也一样成立，与本次放宽无关。
    //   ② 空白字：源文里连续空白 vs 单个空白是排版差异，正是本次要容忍的那一类。
    const chars = [...QUOTE.replace(/\*\*/g, '')]
    const whitespace = new Set([' ', '\n', '\r', '\t'])
    let falseAccepts = 0
    for (let i = 1; i < chars.length - 1; i += 1) {
      if (whitespace.has(chars[i])) continue
      const mutated = chars.slice(0, i).join('') + chars.slice(i + 1).join('')
      if (mutated.trim() === '') continue
      const v = await judgeOne(mutated)
      if (v.status === 'pass') {
        falseAccepts += 1
        assert.fail(`删掉内部的 ${JSON.stringify(chars[i])} 被放过了`)
      }
    }
    assert.equal(falseAccepts, 0)
  })
})
