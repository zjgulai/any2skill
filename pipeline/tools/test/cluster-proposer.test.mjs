/**
 * 环 3 · 语义聚类的测试（ticket 11）
 *
 * 全部离线：模型调用一律用注入的 `chat` 替身。这个文件钉四类东西：
 *   1. **输入压缩与提示词构建**是确定性的（同输入同输出，摘要按类型取字段）；
 *   2. **复用键**只在输入真的变了时才变（提示词/对象/模型/章标题任一变化都必须变）；
 *   3. **校核的四件套**（未归类、未解析 id、重复归属、无候选单元）一个都不许静默丢；
 *   4. **两条「先算结论」的派生**——候选字段名照 MVP 计划 §4.2、跨章处置按 ADR-007 约定。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  CROSS_CHAPTER_OBJECTS_FILE,
  ClusterProposalError,
  anchorsOfObject,
  buildClusterSystemPrompt,
  buildClusterUserPrompt,
  candidatesFromChapters,
  chapterInputHash,
  clusterPromptFingerprint,
  crossChapterDisposition,
  diagnosticsOf,
  listClusterInputFiles,
  parseClusterProposal,
  proposeChapterClusters,
  readPartialClusters,
  summaryOfObject,
  validateClusterProposal,
  writePartialClusters,
} from '../cluster-proposer.mjs'

const A = (n) => `chapterX#h2-${n}`
const OBJ = (id, objectType, fields, anchors = [A(1)]) => ({
  id,
  objectType,
  sourceRefs: anchors.map((a) => ({ file: 'sources/ai-agent-book-zh/book/chapterX.md', anchor: a })),
  ...fields,
})

const OBJECTS = [
  OBJ('CX-1', 'EngineeringRule', { statement: '规则一', appliesWhen: '场景一' }, [A(1), A(2)]),
  OBJ('CX-2', 'EngineeringRule', { statement: '规则二' }, [A(2)]),
  OBJ('CX-3', 'Concept', { canonicalTerm: '术语', definition: '定义' }, [A(3)]),
  OBJ('CX-4', 'AntiPattern', { pattern: '坑' }, [A(3)]),
  OBJ('CX-5', 'Heuristic', { trigger: '触发', recommendation: '建议' }, [A(4)]),
]

const GOOD_PROPOSAL = {
  units: [
    { name: '单元一', objectIds: ['CX-1', 'CX-2'], rationale: '同属规则族' },
    { name: '单元二', objectIds: ['CX-3', 'CX-4', 'CX-5'], rationale: '同属概念与陷阱' },
  ],
  skills: [{ name: '候选一', trigger: '做 X 时', unitIndexes: [0, 1], rationale: '同一批场景' }],
}

describe('11 · 输入压缩：摘要按类型取字段，且是确定性的', () => {
  test('EngineeringRule 取 statement；Concept 拼「术语：定义」；Heuristic 拼「触发 → 建议」', () => {
    assert.equal(summaryOfObject(OBJECTS[0]), '规则一')
    assert.equal(summaryOfObject(OBJECTS[2]), '术语：定义')
    assert.equal(summaryOfObject(OBJECTS[4]), '触发 → 建议')
  })

  test('超长摘要被截断并带省略号；换行被单行化（压缩不影响原文——原文在对象文件里）', () => {
    const s = summaryOfObject(OBJ('CX-9', 'EngineeringRule', { statement: 'x'.repeat(300) + '\n第二行' }))
    assert.equal(s.length, 141)
    assert.ok(s.endsWith('…'))
    assert.ok(!s.includes('\n'))
  })

  test('无任何摘要字段时不编造：给出显式占位', () => {
    assert.equal(summaryOfObject(OBJ('CX-8', 'Case', {})), '(无摘要字段)')
  })

  test('锚点去重保序', () => {
    assert.deepEqual(anchorsOfObject(OBJECTS[0]), [A(1), A(2)])
    assert.deepEqual(anchorsOfObject(OBJ('CX-7', 'Concept', {}, [A(1), A(1), A(2)])), [A(1), A(2)])
  })
})

describe('11 · 复用键：输入真的变了，键才变', () => {
  const rows = OBJECTS.map((o) => ({
    id: o.id,
    objectType: o.objectType,
    summary: summaryOfObject(o),
    anchors: anchorsOfObject(o),
  }))
  const base = { fileKey: 'chapterX', chapterTitle: '某章', rows, modelId: 'm1' }

  test('同输入 → 同键；行序不同 → 键不同（复用键哈希的是**真正要发出的提示词**，行序在提示词里）', () => {
    assert.equal(chapterInputHash(base), chapterInputHash({ ...base, rows: [...rows] }))
    assert.notEqual(chapterInputHash(base), chapterInputHash({ ...base, rows: [...rows].reverse() }))
  })

  test('对象内容 / 模型 id / 章标题 任一变化 → 键变', () => {
    const changed = rows.map((r, i) => (i === 0 ? { ...r, summary: `${r.summary}改` } : r))
    assert.notEqual(chapterInputHash(base), chapterInputHash({ ...base, rows: changed }))
    assert.notEqual(chapterInputHash(base), chapterInputHash({ ...base, modelId: 'm2' }))
    assert.notEqual(chapterInputHash(base), chapterInputHash({ ...base, chapterTitle: '另一章' }))
  })

  test('提示词指纹是模块级的常量（与具体章无关）', () => {
    assert.match(clusterPromptFingerprint(), /^prompt-[0-9a-f]{12}$/)
    assert.equal(clusterPromptFingerprint(), clusterPromptFingerprint())
  })

  test('用户提示词包含章标识与逐行对象；系统提示词钉住「恰好一个单元」这条硬要求', () => {
    const user = buildClusterUserPrompt({ fileKey: 'chapterX', chapterTitle: '某章', rows })
    assert.ok(user.includes('chapterX'))
    assert.ok(user.includes('CX-1 | EngineeringRule | 规则一'))
    assert.ok(buildClusterSystemPrompt().includes('每个对象必须恰好出现在一个内容单元里'))
  })
})

describe('11 · 解析：不做语义修补，坏响应即抛', () => {
  test('合法 JSON（含锚定围栏）可解析', () => {
    assert.deepEqual(parseClusterProposal('{"units":[],"skills":[]}'), { units: [], skills: [] })
    assert.deepEqual(parseClusterProposal('```json\n{"units":[],"skills":[]}\n```'), { units: [], skills: [] })
  })

  test('坏响应抛 ClusterProposalError 且携带原文（可从错误对象取回，无需重买）', () => {
    assert.throws(
      () => parseClusterProposal('不是 JSON'),
      (err) => err instanceof ClusterProposalError && typeof err.rawText === 'string',
    )
  })
})

describe('11 · 校核：四件套一个都不许静默丢', () => {
  const rows = OBJECTS.map((o) => ({ id: o.id, objectType: o.objectType, summary: summaryOfObject(o), anchors: anchorsOfObject(o) }))

  test('正常提案：两级记录派生正确，四件套全空', () => {
    const r = validateClusterProposal(GOOD_PROPOSAL, { fileKey: 'chapterX', rows })
    assert.deepEqual(r.units.map((u) => u.unitId), ['chapterX-u1', 'chapterX-u2'])
    assert.deepEqual(r.skills.map((s) => s.skillId), ['chapterX-s1'])
    assert.deepEqual(r.units[0].anchors, [A(1), A(2)])
    assert.deepEqual(r.skills[0].objectIds, ['CX-1', 'CX-2', 'CX-3', 'CX-4', 'CX-5'])
    assert.deepEqual(r.coverage, {
      gatePassed: 5,
      assigned: 5,
      unassigned: [],
      duplicates: [],
      unresolvedObjectIds: [],
      unitsWithoutSkill: [],
    })
  })

  test('模型漏掉对象 → unassigned 带理由', () => {
    const proposal = {
      units: [{ name: 'u', objectIds: ['CX-1', 'CX-2'], rationale: 'r' }],
      skills: [{ name: 's', trigger: 't', unitIndexes: [0], rationale: 'r' }],
    }
    const r = validateClusterProposal(proposal, { fileKey: 'chapterX', rows })
    assert.deepEqual(r.coverage.unassigned.map((u) => u.objectId), ['CX-3', 'CX-4', 'CX-5'])
    assert.ok(r.coverage.unassigned.every((u) => u.reason.length > 0))
  })

  test('模型引用不存在的 id → unresolvedObjectIds（含引用者）', () => {
    const proposal = {
      units: [{ name: 'u', objectIds: ['CX-1', 'CX-404'], rationale: 'r' }],
      skills: [{ name: 's', trigger: 't', unitIndexes: [0], rationale: 'r' }],
    }
    const r = validateClusterProposal(proposal, { fileKey: 'chapterX', rows })
    assert.deepEqual(r.coverage.unresolvedObjectIds, [{ objectId: 'CX-404', citedBy: 'chapterX-u1' }])
    assert.deepEqual(r.units[0].objectIds, ['CX-1'])
  })

  test('对象被归进两个单元 → duplicates 记录全部归属与保留项（保留第一次）', () => {
    const proposal = {
      units: [
        { name: 'u1', objectIds: ['CX-1'], rationale: 'r' },
        { name: 'u2', objectIds: ['CX-1', 'CX-2'], rationale: 'r' },
      ],
      skills: [{ name: 's', trigger: 't', unitIndexes: [0, 1], rationale: 'r' }],
    }
    const r = validateClusterProposal(proposal, { fileKey: 'chapterX', rows })
    assert.deepEqual(r.coverage.duplicates, [
      { objectId: 'CX-1', units: ['chapterX-u1', 'chapterX-u2'], kept: 'chapterX-u1' },
    ])
    // 已归类 = 出现在至少一个单元里的对象数（CX-1、CX-2）；重复归属不减这个数，但必须可见。
    assert.equal(r.coverage.assigned, 2)
    assert.deepEqual(r.coverage.unassigned.map((u) => u.objectId), ['CX-3', 'CX-4', 'CX-5'])
  })

  test('单元没进任何候选 → unitsWithoutSkill', () => {
    const proposal = {
      units: [
        { name: 'u1', objectIds: ['CX-1'], rationale: 'r' },
        { name: 'u2', objectIds: ['CX-2'], rationale: 'r' },
      ],
      skills: [{ name: 's', trigger: 't', unitIndexes: [0], rationale: 'r' }],
    }
    const r = validateClusterProposal(proposal, { fileKey: 'chapterX', rows })
    assert.deepEqual(r.coverage.unitsWithoutSkill, ['chapterX-u2'])
  })

  test('unitIndexes 越界 → 抛错（不静默忽略）', () => {
    const proposal = { units: [{ name: 'u', objectIds: ['CX-1'], rationale: 'r' }], skills: [{ name: 's', trigger: 't', unitIndexes: [3], rationale: 'r' }] }
    assert.throws(() => validateClusterProposal(proposal, { fileKey: 'chapterX', rows }), /越界/)
  })

  test('缺 units / skills 数组 → 抛错（形状不可识别不当作空）', () => {
    assert.throws(() => validateClusterProposal({ skills: [] }, { fileKey: 'chapterX', rows }), /没有 units 数组/)
    assert.throws(() => validateClusterProposal({ units: [] }, { fileKey: 'chapterX', rows }), /没有 skills 数组/)
  })
})

describe('11 · 单章提案：注入 chat 替身即可离线跑通', () => {
  const chatOf = (proposal, usage = { prompt_tokens: 100, completion_tokens: 20 }) =>
    async () => ({
      text: JSON.stringify(proposal),
      usage,
      modelId: 'stub-model',
      finishReason: 'stop',
      reasoningChars: 0,
    })

  test('提案记录携带身份（复用键与 config.modelId 一致）与覆盖率', async () => {
    const config = { modelId: 'stub-model' }
    const record = await proposeChapterClusters({
      config,
      fileKey: 'chapterX',
      chapterTitle: '某章',
      objects: OBJECTS,
      chat: chatOf(GOOD_PROPOSAL),
      createdAt: '2026-10-12T00:00:00.000Z',
    })
    assert.equal(record.fileKey, 'chapterX')
    assert.equal(record.status, 'proposed')
    assert.equal(record.modelId, 'stub-model')
    assert.equal(record.units.length, 2)
    assert.equal(record.skills.length, 1)
    assert.deepEqual(record.coverage.unassigned, [])
    const rows = OBJECTS.map((o) => ({ id: o.id, objectType: o.objectType, summary: summaryOfObject(o), anchors: anchorsOfObject(o) }))
    assert.equal(record.inputHash, chapterInputHash({ fileKey: 'chapterX', chapterTitle: '某章', rows, modelId: 'stub-model' }))
  })

  test('模型截断（finish_reason=length）如实记录（由调用方决定是否重跑）', async () => {
    const res = async () => ({ text: JSON.stringify(GOOD_PROPOSAL), usage: null, modelId: 'stub-model', finishReason: 'length', reasoningChars: 10 })
    const record = await proposeChapterClusters({ config: { modelId: 'stub-model' }, fileKey: 'chapterX', objects: OBJECTS, chat: res })
    assert.equal(record.finishReason, 'length')
  })
})

describe('11 · 候选派生与跨章处置（先算结论，ADR-024 决策 3）', () => {
  test('SkillCandidate 字段名照 MVP 计划 §4.2；promotionState 初值 candidate', () => {
    const chapters = validateClusterProposal(GOOD_PROPOSAL, {
      fileKey: 'chapterX',
      rows: OBJECTS.map((o) => ({ id: o.id, objectType: o.objectType, summary: summaryOfObject(o), anchors: anchorsOfObject(o) })),
    })
    const candidates = candidatesFromChapters([{ fileKey: 'chapterX', ...chapters }])
    assert.equal(candidates.length, 1)
    const c = candidates[0]
    assert.equal(c.skillId, 'chapterX-s1')
    assert.equal(c.trigger, '做 X 时')
    assert.deepEqual(c.chapterRefs, ['chapterX'])
    assert.equal(c.promotionState, 'candidate')
    assert.deepEqual(c.units, ['chapterX-u1', 'chapterX-u2'])
    assert.deepEqual(c.anchors, [A(1), A(2), A(3), A(4)])
    for (const field of ['skillId', 'sourceObjects', 'trigger', 'chapterRefs', 'promotionState']) {
      assert.ok(field in c, `缺字段 ${field}`)
    }
  })

  test('跨章处置：跨 ≥2 章 → 待门禁二验证；单章 → 分发进陷阱段（且条件未验证字段为 null）', () => {
    const aps = [
      OBJ('AP-A', 'AntiPattern', { pattern: '跨章的坑' }, ['chapter1#h2-1', 'chapter3#h1-1']),
      OBJ('AP-B', 'AntiPattern', { pattern: '单章的坑' }, ['chapter2#h2-2']),
    ]
    const [cross, single] = crossChapterDisposition(aps)
    assert.equal(cross.objectId, 'AP-A')
    assert.equal(cross.decision, 'independent-candidate-pending-gate2')
    assert.equal(cross.chapterCount, 2)
    assert.ok(cross.unverifiedCondition.includes('门禁二'))
    assert.equal(single.decision, 'distribute-to-pitfalls')
    assert.equal(single.unverifiedCondition, null)
  })

  test('诊断块：2.2 对照只在章口径上算，且标注「仅诊断」', () => {
    const chapters = [
      { fileKey: 'chapter4', units: [{ objectIds: [1, 2] }, { objectIds: [3] }], skills: [{ unitIds: ['a'] }], coverage: { gatePassed: 3, unassigned: [], unresolvedObjectIds: [] } },
      { fileKey: 'introduction', units: [{ objectIds: [1] }], skills: [{ unitIds: ['a'] }], coverage: { gatePassed: 1, unassigned: [], unresolvedObjectIds: [] } },
    ]
    const d = diagnosticsOf(chapters, [{ skillId: 'chapter4-s1' }])
    assert.equal(d.reference.skillsPerChapter, 2.2)
    assert.equal(d.reference.observedChapters, 1, '只有 chapterN 形态的文件进程级对照')
    assert.equal(d.reference.observedSkills, 1)
    assert.match(d.reference.note, /仅诊断/)
    assert.deepEqual(d.unitSize, { min: 1, median: 1, max: 2, n: 3 })
  })
})

describe('11 · 输出文件枚举与 partial 往返', () => {
  test('排除跨章综合产物、按名排序', () => {
    assert.deepEqual(
      listClusterInputFiles(['b.objects.json', CROSS_CHAPTER_OBJECTS_FILE, 'a.objects.json', 'x.anchors.json']),
      ['a.objects.json', 'b.objects.json'],
    )
  })

  test('partial 写读往返（续跑用；*.partial.json 已被 .gitignore 忽略）', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-clusters-'))
    try {
      const doc = { schemaVersion: 'clusters/v1-partial', promptFingerprint: clusterPromptFingerprint(), chapters: { chapterX: { inputHash: 'sha256:0' } } }
      const abs = await writePartialClusters(doc, root)
      assert.match(abs, /clusters\.partial\.json$/)
      assert.deepEqual(await readPartialClusters(root), doc)
      assert.equal(await readPartialClusters(path.join(root, 'nope')), null)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
