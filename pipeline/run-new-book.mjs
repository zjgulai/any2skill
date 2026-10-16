#!/usr/bin/env node
/**
 * 新书入场与管线编排（卡 29）——「给到 md 就把它推到底」的那条命令链。
 *
 * 用法：
 *   node pipeline/run-new-book.mjs onboard  --dir <md 书目录> --key <sourceKey>
 *   node pipeline/run-new-book.mjs pipeline --key <sourceKey> --model … --base-url … [--layer2 deepseek] [--no-synthesis] [--dry-run]
 *   node pipeline/run-new-book.mjs scaffold --key <sourceKey>
 *   node pipeline/run-new-book.mjs all      --dir … --key … --model … --base-url …
 *
 * ## 它做什么
 *
 *   onboard   把 md 目录拷进 `sources/<key>/book/`，逐文件 sha256 写 SOURCE-MANIFEST。
 *   pipeline  串联既有 CLI：环 1/2（run-book）→ 环 3（propose-clusters）→ 跨章合成
 *             （propose-themes + synthesize-antipatterns，可关）→ 门禁一筛查
 *             （对全体候选逐份 build-skill --dry-run，产物 `pipeline/registry/screening.<key>.json`）。
 *             **不重造任何轮子**——每一步都是既有命令；本命令只负责顺序、参数与记录。
 *   scaffold  从筛查通过者生成**策展草稿**：清单草案 + 工作流草案（字面保真条款默认内置）
 *             + 编辑核对单。草案带 `draft:true`——构建器**拒绝**直接构建草稿（卡 29 起）。
 *
 * ## 它不做什么
 *
 *   不替编辑写任务边界（那是策展层的判断）；不发起任何付费评测（门禁二三由主人在
 *   runbook 的评估阶段显式运行）；不绕过每阶段自己的验收——每步的产物就是它的验收。
 *
 * ## 账本
 *
 *   pipeline 阶段由 run-book 自理其账本（含逐文件子账本）；propose-clusters/合成/筛查
 *   在本命令进程内执行时需要预载：`node --require ./pipeline/tools/fs-ledger.cjs` +
 *   `DSH_FS_LEDGER=<path>`（与全仓口径一致，本命令不强加）。
 */

import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, sourceBookRoot } from './tools/anchor-index.mjs'
import { candidatesRelPath, crossChapterObjectsFile } from './tools/cluster-proposer.mjs'
import { collectCrossChapterAntipatterns, unwrapObjectsFile } from './tools/skill-builder.mjs'

export const EXIT = Object.freeze({ PASS: 0, RUN_FAILED: 4 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CLI = (name) => path.join(HERE, name)

function parseArgs(argv) {
  const args = argv.slice(2)
  const sub = args[0]
  const flags = {
    sub,
    dir: null,
    key: null,
    repoRoot: DEFAULT_REPO_ROOT,
    model: null,
    baseUrl: null,
    judgeModel: null,
    layer2: 'deepseek',
    synthesis: true,
    dryRun: false,
    json: false,
  }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--dir') (flags.dir = path.resolve(need(i, a))), (i += 1)
    else if (a === '--key') (flags.key = need(i, a)), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a === '--model') (flags.model = need(i, a)), (i += 1)
    else if (a === '--base-url') (flags.baseUrl = need(i, a)), (i += 1)
    else if (a === '--judge-model') (flags.judgeModel = need(i, a)), (i += 1)
    else if (a === '--layer2') (flags.layer2 = need(i, a)), (i += 1)
    else if (a === '--no-synthesis') flags.synthesis = false
    else if (a === '--dry-run') flags.dryRun = true
    else if (a === '--json') flags.json = true
    else throw new Error(`未知参数：${a}`)
  }
  return flags
}

