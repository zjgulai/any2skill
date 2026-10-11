/**
 * 卡 06 · 反模式跨章综合的判据测试
 *
 * 这些测试**不调用模型**：跨章综合是一条新链路，而它最容易出错的地方不是提示词写得好不好，
 * 是「跨章」这件事**有没有被机器检验**。因此本文件把卡 06 的四条验收逐条钉成断言：
 *
 *   1. 一个只能由两章共同支撑的反模式 → `sourceRefs` 覆盖两章**且通过验证**；
 *   2. 一个仅由单章支撑却声称跨章的对象 → 被正确归类并带对应标记；
 *   3. 同一 `corrective` 在两条记录里精确相等 → 合并为一条；
 *   4. 分布统计与逐条明细**复算一致**（不靠目测）。
 *
 * 夹具取自**真实源文件**（chapter5 / chapter7）而不是手写字符串：手写的引文永远能命中手写的
 * 正文，那样的测试无法证明「逐字比对」这条判据真的在工作。引文由被测锚点的真实区间里取出。
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_REPO_ROOT, buildAnchorIndex, normalizeSourceLines } from '../../tools/anchor-index.mjs'
import { verifyObjects, anchorLookup } from '../../tools/verifier.mjs'
import { judgePromptFingerprint } from '../../tools/judge.mjs'
import { PIPELINE_VERSION } from '../../run.mjs'
import { synthRawRunId, synthRunId } from '../../synthesize-antipatterns.mjs'
import { findLatestAntipatternVerdicts } from '../../build-skill.mjs'
import {
  ANTIPATTERN_MARKS,
  MARK_MEANING,
  buildDistribution,
  markForAntiPattern,
  materializeSynthesizedAntiPattern,
  mergeByExactCorrective,
  synthesizedIdFor,
} from '../../tools/antipattern-synthesis.mjs'

const REPO = DEFAULT_REPO_ROOT
const CH5 = 'sources/ai-agent-book-zh/book/chapter5.md'
const CH7 = 'sources/ai-agent-book-zh/book/chapter7.md'

let IDX5
let IDX7
let LINES5
let LINES7
/** 从真实区间里取出的一段逐字原文（非标题行）。 */
const QUOTE = new Map()

const pickQuote = (lines, anchorEntry, minLen = 20) => {
  for (let i = anchorEntry.lineStart; i < anchorEntry.lineEnd; i += 1) {
    const line = lines[i]
    if (line === undefined) break
    const t = line.trim()
    if (t === '' || t.startsWith('#')) continue
    if (t.length >= minLen) return t
  }
  throw new Error(`锚点 ${anchorEntry.anchor} 里找不到可用的引文行——本测试需要一段真实正文`)
}

const refOf = (index, entry, quote) => ({
  file: index.sourceFile,
  anchor: entry.anchor,
  title: entry.title,
  lineStart: entry.lineStart,
  lineEnd: entry.lineEnd,
  contentHash: entry.contentHash,
  ...(quote === undefined ? {} : { quote }),
})

const antiPattern = ({ id, sourceRefs, evidenceQuote, corrective = '应当先做 X 再做 Y' }) => ({
  id,
  objectType: 'AntiPattern',
  revision: 1,
  status: 'candidate',
  createdAt: '2026-10-09T00:00:00.000Z',
  evidenceGrade: 'E2-derived',
  freshness: { state: 'fresh', asOf: '2026-10-09T00:00:00.000Z' },
  sourceRefs,
  evidenceQuote,
  pattern: '一种失败做法',
  harm: '造成损害',
  corrective,
  evidence: ['书中相关的说明'],
  chapterRef: 'chapter5',
})

before(async () => {
  IDX5 = await buildAnchorIndex(path.join(REPO, CH5), { repoRoot: REPO })
  IDX7 = await buildAnchorIndex(path.join(REPO, CH7), { repoRoot: REPO })
  LINES5 = normalizeSourceLines(await readFile(path.join(REPO, CH5), 'utf8'))
  LINES7 = normalizeSourceLines(await readFile(path.join(REPO, CH7), 'utf8'))
  // 每个可用的锚点各取一段真实引文。取不到就报错——而不是让测试静默退化成空夹具。
  for (const [idx, lines] of [
    [IDX5, LINES5],
    [IDX7, LINES7],
  ]) {
    for (const a of idx.anchors) {
      try {
        QUOTE.set(a.anchor, pickQuote(lines, a))
      } catch {
        /* 该锚点里没有够长的正文行，跳过 */
      }
    }
  }
})

