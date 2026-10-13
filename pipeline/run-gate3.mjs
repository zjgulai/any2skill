#!/usr/bin/env node
/**
 * 门禁三 · 效用 A/B CLI（ticket 14，决策见 ADR-027）。
 *
 * 用法：
 *   node pipeline/run-gate3.mjs --dry-run [--skill <slug>]
 *   node pipeline/run-gate3.mjs --model <id> --base-url <url> [--skill <slug>] [--no-resume]
 *
 * ## 副作用清单
 *
 *   `--dry-run`   只读盘、只打印：被测 skill、计划调用数、已知问题。**不发调用、不写盘。**
 *   真实运行      任务生成与两臂执行逐条落 partial（`gate3-tasks.partial.json` /
 *                 `gate3-runs.partial.json`，均被 .gitignore 忽略），结尾写
 *                 `pipeline/knowledge/gate3-tasks.json` 与 `pipeline/registry/gate3-report.json`
 *                 （写前对已存在的旧报告按内容哈希归档）。
 *   `--skill <slug>` 单 skill 模式：**不写正式产物**，报告打到 stdout。
 *
 * ## 三条纪律
 *
 *   1. **无 skill 臂的上下文不得出现 SKILL.md 片段**——注入只发生在有 skill 臂；
 *   2. **评分只有一条路径**：声明式检查单求值（ADR-027 决策 2，不执行生成代码）；
 *   3. **未复跑不下结论**：退化事件先复跑，复现即拒（ADR-006）、不复现记噪声（ADR-022）。
 */

import path from 'node:path'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from './tools/anchor-index.mjs'
import { resolveLlmConfig, LlmConfigError, normalizeReasoningEffort } from './tools/llm-client.mjs'
import { parseFrontmatter } from './tools/verify-skill.mjs'
import {
  DEFAULT_GATE3_MAX_TOKENS,
  DEFAULT_TASKS_PER_SKILL,
  GATE3_REPORT_SCHEMA_VERSION,
  GATE3_TASKS_SCHEMA_VERSION,
  REPORT_REL_PATH,
  RUNS_PARTIAL_REL_PATH,
  TASKS_PARTIAL_REL_PATH,
  TASKS_REL_PATH,
  armInputHash,
  executionPromptFingerprint,
  generateTasksForSkill,
  readJsonOrNull,
  runTaskArm,
  taskGenInputHash,
  taskGenPromptFingerprint,
  verdictForSkill,
  writeJson,
} from './tools/gate3-utility-ab.mjs'
import { archiveIfExists } from './run-gate2.mjs'

export const EXIT = Object.freeze({
  PASS: 0,
  RUN_FAILED: 4,
})

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    dryRun: false,
    json: false,
    resume: true,
    repoRoot: DEFAULT_REPO_ROOT,
    model: null,
    baseUrl: null,
    provider: null,
    reasoningEffort: null,
    maxTokens: null,
    skill: null,
  }
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    if (a === '--dry-run') flags.dryRun = true
    else if (a === '--json') flags.json = true
    else if (a === '--no-resume') flags.resume = false
    else if (a === '--skill') (flags.skill = need(i, a)), (i += 1)
    else if (a === '--model') (flags.model = need(i, a)), (i += 1)
    else if (a === '--base-url') (flags.baseUrl = need(i, a)), (i += 1)
    else if (a === '--provider') (flags.provider = need(i, a)), (i += 1)
    else if (a === '--reasoning-effort') (flags.reasoningEffort = need(i, a)), (i += 1)
    else if (a === '--max-tokens') (flags.maxTokens = Number(need(i, a))), (i += 1)
    else if (a === '--repo-root') (flags.repoRoot = path.resolve(need(i, a))), (i += 1)
    else if (a.startsWith('--')) throw new Error(`未知参数：${a}`)
    else throw new Error(`未知位置参数：${a}（本命令不接受位置参数）`)
  }
  return flags
}

/**
 * 被测物 = **已发布物**：`skills/<slug>/SKILL.md` 原文 + 它构建时的契约（取风险标记）。
 * 缺契约的 skill 拒绝进入（没有风险标记与 provenance，判分口径无从校准）。
 */
