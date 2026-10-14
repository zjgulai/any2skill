/**
 * 多源参数化（ticket 18 段①）
 *
 * 钉三件事：源根助手是唯一定义处；路径守卫**按源键放行**（第二源不被自己挡在门外）；
 * 源键不匹配时仍然拒绝（守卫没有因为参数化而失效）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_SOURCE_KEY, DEFAULT_SOURCE_ROOT, sourceBookRoot, sourceCodeRoot } from '../../tools/anchor-index.mjs'
import { prepareChapterInputs } from '../../propose-clusters.mjs'
import { candidatesRelPath, clustersPartialRelPath, clustersRelPath, writeClusters } from '../../tools/cluster-proposer.mjs'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')
const CLI = path.join(REPO, 'pipeline', 'run.mjs')

describe('18 · 源键与源根', () => {
  it('环 3 产物按源命名空间：缺省键逐字节保持既有文件名，其他源加后缀', async () => {
    assert.equal(clustersRelPath(), 'pipeline/knowledge/clusters.json')
    assert.equal(candidatesRelPath(), 'pipeline/registry/skill-candidates.json')
    assert.equal(clustersRelPath('rust-book-cn'), path.join('pipeline', 'knowledge', 'clusters.rust-book-cn.json'))
    assert.equal(candidatesRelPath('rust-book-cn'), path.join('pipeline', 'registry', 'skill-candidates.rust-book-cn.json'))
    // .gitignore 的 *.partial.json 靠后缀生效——partial 路径必须以它结尾
    assert.ok(clustersPartialRelPath('rust-book-cn').endsWith('.partial.json'))
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-ns-'))
    try {
      const abs = await writeClusters({ schemaVersion: 'clusters/v1', chapters: [] }, root, { sourceKey: 'rust-book-cn' })
      assert.match(abs, /clusters\.rust-book-cn\.json$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
  it(' 缺省键逐字等于既有常量；自定义键按约定拼路径', () => {
    assert.equal(DEFAULT_SOURCE_KEY, 'ai-agent-book-zh')
    assert.equal(DEFAULT_SOURCE_ROOT, path.join('sources', 'ai-agent-book-zh', 'book'))
    assert.equal(sourceBookRoot(), DEFAULT_SOURCE_ROOT)
    assert.equal(sourceBookRoot('rust-book-cn'), path.join('sources', 'rust-book-cn', 'book'))
    assert.equal(sourceCodeRoot('rust-book-cn'), path.join('sources', 'rust-book-cn', 'code'))
  })

  it('路径守卫按源键放行：同一文件在对应源键下通过，在不匹配源键下被拒', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-sourcekey-'))
    try {
      const rel = path.join('sources', 'rust-book-cn', 'book')
      await mkdir(path.join(root, rel), { recursive: true })
      await writeFile(path.join(root, rel, 'probe.md'), '# 探针\n\n## 一节\n\n正文。\n', 'utf8')

      const ok = spawnSync(
        process.execPath,
        [CLI, path.join(rel, 'probe.md'), '--source-key', 'rust-book-cn', '--repo-root', root, '--json'],
        { cwd: REPO, encoding: 'utf8' },
      )
      assert.ok([0, 3].includes(ok.status), `第二源应可被消费（stub 路径），实测 ${ok.status}；stderr=${ok.stderr}`)
      assert.ok(!ok.stderr.includes('路径守卫'), `不应被守卫拒绝：${ok.stderr}`)

      const wrong = spawnSync(
        process.execPath,
        [CLI, path.join(rel, 'probe.md'), '--repo-root', root, '--json'],
        { cwd: REPO, encoding: 'utf8' },
      )
      assert.equal(wrong.status, 4, '缺省源键下该路径应被拒')
      assert.match(wrong.stderr, /必须位于/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('环 3 输入按源过滤：别的源的文件被**可见地跳过**，真缺回执仍然拒绝', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-sourcefilter-'))
    try {
      const mk = async (key, fileKey, objId) => {
        const dirRel = path.join('sources', key, 'book')
        await mkdir(path.join(root, dirRel), { recursive: true })
        await writeFile(path.join(root, dirRel, `${fileKey}.md`), `# ${fileKey}\n\n## 一节\n\n正文。\n`, 'utf8')
        await writeFile(
          path.join(root, 'pipeline', 'knowledge', `${fileKey}.objects.json`),
          JSON.stringify([{ id: objId, objectType: 'Concept', sourceRefs: [] }]),
        )
        await writeFile(
          path.join(root, 'pipeline', 'registry', `run-${fileKey}.receipt.json`),
          JSON.stringify({
            runId: `run-${fileKey}`,
            createdAt: new Date().toISOString(),
            source: { path: path.join(dirRel, `${fileKey}.md`) },
            objectVerdicts: [{ objectId: objId, status: 'pass' }],
          }),
        )
      }
      await mkdir(path.join(root, 'pipeline', 'knowledge'), { recursive: true })
      await mkdir(path.join(root, 'pipeline', 'registry'), { recursive: true })
      await mk('srcA', 'alpha', 'A-1')
      await mk('srcB', 'beta', 'B-1')
      // 第三类：有对象文件、但**任何源都没有它的回执**——这才是「真缺」。
      await writeFile(
        path.join(root, 'pipeline', 'knowledge', 'gamma.objects.json'),
        JSON.stringify([{ id: 'G-1', objectType: 'Concept', sourceRefs: [] }]),
      )

      const a = await prepareChapterInputs(root, { modelId: null, sourceKey: 'srcA' })
      assert.deepEqual(a.inputs.map((x) => x.fileKey), ['alpha'])
      assert.deepEqual(a.skippedOtherSource.map((x) => x.fileKey), ['beta'], '别的源 → 可见地跳过')
      assert.deepEqual(a.missingReceipts.map((x) => x.fileKey), ['gamma'], '无任何回执 → 真缺，照旧拒绝')

      const c = await prepareChapterInputs(root, { modelId: null, sourceKey: 'srcC' })
      assert.equal(c.inputs.length, 0)
      assert.deepEqual(c.skippedOtherSource.map((x) => x.fileKey).sort(), ['alpha', 'beta'], 'srcC 没有自己的文件，两文件都归别的源')
      assert.deepEqual(c.missingReceipts.map((x) => x.fileKey), ['gamma'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('环 4 簇装配按源键取源（段③切片实测漏掉过这一处，补回归）', async () => {
    const { loadClusterAssemblyInputs } = await import('../../build-skill.mjs')
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-rings4-src-'))
    try {
      const dirRel = path.join('sources', 'srcA', 'book')
      await mkdir(path.join(root, dirRel), { recursive: true })
      await writeFile(path.join(root, dirRel, 'alpha.md'), '# 标题\n\n## 一节\n\n正文足够长。\n', 'utf8')
      await mkdir(path.join(root, 'pipeline', 'knowledge'), { recursive: true })
      await mkdir(path.join(root, 'pipeline', 'registry'), { recursive: true })
      await writeFile(
        path.join(root, 'pipeline', 'knowledge', 'alpha.objects.json'),
        JSON.stringify([
          { id: 'A-1', objectType: 'EngineeringRule', statement: '规则', appliesWhen: '场景', sourceRefs: [{ file: path.join(dirRel, 'alpha.md'), anchor: 'alpha#h2-1' }] },
        ]),
      )
      await writeFile(
        path.join(root, 'pipeline', 'registry', 'run-alpha.receipt.json'),
        JSON.stringify({
          runId: 'run-alpha',
          createdAt: new Date().toISOString(),
          source: { path: path.join(dirRel, 'alpha.md') },
          objectVerdicts: [{ objectId: 'A-1', status: 'pass' }],
        }),
      )
      const clusterDef = { skillId: 'alpha-s1', chapterRefs: ['alpha'], name: '甲', anchorIds: ['alpha#h2-1'], objectIds: ['A-1'], units: [] }
      const ok = await loadClusterAssemblyInputs(root, clusterDef, { sourceKey: 'srcA' })
      assert.equal(ok.kept.length, 1)
      await assert.rejects(
        () => loadClusterAssemblyInputs(root, clusterDef, { sourceKey: 'ai-agent-book-zh' }),
        /ENOENT|缺门禁一回执|reject/i,
        '源键不匹配必须失败而不是读到别的源',
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