const sha256 = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`

/* ──────────────────────────── onboard ──────────────────────────── */

async function walkMd(dir, base = dir) {
  const out = []
  const names = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
  for (const n of names) {
    const abs = path.join(dir, n.name)
    if (n.isDirectory()) out.push(...(await walkMd(abs, base)))
    else if (n.name.endsWith('.md')) out.push(path.relative(base, abs))
  }
  return out
}

export async function onboard(repoRoot, { dir, key }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key ?? '')) throw new Error(`--key 非法：${key}（小写字母/数字/连字符）`)
  const st = await stat(dir).catch(() => null)
  if (!st || !st.isDirectory()) throw new Error(`--dir 不存在或不是目录：${dir}`)
  const files = await walkMd(dir)
  if (files.length === 0) throw new Error(`目录里没有 .md 文件：${dir}`)

  const destRel = sourceBookRoot(key)
  const destAbs = path.join(repoRoot, destRel)
  const exists = await stat(destAbs).catch(() => null)
  if (exists) throw new Error(`目标已存在：${destRel}——拒绝覆盖（已入场过，或换 key）。`)

  await mkdir(destAbs, { recursive: true })
  const entries = []
  for (const rel of files) {
    const buf = await readFile(path.join(dir, rel))
    const out = path.join(destAbs, rel)
    await mkdir(path.dirname(out), { recursive: true })
    await writeFile(out, buf)
    entries.push({ file: rel, bytes: buf.length, sha256: sha256(buf) })
  }
  const manifest = [
    `# SOURCE-MANIFEST · ${key}`,
    '',
    `- 入场时间：${new Date().toISOString()}`,
    `- 来源目录：\`${dir}\``,
    `- 文件数：${entries.length}（.md，含子目录）`,
    '',
    '| 文件 | 字节 | sha256 |',
    '|---|---:|---|',
    ...entries.map((e) => `| \`${e.file}\` | ${e.bytes} | ${e.sha256} |`),
    '',
    '本清单供入场核验；行数与哈希可逐条复算（`sha256sum` 对照）。',
    '',
  ].join('\n')
  await writeFile(path.join(repoRoot, 'sources', key, 'SOURCE-MANIFEST.md'), manifest, 'utf8')
  return { key, dir: destRel, files: entries.length, manifest: `sources/${key}/SOURCE-MANIFEST.md` }
}

/* ──────────────────────────── pipeline ──────────────────────────── */

