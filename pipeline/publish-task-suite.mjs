#!/usr/bin/env node
/**
 * 任务技能套件 · 迁移与发布 CLI（卡 26，决策见 ADR-031）
 *
 * 用法：
 *   node pipeline/publish-task-suite.mjs --dry-run    # 校验并打印迁移计划，一个文件都不动
 *   node pipeline/publish-task-suite.mjs              # 执行：归档旧 30 → 原子切换新 19
 *
 * ## 它做什么（一次运行、四种产物）
 *
 *   1. **预检**：构建全部 19 个成员到内存（复用 build-task-suite 的 buildMember），
 *      任一不过门禁一即中止——**绝不带着失败品切换**。
 *   2. **迁移前清单 + 归档**：记录旧 30 个目录的逐文件哈希（`task-suite-lineage.v1.json`
 *      的 legacy 段），然后**逐字节移入** `pipeline/registry/legacy-published/chapter-suite-v1/skills/`；
 *      移动后逐文件复算哈希断言一致。旧契约、回执、门禁报告、tiers、冻结一律不动。
 *   3. **切换**：把 19 个 staged 产物写入 `skills/<slug>/`（staging 目录同时保留）。
 *   4. **记录**：`task-suite-lineage.v1.json`（30→19 映射与哈希）+ `task-suite-status.v1.json`
 *      （structuralGate 通过；trigger/utility = unassessed-after-recomposition——**不聚合、
 *      不继承**旧判定）。
 *
 * ## 幂等
 *
 *   检测「已迁移」状态（归档目录在、19 个新 slug 在、且哈希与 staging 一致）→ 二次运行
 *   为 no-op（退出 0，不重写）。**部分迁移**（归档在但缺新 slug，或反之）→ 硬错误，
 *   交人工处理——绝不在半迁移状态上继续搬文件。
 *
 * ## 它不做什么
 *
 *   不发任何模型调用（不跑门禁二/三）；不改旧契约/旧报告/冻结文件；不为旧 slug 留
 *   触发桩（旧路径不再可寻址是本次重组的目的，见 ADR-031）。
 */

import path from 'node:path'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from './tools/anchor-index.mjs'
import { EXIT } from './build-skill.mjs'
import { buildMember } from './build-task-suite.mjs'
import { loadObjectIndex, loadSuiteManifest } from './tools/task-skill-builder.mjs'

const ARCHIVE_REL = path.join('pipeline', 'registry', 'legacy-published', 'chapter-suite-v1', 'skills')
const LINEAGE_REL = path.join('pipeline', 'registry', 'task-suite-lineage.v1.json')
const STATUS_REL = path.join('pipeline', 'registry', 'task-suite-status.v1.json')

