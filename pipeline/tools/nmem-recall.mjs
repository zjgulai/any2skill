#!/usr/bin/env node
/**
 * 卡 33 · 读侧记忆召回（SOP 第 6.2 步，Node 等价实现）
 *
 * 生命线原则：本模块只被 agent 会话按需调用，不被任何门禁/生成脚本 import；
 * 任何失败（nmem 缺失、超时、非零退出、坏 JSON、无匹配）都返回空串，绝不抛错。
 *
 * 用法：node pipeline/tools/nmem-recall.mjs "查询短语"
 */

import { spawnSync } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 3000
const MIN_SCORE = 0.7
const TOP_N = 3

export function recallDurableMemories(query, opts = {}) {
  const {
    bin = process.env.NMEM_BIN || 'nmem',
    timeoutMs = Number(process.env.NMEM_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    minScore = MIN_SCORE,
    space = process.env.NMEM_SPACE || 'any2skills',
    topN = TOP_N,
  } = opts
  if (!query || !query.trim()) return ''

  try {
    const res = spawnSync(bin, [
      '--json', 'memories', 'search', query.trim().slice(0, 100),
      '--space', space, '-n', String(topN), '--importance-min', '0.7',
    ], { encoding: 'utf8', timeout: timeoutMs })
    if (res.status !== 0) return ''
    const data = JSON.parse(res.stdout)
    const items = Array.isArray(data)
      ? data
      : (data.memories || data.items || [])
    const blocks = []
    for (const m of items) {
      const score = Number(m.score || 0)
      if (score < minScore) continue
      const title = (m.title || '').trim()
      const content = (m.content || m.snippet || '').trim()
      if (title && content) {
        blocks.push(`• 【${title}】(匹配度 ${score.toFixed(2)})\n${content}`)
      }
    }
    if (blocks.length === 0) return ''
    return '【Nowledge Mem 专属记忆检索（核心口径/红线/避坑经验）】\n' + blocks.join('\n\n')
  } catch {
    return ''
  }
}

// CLI 直跑：node pipeline/tools/nmem-recall.mjs "查询"
if (import.meta.url === `file://${process.argv[1]}`) {
  const query = process.argv[2]
  if (!query) {
    console.error('用法：node pipeline/tools/nmem-recall.mjs "查询短语"')
    process.exit(2)
  }
  const out = recallDurableMemories(query)
  process.stdout.write(out)
  process.exit(0)
}
