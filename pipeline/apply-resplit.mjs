#!/usr/bin/env node
/**
 * 门禁二反馈 → 划分修正的执行器（ticket 13，ADR-007「退回环 3 合并」的执行段）。
 *
 * 用法：
 *   node pipeline/apply-resplit.mjs --dry-run            # 全量校验与变更摘要，**不写任何文件**
 *   node pipeline/apply-resplit.mjs                      # 执行（要求计划 approved:true）
 *
 * ## 本命令做什么、不做什么
 *
 * 做：读 `pipeline/registry/resplit-plan.json`（机器可读、逐条带依据），把 `merge` 条目
 * 应用到两份划分产物——**纯结构操作，零模型调用**；旧产物先归档进各自的 `history/`。
 * 不：不做语义判断（合并与否由计划说了算）、不重新聚类、不装配 skill（那是环 4）、
 * 不读 `benchmark/`。
 *
 * ## 三条硬校验（任一不过即拒绝，不写盘）
 *
 *   1. **计划必须已批准**（`approved: true`）——执行与决策分开是这张卡的设计：
 *      谁在什么时候批了什么，写在计划文件里。
 *   2. **配对不相交**：同一候选不得同时出现在两个配对里（计划规则保证；执行器再验一遍）。
 *   3. **零静默丢失**：被并入者的每个对象、每个单元都必须在并入者里出现；
 *      且执行后每章的单元引用必须全部可解析——全量断言通过才落盘。
 *
 * ## merge 的语义（并入，不新建身份）
 *
 * `into` 吸收 `target` 的单元与对象（`target` 从候选表移除，理由入档）；单元本身
 * **留在各自所属章节的记录里**（跨章候选的单元天然分布在多章），skill 条目上补
 * `chapterRefs` 显式声明所跨章节。这样环 4 的 `loadClusterAssemblyInputs` 无需特判。
 */

import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, DEFAULT_SOURCE_KEY } from './tools/anchor-index.mjs'
import { candidatesRelPath, clustersRelPath } from './tools/cluster-proposer.mjs'
import { unwrapObjectsFile } from './tools/skill-builder.mjs'

export const EXIT = Object.freeze({
  PASS: 0,
  RUN_FAILED: 4,
})

const PLAN_REL = path.join('pipeline', 'registry', 'resplit-plan.json')

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { dryRun: false, json: false, repoRoot: DEFAULT_REPO_ROOT, plan: PLAN_REL, sourceKey: DEFAULT_SOURCE_KEY }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--json') flags.json = true
    else if (a === '--plan') (flags.plan = need(i, a)), (i += 1)
    else if (a === '--source-key') (flags.sourceKey = need(i, a)), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a.startsWith('--')) throw new Error(`未知参数：${a}`)
    else throw new Error(`未知位置参数：${a}（本命令不接受位置参数）`)
  }
  return flags
}

const sha8 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 8)

/**
 * 把计划应用到两份划分产物的**纯函数**（不读盘不写盘，便于测试）。
 * 校验失败即抛——错误信息必须能直接回答「哪条对不上」。
 */
