/**
 * 溢出阀的测试（ADR-004 决策 2 的首个实现，ticket 16）
 *
 * 钉三件事：超限时**骨架完整 + 指针可见**、references 内容与 SKILL.md 同批对象
 * （逐字节可复算的哈希进契约）、两态渲染确定性；未超限时一个字都不动。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { SIZE_LIMIT_BYTES, assembleSkill } from '../skill-builder.mjs'

const rule = (i) => ({
  id: `R-${i}`,
  objectType: 'EngineeringRule',
  statement: `规则${i}：` + '规'.repeat(40),
  rationale: '理由'.repeat(20),
  appliesWhen: `场景${i}`,
  sourceRefs: [],
})
const concept = (i) => ({
  id: `C-${i}`,
  objectType: 'Concept',
  canonicalTerm: `术语${i}`,
  definition: `术语${i}的定义：` + '义'.repeat(80),
  examples: [`示例A-${i}：` + '例'.repeat(150), `示例B-${i}：` + '例'.repeat(150), `示例C-${i}：` + '例'.repeat(150)],
  sourceRefs: [],
})
const cluster = { rootAnchor: 'x#h2-1', title: '测试簇', level: 2, anchors: [] }

describe('16 · 溢出阀：超限时骨架 + 指针，细节入 references', () => {
  it('超出阈值 → markdown 收敛到阈值内、引用段保留加粗小节头与指针、references 内容完整', () => {
    const objects = [...Array.from({ length: 8 }, (_, i) => rule(i)), ...Array.from({ length: 12 }, (_, i) => concept(i))]
    const a = assembleSkill({ cluster, objects, antipatterns: [], codePointers: [], slug: 'x', skillTitle: 'X' })
    const bytes = Buffer.byteLength(a.markdown, 'utf8')
    assert.ok(bytes <= SIZE_LIMIT_BYTES, `溢出后应 ≤ 阈值，实测 ${bytes}`)
    assert.equal(a.overflow.applied, true)
    assert.ok(a.overflow.bytesFull > SIZE_LIMIT_BYTES)
    assert.equal(a.references.length, 1)
    const ref = a.references[0]
    assert.equal(ref.path, 'references/practice-patterns.md')
    assert.ok(ref.content.includes('示例A-0'), 'references 必须含完整示例内容')
    assert.ok(ref.content.includes('术语0'))

    const section = a.markdown.split('## 实践模式')[1].split('## 常见陷阱')[0]
    assert.ok(section.includes('**术语0**'), '加粗小节头必须保留（条目数口径不变）')
    assert.ok(section.includes('references/practice-patterns.md'), '指针必须在段内可见')
    assert.ok(!section.includes('示例A-0'), '细节不得留在 SKILL.md')
    for (const i of [1, 5, 11]) assert.ok(section.includes(`**术语${i}**`))

    const contractRef = a.contract.references[0]
    assert.equal(contractRef.sha256, `sha256:${createHash('sha256').update(ref.content).digest('hex')}`)
    assert.equal(contractRef.bytes, Buffer.byteLength(ref.content, 'utf8'))
  })

  it('未超限 → 一个字不动：无 references、无指针行、overflow.applied=false', () => {
    const a = assembleSkill({ cluster, objects: [rule(0), concept(0)], antipatterns: [], codePointers: [], slug: 'x', skillTitle: 'X' })
    assert.equal(a.overflow, null)
    assert.deepEqual(a.references, [])
    assert.ok(a.markdown.includes('示例A-0'), '未超限时细节留在原位')
    assert.deepEqual(a.contract.references, [])
    assert.deepEqual(a.contract.overflow, { applied: false })
  })

  it('确定性：同输入两次装配逐字节相同（含 references 与 overflow 记录）', () => {
    const objects = [...Array.from({ length: 8 }, (_, i) => rule(i)), ...Array.from({ length: 12 }, (_, i) => concept(i))]
    const mk = () => assembleSkill({ cluster, objects, antipatterns: [], codePointers: [], slug: 'x', skillTitle: 'X' })
    const a = mk()
    const b = mk()
    assert.equal(a.markdown, b.markdown)
    assert.equal(a.references[0].content, b.references[0].content)
  })

  it('指针态仍超限 → 如实标记 stillOverLimit（不造假收敛）', () => {
    const objects = Array.from({ length: 90 }, (_, i) => rule(i))
    const a = assembleSkill({ cluster, objects: [...objects, concept(0)], antipatterns: [], codePointers: [], slug: 'x', skillTitle: 'X' })
    assert.equal(a.overflow.applied, true)
    assert.equal(a.overflow.stillOverLimit, true)
  })
})
