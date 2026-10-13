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

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..')
const CLI = path.join(REPO, 'pipeline', 'run.mjs')

describe('18 · 源键与源根', () => {
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
})