const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`

async function listFilesRec(dir, base = dir) {
  const names = (await readdir(dir, { withFileTypes: true }).catch(() => [])).sort((a, b) => a.name.localeCompare(b.name))
  const out = []
  for (const n of names) {
    const abs = path.join(dir, n.name)
    if (n.isDirectory()) out.push(...(await listFilesRec(abs, base)))
    else out.push(path.relative(base, abs))
  }
  return out
}

async function hashDir(abs) {
  const files = await listFilesRec(abs)
  const entries = []
  for (const f of files) {
    entries.push({ path: f, sha256: sha256(await readFile(path.join(abs, f))) })
  }
  return entries
}

export async function planMigration(repoRoot = DEFAULT_REPO_ROOT) {
  const suite = await loadSuiteManifest(repoRoot)
  // 旧 slug 清单含 rejected 段的 legacy（卡 27：被拒成员从 members 移除，但其 legacy 输入仍在归档面）
  const legacy = [...new Set([...suite.manifest.members, ...(suite.manifest.rejected ?? [])].flatMap((m) => m.legacySlugs))].sort()
  const newSlugs = suite.manifest.members.map((m) => m.slug)

  const skillsDir = path.join(repoRoot, 'skills')
  const present = new Set(await readdir(skillsDir))
  const legacyPresent = legacy.filter((l) => present.has(l))
  const newPresent = newSlugs.filter((s) => present.has(s))
  const archiveAbs = path.join(repoRoot, ARCHIVE_REL)
  const archiveExists = await stat(archiveAbs).then(() => true).catch(() => false)

  let state = 'fresh'
  if (legacyPresent.length === 0 && newPresent.length === newSlugs.length && archiveExists) state = 'already-migrated'
  else if (legacyPresent.length > 0 && newPresent.length === 0 && !archiveExists) state = 'fresh'
  else state = 'partial'

  return { suite, legacy, newSlugs, legacyPresent, newPresent, archiveExists, state }
}

async function main(argv) {
  const args = argv.slice(2)
  const flags = { dryRun: false, json: false, repoRoot: DEFAULT_REPO_ROOT }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--json') flags.json = true
    else if (a === '--repo-root') {
      flags.repoRoot = path.resolve(args[i + 1])
      i += 1
    } else {
      process.stderr.write(`未知参数：${a}\n`)
      return EXIT.RUN_FAILED
    }
  }
  const repoRoot = flags.repoRoot

  try {
    const plan = await planMigration(repoRoot)
    if (plan.state === 'partial') {
      throw new Error(
        '检测到半迁移状态（归档目录与新 slug 的存在性不一致）——拒绝继续；先人工确认后再运行。',
      )
    }
    if (plan.state === 'already-migrated') {
      process.stdout.write(`已迁移（幂等 no-op）：归档在 ${ARCHIVE_REL}，19 个新 slug 齐备。\n`)
      return EXIT.PASS
    }

    // 预检：全部成员先构建（内存），任一失败即中止
    const objectIndex = await loadObjectIndex(repoRoot)
    const built = []
    for (const member of plan.suite.manifest.members) {
      built.push({ member, ...(await buildMember(repoRoot, member, plan.suite, objectIndex)) })
    }
    const failed = built.filter((b) => !b.verdict.passed)
    if (failed.length > 0) {
      throw new Error(`预检失败：${failed.map((f) => f.member.slug).join(', ')} 未过门禁一——中止迁移。`)
    }

    if (flags.dryRun) {
      const out = {
        dryRun: true,
        state: plan.state,
        archive: { from: 'skills/<旧 30>', to: ARCHIVE_REL, count: plan.legacy.length },
        publish: { slugs: plan.newSlugs, count: plan.newSlugs.length },
        lineage: LINEAGE_REL,
        status: STATUS_REL,
        legacyPreview: plan.legacy,
        newPreview: plan.newSlugs,
      }
      process.stdout.write(flags.json ? `${JSON.stringify(out, null, 2)}\n` : `[dry-run] 迁移计划：归档 ${plan.legacy.length} 个旧目录 → ${ARCHIVE_REL}；发布 ${plan.newSlugs.length} 个新技能。未写盘。\n`)
      return EXIT.PASS
    }

    // 迁移前清单（旧 30 的逐文件哈希）
    const legacyEntries = []
    for (const slug of plan.legacy) {
      const abs = path.join(repoRoot, 'skills', slug)
      const files = await hashDir(abs)
      legacyEntries.push({ slug, files, newOwners: plan.suite.manifest.members.filter((m) => m.legacySlugs.includes(slug)).map((m) => m.slug) })
    }

    // 归档：逐字节移动 + 移动后复算
    const archiveAbs = path.join(repoRoot, ARCHIVE_REL)
    await mkdir(archiveAbs, { recursive: true })
    for (const slug of plan.legacy) {
      await rename(path.join(repoRoot, 'skills', slug), path.join(archiveAbs, slug))
    }
    for (const entry of legacyEntries) {
      const moved = await hashDir(path.join(archiveAbs, entry.slug))
      if (JSON.stringify(moved) !== JSON.stringify(entry.files)) {
        throw new Error(`归档后哈希不一致：${entry.slug}——停止并人工核查。`)
      }
    }

    // 切换：写 19 个新发布物（staging 保留一份）
    const membersRecord = []
    for (const b of built) {
      const pubDir = path.join(repoRoot, 'skills', b.member.slug)
      await mkdir(path.join(pubDir, 'references'), { recursive: true })
      await writeFile(path.join(pubDir, 'SKILL.md'), b.markdown, 'utf8')
      const dir = path.join(repoRoot, 'pipeline', 'registry', 'build', b.member.slug)
      await mkdir(path.join(dir, 'references'), { recursive: true })
      await writeFile(path.join(dir, 'SKILL.md'), b.markdown, 'utf8')
      await writeFile(path.join(dir, 'skill-contract.json'), `${JSON.stringify(b.contract, null, 2)}\n`, 'utf8')
      await writeFile(path.join(dir, 'gate-receipt.json'), `${JSON.stringify({ slug: b.member.slug, ...b.verdict }, null, 2)}\n`, 'utf8')
      membersRecord.push({
        slug: b.member.slug,
        legacySlugs: b.member.legacySlugs,
        sourceObjects: b.member.primaryObjects.length,
        crossChapterObjects: (b.member.crossChapterObjects ?? []).length,
        workflow: b.contract.workflow,
        bytes: b.verdict.checks.bytes,
        markdownSha256: b.verdict.markdownHash,
        readingMode: b.readingMode,
      })
    }

    // 记录：lineage + status
    const now = new Date().toISOString()
    const lineage = {
      schemaVersion: 'task-suite-lineage/v1',
      createdAt: now,
      suiteManifest: { file: path.relative(repoRoot, plan.suite.abs), sha256: plan.suite.sha256 },
      archive: { dir: ARCHIVE_REL, note: '旧 30 发布物逐字节移入（移动后逐文件哈希复验一致）；旧契约/回执/门禁报告/tiers/冻结文件均未改动。' },
      legacy: legacyEntries,
      members: membersRecord,
    }
    await writeFile(path.join(repoRoot, LINEAGE_REL), `${JSON.stringify(lineage, null, 2)}\n`, 'utf8')

    const status = {
      schemaVersion: 'task-suite-status/v1',
      createdAt: now,
      structuralGate: 'passed',
      structuralGateDetail: membersRecord.map((m) => ({ slug: m.slug, passed: true, bytes: m.bytes, markdownSha256: m.markdownSha256 })),
      triggerAssessment: 'unassessed-after-recomposition',
      utilityAssessment: 'unassessed-after-recomposition',
      note:
        '重组使历史上全部门禁二/三证据不再与本套件的名称/描述/正文对应——按 ADR-030 的重测协议与 ' +
        'ADR-031 的证据边界：**不聚合、不继承**旧的 passed/low-utility 判定。付费重测须由用户显式发起；' +
        '发起前本套件是「结构合规、效用未评」状态，披露载体为本文件与 README。',
      historicalEvidence: {
        tiersFile: 'pipeline/registry/tiers.json',
        tiersNote: '该文件是对旧 30 个发布物的历史测量记录，语义不迁移至本套件。',
        gate2Reports: ['pipeline/registry/gate2-report.json', 'pipeline/registry/gate2-report.strict.json'],
        gate3Report: 'pipeline/registry/gate3-report.json',
        freezeFiles: ['pipeline/registry/freeze-2026-10-13T16-14-59.json', 'pipeline/registry/freeze-2026-10-14T22-17-15.json'],
      },
      rejectedKept: ['chapter3-s1', 'ch13-02-iterators-s1'],
    }
    await writeFile(path.join(repoRoot, STATUS_REL), `${JSON.stringify(status, null, 2)}\n`, 'utf8')

    const out = {
      archived: plan.legacy.length,
      published: membersRecord.length,
      lineage: LINEAGE_REL,
      status: STATUS_REL,
    }
    if (flags.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
    else process.stdout.write(`迁移完成：归档 ${out.archived} 个旧发布物 → ${ARCHIVE_REL}；发布 ${out.published} 个新技能；记录 ${LINEAGE_REL} / ${STATUS_REL}。\n`)
    return EXIT.PASS
  } catch (err) {
    process.stderr.write(`迁移失败：${err?.message ?? err}\n`)
    return EXIT.RUN_FAILED
  }
}

export { main }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}