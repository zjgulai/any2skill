/**
 * 对象集聚合对照工具（零模型调用、零网络）。
 *
 * 这些测试钉的不是数字，是**口径**——一个「跨章占比 4/16 → 7/14」的结论，只有在
 * 「跨章」被定义为「sourceRefs 去重后的**章节数** ≥2」、且「没判定表」与「判定表里没有这条」
 * 被区分开时才成立。口径错了，数字再准也是错的。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  objectsOf,
  verdictsOf,
  profile,
  parseArgs,
} from '../compare-object-sets.mjs'

const mk = (id, anchors, extra = {}) => ({
  id,
  pattern: 'P'.repeat(10),
  harm: 'H'.repeat(5),
  evidenceQuote: anchors[0] ? 'q'.repeat(7) : '',
  sourceRefs: anchors.map((a) => ({ anchor: a, quote: 'q'.repeat(7) })),
  ...extra,
})

describe('对象集对照：口径', () => {
  it('「跨章」按**去重后的章节数**算，不按 sourceRefs 条数', () => {
    // 三条出处全在 chapter5——条数是 3，章节数是 1，必须判为**非**跨章。
    // 这正是「抄取冒充综合」的检出点（CROSS_CHAPTER_CLAIM_UNSUPPORTED 的同一条理由）。
    const same = profile([mk('A-01', ['chapter5#h1-1', 'chapter5#h2-1', 'chapter5#h3-1'])], null, 'x')
    assert.equal(same.rows[0].refs, 3)
    assert.equal(same.rows[0].chapters, 1)
    assert.equal(same.summary.跨章对象数, 0)
    assert.equal(same.summary.跨章比例, '0/1')
  })

  it('两条出处落在两个章节 → 跨章', () => {
    const p = profile([mk('A-01', ['chapter5#h1-1', 'chapter2#h3-1'])], null, 'x')
    assert.equal(p.summary.跨章对象数, 1)
    assert.equal(p.summary.跨章比例, '1/1')
  })

  it('主张字数 = pattern + harm，不含 corrective（corrective 不进判定对象）', () => {
    const p = profile([mk('A-01', ['c#h1'], { pattern: 'abcde', harm: 'xy', corrective: 'ZZZZZZZZZZ' })], null, 'x')
    assert.equal(p.rows[0].claimChars, 7)
  })

  it('没有判定表 → 不输出判定分布；有判定表但没有这条 → 记成「(无判定)」', () => {
    const objs = [mk('A-01', ['c#h1']), mk('A-02', ['c#h2'])]
    assert.equal(profile(objs, null, 'x').summary.判定分布, undefined)

    const partial = new Map([['A-01', { objectId: 'A-01', status: 'pass' }]])
    const p = profile(objs, partial, 'x')
    assert.deepEqual(p.summary.判定分布, { pass: 1, '(无判定)': 1 })
  })

  it('对象集文件的两种形状都认：裸数组与带 wrapper 的 {objects}', () => {
    assert.deepEqual(objectsOf([1, 2]), [1, 2])
    assert.deepEqual(objectsOf({ objects: [3] }), [3])
    assert.deepEqual(objectsOf({}), [])
  })

  it('判定表解析：`null` 与「空表」不是一回事', () => {
    assert.equal(verdictsOf(null), null)
    assert.equal(verdictsOf(undefined), null)
    assert.equal(verdictsOf({ verdicts: [] }).size, 0)
  })

  it('统计量在空集合上是 null，不是 NaN 或 0（「没有对象」不该显示成「全 0」）', () => {
    const p = profile([], null, 'x')
    assert.deepEqual(p.summary.主张字数, { avg: null, median: null, min: null, max: null })
    assert.equal(p.summary.跨章比例, '0/0')
  })
})

describe('对象集对照：CLI', () => {
  it('--old / --new 必填，缺一个就拒绝而不是跑出半张表', () => {
    assert.throws(() => parseArgs(['node', 'x', '--old', 'a.json']), /都必填/)
    assert.throws(() => parseArgs(['node', 'x', '--new', 'a.json']), /都必填/)
  })

  it('未知参数抛错，不静默忽略（拼错的开关会让人以为对照过了）', () => {
    assert.throws(() => parseArgs(['node', 'x', '--old', 'a', '--new', 'b', '--tpo', '5']), /未知参数/)
  })

  it('缺取值报「缺少取值」而不是把下一个开关吃成值', () => {
    assert.throws(() => parseArgs(['node', 'x', '--old', '--new', 'b']), /缺少取值/)
  })
})
