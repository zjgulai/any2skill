/**
 * 环 4 · 按簇装配入口（ticket 11 / ADR-024 决策 2）
 *
 * 端到端跑 CLI（`--cluster`），在一个临时仓库根里做：复制真实的 chapter4.md、
 * 造一份对象文件 + 判定回执 + `clusters.json`。钉三件事：
 *   1. **两份入口的引用不静默打折**——未知 skillId、索引里没有的锚点、对象不在文件里，全部拒绝装配；
 *   2. **门禁前的过滤不变**——只消费判定回执里 `status==='pass'` 的对象，被排除的逐条记进 provenance；
 *   3. **来源可辨**——`clusterSource` 与 `clusterSkillId` 进契约 provenance，事后核对不靠猜。
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = DEFAULT_REPO_ROOT
const CLI = path.join(REPO, 'pipeline', 'build-skill.mjs')
const SOURCE_REL = path.join('sources', 'ai-agent-book-zh', 'book', 'chapter4.md')

const runCli = (root, args) =>
  spawnSync(process.execPath, [CLI, '--repo-root', root, ...args], { cwd: REPO, encoding: 'utf8' })

let ROOT
let A0
let A1

async function makeRoot(tag, { anchors = null, objectIds = ['T-1', 'T-2', 'T-3'] } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `any2skills-cluster-${tag}-`))
  await mkdir(path.join(dir, 'sources', 'ai-agent-book-zh', 'book'), { recursive: true })
  await copyFile(path.join(REPO, SOURCE_REL), path.join(dir, SOURCE_REL))
  await copyFile(
    path.join(REPO, 'sources', 'ai-agent-book-zh', 'book', 'chapter1.md'),
    path.join(dir, 'sources', 'ai-agent-book-zh', 'book', 'chapter1.md'),
  )
  const idx = await buildAnchorIndex(path.join(dir, SOURCE_REL), { repoRoot: dir })
  const a = idx.anchors[0].anchor
  const b = idx.anchors[1].anchor
  const idx1 = await buildAnchorIndex(path.join(dir, 'sources', 'ai-agent-book-zh', 'book', 'chapter1.md'), { repoRoot: dir })
  const c1 = idx1.anchors[1].anchor

  await mkdir(path.join(dir, 'pipeline', 'knowledge'), { recursive: true })
  await mkdir(path.join(dir, 'pipeline', 'registry'), { recursive: true })
  const objs = [
    { id: 'T-1', objectType: 'EngineeringRule', statement: '规则甲', appliesWhen: '场景甲', rationale: '理由', sourceRefs: [{ file: SOURCE_REL, anchor: a }] },
    { id: 'T-2', objectType: 'EngineeringRule', statement: '规则乙', appliesWhen: '场景乙', rationale: '理由', sourceRefs: [{ file: SOURCE_REL, anchor: b }] },
    { id: 'T-3', objectType: 'Concept', canonicalTerm: '术语', definition: '定义', sourceRefs: [{ file: SOURCE_REL, anchor: b }] },
  ]
  await writeFile(path.join(dir, 'pipeline', 'knowledge', 'chapter4.objects.json'), JSON.stringify(objs, null, 2))
  await writeFile(
    path.join(dir, 'pipeline', 'knowledge', 'chapter1.objects.json'),
    JSON.stringify([
      {
        id: 'T-5',
        objectType: 'EngineeringRule',
        statement: '规则丙（第一章）',
        appliesWhen: '场景丙',
        rationale: '理由',
        sourceRefs: [{ file: path.join('sources', 'ai-agent-book-zh', 'book', 'chapter1.md'), anchor: c1 }],
      },
    ], null, 2),
  )
  await writeFile(
    path.join(dir, 'pipeline', 'registry', 'run-testcluster.receipt.json'),
    JSON.stringify({
      runId: 'run-testcluster',
      createdAt: new Date().toISOString(),
      source: { path: SOURCE_REL },
      // T-3 不在通过名单里——它必须被排除并记进 provenance，不得静默混入。
      objectVerdicts: [
        { objectId: 'T-1', status: 'pass' },
        { objectId: 'T-2', status: 'pass' },
        { objectId: 'T-3', status: 'reject', reasonCode: 'QUOTE_MISMATCH' },
      ],
    }),
  )
  await writeFile(
    path.join(dir, 'pipeline', 'registry', 'run-testcluster-ch1.receipt.json'),
    JSON.stringify({
      runId: 'run-testcluster-ch1',
      createdAt: new Date().toISOString(),
      source: { path: path.join('sources', 'ai-agent-book-zh', 'book', 'chapter1.md') },
      objectVerdicts: [{ objectId: 'T-5', status: 'pass' }],
    }),
  )
  await writeFile(
    path.join(dir, 'pipeline', 'knowledge', 'clusters.json'),
    JSON.stringify(
      {
        schemaVersion: 'clusters/v1',
        chapters: [
          {
            fileKey: 'chapter4',
            units: [
              { unitId: 'chapter4-u1', name: '单元一', objectIds: objectIds, anchors: anchors ?? [a, b], rationale: 'r' },
            ],
            skills: [
              { skillId: 'chapter4-s1', name: '候选一', trigger: '什么时候用', unitIds: ['chapter4-u1'], rationale: 'r' },
            ],
          },
          {
            fileKey: 'chapter1',
            units: [{ unitId: 'chapter1-u1', name: '单元二', objectIds: ['T-5'], anchors: [c1], rationale: 'r' }],
            // 跨章候选（重切后的形态）：单元跨两章，skill 条目落在 chapter1 的章节记录里、
            // 用显式 chapterRefs 声明所跨章节。
            skills: [
              {
                skillId: 'cross-s1',
                name: '跨章候选',
                trigger: '跨章场景',
                unitIds: ['chapter4-u1', 'chapter1-u1'],
                chapterRefs: ['chapter1', 'chapter4'],
                rationale: 'r',
              },
            ],
          },
        ],
      },
      null,
      2,
    ),
  )
  return { dir, a, b }
}

before(async () => {
  const made = await makeRoot('happy')
  ROOT = made.dir
  A0 = made.a
  A1 = made.b
})

after(async () => {
  if (ROOT) await rm(ROOT, { recursive: true, force: true })
})

describe('11 · 环 4 簇入口：按划分产物装配', () => {
  it('dry-run 下簇模式跑通：slug/title 缺省取自候选，来源可辨', () => {
    const r = runCli(ROOT, ['--cluster', 'chapter4-s1', '--dry-run', '--json'])
    // 退出码 3 = 门禁一拒（本夹具没有配套代码，正是预期）；本用例断言的是**入口本身**跑通。
    assert.ok([0, 3].includes(r.status), `应为 0 或 3，实测 ${r.status}；stderr=${r.stderr}`)
    const summary = JSON.parse(r.stdout)
    assert.equal(summary.clusterSource, 'pipeline/knowledge/clusters.json')
    assert.equal(summary.slug, 'chapter4-s1')
    assert.equal(summary.rootAnchor, 'chapter4-s1')
    assert.equal(summary.clusterAnchors, 2)
    assert.equal(summary.objectsInCluster, 3)
    assert.equal(summary.objectsKept, 2, 'T-3 未过门禁，不得计入')
  })

  it('真实运行：暂存与契约落盘；被门禁排除的对象逐条记进 provenance', async () => {
    const r = runCli(ROOT, ['--cluster', 'chapter4-s1', '--json'])
    assert.ok([0, 3].includes(r.status), `应为 0（过门禁）或 3（被门禁拒），实测 ${r.status}；stderr=${r.stderr}`)
    const summary = JSON.parse(r.stdout)
    const contract = JSON.parse(await readFile(path.join(ROOT, 'pipeline', 'registry', 'build', 'chapter4-s1', 'skill-contract.json'), 'utf8'))
    assert.equal(contract.provenance.clusterSource, 'pipeline/knowledge/clusters.json')
    assert.equal(contract.provenance.clusterSkillId, 'chapter4-s1')
    assert.deepEqual(contract.provenance.clusterUnits, ['chapter4-u1'])
    assert.deepEqual(contract.provenance.objectsExcludedByGate, ['T-3'])
    assert.equal(contract.provenance.objectsKept, 2)
    assert.equal(contract.skillId, 'chapter4-s1')
    const staged = await readFile(path.join(ROOT, 'pipeline', 'registry', 'build', 'chapter4-s1', 'SKILL.md'), 'utf8')
    assert.match(staged, /^---\nname: chapter4-s1\n/)
    assert.match(staged, /# 候选一/)
    if (summary.gate.passed) {
      await readFile(path.join(ROOT, 'skills', 'chapter4-s1', 'SKILL.md'), 'utf8')
    } else {
      await assert.rejects(() => readFile(path.join(ROOT, 'skills', 'chapter4-s1', 'SKILL.md'), 'utf8'))
    }
  })

  it('跨章候选（重切形态）：两章对象合流、chapterRefs 进 provenance、深度阅读含两章', async () => {
    const r = runCli(ROOT, ['--cluster', 'cross-s1', '--json'])
    assert.ok([0, 3].includes(r.status), `实测 ${r.status}；stderr=${r.stderr}`)
    const summary = JSON.parse(r.stdout)
    assert.equal(summary.objectsInCluster, 4, 'chapter4 的 T-1..T-3 与 chapter1 的 T-5 合流')
    assert.equal(summary.objectsKept, 3, 'T-3 未过门禁，仍被排除')
    const contract = JSON.parse(
      await readFile(path.join(ROOT, 'pipeline', 'registry', 'build', 'cross-s1', 'skill-contract.json'), 'utf8'),
    )
    assert.deepEqual(contract.provenance.clusterChapterRefs, ['chapter1', 'chapter4'])
    assert.match(contract.provenance.objectsFile, /chapter1\.objects\.json/)
    assert.match(contract.provenance.objectsFile, /chapter4\.objects\.json/)
    assert.match(contract.provenance.objectsFile, / \+ /)
    assert.equal(contract.provenance.objectsTotal, 4)
    const staged = await readFile(path.join(ROOT, 'pipeline', 'registry', 'build', 'cross-s1', 'SKILL.md'), 'utf8')
    assert.match(staged, /chapter1\.md/, '深度阅读段必须回链第一章')
  })

  it('簇与根的来源不混：root-anchor 入口的 provenance 仍标 root-anchor', async () => {
    const r = runCli(ROOT, ['--root-anchor', `${A0}`, '--slug', 'by-root', '--title', '按子树', '--json'])
    assert.ok([0, 3].includes(r.status), `实测 ${r.status}；stderr=${r.stderr}`)
    const contract = JSON.parse(await readFile(path.join(ROOT, 'pipeline', 'registry', 'build', 'by-root', 'skill-contract.json'), 'utf8'))
    assert.equal(contract.provenance.clusterSource, 'root-anchor')
    assert.equal(contract.provenance.clusterRootAnchor, A0)
  })
})

describe('11 · 环 4 簇入口：引用不静默打折', () => {
  it('未知 skillId → 拒绝（列出现有候选）', () => {
    const r = runCli(ROOT, ['--cluster', 'chapter4-s9', '--dry-run'])
    assert.equal(r.status, 4)
    assert.match(r.stderr, /没有 skillId=chapter4-s9/)
    assert.match(r.stderr, /chapter4-s1/)
  })

  it('--cluster 与 --root-anchor 互斥', () => {
    const r = runCli(ROOT, ['--cluster', 'chapter4-s1', '--root-anchor', A0])
    assert.equal(r.status, 4)
    assert.match(r.stderr, /互斥/)
  })

  it('候选引用了索引里不存在的锚点 → 拒绝装配', async () => {
    const bad = await makeRoot('bad-anchor', { anchors: ['chapter4#zz-9'] })
    try {
      const r = runCli(bad.dir, ['--cluster', 'chapter4-s1', '--dry-run'])
      assert.equal(r.status, 4)
      assert.match(r.stderr, /不存在的锚点：chapter4#zz-9/)
    } finally {
      await rm(bad.dir, { recursive: true, force: true })
    }
  })

  it('候选引用的对象不在对象文件里 → 拒绝装配', async () => {
    const bad = await makeRoot('bad-object', { objectIds: ['T-1', 'T-404'] })
    try {
      const r = runCli(bad.dir, ['--cluster', 'chapter4-s1', '--dry-run'])
      assert.equal(r.status, 4)
      assert.match(r.stderr, /T-404/)
    } finally {
      await rm(bad.dir, { recursive: true, force: true })
    }
  })

  it('clusters.json 不存在 → 指引先跑环 3（不是一句「文件不存在」）', async () => {
    const empty = await mkdtemp(path.join(os.tmpdir(), 'any2skills-cluster-empty-'))
    try {
      const r = runCli(empty, ['--cluster', 'chapter4-s1', '--dry-run'])
      assert.equal(r.status, 4)
      assert.match(r.stderr, /先跑 pipeline\/propose-clusters\.mjs/)
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })
})

void A1