const anchorWithQuote = (idx, n = 0) => {
  const usable = idx.anchors.filter((a) => QUOTE.has(a.anchor))
  assert.ok(usable.length > n, `${idx.sourceFile} 的可用锚点不足`)
  return usable[n]
}

describe('06 · 跨章综合：跨章是可验证的事实，不是自述', () => {
  it('只能由两章共同支撑的反模式：sourceRefs 覆盖两章且通过验证', async () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const a7 = anchorWithQuote(IDX7, 0)
    const refs = [refOf(IDX5, a5, QUOTE.get(a5.anchor)), refOf(IDX7, a7, QUOTE.get(a7.anchor))]

    const { verdicts } = await verifyObjects(
      [antiPattern({ id: 'AP-SYNTH-T98-01', sourceRefs: refs, evidenceQuote: QUOTE.get(a5.anchor) })],
      [IDX5, IDX7],
      { repoRoot: REPO },
    )

    const v = verdicts[0]
    assert.equal(v.status, 'pass', `应当通过，实际理由码 ${v.reasonCode}：${JSON.stringify(v.failures)}`)
    // 两条出处各自被逐字验过——这是「跨章」从自述变成事实的那一步。
    assert.equal(v.refQuoteComparisons.length, 2)
    assert.deepEqual(
      v.refQuoteComparisons.map((c) => c.acceptedBy),
      ['strict', 'strict'],
    )
    assert.equal(v.refQuoteComparisons[1].anchor, a7.anchor)

    const chapters = [...new Set(refs.map((r) => r.file))].length
    assert.equal(chapters, 2, 'sourceRefs 必须覆盖两个不同的源文件')
  })

  it('逐条引文在**它自己那一条**出处里验：第二条引文不命中 → QUOTE_MISMATCH，且 at 指向 sourceRefs/1', async () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const a7 = anchorWithQuote(IDX7, 0)
    const refs = [
      refOf(IDX5, a5, QUOTE.get(a5.anchor)),
      refOf(IDX7, a7, '这一段在第七章里根本不存在，是用来测逐条引文判据的'),
    ]

    const { verdicts } = await verifyObjects(
      [antiPattern({ id: 'AP-SYNTH-T98-02', sourceRefs: refs, evidenceQuote: QUOTE.get(a5.anchor) })],
      [IDX5, IDX7],
      { repoRoot: REPO },
    )

    const v = verdicts[0]
    assert.equal(v.status, 'reject')
    assert.equal(v.reasonCode, 'QUOTE_MISMATCH')
    const hit = v.failures.find((f) => f.code === 'QUOTE_MISMATCH')
    assert.equal(hit.at, 'sourceRefs/1', '必须指出是第几条出处对不上，而不是只报「引文有问题」')
    assert.match(hit.detail, new RegExp(a7.anchor))
  })

  it('仅由单章支撑却声称跨章 → 归类为 CROSS_CHAPTER_CLAIM_UNSUPPORTED', () => {
    const usable = IDX5.anchors.filter((a) => QUOTE.has(a.anchor))
    assert.ok(usable.length >= 2, 'chapter5 至少要有两个可用锚点才能构造「同章多出处」')
    const theme = {
      id: 'T98',
      chapterKeys: ['chapter5', 'chapter7'],
      anchors: [...usable.slice(0, 2), anchorWithQuote(IDX7, 0)],
    }

    // 引用两个锚点（看起来做了综合），但它们都在 chapter5 里。
    const faked = {
      sourceRefs: [refOf(IDX5, usable[0]), refOf(IDX5, usable[1])],
      __citedAnchors: [usable[0].anchor, usable[1].anchor],
    }
    assert.equal(markForAntiPattern(faked, { theme }).mark, 'CROSS_CHAPTER_CLAIM_UNSUPPORTED')

    // 真的跨章 → 另一个标记；只有一条出处 → 又是另一个标记。三者互不混淆。
    const genuine = {
      sourceRefs: [refOf(IDX5, usable[0]), refOf(IDX7, anchorWithQuote(IDX7, 0))],
      __citedAnchors: [usable[0].anchor, anchorWithQuote(IDX7, 0).anchor],
    }
    assert.equal(markForAntiPattern(genuine, { theme }).mark, 'CROSS_CHAPTER_SUPPORTED')

    const single = { sourceRefs: [refOf(IDX5, usable[0])], __citedAnchors: [usable[0].anchor] }
    assert.equal(markForAntiPattern(single, { theme }).mark, 'SINGLE_CHAPTER_ONLY')

    // 三个标记都在封闭集合里，且都有含义可读。
    for (const m of ['CROSS_CHAPTER_CLAIM_UNSUPPORTED', 'CROSS_CHAPTER_SUPPORTED', 'SINGLE_CHAPTER_ONLY']) {
      assert.ok(ANTIPATTERN_MARKS.includes(m))
      assert.equal(typeof MARK_MEANING[m], 'string')
    }
  })

  it('同一 corrective 精确相等 → 合并为一条，出处取并集', () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const a7 = anchorWithQuote(IDX7, 0)
    const same = '把评估数据集当训练集用来调提示词'
    const objects = [
      antiPattern({
        id: 'AP-SYNTH-T98-01',
        sourceRefs: [refOf(IDX5, a5, QUOTE.get(a5.anchor))],
        evidenceQuote: QUOTE.get(a5.anchor),
        corrective: same,
      }),
      antiPattern({
        id: 'AP-SYNTH-T98-02',
        sourceRefs: [refOf(IDX7, a7, QUOTE.get(a7.anchor))],
        evidenceQuote: QUOTE.get(a7.anchor),
        corrective: same,
      }),
      antiPattern({
        id: 'AP-SYNTH-T98-03',
        sourceRefs: [refOf(IDX5, a5, QUOTE.get(a5.anchor))],
        evidenceQuote: QUOTE.get(a5.anchor),
        corrective: '另一条完全不同的纠正做法',
      }),
    ]

    const { objects: merged, merges } = mergeByExactCorrective(objects, { themeId: 'T98' })

    assert.equal(merged.length, 2, '两条同 corrective 的应合成一条，另一条不动')
    assert.equal(merges.length, 1)
    assert.equal(merges[0].keptId, 'AP-SYNTH-T98-01')
    assert.equal(merges[0].mergedId, 'AP-SYNTH-T98-02')
    assert.equal(merges[0].distinctCorrectiveMatch, 'exact')
    const kept = merged.find((o) => o.id === 'AP-SYNTH-T98-01')
    assert.equal(kept.sourceRefs.length, 2)
    assert.deepEqual(
      [...new Set(kept.sourceRefs.map((r) => r.file))].length,
      2,
      '合并后出处应跨两个文件——这正是「同一主题在多章重复出现」的形态',
    )
  })

  it('精确相等才合并：只差一个字的 corrective 不合并（不引入相似度阈值）', () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const base = '先写评估再写提示词'
    const near = '先写评估，再写提示词'
    const objects = [
      antiPattern({ id: 'AP-SYNTH-T98-01', sourceRefs: [refOf(IDX5, a5)], evidenceQuote: QUOTE.get(a5.anchor), corrective: base }),
      antiPattern({ id: 'AP-SYNTH-T98-02', sourceRefs: [refOf(IDX5, a5)], evidenceQuote: QUOTE.get(a5.anchor), corrective: near }),
    ]
    const { objects: merged, merges } = mergeByExactCorrective(objects, { themeId: 'T98' })
    assert.equal(merged.length, 2, '卡 06 明令不预设相似度阈值：近似不构成合并理由')
    assert.equal(merges.length, 0)
  })

  it('分布统计与逐条明细复算一致', () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const a7 = anchorWithQuote(IDX7, 0)
    const marks = [
      { id: 'A', themeId: 'T98', mark: 'CROSS_CHAPTER_SUPPORTED', chapters: ['chapter5', 'chapter7'], sourceRefCount: 2, citedAnchorCount: 2, unresolvedAnchorCount: 0 },
      { id: 'B', themeId: 'T98', mark: 'SINGLE_CHAPTER_ONLY', chapters: ['chapter5'], sourceRefCount: 1, citedAnchorCount: 1, unresolvedAnchorCount: 0 },
      { id: 'C', themeId: 'T98', mark: 'CROSS_CHAPTER_CLAIM_UNSUPPORTED', chapters: ['chapter5'], sourceRefCount: 2, citedAnchorCount: 2, unresolvedAnchorCount: 0 },
      { id: 'D', themeId: 'T98', mark: 'CROSS_CHAPTER_SUPPORTED', chapters: ['chapter5', 'chapter7'], sourceRefCount: 2, citedAnchorCount: 2, unresolvedAnchorCount: 1 },
    ]
    const d = buildDistribution(marks)

    // 复算，而不是照抄上面的数字。
    assert.equal(d.total, marks.length)
    assert.equal(d.total, d.perObject.length, '总数必须等于逐条明细的条数')
    assert.equal(d.multiChapter, marks.filter((m) => m.mark === 'CROSS_CHAPTER_SUPPORTED').length)
    assert.equal(d.crossChapterRatio.numerator, d.multiChapter)
    assert.equal(d.crossChapterRatio.denominator, d.total)

    const recomputed = {}
    for (const m of d.perObject) for (const c of m.chapters) recomputed[c] = (recomputed[c] ?? 0) + 1
    assert.deepEqual(d.chaptersCited, recomputed, '章节分布必须等于逐条明细里章节的出现次数')

    const markSum = Object.values(d.byMark).reduce((a, b) => a + b, 0)
    assert.equal(markSum, d.total, '各标记的计数之和必须等于总数（没有对象的标记被漏掉）')
    for (const m of d.perObject) assert.ok(ANTIPATTERN_MARKS.includes(m.mark))

    // 空集合不能产出 NaN 或 0/0。
    const empty = buildDistribution([])
    assert.equal(empty.total, 0)
    assert.equal(empty.crossChapterRatio.decimal, null)
  })
})

