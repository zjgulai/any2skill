#!/usr/bin/env node
/**
 * 任务技能套件 · 构建 CLI（卡 26，决策见 ADR-031）
 *
 * 用法：
 *   node pipeline/build-task-suite.mjs --dry-run [--bundle <slug>]     # 只读盘、只渲染、只报告
 *   node pipeline/build-task-suite.mjs                                  # 渲染并写暂存区与构建契约
 *   node pipeline/build-task-suite.mjs --publish                        # 另将过门禁一者写入 skills/
 *
 * ## 副作用清单
 *
 *   缺省（无 --publish）只写 `pipeline/registry/build/<slug>/`（SKILL.md + 契约 + 回执）——
 *   **不触碰 skills/**；这是迁移前的 staging 形态，避免出现「旧 30 + 新 19」混合目录。
 *   `--publish` 才把过门禁一者写入 `skills/<slug>/`（真正的原子切换由
 *   `pipeline/publish-task-suite.mjs` 编排，它先归档旧目录再调用本命令）。
 *   `--dry-run` 一个文件都不写。
 *
 * ## 门禁一（任务骨架）
 *
 * 复用 `verify-skill.mjs`（传入任务骨架）：frontmatter 硬限、体积、段齐全与顺序、
 * 契约段计数一致、sourceRefs 逐条可解析、出处回链齐全。这些判据与旧套件**同一实现**，
 * 差别只在骨架参数——两个套件不各自维护一套校验器。
 */

import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, buildAnchorIndex, sourceBookRoot } from './tools/anchor-index.mjs'
import { SIZE_LIMIT_BYTES } from './tools/skill-builder.mjs'
import { verifySkill } from './tools/verify-skill.mjs'
import { assertSlug, EXIT } from './build-skill.mjs'
import {
  SUITE_MANIFEST_REL_PATH,
  TASK_SKELETON_SECTIONS,
  TASK_SKILL_CONTRACT_SCHEMA_VERSION,
  countsOf,
  loadMemberSources,
  loadObjectIndex,
  loadSuiteManifest,
  loadWorkflow,
  readJson,
  renderTaskSkill,
} from './tools/task-skill-builder.mjs'

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { dryRun: false, json: false, repoRoot: DEFAULT_REPO_ROOT, manifest: SUITE_MANIFEST_REL_PATH, bundle: null, publish: false }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--json') flags.json = true
    else if (a === '--publish') flags.publish = true
    else if (a === '--bundle') (flags.bundle = need(i, a)), (i += 1)
    else if (a === '--manifest') (flags.manifest = need(i, a)), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else throw new Error(`未知参数：${a}`)
  }
  return flags
}