export async function enumeratePublishedSkills(repoRoot, { only = null } = {}) {
  const skillsDir = path.join(repoRoot, 'skills')
  let names = []
  try {
    names = await readdir(skillsDir)
  } catch (err) {
    if (err.code === 'ENOENT') return []
    throw err
  }
  const out = []
  for (const slug of names.sort()) {
    if (only && slug !== only) continue
    const skillMdAbs = path.join(skillsDir, slug, 'SKILL.md')
    let markdown
    try {
      markdown = await readFile(skillMdAbs, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') continue
      throw err
    }
    const contractAbs = path.join(repoRoot, 'pipeline', 'registry', 'build', slug, 'skill-contract.json')
    const contract = await readJsonOrNull(contractAbs)
    if (!contract) {
      throw new Error(`已发布物 ${slug} 缺构建契约（${path.relative(repoRoot, contractAbs)}）——拒绝进入门禁三。`)
    }
    const fm = parseFrontmatter(markdown)
    if (!fm.ok) throw new Error(`已发布物 ${slug} 的 frontmatter 不可解析——先排查发布流程。`)
    out.push({
      slug,
      name: contract.name ?? slug,
      description: fm.fields.description,
      markdown,
      markdownSha256: `sha256:${createHash('sha256').update(markdown).digest('hex')}`,
      riskFlags: (contract.riskFlags ?? []).map((r) => r.flag),
    })
  }
  if (only && out.length === 0) {
    throw new Error(`skills/ 下没有已发布的 ${only}（现有：${names.join(', ') || '（无）'}）`)
  }
  return out
}

const addUsage = (acc, u) => {
  acc.promptTokens += u?.prompt_tokens ?? 0
  acc.completionTokens += u?.completion_tokens ?? 0
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
  const K = DEFAULT_TASKS_PER_SKILL

  try {
    const skills = await enumeratePublishedSkills(repoRoot, { only: flags.skill })

    const tasksAbs = path.join(repoRoot, TASKS_REL_PATH)
    const tasksPartialAbs = path.join(repoRoot, TASKS_PARTIAL_REL_PATH)
    const runsPartialAbs = path.join(repoRoot, RUNS_PARTIAL_REL_PATH)
    const reportAbs = path.join(repoRoot, REPORT_REL_PATH)

    const baseTasks = (await readJsonOrNull(tasksPartialAbs)) ?? (await readJsonOrNull(tasksAbs))
    const usableTasks = flags.resume && baseTasks?.promptFingerprint === taskGenPromptFingerprint() ? baseTasks : null
    const baseRuns = flags.resume ? await readJsonOrNull(runsPartialAbs) : null
    const usableRuns = baseRuns?.promptFingerprint === executionPromptFingerprint() ? baseRuns : null

    if (flags.dryRun) {
      const modelId = flags.model ?? null
      let planned = 0
      for (const s of skills) {
        const want = taskGenInputHash({ skillName: s.name, skillDescription: s.description, skillMarkdown: s.markdown, k: K, modelId })
        const hit = usableTasks?.skills?.find((x) => x.slug === s.slug && x.inputHash === want)
        if (!hit) planned += 1
        planned += 2 * K
      }
      const out = {
        dryRun: true,
        skills: skills.map((s) => ({ slug: s.slug, riskFlags: s.riskFlags, markdownBytes: Buffer.byteLength(s.markdown, "utf8") })),
        tasksPerSkill: K,
        plannedCalls: planned,
        note: '计划调用含潜在退化事件复跑（按 0 计）；有 skill 臂注入的 SKILL.md 为发布物原文。',
      }
      if (flags.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
      else {
        process.stdout.write(
          `[dry-run] 未调用模型、未写任何文件。\n` +
            skills.map((s) => `  ${s.slug}（${Buffer.byteLength(s.markdown, "utf8")} 字节；风险标记 ${s.riskFlags.join(',') || '无'}）\n`).join('') +
            `计划调用：约 ${planned} 次（任务生成缺额 + 两臂 × ${K} 任务/技能）\n`,
        )
      }
      return EXIT.PASS
    }

    let config
    try {
      config = await resolveLlmConfig({
        env: process.env,
        overrides: {
          ...(flags.model ? { modelId: flags.model } : {}),
          ...(flags.baseUrl ? { baseUrl: flags.baseUrl } : {}),
          ...(flags.provider ? { provider: flags.provider } : {}),
          ...(flags.reasoningEffort ? { reasoningEffort: normalizeReasoningEffort(flags.reasoningEffort) } : {}),
        },
      })
    } catch (err) {
      if (err instanceof LlmConfigError) {
        process.stderr.write(`[LLM 配置] ${err.message}\n`)
        return EXIT.RUN_FAILED
      }
      throw err
    }
    const modelId = config.modelId ?? null
    const maxTokens = Number.isFinite(flags.maxTokens) ? flags.maxTokens : DEFAULT_GATE3_MAX_TOKENS

    await archiveIfExists(repoRoot, reportAbs)
    await archiveIfExists(repoRoot, tasksAbs)

    const tasksDoc = usableTasks ?? {
      schemaVersion: GATE3_TASKS_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      promptFingerprint: taskGenPromptFingerprint(),
      model: { modelId },
      skills: [],
      usage: { promptTokens: 0, completionTokens: 0 },
    }
    tasksDoc.model = { modelId }
    if (!Array.isArray(tasksDoc.skills)) tasksDoc.skills = []
    if (!tasksDoc.usage) tasksDoc.usage = { promptTokens: 0, completionTokens: 0 }

    // ── 任务生成（逐 skill 复用/生成） ──
    for (const s of skills) {
      const wantHash = taskGenInputHash({ skillName: s.name, skillDescription: s.description, skillMarkdown: s.markdown, k: K, modelId })
      const existing = tasksDoc.skills.find((x) => x.slug === s.slug)
      if (existing?.inputHash === wantHash) {
        process.stdout.write(`  ${s.slug}：任务复用（0 次调用）\n`)
        continue
      }
      const gen = await generateTasksForSkill({
        config,
        skillName: s.name,
        skillDescription: s.description,
        skillMarkdown: s.markdown,
        k: K,
        maxTokens,
      })
      const record = {
        slug: s.slug,
        name: s.name,
        description: s.description,
        riskFlags: s.riskFlags,
        markdownSha256: s.markdownSha256,
        inputHash: gen.inputHash ?? wantHash,
        tasks: gen.tasks.map((t, i) => ({ taskId: `${s.slug}-t${i + 1}`, ...t })),
        problems: gen.problems,
        finishReason: gen.finishReason,
      }
      const at = tasksDoc.skills.findIndex((x) => x.slug === s.slug)
      if (at >= 0) tasksDoc.skills[at] = record
      else tasksDoc.skills.push(record)
      addUsage(tasksDoc.usage, gen.usage)
      await writeJson(tasksPartialAbs, tasksDoc)
      process.stdout.write(
        `  ${s.slug}：任务 ${record.tasks.length}/${K}${gen.problems.length ? `（问题 ${gen.problems.map((p) => p.code).join(',')}）` : ''}\n`,
      )
    }

    // ── 两臂执行（逐任务复用/调用；退化事件补复跑） ──
    const runsDoc = usableRuns ?? {
      schemaVersion: `${GATE3_REPORT_SCHEMA_VERSION}-runs`,
      promptFingerprint: executionPromptFingerprint(),
      runs: {},
      usage: { promptTokens: 0, completionTokens: 0 },
    }
    if (!runsDoc.runs) runsDoc.runs = {}
    if (!runsDoc.usage) runsDoc.usage = { promptTokens: 0, completionTokens: 0 }

    const ensureArm = async (skill, task, arm, suffix = '') => {
      const key = `${task.taskId}:${arm}${suffix}`
      const wantHash = armInputHash({ arm, task, skillMarkdown: skill.markdown, modelId })
      const existing = runsDoc.runs[key]
      if (existing?.inputHash === wantHash) return existing
      const run = await runTaskArm({
        config,
        arm,
        task,
        taskId: task.taskId,
        skillMarkdown: skill.markdown,
        maxTokens,
      })
      const record = {
        inputHash: run.inputHash ?? wantHash,
        passed: run.passed,
        checks: run.checks,
        filesWritten: run.filesWritten,
        invalidPaths: run.invalidPaths,
        finishReason: run.finishReason,
        usage: run.usage,
      }
      runsDoc.runs[key] = record
      addUsage(runsDoc.usage, run.usage)
      await writeJson(runsPartialAbs, runsDoc)
      return record
    }

    const perSkillResults = []
    for (const s of skills) {
      const rec = tasksDoc.skills.find((x) => x.slug === s.slug)
      const taskResults = []
      for (const task of rec.tasks) {
        const without = await ensureArm(s, task, 'without')
        const withArm = await ensureArm(s, task, 'with')
        const isDegradation = without.passed === true && withArm.passed === false
        let rerun = null
        if (isDegradation) {
          process.stdout.write(`    ↻ 退化事件，复跑确认：${task.taskId}\n`)
          const rw = await ensureArm(s, task, 'without', ':rerun')
          const rt = await ensureArm(s, task, 'with', ':rerun')
          rerun = { without: rw, with: rt }
        }
        taskResults.push({ taskId: task.taskId, without, with: withArm, rerun })
        process.stdout.write(
          `    ${task.taskId}：无skill ${without.passed ? '过' : '败'} / 有skill ${withArm.passed ? '过' : '败'}${isDegradation ? '（退化，已复跑）' : ''}\n`,
        )
      }
      const verdict = verdictForSkill({ skillId: s.slug, name: s.name, riskFlags: s.riskFlags, taskResults })
      perSkillResults.push({ skill: s, rec, taskResults, verdict })
    }

    // ── 报告 ──
    const report = {
      schemaVersion: GATE3_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      subset: flags.skill ?? null,
      model: { modelId },
      promptFingerprints: { taskGen: taskGenPromptFingerprint(), execution: executionPromptFingerprint() },
      tasksFile: rel(tasksAbs),
      note: '自包含任务测的是**方向上的效用差异**（有/无 skill），不是真实场景的绝对表现；判定规则见 ADR-027 决策 3。',
      skills: perSkillResults.map(({ skill, rec, taskResults, verdict }) => ({
        slug: skill.slug,
        name: skill.name,
        riskFlags: skill.riskFlags,
        markdownSha256: skill.markdownSha256,
        tasks: rec.tasks.map((t) => {
          const r = taskResults.find((x) => x.taskId === t.taskId)
          return {
            taskId: t.taskId,
            prompt: t.prompt,
            fixtures: t.fixtures,
            checks: t.checks,
            without: { passed: r.without.passed, checks: r.without.checks, invalidPaths: r.without.invalidPaths },
            with: { passed: r.with.passed, checks: r.with.checks, invalidPaths: r.with.invalidPaths },
            rerun: r.rerun ? { without: { passed: r.rerun.without.passed }, with: { passed: r.rerun.with.passed } } : null,
          }
        }),
        verdict,
      })),
      usage: { taskGeneration: tasksDoc.usage, execution: runsDoc.usage },
    }

    if (flags.skill) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      process.stdout.write('（--skill 单模式：未写正式产物。）\n')
      return EXIT.PASS
    }

    await writeJson(tasksAbs, tasksDoc)
    await writeJson(reportAbs, report)

    const summary = {
      report: rel(reportAbs),
      verdicts: report.skills.map((s) => ({ slug: s.slug, verdict: s.verdict.verdict, counts: s.verdict.counts })),
      usage: report.usage,
    }
    if (flags.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    else {
      process.stdout.write(`门禁三完成：${report.skills.length} 个已发布 skill 的效用 A/B\n`)
      for (const s of report.skills) {
        process.stdout.write(
          `  ${s.slug} → ${s.verdict.verdict}（改进 ${s.verdict.counts.improvements} / 确认退化 ${s.verdict.counts.confirmedDegradations} / 噪声 ${s.verdict.counts.noiseDegradations} / 无效任务 ${s.verdict.counts.invalidTasks}）\n` +
            `    ${s.verdict.reason}\n`,
        )
      }
      process.stdout.write(`报告：${rel(reportAbs)}\n`)
    }
    return EXIT.PASS
  } catch (err) {
    process.stderr.write(`门禁三失败：${err?.message ?? err}\n`)
    return EXIT.RUN_FAILED
  }
}

export { parseArgs }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