export function applyPlan({ clustersDoc, candidatesDoc, plan }) {
  const merges = (plan.pairs ?? []).filter((p) => p.action === 'merge')
  if (merges.length === 0) throw new Error('计划里没有任何 merge 条目——没有可执行的内容。')

  // 配对不相交（同一候选只出现一次）
  const seen = new Map()
  for (const m of merges) {
    for (const id of [m.into, m.target]) {
      if (seen.has(id)) throw new Error(`候选 ${id} 出现在两个配对里（${seen.get(id)} 与 ${m.target}|${m.into}）——拒绝执行。`)
      seen.set(id, `${m.into}|${m.target}`)
    }
  }

  const chapters = Array.isArray(clustersDoc.chapters) ? clustersDoc.chapters : []
  const allUnits = new Map()
  for (const ch of chapters) for (const u of ch.units ?? []) allUnits.set(u.unitId, u)
  const findSkill = (skillId) => {
    for (const ch of chapters) {
      for (const s of ch.skills ?? []) if (s.skillId === skillId) return { ch, s }
    }
    return null
  }

  const candidates = Array.isArray(candidatesDoc.candidates) ? candidatesDoc.candidates : []
  const candidateById = new Map(candidates.map((c) => [c.skillId, c]))

  const removed = []
  const mergeRecords = []
  for (const m of merges) {
    const intoHit = findSkill(m.into)
    const targetHit = findSkill(m.target)
    if (!intoHit) throw new Error(`clusters.json 里找不到并入者 ${m.into}`)
    if (!targetHit) throw new Error(`clusters.json 里找不到被并入者 ${m.target}`)
    const intoCand = candidateById.get(m.into)
    const targetCand = candidateById.get(m.target)
    if (!intoCand) throw new Error(`skill-candidates.json 里找不到并入者 ${m.into}`)
    if (!targetCand) throw new Error(`skill-candidates.json 里找不到被并入者 ${m.target}`)

    const unitIds = [...new Set([...(intoHit.s.unitIds ?? []), ...(targetHit.s.unitIds ?? [])])]
    const unitAnchors = unitIds.flatMap((id) => {
      const u = allUnits.get(id)
      if (!u) throw new Error(`单元 ${id}（${m.into} 并入后引用）在任何章的单元记录里都不存在——拒绝执行。`)
      return u.anchors ?? []
    })
    const chapterRefs = [...new Set([...unitAnchors.map((a) => String(a).split('#')[0]), intoHit.ch.fileKey, targetHit.ch.fileKey])].sort()

    // 零静默丢失：被并入者的每个单元与对象都要在并入者里出现
    const missingUnits = (targetHit.s.unitIds ?? []).filter((id) => !unitIds.includes(id))
    const intoObjects = new Set([...(intoCand.sourceObjects ?? []), ...(targetCand.sourceObjects ?? [])])
    const missingObjects = (targetCand.sourceObjects ?? []).filter((id) => !intoObjects.has(id))
    if (missingUnits.length || missingObjects.length) {
      throw new Error(
        `并入 ${m.target} → ${m.into} 时出现丢失：单元 ${missingUnits.join(', ') || '无'}；对象 ${missingObjects.join(', ') || '无'}——拒绝执行。`,
      )
    }

    // 改 clusters：target 的 skill 条目移除；into 的条目吃下并集并补声明
    targetHit.ch.skills = targetHit.ch.skills.filter((s) => s.skillId !== m.target)
    Object.assign(intoHit.s, {
      unitIds,
      objectIds: [...intoObjects],
      chapterRefs,
      mergedFrom: [...new Set([...(intoHit.s.mergedFrom ?? []), m.target])],
      mergeBasis: [...(intoHit.s.mergeBasis ?? []), m.basis],
    })

    // 改 candidates：target 移除；into 吃下并集
    const idx = candidates.findIndex((c) => c.skillId === m.target)
    candidates.splice(idx, 1)
    Object.assign(intoCand, {
      sourceObjects: [...intoObjects],
      units: unitIds,
      chapterRefs,
      anchors: [...new Set([...(intoCand.anchors ?? []), ...(targetCand.anchors ?? [])])],
      mergedFrom: [...new Set([...(intoCand.mergedFrom ?? []), m.target])],
    })
    removed.push({ skillId: m.target, mergedInto: m.into, basis: m.basis, reason: m.reason ?? null })
    mergeRecords.push({ into: m.into, target: m.target, unitIds, objectCount: intoObjects.size, chapterRefs, basis: m.basis })
  }

  // 全局一致性：每个 skill 引用的单元必须可解析
  for (const ch of chapters) {
    for (const s of ch.skills ?? []) {
      for (const id of s.unitIds ?? []) {
        if (!allUnits.has(id)) throw new Error(`拼接后 ${s.skillId} 引用了不存在的单元 ${id}——拒绝执行。`)
      }
    }
  }

  return { clustersDoc, candidatesDoc, removed, mergeRecords }
}