/** 构建一个成员（纯装配 + 门禁一 + 契约；写盘由调用方决定）。 */
export async function buildMember(repoRoot, member, suite, objectIndex) {
  assertSlug(member.slug)
  const { workflow, sha256: workflowSha } = await loadWorkflow(repoRoot, member)
  const { objects, aps } = await loadMemberSources(repoRoot, member, objectIndex)

  // 溢出阀（ADR-031）：先按逐锚点全列渲染；超限时改用按文件聚合的紧凑出处；
  // 仍超限则如实交给门禁拒绝，不在这里裁剪规则与陷阱内容。
  let readingMode = 'full'
  let markdown = renderTaskSkill({ member, workflow, objects, aps, readingMode })
  if (Buffer.byteLength(markdown, 'utf8') > SIZE_LIMIT_BYTES) {
    readingMode = 'compact'
    markdown = renderTaskSkill({ member, workflow, objects, aps, readingMode })
  }

  const sectionCounts = countsOf(markdown)
  const refs = []
  {
    const seen = new Set()
    for (const o of [...objects, ...aps]) {
      for (const r of o.sourceRefs ?? []) {
        const key = `${r.file}#${r.anchor}`
        if (seen.has(key)) continue
        seen.add(key)
        refs.push({ file: r.file, anchor: r.anchor, title: r.title, lineStart: r.lineStart, lineEnd: r.lineEnd })
      }
    }
  }
  const anchorIndexes = []
  for (const file of new Set(refs.map((r) => r.file))) {
    anchorIndexes.push(await buildAnchorIndex(path.join(repoRoot, file), { repoRoot }))
  }

  // legacy 章节契约（本仓重组路径）：逐份读取进 provenance。
  // **新书直接策展**（卡 29）：legacySlugs 为空时没有旧契约可读——sourceFile 从
  // owned 对象的所在章派生（对象装载按 fileKey 排序，取第一份，确定性）。
  const legacyContracts = []
  for (const slug of member.legacySlugs ?? []) {
    const rel = path.join('pipeline', 'registry', 'build', slug, 'skill-contract.json')
    legacyContracts.push({ slug, rel, doc: await readJson(path.join(repoRoot, rel), `旧契约 ${slug}`) })
  }
  const derivedSourceFile =
    legacyContracts.length > 0
      ? legacyContracts[0].doc.provenance?.sourceFile ?? null
      : objects.length > 0
        ? path.join(sourceBookRoot(member.sourceKey), `${objects[0].__fileKey}.md`)
        : null

  const contract = {
    schemaVersion: TASK_SKILL_CONTRACT_SCHEMA_VERSION,
    skillId: member.slug,
    name: member.slug,
    title: workflow.title,
    description: workflow.description,
    sourceKey: member.sourceKey,
    suite: { manifestFile: path.relative(repoRoot, suite.abs), manifestSha256: suite.sha256 },
    legacy: { slugs: member.legacySlugs ?? [], skillIds: legacyContracts.map((l) => l.doc.skillId) },
    workflow: { file: member.workflowFile, sha256: workflowSha },
    sourceObjects: member.primaryObjects,
    crossChapterObjects: member.crossChapterObjects ?? [],
    sourceRefs: refs,
    sectionCounts,
    // 风险标记语义绑定旧骨架的建议值体系（ADR-006/021），任务骨架不套用；
    // 空数组是「本骨架下无此标记」，不是「没算」——记录于 ADR-031。
    riskFlags: [],
    gapCodes: [],
    gaps: [],
    evidenceGrade: 'E2-derived',
    freshness: { state: 'fresh', asOf: new Date(0).toISOString() },
    gateReceipt: null,
    provenance: {
      sourceKey: member.sourceKey,
      sourceFile: derivedSourceFile,
      objectsFiles: [...new Set(objects.map((o) => path.join('pipeline', 'knowledge', `${o.__fileKey}.objects.json`)))].sort(),
      legacyContracts: legacyContracts.map((l) => l.rel),
      suiteManifest: path.relative(repoRoot, suite.abs),
      workflowFile: member.workflowFile,
      generation: 'task-suite',
    },
  }

  const verdict = await verifySkill({
    markdown,
    contract,
    anchorIndexes,
    repoRoot,
    sectionCountsExpected: sectionCounts,
    skeleton: TASK_SKELETON_SECTIONS,
  })
  contract.gateReceipt = {
    passed: verdict.passed,
    reasonCodes: verdict.reasonCodes,
    bytes: verdict.checks.bytes,
    markdownHash: verdict.markdownHash,
    checkedAt: new Date(0).toISOString(),
  }
  return { markdown, contract, verdict, readingMode, objects, aps }
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
    const suite = await loadSuiteManifest(repoRoot, flags.manifest)
    const objectIndex = await loadObjectIndex(repoRoot)
    const members = flags.bundle ? suite.manifest.members.filter((m) => m.slug === flags.bundle) : suite.manifest.members
    if (flags.bundle && members.length === 0) throw new Error(`清单里没有成员：${flags.bundle}`)
    const rows = []
    let failed = 0
    for (const member of members) {
      const built = await buildMember(repoRoot, member, suite, objectIndex)
      const { verdict } = built
      rows.push({
        slug: member.slug,
        bytes: verdict.checks.bytes,
        readingMode: built.readingMode,
        passed: verdict.passed,
        reasonCodes: verdict.reasonCodes,
        failures: verdict.failures,
        objects: built.objects.length,
        aps: built.aps.length,
      })
      if (!verdict.passed) failed += 1
      if (!flags.dryRun) {
        const dir = path.join(repoRoot, 'pipeline', 'registry', 'build', member.slug)
        await mkdir(path.join(dir, 'references'), { recursive: true })
        await writeFile(path.join(dir, 'SKILL.md'), built.markdown, 'utf8')
        await writeFile(path.join(dir, 'skill-contract.json'), `${JSON.stringify(built.contract, null, 2)}\n`, 'utf8')
        await writeFile(path.join(dir, 'gate-receipt.json'), `${JSON.stringify({ slug: member.slug, ...verdict }, null, 2)}\n`, 'utf8')
      }
      if (flags.publish && verdict.passed && !flags.dryRun) {
        const pubDir = path.join(repoRoot, 'skills', member.slug)
        await mkdir(path.join(pubDir, 'references'), { recursive: true })
        await writeFile(path.join(pubDir, 'SKILL.md'), built.markdown, 'utf8')
      }
    }
    const out = { dryRun: flags.dryRun, publish: flags.publish, members: rows, failed }
    if (flags.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    else {
      for (const r of rows) {
        process.stdout.write(`${r.passed ? '✅' : '❌'} ${r.slug.padEnd(34)} ${String(r.bytes).padStart(5)}B  对象${String(r.objects).padStart(3)} AP${String(r.aps).padStart(2)}  出处${r.readingMode}  ${r.reasonCodes.join(',') || '—'}\n`)
        for (const f of r.failures ?? []) process.stdout.write(`     · ${f.code}: ${f.detail}\n`)
      }
      process.stdout.write(`共 ${rows.length} 个成员，失败 ${failed} 个。${flags.dryRun ? '（dry-run：未写盘）' : flags.publish ? '（已写暂存区与发布区）' : '（已写暂存区；未发布）'}\n`)
    }
    return failed === 0 ? EXIT.PASS : EXIT.RUN_FAILED
  } catch (err) {
    process.stderr.write(`任务套件构建失败：${err?.message ?? err}\n`)
    return EXIT.RUN_FAILED
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}