describe('06 · 综合对象物化：身份与出处由流水线填，模型只管知识', () => {
  const theme = () => ({
    id: 'T98',
    name: '测试主题',
    chapterKeys: ['chapter5', 'chapter7'],
    anchors: [],
  })

  it('evidenceQuote 由主锚点的引文接线而来，不由模型写两遍', () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const t = theme()
    t.anchors = [{ anchor: a5.anchor }]
    const entries = new Map([[a5.anchor, a5]])
    const q = QUOTE.get(a5.anchor)

    const { obj } = materializeSynthesizedAntiPattern(
      {
        objectType: 'AntiPattern',
        supportingAnchors: [{ anchor: a5.anchor, quote: q }],
        // 故意给一个与引文不同的 evidenceQuote：模型写错时，流水线的接线必须胜出。
        evidenceQuote: '模型自己写的一句对不上原文的话',
        pattern: 'p',
        harm: 'h',
        corrective: 'c',
        evidence: ['e'],
      },
      { theme: t, anchorEntries: entries, createdAt: '2026-10-09T00:00:00.000Z', seq: 1 },
    )

    assert.equal(obj.evidenceQuote, q, '主引文必须等于主锚点的引文')
    assert.equal(obj.sourceRefs.length, 1)
    assert.equal(obj.sourceRefs[0].quote, q)
    assert.equal(obj.sourceRefs[0].contentHash, a5.contentHash, '出处必须带内容哈希，否则源版本漂移判据形同虚设')
    assert.equal(obj.chapterRef, 'chapter5')
    assert.equal(obj.evidenceGrade, 'E2-derived', '综合物不是「在某段里观察到」，必须如实标注为推导')
    assert.equal(obj.id, 'AP-SYNTH-T98-01')
  })

  it('引用主题外的锚点 = 未解析，既不计入出处也不静默丢弃', () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const a7 = anchorWithQuote(IDX7, 0)
    const t = theme()
    // 主题只给了 chapter5 的锚点，模型却引用了 chapter7 的。
    t.anchors = [{ anchor: a5.anchor }]
    const entries = new Map([
      [a5.anchor, a5],
      [a7.anchor, a7],
    ])

    const out = materializeSynthesizedAntiPattern(
      {
        objectType: 'AntiPattern',
        supportingAnchors: [
          { anchor: a5.anchor, quote: QUOTE.get(a5.anchor) },
          { anchor: a7.anchor, quote: QUOTE.get(a7.anchor) },
          { anchor: 'chapter9#h9-9', quote: '根本不存在的锚点' },
        ],
        pattern: 'p',
        harm: 'h',
        corrective: 'c',
        evidence: ['e'],
      },
      { theme: t, anchorEntries: entries, createdAt: '2026-10-09T00:00:00.000Z', seq: 2 },
    )

    assert.equal(out.obj.sourceRefs.length, 1, '只有主题内的那条构成支撑')
    assert.deepEqual(out.unresolvedAnchors, [a7.anchor, 'chapter9#h9-9'])
    // 全解析不到时 sourceRefs 为空数组，落盘交由第 3 层以 REFERENCE_MISSING 拒绝——
    // 本层不替它判死，否则失败无法归因到具体环节。
    assert.deepEqual(out.citedAnchors, [a5.anchor, a7.anchor, 'chapter9#h9-9'])
  })

  it('id 由主题确定性派生：重跑不产生新 id', () => {
    assert.equal(synthesizedIdFor('T02', 1), 'AP-SYNTH-T02-01')
    assert.equal(synthesizedIdFor('T12', 12), 'AP-SYNTH-T12-12')
    assert.equal(synthesizedIdFor('T02', 1), synthesizedIdFor('T02', 1))
    assert.throws(() => synthesizedIdFor('T2', 1), /主题 id/)
  })

  it('_citedAnchors 不进落盘对象（schema 封闭，多一个字段会让整条变成 SCHEMA_INVALID）', () => {
    const a5 = anchorWithQuote(IDX5, 0)
    const t = theme()
    t.anchors = [{ anchor: a5.anchor }]
    const { obj } = materializeSynthesizedAntiPattern(
      {
        objectType: 'AntiPattern',
        supportingAnchors: [{ anchor: a5.anchor, quote: QUOTE.get(a5.anchor) }],
        pattern: 'p',
        harm: 'h',
        corrective: 'c',
        evidence: ['e'],
      },
      { theme: t, anchorEntries: new Map([[a5.anchor, a5]]), createdAt: '2026-10-09T00:00:00.000Z', seq: 1 },
    )
    assert.equal(Object.prototype.hasOwnProperty.call(obj, 'supportingAnchors'), false)
    assert.equal(Object.prototype.hasOwnProperty.call(obj, '__citedAnchors'), false)
  })
})

