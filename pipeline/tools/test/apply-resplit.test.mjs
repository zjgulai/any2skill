/**
 * 重切执行器的测试（ticket 13）
 *
 * 钉三件事：
 *   1. **执行与决策分开**：approved 不是 true 一律拒绝（含「先批准、后执行」的留痕字段）；
 *   2. **零静默丢失**：被并入者的单元与对象必须在并入者里出现、拼接后引用必须全可解析——
 *      任一不过即拒绝且不写盘；
 *   3. **归档与留痕**：旧产物按内容哈希进 history，新产物带 resplit 块（谁、何时、依据什么）。
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { applyPlan } from '../../apply-resplit.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')
const CLI = path.join(REPO, 'pipeline', 'apply-resplit.mjs')

const CLUSTERS = {
  schemaVersion: 'clusters/v1',
  chapters: [
    {
      fileKey: 'chapter4',
      units: [{ unitId: 'chapter4-u1', name: '单元一', objectIds: ['T-1', 'T-2'], anchors: ['chapter4#h2-1'], rationale: 'r' }],
      skills: [{ skillId: 'chapter4-s1', name: '候选甲', trigger: 't', unitIds: ['chapter4-u1'], rationale: 'r' }],
    },
    {
      fileKey: 'chapter1',
      units: [{ unitId: 'chapter1-u1', name: '单元二', objectIds: ['T-3'], anchors: ['chapter1#h2-1'], rationale: 'r' }],
      skills: [{ skillId: 'chapter1-s1', name: '候选乙', trigger: 't', unitIds: ['chapter1-u1'], rationale: 'r' }],
    },
  ],
}
const CANDIDATES = {
  schemaVersion: 'skill-candidates/v1',
  candidates: [
    { skillId: 'chapter4-s1', name: '候选甲', trigger: 't', sourceObjects: ['T-1', 'T-2'], units: ['chapter4-u1'], anchors: ['chapter4#h2-1'], chapterRefs: ['chapter4'], promotionState: 'candidate' },
    { skillId: 'chapter1-s1', name: '候选乙', trigger: 't', sourceObjects: ['T-3'], units: ['chapter1-u1'], anchors: ['chapter1#h2-1'], chapterRefs: ['chapter1'], promotionState: 'candidate' },
  ],
}
const PLAN = {
  schemaVersion: 'resplit-plan/v1',
  approved: true,
  approvedAt: '2026-10-13T00:00:00.000Z',
  rule: '测试用',
  pairs: [{ action: 'merge', into: 'chapter4-s1', target: 'chapter1-s1', basis: { strictScenarios: 2, listScenarios: 2 }, reason: '测试' }],
}

async function makeRoot(tag, { plan = PLAN, clusters = CLUSTERS, candidates = CANDIDATES } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `any2skills-resplit-${tag}-`))
  await mkdir(path.join(dir, 'pipeline', 'knowledge', 'history'), { recursive: true })
  await mkdir(path.join(dir, 'pipeline', 'registry', 'history'), { recursive: true })
  await writeFile(path.join(dir, 'pipeline', 'knowledge', 'clusters.json'), JSON.stringify(clusters, null, 2))
  await writeFile(path.join(dir, 'pipeline', 'registry', 'skill-candidates.json'), JSON.stringify(candidates, null, 2))
  await writeFile(path.join(dir, 'pipeline', 'registry', 'resplit-plan.json'), JSON.stringify(plan, null, 2))
  await writeFile(
    path.join(dir, 'pipeline', 'knowledge', 'chapter4.objects.json'),
    JSON.stringify([{ id: 'T-1' }, { id: 'T-2' }]),
  )
  await writeFile(path.join(dir, 'pipeline', 'knowledge', 'chapter1.objects.json'), JSON.stringify([{ id: 'T-3' }]))
  return dir
}

const runCli = (root, args = []) => spawnSync(process.execPath, [CLI, '--repo-root', root, ...args], { cwd: REPO, encoding: 'utf8' })

describe('13 · applyPlan（纯函数）：零丢失与不相交是硬校验', () => {
  it('正常合并：并集正确、chapterRefs 派生为两章、removed/records 留痕', () => {
    const r = applyPlan({
      clustersDoc: structuredClone(CLUSTERS),
      candidatesDoc: structuredClone(CANDIDATES),
      plan: PLAN,
    })
    const intoSkill = r.clustersDoc.chapters[0].skills[0]
    assert.deepEqual(intoSkill.unitIds, ['chapter4-u1', 'chapter1-u1'])
    assert.deepEqual(intoSkill.chapterRefs, ['chapter1', 'chapter4'])
    assert.deepEqual(intoSkill.mergedFrom, ['chapter1-s1'])
    assert.equal(r.clustersDoc.chapters[1].skills.length, 0, '被并入者的 skill 条目移除')
    assert.equal(r.candidatesDoc.candidates.length, 1)
    assert.deepEqual(r.candidatesDoc.candidates[0].sourceObjects.sort(), ['T-1', 'T-2', 'T-3'])
    assert.deepEqual(r.removed, [{ skillId: 'chapter1-s1', mergedInto: 'chapter4-s1', basis: PLAN.pairs[0].basis, reason: '测试' }])
  })

  it('同一候选出现在两个配对里 → 抛错（不相交校验）', () => {
    const plan = { ...PLAN, pairs: [...PLAN.pairs, { action: 'merge', into: 'chapter4-s1', target: 'chapter1-s1', basis: {}, reason: null }] }
    assert.throws(() => applyPlan({ clustersDoc: structuredClone(CLUSTERS), candidatesDoc: structuredClone(CANDIDATES), plan }), /出现在两个配对里/)
  })

  it('引用了不存在的单元 → 抛错（拼接后引用必须全可解析）', () => {
    const clusters = structuredClone(CLUSTERS)
    clusters.chapters[1].units = [] // 让 chapter1-u1 悬空
    assert.throws(
      () => applyPlan({ clustersDoc: clusters, candidatesDoc: structuredClone(CANDIDATES), plan: PLAN }),
      /在任何章的单元记录里都不存在/,
    )
  })
})

describe('13 · apply-resplit CLI：批准门、归档、resplit 块', () => {
  it('approved 不是 true → 拒绝执行且不写盘', async () => {
    const root = await makeRoot('gate', { plan: { ...PLAN, approved: false } })
    try {
      const before = await readFile(path.join(root, 'pipeline', 'knowledge', 'clusters.json'), 'utf8')
      const r = runCli(root, ['--dry-run'])
      assert.equal(r.status, 4)
      assert.match(r.stderr, /approved 不是 true/)
      assert.equal(await readFile(path.join(root, 'pipeline', 'knowledge', 'clusters.json'), 'utf8'), before)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('dry-run 校验通过但不写盘；真实运行归档旧产物并写 resplit 块', async () => {
    const root = await makeRoot('run')
    try {
      const dry = runCli(root, ['--dry-run', '--json'])
      assert.equal(dry.status, 0, dry.stderr)
      assert.equal(JSON.parse(dry.stdout).candidatesAfter, 1)
      assert.equal((await readdir(path.join(root, 'pipeline', 'knowledge', 'history'))).length, 0, 'dry-run 不得归档')

      const real2 = runCli(root, ['--json'])
      assert.equal(real2.status, 0, real2.stderr)
      const clusters = JSON.parse(await readFile(path.join(root, 'pipeline', 'knowledge', 'clusters.json'), 'utf8'))
      assert.equal(clusters.resplit.merges.length, 1)
      assert.match(clusters.resplit.planSha256, /^sha256:/)
      assert.equal((await readdir(path.join(root, 'pipeline', 'knowledge', 'history'))).filter((f) => f.startsWith('clusters.')).length, 1)
      const candidates = JSON.parse(await readFile(path.join(root, 'pipeline', 'registry', 'skill-candidates.json'), 'utf8'))
      assert.equal(candidates.candidates.length, 1)
      assert.match(candidates.clustersSha256, /^sha256:/)
      assert.ok(candidates.resplit.removed.some((x) => x.skillId === 'chapter1-s1'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('计划引用不存在的候选 → 拒绝并指出哪个', async () => {
    const plan = { ...PLAN, pairs: [{ action: 'merge', into: 'chapter4-s1', target: 'nope', basis: {}, reason: null }] }
    const root = await makeRoot('missing', { plan })
    try {
      const r = runCli(root, [])
      assert.equal(r.status, 4)
      assert.match(r.stderr, /找不到被并入者 nope/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
