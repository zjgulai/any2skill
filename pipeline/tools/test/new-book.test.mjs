/**
 * 新书工作流（卡 29）：onboard / scaffold / 无 legacy 构建 / 草稿硬拒绝。
 * 全部离线、零模型调用——管线的每一跳都在临时仓库里做最小复现。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { onboard, scaffold, runPipelineStage, LITERAL_FIDELITY_STEP } from '../../run-new-book.mjs'
import { loadWorkflow } from '../../tools/task-skill-builder.mjs'
import { buildMember } from '../../build-task-suite.mjs'
import { loadObjectIndex } from '../../tools/task-skill-builder.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')

async function mkBookDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-newbook-src-'))
  await writeFile(path.join(dir, 'ch01.md'), '# 第一章\n\n## 一节\n\n内容。\n', 'utf8')
  await mkdir(path.join(dir, 'part2'), { recursive: true })
  await writeFile(path.join(dir, 'part2', 'ch02.md'), '# 第二章\n\n## 一节\n\n内容。\n', 'utf8')
  await writeFile(path.join(dir, 'notes.txt'), '不是 md，不入场。\n', 'utf8')
  return dir
}

describe('29 · 新书入场', () => {
  it('拷贝 md（含子目录）并逐文件 sha256 立清单；二次入场拒绝', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'any2skills-newbook-repo-'))
    const src = await mkBookDir()
    try {
      const out = await onboard(repo, { dir: src, key: 'nb-test' })
      assert.equal(out.files, 2)
      const m = await readFile(path.join(repo, 'sources', 'nb-test', 'SOURCE-MANIFEST.md'), 'utf8')
      assert.match(m, /ch01\.md/)
      assert.match(m, /part2\/ch02\.md/)
      assert.match(m, /sha256:/)
      assert.ok(!m.includes('notes.txt'), '非 md 不入场')
      await assert.rejects(() => onboard(repo, { dir: src, key: 'nb-test' }), /拒绝覆盖/)
      // key 合法性
      await assert.rejects(() => onboard(repo, { dir: src, key: 'Bad Key' }), /非法/)
    } finally {
      await rm(repo, { recursive: true, force: true })
      await rm(src, { recursive: true, force: true })
    }
  })

  it('pipeline --dry-run 只打印计划命令，不执行', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'any2skills-newbook-plan-'))
    try {
      const out = await runPipelineStage(repo, { key: 'nb-test', model: 'm', baseUrl: 'https://x', judgeModel: null, layer2: 'deepseek', synthesis: true, dryRun: true, repoRoot: repo })
      assert.deepEqual(out.steps, ['环 1/2（锚点 + 对象 + 判定者）', '环 3（章内聚类 + 候选）', '主题提案', '跨章反模式合成'])
      assert.equal(out.screening, null)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})

describe('29 · 策展草稿', () => {
  it('从筛查产出草案：清单/工作流/核对单齐备；字面保真条款默认内置；draft 标记齐全', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'any2skills-newbook-scaffold-'))
    try {
      await mkdir(path.join(repo, 'pipeline', 'knowledge'), { recursive: true })
      await mkdir(path.join(repo, 'pipeline', 'registry'), { recursive: true })
      const obj = (id, type, text) => ({ id, objectType: type, statement: text, trigger: `当需要 ${id} 时`, sourceRefs: [{ file: 'sources/nb-test/book/ch01.md', anchor: 'ch01#h2-1', title: '一节', lineStart: 3, lineEnd: 5 }] })
      await writeFile(
        path.join(repo, 'pipeline', 'knowledge', 'ch01.objects.json'),
        JSON.stringify({ schemaVersion: 'objects/v1', objects: [obj('NB-1', 'EngineeringRule', '顺序要正确。'), obj('NB-2', 'AntiPattern', '别乱来。')] }),
        'utf8',
      )
      await writeFile(
        path.join(repo, 'pipeline', 'registry', 'skill-candidates.nb-test.json'),
        JSON.stringify({ schemaVersion: 'skill-candidates/v1', candidates: [{ skillId: 'ch01-s1', name: '第一章任务', trigger: '当处理第一章时', sourceObjects: ['NB-1', 'NB-2'], anchors: ['ch01#h2-1'], chapterRefs: ['ch01'] }] }),
        'utf8',
      )
      const screening = { rows: [{ skillId: 'ch01-s1', passed: true }, { skillId: 'ch01-s2', passed: false }] }
      const out = await scaffold(repo, 'nb-test', { screening })
      assert.equal(out.members, 1, '只取筛查通过者')
      const manifest = JSON.parse(await readFile(path.join(repo, 'pipeline', 'curation', 'nb-test', 'task-skill-suite.v1.json'), 'utf8'))
      assert.equal(manifest.draft, true)
      assert.equal(manifest.members[0].slug, 'ch01-s1')
      assert.deepEqual(manifest.members[0].primaryObjects, ['NB-1', 'NB-2'])
      const draft = JSON.parse(await readFile(path.join(repo, 'pipeline', 'curation', 'nb-test', 'drafts', 'ch01-s1.json'), 'utf8'))
      assert.equal(draft.draft, true)
      assert.equal(draft.steps[0], LITERAL_FIDELITY_STEP, '字面保真条款默认内置')
      const checklist = await readFile(path.join(repo, 'pipeline', 'curation', 'nb-test', 'EDITORIAL-CHECKLIST.md'), 'utf8')
      assert.match(checklist, /去掉了? `draft: true`|去掉 `draft: true`/)
      await assert.rejects(() => scaffold(repo, 'nb-test', { screening }), /拒绝覆盖/)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('loadWorkflow 对 draft:true 硬拒绝', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'any2skills-newbook-draft-'))
    try {
      const wfRel = 'pipeline/curation/nb-test/drafts/x.json'
      await mkdir(path.dirname(path.join(repo, wfRel)), { recursive: true })
      await writeFile(
        path.join(repo, wfRel),
        JSON.stringify({ schemaVersion: 'task-workflow/v1', draft: true, slug: 'x', title: 't', description: 'd', whenToUse: ['a'], inputs: ['a'], steps: ['a', 'b', 'c'], outputs: ['a'], checks: ['a'], stopConditions: ['a'], rollback: { disposition: 'not-applicable', note: 'n' }, boundaries: ['a'] }),
        'utf8',
      )
      await assert.rejects(() => loadWorkflow(repo, { slug: 'x', workflowFile: wfRel }), /草稿/)
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })

  it('无 legacy 新书：委托构建从 owned 对象派生 provenance.sourceFile，legacy 段为空', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'any2skills-newbook-build-'))
    try {
      await mkdir(path.join(repo, 'sources', 'nb-test', 'book'), { recursive: true })
      await writeFile(path.join(repo, 'sources', 'nb-test', 'book', 'ch01.md'), '# 第一章\n\n## 一节\n\n内容足够长的正文。\n', 'utf8')
      await mkdir(path.join(repo, 'pipeline', 'knowledge'), { recursive: true })
      await mkdir(path.join(repo, 'pipeline', 'registry'), { recursive: true })
      const refs = [{ file: path.join('sources', 'nb-test', 'book', 'ch01.md'), anchor: 'ch01#h2-1', title: '一节', lineStart: 3, lineEnd: 5 }]
      await writeFile(
        path.join(repo, 'pipeline', 'knowledge', 'ch01.objects.json'),
        JSON.stringify({ schemaVersion: 'objects/v1', objects: [{ id: 'NB-1', objectType: 'EngineeringRule', statement: '顺序要正确。', sourceRefs: refs }] }),
        'utf8',
      )
      await writeFile(
        path.join(repo, 'pipeline', 'registry', 'run-nb.receipt.json'),
        JSON.stringify({ runId: 'run-nb', createdAt: new Date().toISOString(), source: { path: path.join('sources', 'nb-test', 'book', 'ch01.md') }, objectVerdicts: [{ objectId: 'NB-1', status: 'pass' }] }),
        'utf8',
      )
      const wfRel = 'pipeline/curation/nb-test/workflows/x.json'
      await mkdir(path.dirname(path.join(repo, wfRel)), { recursive: true })
      await writeFile(
        path.join(repo, wfRel),
        JSON.stringify({ schemaVersion: 'task-workflow/v1', slug: 'x', title: '甲任务', description: '做甲事；处理乙时用。', whenToUse: ['处理甲时'], inputs: ['输入'], steps: ['第一步', '第二步', '第三步'], outputs: ['产物'], checks: ['检查'], stopConditions: ['停止条件'], rollback: { disposition: 'not-applicable', note: '无状态变更' }, boundaries: ['不覆盖乙'] }),
        'utf8',
      )
      const suite = {
        abs: path.join(repo, 'pipeline', 'curation', 'nb-test', 'task-skill-suite.v1.json'),
        sha256: 'sha256:test',
        manifest: { members: [] },
      }
      const objectIndex = await loadObjectIndex(repo)
      const built = await buildMember(repo, { slug: 'x', sourceKey: 'nb-test', legacySlugs: [], primaryObjects: ['NB-1'], crossChapterObjects: [], workflowFile: wfRel }, suite, objectIndex)
      assert.equal(built.verdict.passed, true, JSON.stringify(built.verdict.failures))
      assert.equal(built.contract.provenance.sourceFile, path.join('sources', 'nb-test', 'book', 'ch01.md'))
      assert.deepEqual(built.contract.legacy.slugs, [])
    } finally {
      await rm(repo, { recursive: true, force: true })
    }
  })
})