describe('06 · 多份锚点索引合并的边界', () => {
  it('同一份索引传两遍 → 报「重复给了两次」，不静默去重', async () => {
    await assert.rejects(
      () =>
        verifyObjects([antiPattern({ id: 'AP-SYNTH-T98-01', sourceRefs: [], evidenceQuote: 'x' })], [IDX5, IDX5], {
          repoRoot: REPO,
        }),
      /同一个锚点被两份索引重复给了两次/,
    )
  })

  it('两份索引指向同一个源文件、锚点却不同（典型：过期索引）→ 由另一条守卫拦下', async () => {
    // 锚点键**不重叠**，所以查找表那道守卫看不见它；这里响的是「同一个文件给了两遍行」。
    // 构造方式：同一文件、锚点标识已变（改过标题后的过期索引就是这个形状）。
    const stale = { ...IDX5, anchors: IDX5.anchors.map((a) => ({ ...a, anchor: `${a.anchor}-old` })) }
    await assert.rejects(
      () =>
        verifyObjects([antiPattern({ id: 'AP-SYNTH-T98-01', sourceRefs: [], evidenceQuote: 'x' })], [IDX5, stale], {
          repoRoot: REPO,
        }),
      /重复给到了同一个源文件/,
    )
  })

  it('锚点查找表跨文件合并且不互相覆盖', () => {
    const lookup = anchorLookup([IDX5, IDX7])
    for (const a of IDX5.anchors) assert.ok(lookup.has(`${a.file}::${a.anchor}`))
    for (const a of IDX7.anchors) assert.ok(lookup.has(`${a.file}::${a.anchor}`))
  })
})