async function main(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return EXIT.RUN_FAILED
  }
  const repoRoot = flags.repoRoot
  const rel = (p) => path.relative(repoRoot, p)

  try {
    const planRaw = await readFile(path.join(repoRoot, flags.plan), 'utf8')
    const plan = JSON.parse(planRaw)
    if (plan.approved !== true) {
      throw new Error(
        `${flags.plan} 的 approved 不是 true——执行与决策分开：先在计划文件里记录批准（approved:true + approvedAt），再执行。`,
      )
    }
    const clustersRaw = await readFile(path.join(repoRoot, clustersRelPath(flags.sourceKey)), 'utf8')
    const candidatesRaw = await readFile(path.join(repoRoot, candidatesRelPath(flags.sourceKey)), 'utf8')
    const clustersDoc = JSON.parse(clustersRaw)
    const candidatesDoc = JSON.parse(candidatesRaw)

    const applied = applyPlan({ clustersDoc, candidatesDoc, plan })

    // 对象级零丢失：每个候选（含并入者）声明的对象必须能在其各章的对象文件里找到。
    const objectIdsByFile = new Map()
    for (const ch of clustersDoc.chapters) {
      try {
        const raw = await readFile(path.join(repoRoot, 'pipeline', 'knowledge', `${ch.fileKey}.objects.json`), 'utf8')
        objectIdsByFile.set(ch.fileKey, new Set(unwrapObjectsFile(JSON.parse(raw), `${ch.fileKey}.objects.json`).map((o) => o.id)))
      } catch (err) {
        if (err.code === 'ENOENT') continue
        throw err
      }
    }
    for (const cand of applied.candidatesDoc.candidates) {
      const known = new Set()
      for (const f of cand.chapterRefs ?? []) for (const id of objectIdsByFile.get(f) ?? []) known.add(id)
      const missing = (cand.sourceObjects ?? []).filter((id) => !known.has(id))
      if (missing.length > 0) {
        throw new Error(
          `候选 ${cand.skillId} 声明的对象在它各章的对象文件里找不到：${missing.slice(0, 5).join(', ')}——拒绝执行。`,
        )
      }
    }

    const resplitBlock = {
      appliedAt: new Date().toISOString(),
      planFile: rel(path.join(repoRoot, flags.plan)),
      planSha256: `sha256:${createHash('sha256').update(planRaw).digest('hex')}`,
      rule: plan.rule ?? null,
      merges: applied.mergeRecords,
      removed: applied.removed,
    }
    applied.clustersDoc.resplit = resplitBlock
    applied.candidatesDoc.resplit = { ...resplitBlock, note: 'diagnostics 与 candidates 的聚类时点字段保持原样（本块是重切记录，不重算聚类诊断）。' }

    if (flags.dryRun) {
      const out = {
        dryRun: true,
        merges: applied.mergeRecords.map((m) => `${m.target} → ${m.into}（${m.chapterRefs.join('+')}，${m.objectCount} 对象）`),
        removed: applied.removed.map((r) => r.skillId),
        candidatesAfter: applied.candidatesDoc.candidates.length,
      }
      process.stdout.write(flags.json ? `${JSON.stringify(out, null, 2)}\n` : `[dry-run] 校验通过，未写盘。\n${out.merges.map((x) => `  ${x}`).join('\n')}\n候选数：${out.candidatesAfter}\n`)
      return EXIT.PASS
    }

    // 归档旧产物（内容哈希命名——重跑同一计划不会覆盖历史）
    const historyDir = path.join(repoRoot, 'pipeline', 'knowledge', 'history')
    const regHistory = path.join(repoRoot, 'pipeline', 'registry', 'history')
    await mkdir(historyDir, { recursive: true })
    await mkdir(regHistory, { recursive: true })
    const clustersArchive = path.join(historyDir, `clusters.${sha8(clustersRaw)}.json`)
    const candidatesArchive = path.join(regHistory, `skill-candidates.${sha8(candidatesRaw)}.json`)
    await writeFile(clustersArchive, clustersRaw, 'utf8')
    await writeFile(candidatesArchive, candidatesRaw, 'utf8')

    const newClustersRaw = `${JSON.stringify(applied.clustersDoc, null, 2)}\n`
    const newCandidatesRaw = `${JSON.stringify(
      { ...applied.candidatesDoc, clustersSha256: `sha256:${createHash('sha256').update(newClustersRaw).digest('hex')}` },
      null,
      2,
    )}\n`
    await writeFile(path.join(repoRoot, clustersRelPath(flags.sourceKey)), newClustersRaw, 'utf8')
    await writeFile(path.join(repoRoot, candidatesRelPath(flags.sourceKey)), newCandidatesRaw, 'utf8')

    const out = {
      merges: applied.mergeRecords.map((m) => `${m.target} → ${m.into}`),
      removed: applied.removed.map((r) => r.skillId),
      candidatesAfter: applied.candidatesDoc.candidates.length,
      archived: { clusters: rel(clustersArchive), candidates: rel(candidatesArchive) },
    }
    if (flags.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    else {
      process.stdout.write(
        `重切已应用：${out.merges.length} 对合并；候选 ${out.candidatesAfter} 个\n` +
          out.merges.map((m) => `  ${m}`).join('\n') +
          `\n归档：${out.archived.clusters} / ${out.archived.candidates}\n`,
      )
    }
    return EXIT.PASS
  } catch (err) {
    process.stderr.write(`重切失败：${err?.message ?? err}\n`)
    return EXIT.RUN_FAILED
  }
}

export { parseArgs }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
