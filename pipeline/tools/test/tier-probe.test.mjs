/**
 * 档位探针的**记账性质**测试
 *
 * 探针（`pipeline/tools/tier-probe.mjs`）是用来给 ADR-009 定档提供证据的仪器。
 * 仪器本身错了，结论就是错的，而错的仪器通常**看起来更正常**——这是本文件存在的理由。
 *
 * 这里钉的核心性质只有一条，但它是一条真实缺陷：
 *
 *   > 同一个档位跑两个臂时，两臂必须各自独立记账，**不得互相覆盖**。
 *
 * 缺陷经过：最初直接用档位名作 `byTier` 的键，于是 `--tiers high,high`
 * （量噪声底的标准做法）会让第二个臂覆盖第一个臂的判决，两臂显示「完全一致」——
 * **恰好把噪声底报成 0**，而噪声底正是判断「档位效应是否可分辨」的那个量。
 * 零噪声底会让任何档位结论都显得成立。
 *
 * 本文件只测纯函数，零网络、零凭据。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { comparePair, labelArms } from '../tier-probe.mjs'

/** 造一份与 main() 中同形状的对齐矩阵。 */
function matrixOf(rows) {
  return rows.map(([objectId, byArm]) => ({ objectId, objectType: 'Concept', byArm }))
}

/** 造一个与 main() 中同形状的臂。 */
function armOf(label, verdicts) {
  return { label, verdicts: Object.fromEntries(Object.entries(verdicts).map(([k, v]) => [k, { verdict: v }])) }
}

describe('档位探针 · 臂标签必须唯一', () => {
  it('同档两臂得到不同的标签（这正是量噪声底所必需的）', () => {
    const labels = labelArms(['high', 'high', 'low']).map((a) => a.label)
    assert.deepEqual(labels, ['high', 'high#2', 'low'])
    assert.equal(new Set(labels).size, labels.length, '标签必须互不相同')
  })

  it('同档三臂也不碰撞', () => {
    const labels = labelArms(['low', 'low', 'low']).map((a) => a.label)
    assert.deepEqual(labels, ['low', 'low#2', 'low#3'])
  })

  it('不同档位各保留原名，不加后缀', () => {
    assert.deepEqual(labelArms(['high', 'low']).map((a) => a.label), ['high', 'low'])
  })

  it('「不发字段」的臂标为 default，且同样遵守唯一性', () => {
    assert.deepEqual(labelArms([null, null]).map((a) => a.label), ['default', 'default#2'])
  })

  it('档位取值被原样保留（标签变了不等于档位变了）', () => {
    const arms = labelArms(['high', 'high'])
    assert.deepEqual(arms.map((a) => a.tier), ['high', 'high'])
  })
})

describe('档位探针 · 同档两臂的差异必须被算出来，不得被吞掉', () => {
  it('同档两臂判决不同 → 差异条数为 1，而不是 0', () => {
    const a = armOf('high', { X1: 'supported' })
    const b = armOf('high#2', { X1: 'insufficient' })
    const matrix = matrixOf([['X1', { high: 'supported', 'high#2': 'insufficient' }]])

    const pair = comparePair(a, b, matrix)
    assert.equal(pair.counts.disagree, 1, '同档两臂不一致时必须被算作不一致')
    assert.equal(pair.counts.agree, 0)
    assert.deepEqual(pair.comparedArms, ['high', 'high#2'])
  })

  it('两臂判决相同 → 一致', () => {
    const a = armOf('high', { X1: 'supported' })
    const b = armOf('high#2', { X1: 'supported' })
    const matrix = matrixOf([['X1', { high: 'supported', 'high#2': 'supported' }]])
    assert.equal(comparePair(a, b, matrix).counts.agree, 1)
  })
})

describe('档位探针 · 方向标签必须区分「丢检出」与「更严」', () => {
  it('A 检出、B 放过 → 标为 A-only（若 A 是高档，这就是降档丢掉的检出）', () => {
    const a = armOf('high', { X1: 'insufficient' })
    const b = armOf('low', { X1: 'supported' })
    const matrix = matrixOf([['X1', { high: 'insufficient', low: 'supported' }]])

    const pair = comparePair(a, b, matrix)
    assert.equal(pair.rows[0].direction, 'high-only')
  })

  it('B 检出、A 放过 → 标为 B-only（方向相反，不可与上一条混为一谈）', () => {
    const a = armOf('high', { X1: 'supported' })
    const b = armOf('low', { X1: 'insufficient' })
    const matrix = matrixOf([['X1', { high: 'supported', low: 'insufficient' }]])

    const pair = comparePair(a, b, matrix)
    assert.equal(pair.rows[0].direction, 'low-only')
  })

  it('两臂都检出、但判得不同（不充分 vs 不支撑）→ 不是「谁丢了检出」', () => {
    const a = armOf('high', { X1: 'insufficient' })
    const b = armOf('low', { X1: 'unsupported' })
    const matrix = matrixOf([['X1', { high: 'insufficient', low: 'unsupported' }]])

    const pair = comparePair(a, b, matrix)
    assert.equal(pair.rows[0].direction, 'both-detect-differently')
  })

  it('只有「支撑」算放过：两种拒绝互相之间不算丢检出', () => {
    // ADR-010 决策 2：不充分与不支撑都拒绝。方向判定必须与这条同口径。
    const a = armOf('high', { X1: 'insufficient' })
    const b = armOf('low', { X1: 'insufficient' })
    const matrix = matrixOf([['X1', { high: 'insufficient', low: 'insufficient' }]])
    assert.equal(comparePair(a, b, matrix).counts.agree, 1, '同一种拒绝 == 一致')
  })
})