/**
 * 身份解耦（ADR-022 已决 4）。
 *
 * 这组测试钉的是一条**机制**，不是一个数值：`synthRunId` 原来也吃 `judgeEnabled`，
 * 于是判据换代（`judge-prompt/v1 → v2`）后判定表与回执照旧落在同一个 runId 上。
 *
 * 但「把判据身份塞进那一个 id」会连坐另一条性质：续跑（`replayThemeFromRaw`）只认
 * `prior.runId === 本次身份`，身份一换，**已经付过钱的原始响应就再也读不到**。
 * 所以断言分成两半——判定侧要变，raw 侧不许变。
 */
describe('06 · 身份解耦：raw 只认生产者，判定产物另加判据身份', () => {
  const base = {
    themeIds: ['T12', 'T02'],
    promptFingerprint: 'synth-fixturefingerprint',
    catalogHash: 'sha256:fixturecatalog',
    modelId: 'deepseek-v4-pro',
  }
  const artifacts = (over = {}) =>
    synthRunId({
      ...base,
      judgeEnabled: true,
      judgePromptFingerprint: judgePromptFingerprint(),
      pipelineVersion: PIPELINE_VERSION,
      ...over,
    })

  it('两个身份永不相等——`kind` 进摘要，读者只凭文件名就能分辨装着哪一类', () => {
    assert.notEqual(synthRawRunId(base), artifacts())
    // 连「关掉判定者」这一侧也不能与 raw 同形。
    assert.notEqual(synthRawRunId(base), artifacts({ judgeEnabled: false }))
  })

  it('换判据指纹：判定产物身份变，**raw 身份不变**（这一条就是「改下游不必重买 raw」）', () => {
    const before = artifacts()
    const after = artifacts({ judgePromptFingerprint: 'judge-anotherversion' })
    assert.notEqual(after, before)
    assert.equal(synthRawRunId(base), synthRawRunId(base))
  })

  it('换流水线版本：判定产物身份变，raw 身份不变', () => {
    assert.notEqual(artifacts({ pipelineVersion: PIPELINE_VERSION + 1 }), artifacts())
  })

  it('生产者提示词指纹一变，**两边都变**——旧原始响应确实不该再被复用', () => {
    const changed = { ...base, promptFingerprint: 'synth-renamed' }
    assert.notEqual(synthRawRunId(changed), synthRawRunId(base))
    assert.notEqual(artifacts({ promptFingerprint: 'synth-renamed' }), artifacts())
  })

  it('未启用判定者时判据身份记 null：换判据不让 `--no-judge` 的产物身份跟着漂', () => {
    const a = artifacts({ judgeEnabled: false, judgePromptFingerprint: 'judge-x' })
    const b = artifacts({ judgeEnabled: false, judgePromptFingerprint: 'judge-y' })
    assert.equal(a, b)
  })

  it('身份与主题顺序无关（同一批主题只该有一个身份）', () => {
    const shuffled = { ...base, themeIds: ['T02', 'T12'] }
    assert.equal(synthRawRunId(shuffled), synthRawRunId(base))
    assert.equal(artifacts(shuffled), artifacts())
  })
})