const runStep = (label, argv, { repoRoot, dryRun }) => {
  const printable = ['node', ...argv.map((a) => (a === repoRoot ? '<repo>' : a))].join(' ')
  if (dryRun) {
    process.stdout.write(`  [dry-run] ${label}: ${printable}\n`)
    return { label, dryRun: true, status: 0 }
  }
  process.stdout.write(`  ▸ ${label}\n`)
  const r = spawnSync(process.execPath, argv, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  return { label, status: r.status }
}

export async function runPipelineStage(repoRoot, flags) {
  const key = flags.key
  const steps = []

  // 环 1/2：run-book 自理账本与并发；模型参数走 llm-* 形态。
  steps.push({
    label: '环 1/2（锚点 + 对象 + 判定者）',
    argv: [
      CLI('run-book.mjs'),
      '--source-key', key,
      '--layer2', flags.layer2,
      ...(flags.model ? ['--llm-model', flags.model] : []),
      ...(flags.baseUrl ? ['--llm-base-url', flags.baseUrl] : []),
      ...(flags.judgeModel ? ['--judge-model', flags.judgeModel] : []),
      '--repo-root', repoRoot,
    ],
  })
  // 环 3
  steps.push({
    label: '环 3（章内聚类 + 候选）',
    argv: [CLI('propose-clusters.mjs'), '--source-key', key, ...(flags.model ? ['--model', flags.model] : []), ...(flags.baseUrl ? ['--base-url', flags.baseUrl] : []), '--repo-root', repoRoot],
  })
  // 跨章合成（可关）
  if (flags.synthesis) {
    steps.push({
      label: '主题提案',
      argv: [CLI('propose-themes.mjs'), '--source-key', key, ...(flags.model ? ['--model', flags.model] : []), ...(flags.baseUrl ? ['--base-url', flags.baseUrl] : []), '--repo-root', repoRoot],
    })
    steps.push({
      label: '跨章反模式合成',
      argv: [CLI('synthesize-antipatterns.mjs'), '--source-key', key, ...(flags.model ? ['--model', flags.model] : []), ...(flags.baseUrl ? ['--base-url', flags.baseUrl] : []), ...(flags.judgeModel ? ['--judge-model', flags.judgeModel] : []), '--repo-root', repoRoot],
    })
  }
  if (flags.dryRun) {
    process.stdout.write(`[dry-run] ${key} 的管线计划（未执行任何调用）：\n`)
    for (const s of steps) runStep(s.label, s.argv, { repoRoot, dryRun: true })
    return { steps: steps.map((s) => s.label), screening: null }
  }
  for (const s of steps) {
    const r = runStep(s.label, s.argv, { repoRoot, dryRun: false })
    if (r.status !== 0) throw new Error(`阶段失败（exit ${r.status}）：${s.label}——修因后续跑（各阶段自带 partial 复用，不重复付费）。`)
  }
  const screening = await screenCandidates(repoRoot, key)
  return { steps: steps.map((s) => s.label), screening }
}

/** 门禁一筛查：对全体候选逐份 dry-run 装配；零调用、纯读盘+渲染。 */
async function screenCandidates(repoRoot, key) {
  const candRaw = JSON.parse(await readFile(path.join(repoRoot, candidatesRelPath(key)), 'utf8'))
  const rows = []
  for (const c of candRaw.candidates ?? []) {
    const r = spawnSync(process.execPath, [CLI('build-skill.mjs'), '--cluster', c.skillId, '--source-key', key, '--dry-run', '--json', '--repo-root', repoRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
    let parsed = null
    try {
      parsed = JSON.parse(r.stdout)
    } catch {
      /* 解析失败按整体失败记录 */
    }
    rows.push({
      skillId: c.skillId,
      passed: parsed?.gate?.passed === true,
      reasonCodes: parsed?.gate?.reasonCodes ?? ['(无法解析构建输出)'],
      bytes: parsed?.gate?.bytes ?? null,
      objectsKept: parsed?.objectsKept ?? null,
      crossChapterKept: parsed?.crossChapterAntipatternsKept ?? null,
      failAt: [...new Set((parsed?.gate?.failures ?? []).map((f) => f.at ?? f.code))],
    })
  }
  const doc = {
    schemaVersion: 'screening/v1',
    createdAt: new Date().toISOString(),
    sourceKey: key,
    candidates: rows.length,
    passed: rows.filter((x) => x.passed).length,
    failed: rows.filter((x) => !x.passed).length,
    rows,
  }
  const out = path.join(repoRoot, 'pipeline', 'registry', `screening.${key}.json`)
  await writeFile(out, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  process.stdout.write(`门禁一筛查：${doc.passed}/${doc.candidates} 过 → ${path.relative(repoRoot, out)}\n`)
  for (const r of rows) {
    process.stdout.write(`  ${r.passed ? '✅' : '❌'} ${r.skillId.padEnd(46)} ${r.bytes ?? '?'}B ${r.passed ? '' : '| ' + r.failAt.join(' / ')}\n`)
  }
  return doc
}

/* ──────────────────────────── scaffold ──────────────────────────── */

/** 字面保真条款（卡 28 实证有效的修订件；草案默认内置，编辑保留即可）。 */
export const LITERAL_FIDELITY_STEP =
  '开工前抄录任务的字面要求清单（文件名、命名、签名、输出格式与指定片段），实现与说明以该清单为准；技能用于判断与结构，不用于改写任务指定的表面形式。'
const LITERAL_FIDELITY_CHECK = '任务给定的命名与输出格式逐字保留（与字面要求清单逐项核对）。'
const LITERAL_FIDELITY_BOUNDARY = '技能术语与任务字面冲突时，以任务字面为准。'

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/** 从对象池给草案取「何时使用」候选（来源数据的节选，不生成新事实）。 */
function triggerCandidatesOf(objects, max = 5) {
  const out = []
  for (const o of objects) {
    const t = oneLine(o.trigger ?? o.appliesWhen ?? '')
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

function draftStepsOf(objects, max = 4) {
  const steps = [LITERAL_FIDELITY_STEP]
  for (const o of objects) {
    if (o.objectType !== 'EngineeringRule') continue
    const s = oneLine(o.statement ?? '')
    if (s) steps.push(`【草稿建议（来源规则，请改写为可操作步骤）】${s}`)
    if (steps.length > max) break
  }
  return steps
}

export async function scaffold(repoRoot, key, { screening = null } = {}) {
  const curationDir = path.join(repoRoot, 'pipeline', 'curation', key)
  const existing = await stat(curationDir).catch(() => null)
  if (existing) throw new Error(`策展目录已存在：pipeline/curation/${key}——拒绝覆盖（人工策展可能在盘）。`)

  const doc = screening ?? JSON.parse(await readFile(path.join(repoRoot, 'pipeline', 'registry', `screening.${key}.json`), 'utf8'))
  const candRaw = JSON.parse(await readFile(path.join(repoRoot, candidatesRelPath(key)), 'utf8'))
  const passedIds = new Set(doc.rows.filter((r) => r.passed).map((r) => r.skillId))
  const picked = (candRaw.candidates ?? []).filter((c) => passedIds.has(c.skillId))

  // 跨章反模式池（若合成跑过）
  let apPool = []
  try {
    const poolRaw = JSON.parse(await readFile(path.join(repoRoot, 'pipeline', 'knowledge', crossChapterObjectsFile(key)), 'utf8'))
    apPool = unwrapObjectsFile(poolRaw, crossChapterObjectsFile(key))
  } catch {
    apPool = []
  }

  const draftsDir = path.join(curationDir, 'drafts')
  const workflowsDir = path.join(curationDir, 'workflows')
  await mkdir(draftsDir, { recursive: true })
  await mkdir(workflowsDir, { recursive: true })

  const members = []
  const checklistRows = []
  for (const c of picked) {
    const objectsPath = path.join(repoRoot, 'pipeline', 'knowledge', `${(c.chapterRefs ?? [])[0]}.objects.json`)
    const allObjects = unwrapObjectsFile(JSON.parse(await readFile(objectsPath, 'utf8')), objectsPath)
    const owned = allObjects.filter((o) => (c.sourceObjects ?? []).includes(o.id))
    const aps = apPool.length > 0 ? collectCrossChapterAntipatterns(apPool, c.anchors ?? []).map((a) => a.id) : []

    const draft = {
      schemaVersion: 'task-workflow/v1',
      draft: true,
      draftNote: 'run-new-book 生成的草稿——按 EDITORIAL-CHECKLIST.md 收敛后：去掉 draft 字段、移入 ../workflows/<slug>.json、更新清单 workflowFile，再构建。',
      slug: c.skillId,
      title: `【草稿】${c.name || c.skillId}`,
      description: `【草稿】围绕「${c.name || c.skillId}」的任务技能——请重写为任务式描述（做什么 + 何时用）。参考触发词：${oneLine(c.trigger) || '（未提取到）'}`,
      whenToUse: (triggerCandidatesOf(owned).length > 0 ? triggerCandidatesOf(owned) : ['【草稿】请补全触发场景']),
      inputs: ['【草稿】请补全执行前需要就绪的事实与材料'],
      steps: draftStepsOf(owned),
      outputs: ['【草稿】请补全可检查的交付物'],
      checks: [LITERAL_FIDELITY_CHECK, '【草稿】请补全验证条件'],
      stopConditions: ['【草稿】请补全停止条件（输入缺失、冲突未决等）'],
      rollback: { disposition: 'not-applicable', note: '【草稿】请确认并说明。' },
      boundaries: [LITERAL_FIDELITY_BOUNDARY, '【草稿】请补全与相邻技能的分工与不适用声明'],
    }
    await writeFile(path.join(draftsDir, `${c.skillId}.json`), `${JSON.stringify(draft, null, 2)}\n`, 'utf8')

    members.push({
      slug: c.skillId,
      sourceKey: key,
      legacySlugs: [],
      primaryObjects: c.sourceObjects ?? [],
      crossChapterObjects: aps,
      workflowFile: `pipeline/curation/${key}/workflows/${c.skillId}.json`,
      draftFile: `pipeline/curation/${key}/drafts/${c.skillId}.json`,
      promotionNote: '草稿成员：编辑完成并移入 workflows/ 后，删掉本字段与清单顶部的 draft 标记再构建。',
    })
    checklistRows.push({ slug: c.skillId, title: c.name || c.skillId, objects: owned.length, aps: aps.length })
  }

  const manifest = {
    schemaVersion: 'task-skill-suite/v1',
    draft: true,
    createdAt: new Date().toISOString(),
    note: `新书 ${key} 的策展草稿（run-new-book scaffold 生成）。编辑步骤见 EDITORIAL-CHECKLIST.md；清单与工作流的 draft 标记是构建器的硬拒绝条件（卡 29）。`,
    members,
    rejected: [],
  }
  await writeFile(path.join(curationDir, 'task-skill-suite.v1.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  const checklist = [
    `# 编辑核对单 · ${key}（策展草稿）`,
    '',
    `草案成员：**${members.length} 个**（门禁一筛查通过者）。逐份核对下列要点，改完把工作流从 \`drafts/\` 移入 \`workflows/\`。`,
    '',
    '## 每份工作流必须收敛的点',
    '',
    '1. **slug**：改成任务式动宾名（英文小写连字符，如 `diagnose-rust-borrows`）——改 slug 需同步清单 members 的 slug/workflowFile。',
    '2. **title/description**：任务式（做什么 + 何时用），去掉【草稿】标记。',
    '3. **执行步骤**：把【草稿建议（来源规则…）】改写成可操作动作（一步一个主要动作）；保留字面保真条款。',
    '4. **输入/交付物/检查/停止/回滚/边界**：补全【草稿】占位。',
    '5. **去掉 `draft: true` 与 `draftNote`**——构建器对草稿硬拒绝。',
    '6. 清单：members 的 `promotionNote` 删除；顶部 `draft: true` 删除；`workflowFile` 指向 `workflows/`。',
    '',
    '## 草案成员',
    '',
    '| slug | 标题 | 对象 | 跨章AP |',
    '|---|---|---:|---:|',
    ...checklistRows.map((r) => `| \`${r.slug}\` | ${r.title} | ${r.objects} | ${r.aps} |`),
    '',
    '## 收敛后的命令序列',
    '',
    '```bash',
    `node pipeline/build-task-suite.mjs --manifest pipeline/curation/${key}/task-skill-suite.v1.json --dry-run   # 先干跑`,
    `node pipeline/build-task-suite.mjs --manifest pipeline/curation/${key}/task-skill-suite.v1.json --publish   # 过门禁一才入区`,
    `node pipeline/run-gate2.mjs --suite --suite-key ${key} --suite-manifest pipeline/curation/${key}/task-skill-suite.v1.json --model <id> --base-url <url>   # 触发盲测（两读数 + --compare）`,
    `node pipeline/run-gate3.mjs --source-key ${key} --model <id> --base-url <url>   # 效用与有害性（复跑制）`,
    '```',
    '',
    '评估回合的判定处理（合并/下架/披露）照本仓既定规则执行——见 runbook 的阶段 7。',
    '',
  ].join('\n')
  await writeFile(path.join(curationDir, 'EDITORIAL-CHECKLIST.md'), checklist, 'utf8')

  return { key, members: members.length, curationDir: `pipeline/curation/${key}`, checklist: `pipeline/curation/${key}/EDITORIAL-CHECKLIST.md` }
}

/* ──────────────────────────── main ──────────────────────────── */

async function main(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${err.message}\n`)
    return EXIT.RUN_FAILED
  }
  const repoRoot = flags.repoRoot
  try {
    if (flags.sub === 'onboard') {
      const out = await onboard(repoRoot, { dir: flags.dir, key: flags.key })
      process.stdout.write(flags.json ? `${JSON.stringify(out, null, 2)}\n` : `入场完成：${out.files} 个 .md → ${out.dir}；清单 ${out.manifest}\n`)
      return EXIT.PASS
    }
    if (flags.sub === 'pipeline') {
      const out = await runPipelineStage(repoRoot, flags)
      if (flags.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
      return EXIT.PASS
    }
    if (flags.sub === 'scaffold') {
      const out = await scaffold(repoRoot, flags.key)
      process.stdout.write(flags.json ? `${JSON.stringify(out, null, 2)}\n` : `策展草稿就绪：${out.members} 个成员 → ${out.curationDir}/；先读 ${out.checklist}\n`)
      return EXIT.PASS
    }
    if (flags.sub === 'all') {
      const on = await onboard(repoRoot, { dir: flags.dir, key: flags.key })
      process.stdout.write(`入场完成：${on.files} 个 .md → ${on.dir}\n`)
      await runPipelineStage(repoRoot, flags)
      const sc = await scaffold(repoRoot, flags.key)
      process.stdout.write(`策展草稿就绪：${sc.members} 个成员 → ${sc.curationDir}/；先读 ${sc.checklist}\n`)
      return EXIT.PASS
    }
    process.stderr.write('用法：onboard | pipeline | scaffold | all（见文件头注释）\n')
    return EXIT.RUN_FAILED
  } catch (err) {
    process.stderr.write(`run-new-book 失败：${err?.message ?? err}\n`)
    return EXIT.RUN_FAILED
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}