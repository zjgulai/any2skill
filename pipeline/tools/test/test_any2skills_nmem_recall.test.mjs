/**
 * 卡 33 / 卡 37 验收：读侧记忆召回的生命线测试（SOP checklist 7 的本仓等价实现）
 *
 * SOP 的 test_<agent>_nmem_recall.py 在本仓落为 .mjs（Node 仓库惯例）。
 * fake nmem 通过 NMEM_BIN 注入，覆盖四条降级/成功路径；
 * NMEM_E2E=1 时追加真实检索与真实超时降级测试（需要本地 nmem 服务与已写入的记忆，
 * 即卡 35 完成后才有意义；默认跳过，保证 npm test 零网络、零凭据）。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync, chmodSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { recallDurableMemories } from '../nmem-recall.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** 写一个可执行的假 nmem，按脚本内容决定行为 */
function makeFakeNmem(dir, script) {
  const file = path.join(dir, 'fake-nmem')
  writeFileSync(file, `#!/bin/sh\n${script}\n`)
  chmodSync(file, 0o755)
  return file
}

function tmpDir() {
  return mkdtempSync(path.join(os.tmpdir(), 'nmem-recall-test-'))
}

describe('nmem-recall 生命线（fake nmem 四路径）', () => {
  it('成功路径：返回带标题与匹配度的格式化块', () => {
    const dir = tmpDir()
    const bin = makeFakeNmem(dir, `cat <<'EOF'
{"memories":[{"title":"证据可回查","content":"无 sourceRefs 不得进入下一环节","score":0.92}]}
EOF`)
    const out = recallDurableMemories('证据可回查', { bin, space: 'any2skills' })
    assert.ok(out.includes('【Nowledge Mem 专属记忆检索'))
    assert.ok(out.includes('【证据可回查】'))
    assert.ok(out.includes('0.92'))
  })

  it('低分过滤：score 低于 minScore 的记忆被丢弃，返回空串', () => {
    const dir = tmpDir()
    const bin = makeFakeNmem(dir, `echo '{"memories":[{"title":"t","content":"c","score":0.4}]}'`)
    const out = recallDurableMemories('什么都行', { bin, space: 'x' })
    assert.equal(out, '')
  })

  it('超时路径：假 nmem 睡眠超过 timeoutMs，返回空串不抛错', () => {
    const dir = tmpDir()
    const bin = makeFakeNmem(dir, `sleep 5`)
    const out = recallDurableMemories('查询', { bin, timeoutMs: 200, space: 'x' })
    assert.equal(out, '')
  })

  it('非零退出路径：返回空串', () => {
    const dir = tmpDir()
    const bin = makeFakeNmem(dir, `echo "boom" >&2; exit 1`)
    const out = recallDurableMemories('查询', { bin, space: 'x' })
    assert.equal(out, '')
  })

  it('坏 JSON 路径：返回空串', () => {
    const dir = tmpDir()
    const bin = makeFakeNmem(dir, `echo 'not-json{'`)
    const out = recallDurableMemories('查询', { bin, space: 'x' })
    assert.equal(out, '')
  })

  it('空 query：不调用外部命令，直接返回空串', () => {
    const out = recallDurableMemories('   ', { bin: '/nonexistent-nmem' })
    assert.equal(out, '')
  })

  it('nmem 二进制不存在：优雅降级为空串', () => {
    const out = recallDurableMemories('查询', { bin: '/nonexistent-nmem-binary-xyz' })
    assert.equal(out, '')
  })
})

describe('nmem-recall 真实 E2E（NMEM_E2E=1 才跑；依赖卡 35 已写入）', { skip: process.env.NMEM_E2E !== '1' }, () => {
  const QUERIES = [
    '证据可回查 无 sourceRefs 不得进入下一环节',
    'low-utility 三态如实标注 重测须有因',
    'stat 多报 4096 字节 误判 binary',
  ]

  for (const q of QUERIES) {
    it(`真实检索 Top1 >= 0.70：${q.slice(0, 12)}…`, () => {
      const res = spawnSync('nmem', [
        '--json', 'memories', 'search', q, '--space', 'any2skills', '-n', '3',
      ], { encoding: 'utf8', timeout: 10000 })
      assert.equal(res.status, 0, `nmem search 失败: ${res.stderr}`)
      const data = JSON.parse(res.stdout)
      const items = Array.isArray(data) ? data : (data.memories || data.items || [])
      assert.ok(items.length > 0, '无结果')
      assert.ok(
        Number(items[0].score) >= 0.7,
        `Top1 score=${items[0].score} < 0.70`,
      )
    })
  }

  it('真实超时降级：NMEM_TIMEOUT_MS=1 时返回空串不阻塞', () => {
    const out = recallDurableMemories('证据可回查', {
      bin: process.env.NMEM_BIN || 'nmem',
      timeoutMs: 1,
      space: 'any2skills',
    })
    assert.equal(out, '')
  })
})