/**
 * 装配器取判定表的方式。身份拆开之后，「最新 mtime」不再等于「同一次运行的产物」：
 * registry 里会同时留着不同身份的判定表，而最新那份可能来自一次 `--no-judge` 的运行
 * ——那正是 build-skill 注释里明说要避免的「未判定 ≠ 通过」。
 */
describe('06 · 装配器按身份取判定表，不按 mtime', () => {
  let TMP
  const writeVerdicts = async (runId, { mtimeMs, judgeEnabled = true } = {}) => {
    const dir = path.join(TMP, 'pipeline', 'registry')
    await mkdir(dir, { recursive: true })
    const abs = path.join(dir, `${runId}.antipattern-verdicts.json`)
    await writeFile(
      abs,
      `${JSON.stringify({ schemaVersion: 'antipattern-verdicts/v2', runId, judgeEnabled, verdicts: [] }, null, 2)}\n`,
    )
    if (mtimeMs !== undefined) {
      const t = new Date(mtimeMs)
      await utimes(abs, t, t)
    }
    return abs
  }

  before(async () => {
    TMP = await mkdtemp(path.join(os.tmpdir(), 'any2skills-ap-identity-'))
  })

  it('同身份的那份优先，**即使它更旧**', async () => {
    const mine = await writeVerdicts('run-aaaaaaaaaaaa', { mtimeMs: Date.parse('2026-01-01T00:00:00Z') })
    await writeVerdicts('run-bbbbbbbbbbbb', { mtimeMs: Date.parse('2026-06-01T00:00:00Z') })
    const got = await findLatestAntipatternVerdicts({
      repoRoot: TMP,
      expectRunId: 'run-aaaaaaaaaaaa',
    })
    assert.equal(got.runId, 'run-aaaaaaaaaaaa')
    assert.equal(got.identityMatch, true)
    assert.equal(got.file, mine)
  })

  it('取不到同身份时回退最新，但 `identityMatch` 必须是 false——回退不许伪装成匹配', async () => {
    const got = await findLatestAntipatternVerdicts({
      repoRoot: TMP,
      expectRunId: 'run-cccccccccccc',
    })
    assert.equal(got.runId, 'run-bbbbbbbbbbbb')
    assert.equal(got.identityMatch, false)
    assert.equal(got.candidateCount, 2)
  })

  it('不传 `expectRunId` 时保持旧语义（取最新），且不声称匹配', async () => {
    const got = await findLatestAntipatternVerdicts({ repoRoot: TMP })
    assert.equal(got.runId, 'run-bbbbbbbbbbbb')
    assert.equal(got.identityMatch, false)
  })

  it('一份都没有时返回 null——「没有判定表」与「判定表说都通过了」不是一回事', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'any2skills-ap-empty-'))
    assert.equal(await findLatestAntipatternVerdicts({ repoRoot: empty, expectRunId: 'run-x' }), null)
  })
})
