/**
 * 产出冻结的测试（ticket 15 前置）
 *
 * 钉两件事：冻结面缺失即拒绝（冻结一个不完整的面等于没冻结）；漂移判定能抓出
 * 内容变化与文件缺失（比对者靠它证明「比的是哪一版」）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { computeDrift, hashAll } from '../../freeze-outputs.mjs'

const sha = (s) => `sha256:${createHash('sha256').update(s).digest('hex')}`

describe('15 · 冻结：哈希与漂移判定', () => {
  it('hashAll：存在与缺失都被如实记录（缺失不是静默跳过）', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-freeze-'))
    try {
      await writeFile(path.join(dir, 'a.md'), '甲', 'utf8')
      const files = await hashAll(dir, ['a.md', 'nope.md'])
      assert.equal(files[0].sha256, sha('甲'))
      assert.equal(files[0].missing, undefined)
      assert.equal(files[1].missing, true)
      assert.equal(files[1].sha256, null)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('computeDrift：内容变化与文件缺失都算漂移；一致则零漂移', () => {
    const frozen = [
      { path: 'a', sha256: sha('甲') },
      { path: 'b', sha256: sha('乙') },
    ]
    assert.deepEqual(computeDrift(frozen, [...frozen]), [])
    const drifted = computeDrift(frozen, [{ path: 'a', sha256: sha('甲改了') }])
    assert.equal(drifted.length, 2)
    assert.equal(drifted[0].path, 'a')
    assert.equal(drifted[1].now, '(缺失)')
  })
})
