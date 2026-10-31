#!/usr/bin/env node
/**
 * 卡 36 · 显式记忆关系边回填（11 条）
 *
 * 先逐条 `nmem memories link list <MEMORY_ID>` 查重（0.10.111 无空间级 link list），
 * 再 `nmem memories link add`。二次运行幂等：已存在的边跳过。
 * 默认 dry-run 只打印将执行的边；显式 --apply 才写。
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const SPACE = 'any2skills'

// 11 条显式边（依据 docs/tickets/36 关系表）
const EDGES = [
  ['any2skills-l2-01', 'DERIVES_FROM', 'any2skills-l2-02'],
  ['any2skills-l2-01', 'PASSES_GATE', 'any2skills-l2-03'],
  ['any2skills-l2-03', 'GOVERNED_BY', 'any2skills-l1-02'],
  ['any2skills-l2-03', 'GOVERNED_BY', 'any2skills-l1-03'],
  ['any2skills-l2-04', 'NAMESPACED_UNDER', 'any2skills-l2-02'],
  ['any2skills-l3-01', 'GOVERNED_BY', 'any2skills-l1-04'],
  ['any2skills-l3-02', 'GOVERNED_BY', 'any2skills-l1-04'],
  ['any2skills-l3-03', 'GOVERNED_BY', 'any2skills-l1-04'],
  ['any2skills-l3-04', 'DERIVES_FROM', 'any2skills-l1-01'],
  ['any2skills-l4-01', 'DERIVES_FROM', 'any2skills-l2-01'],
  ['any2skills-l4-02', 'DERIVES_FROM', 'any2skills-l2-01'],
]

const REASONS = {
  DERIVES_FROM: '由源派生（产品定义/画像依赖底层口径）',
  PASSES_GATE: '通过门禁口径（基线声称经三道门禁判定）',
  GOVERNED_BY: '受治理于（避坑教训受红线约束）',
  NAMESPACED_UNDER: '按源命名空间归属',
}

const apply = process.argv.includes('--apply')

function nmem(args, opts = {}) {
  return spawnSync('nmem', args, { encoding: 'utf8', timeout: 30000, ...opts })
}

function linkExists(memoryId, rel) {
  const res = nmem(['--json', 'memories', 'link', 'list', memoryId, '--space', SPACE])
  if (res.status !== 0) return false // 查重失败不阻塞；link add 本身是 upsert 语义，不会重复建边
  try {
    const data = JSON.parse(res.stdout)
    const links = Array.isArray(data) ? data : (data.relations || data.links || data.items || [])
    // 只比对 outgoing 的边：incoming 是别的记忆指进来的，不算本记忆的出边
    return links.some((l) =>
      l.direction !== 'incoming' &&
      String(l.relation_type || l.relationType || '').toUpperCase() === rel)
  } catch {
    return false
  }
}

let created = 0, skipped = 0, failed = 0
const results = []
for (const [src, rel, tgt] of EDGES) {
  const label = `${src} --${rel}--> ${tgt}`
  if (apply && linkExists(src, rel)) {
    skipped += 1
    results.push({ edge: label, status: 'skipped' })
    console.log(`skip: ${label}`)
    continue
  }
  if (!apply) {
    console.log(`[dry-run] 将建边: ${label}`)
    continue
  }
  const res = nmem(['memories', 'link', 'add', '--type', rel, src, tgt,
    '--space', SPACE, '--reason', REASONS[rel] || 'nmem 落地显式关系'])
  if (res.status === 0) {
    created += 1
    results.push({ edge: label, status: 'created' })
    console.log(`ok: ${label}`)
  } else {
    failed += 1
    results.push({ edge: label, status: 'fail', stderr: (res.stderr || '').trim() })
    console.error(`fail: ${label} → ${(res.stderr || '').trim()}`)
  }
}

const summary = { space: SPACE, apply, created, skipped, failed, results }
writeFileSync('docs/audits/any2skills-nmem-links-20261031.json',
  JSON.stringify(summary, null, 2) + '\n')
console.log(`\n完成 created=${created} skipped=${skipped} failed=${failed}`)
if (failed > 0) process.exit(3)
