#!/usr/bin/env node
/**
 * 门禁二 · 触发盲测 CLI（ticket 12，决策见 ADR-026）。
 *
 * 用法：
 *   node pipeline/run-gate2.mjs --dry-run [--skill <skillId>]
 *   node pipeline/run-gate2.mjs --model <id> --base-url <url> [--no-resume] [--skill <skillId>]
 *
 * ## 副作用清单（本文件写什么，跑之前先说清）
 *
 *   `--dry-run`   只读盘、只打印：候选数、描述规模、两段提示词的字符数、计划调用数。
 *                 **不发调用、不写任何文件。**
 *   真实运行      场景生成（每候选 1 次 + 无关场景 1 次）与盲测（每场景 1 次）逐条落
 *                 partial（`pipeline/knowledge/gate2-scenarios.partial.json`、
 *                 `pipeline/registry/gate2-answers.partial.json`，均被 .gitignore 忽略），
 *                 结尾写两份正式产物：`pipeline/knowledge/gate2-scenarios.json` 与
 *                 `pipeline/registry/gate2-report.json`。
 *   `--skill <id>` 单候选调试：只跑该候选，**不写正式产物**，结果打到 stdout。
 *
 * ## 三条纪律（都拒绝静默近似）
 *
 *   1. **盲测者只看到白名单题面**（场景 + 乱序代号 + name + description）——
 *      题面由 `gate2-blind-test.mjs` 的 `buildBlindUserPrompt` 构造，正文/对象/来源不可能经由它进入；
 *   2. **被测对象 = 发布对象**：候选的对象集走环 4 同一条加载与门禁过滤路径
 *      （`loadAssemblyInputs` + `clusterFromCandidate` + 回执通过集），描述由装配器生成；
 *   3. **动作清单不等于执行**：报告按 ADR-007 产出「该合并/该降级/该进高风险抽样」的清单，
 *      本命令**不修改任何划分或候选**。
 */

import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, DEFAULT_SOURCE_KEY } from './tools/anchor-index.mjs'
import { resolveLlmConfig, LlmConfigError, normalizeReasoningEffort } from './tools/llm-client.mjs'
import { assembleSkill } from './tools/skill-builder.mjs'
import { parseFrontmatter } from './tools/verify-skill.mjs'
import { summaryOfObject } from './tools/cluster-proposer.mjs'
import { loadClusterAssemblyInputs, loadClusterCandidate } from './build-skill.mjs'
import {
  BLIND_MODES,
  DEFAULT_GATE2_MAX_TOKENS,
  DEFAULT_HIT_SCENARIOS_PER_CANDIDATE,
  DEFAULT_UNRELATED_SCENARIOS,
  GATE2_REPORT_SCHEMA_VERSION,
  GATE2_SCENARIOS_SCHEMA_VERSION,
  SCENARIOS_PARTIAL_REL_PATH,
  SCENARIOS_REL_PATH,
  blindInputHash,
  blindPromptFingerprint,
  buildBlindCatalog,
  buildGate2Report,
  catalogHash,
  compareReadings,
  generateScenariosForCandidate,
  generateUnrelatedScenarios,
  readJsonOrNull,
  runBlindScenario,
  scenarioGenInputHash,
  scenarioGenPromptFingerprint,
  unrelatedGenInputHash,
  writeJson,
  answersPartialRelPath,
  reportRelPath,
} from './tools/gate2-blind-test.mjs'

export const EXIT = Object.freeze({
  PASS: 0,
  RUN_FAILED: 4,
})

const CANDIDATES_REL = path.join('pipeline', 'registry', 'skill-candidates.json')

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
    blindMode: 'list',
    compare: false,
    sourceKey: DEFAULT_SOURCE_KEY,
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
    else if (a === '--compare') flags.compare = true
    else if (a === '--source-key') (flags.sourceKey = need(i, a)), (i += 1)
    else if (a === '--blind-mode') {
      const v = need(i, a)
      if (!Object.hasOwn(BLIND_MODES, v)) {
        throw new Error(`--blind-mode 只支持 ${Object.keys(BLIND_MODES).join(' | ')}，实得：${v}`)
      }
      flags.blindMode = v
      i += 1
    }
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
 * 候选 → 盲测素材：描述由装配器同一代码路径生成（ADR-026 决策 5），
 * 对象集走环 4 的门禁过滤（未过门禁的对象不得进入被测物）。
 */
export async function loadCandidatesForBlindTest(repoRoot, { only = null, sourceKey = DEFAULT_SOURCE_KEY } = {}) {
  const rel = (p) => path.relative(repoRoot, p)
  let doc
  try {
    doc = JSON.parse(await readFile(path.join(repoRoot, CANDIDATES_REL), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`${CANDIDATES_REL} 不存在——先跑 pipeline/propose-clusters.mjs（环 3）。`)
    }
    throw err
  }
  const all = Array.isArray(doc.candidates) ? doc.candidates : []
  const picked = only ? all.filter((c) => c.skillId === only) : all
  if (only && picked.length === 0) {
    throw new Error(`候选不存在：${only}（现有 ${all.length} 个：${all.map((c) => c.skillId).slice(0, 6).join(', ')}…）`)
  }

  const candidates = []
  const missingReceipts = []
  for (const c of picked) {
    // 与环 4 走**同一条加载路径**（ticket 13 抽出）：多章候选由 chapterRefs 自动展开，
    // 单章候选是它的长度为 1 的特例——不存在「盲测看一份、装配看另一份」的可能。
    const clusterDef = await loadClusterCandidate(repoRoot, c.skillId)
    let prep
    try {
      prep = await loadClusterAssemblyInputs(repoRoot, clusterDef, { sourceKey })
    } catch (err) {
      missingReceipts.push({ skillId: c.skillId, message: err.message })
      continue
    }
    const assembled = assembleSkill({
      cluster: prep.cluster,
      objects: prep.kept,
      antipatterns: [],
      codePointers: [],
      slug: c.skillId,
      skillTitle: c.name || c.skillId,
      skillId: c.skillId,
    })
    const fm = parseFrontmatter(assembled.markdown)
    if (!fm.ok) throw new Error(`候选 ${c.skillId} 的装配产物 frontmatter 不可解析——先跑 build-skill 排查。`)
    candidates.push({
      skillId: c.skillId,
      name: c.name || c.skillId,
      trigger: c.trigger || '',
      description: fm.fields.description,
      chapterRefs: clusterDef.chapterRefs,
      objectRows: prep.kept.map((o) => ({ objectType: o.objectType, summary: summaryOfObject(o) })),
    })
  }
  return { candidates, missingReceipts, candidatesTotal: all.length }
}

const usageOf = (u) => ({ promptTokens: u?.prompt_tokens ?? 0, completionTokens: u?.completion_tokens ?? 0 })
const addUsage = (acc, u) => {
  const x = usageOf(u)
  acc.promptTokens += x.promptTokens
  acc.completionTokens += x.completionTokens
}

const scenarioSetSha = (scenariosDoc) =>
  `sha256:${createHash('sha256').update(JSON.stringify({ candidates: scenariosDoc.candidates, unrelated: scenariosDoc.unrelated })).digest('hex')}`

/**
 * 报告与答案账本**不静默覆盖**：真实运行开始前，已存在的旧文件按内容哈希归档进
 * `registry/history/`（与 run-book 的 archiveIfExists 同一条纪律）。
 * 重切后的第三读数会覆盖第二读数的报告——这一刻的覆盖必须是「有据可查的替换」，
 * 不是「后来者悄悄顶掉前者」。dry-run 与 --skill 子集模式不触发（它们本就不写正式产物）。
 */
export async function archiveIfExists(repoRoot, absPath) {
  let raw
  try {
    raw = await readFile(absPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
  const historyDir = path.join(repoRoot, 'pipeline', 'registry', 'history')
  await mkdir(historyDir, { recursive: true })
  const sha = createHash('sha256').update(raw).digest('hex').slice(0, 8)
  const dest = path.join(historyDir, `${path.basename(absPath, '.json')}.${sha}.json`)
  await writeFile(dest, raw, 'utf8')
  return dest
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
  const K = DEFAULT_HIT_SCENARIOS_PER_CANDIDATE
  const N = DEFAULT_UNRELATED_SCENARIOS
  const blindMode = flags.blindMode
  const blindMax = BLIND_MODES[blindMode].max

  try {
    // ── 对照模式（ticket 13）：两读数 → 稳定对/仅宽松/仅严格三分，落盘 gate2-stable.json ──
    if (flags.compare) {
      const listAbs = path.join(repoRoot, reportRelPath('list'))
      const strictAbs = path.join(repoRoot, reportRelPath('strict'))
      const listReport = await readJsonOrNull(listAbs)
      const strictReport = await readJsonOrNull(strictAbs)
      if (!listReport || !strictReport) {
        throw new Error(`--compare 需要两份读数都在盘：${rel(listAbs)} 与 ${rel(strictAbs)}（先各跑一轮）。`)
      }
      const cmp = compareReadings(listReport, strictReport)
      const stableAbs = await writeJson(path.join(repoRoot, 'pipeline', 'registry', 'gate2-stable.json'), {
        schemaVersion: 'gate2-stable/v1',
        createdAt: new Date().toISOString(),
        sources: { list: rel(listAbs), strict: rel(strictAbs) },
        ...cmp,
      })
      if (flags.json) process.stdout.write(`${JSON.stringify({ stable: rel(stableAbs), counts: cmp.counts }, null, 2)}\n`)
      else {
        process.stdout.write(
          `两读数对照：稳定对 ${cmp.counts.stable} / 仅宽松 ${cmp.counts.listOnly} / 仅严格 ${cmp.counts.strictOnly}\n` +
            `产物：${rel(stableAbs)}\n`,
        )
      }
      return EXIT.PASS
    }

    const { candidates, missingReceipts } = await loadCandidatesForBlindTest(repoRoot, { only: flags.skill, sourceKey: flags.sourceKey })
    if (missingReceipts.length > 0) {
      process.stderr.write(
        '拒绝开工：以下候选所在源文件缺门禁一回执（被测对象无法确定为「发布出去的那批」）——\n' +
          missingReceipts.map((m) => `  · ${m.skillId}：${m.message}`).join('\n') +
          '\n先跑 run.mjs 补齐回执；此处提前拒绝，避免为注定重做的盲测白付调用。\n',
      )
      return EXIT.RUN_FAILED
    }

    // ── 复用底座：正式产物与 partial 同形状，后者优先（它是更新的那次运行） ──
    const scenariosAbs = path.join(repoRoot, SCENARIOS_REL_PATH)
    const scenariosPartialAbs = path.join(repoRoot, SCENARIOS_PARTIAL_REL_PATH)
    const answersPartialAbs = path.join(repoRoot, answersPartialRelPath(blindMode))
    const baseScenarios = (await readJsonOrNull(scenariosPartialAbs)) ?? (await readJsonOrNull(scenariosAbs))
    const usableBase = flags.resume && baseScenarios?.promptFingerprint === scenarioGenPromptFingerprint() ? baseScenarios : null
    const baseAnswers = flags.resume ? await readJsonOrNull(answersPartialAbs) : null
    const answersUsable = baseAnswers?.promptFingerprint === blindPromptFingerprint({ max: blindMax }) ? baseAnswers : null

    // ── dry-run：只报规模 ──
    if (flags.dryRun) {
      const modelId = flags.model ?? null
      let genChars = 0
      let genCalls = 1 // 无关场景一次
      for (const c of candidates) {
        const wantHash = scenarioGenInputHash({ candidate: { name: c.name, trigger: c.trigger, description: c.description }, objectRows: c.objectRows, k: K, modelId })
        const hit = usableBase?.candidates?.find((x) => x.skillId === c.skillId && x.inputHash === wantHash)
        if (!hit) genCalls += 1
        genChars += c.description.length + c.objectRows.reduce((s, r) => s + r.summary.length + 12, 0)
      }
      const out = {
        dryRun: true,
        candidates: candidates.length,
        blindMode,
        hitScenariosPerCandidate: K,
        unrelatedScenarios: N,
        plannedGenerationCalls: genCalls,
        plannedBlindCalls: candidates.length * K + N,
        approxGenerationInputChars: genChars,
        note: '盲测题面 = 场景 + 候选目录（name+description 逐行）；每次调用的目录前缀相同，走服务端提示缓存。',
      }
      if (flags.json) process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
      else {
        process.stdout.write(
          `[dry-run] 未调用模型、未写任何文件。\n` +
            `候选 ${out.candidates} 个；每候选 ${K} 个应触发场景 + ${N} 个无关场景。\n` +
            `计划调用：场景生成 ${out.plannedGenerationCalls} 次 + 盲测 ${out.plannedBlindCalls} 次 = ${out.plannedGenerationCalls + out.plannedBlindCalls} 次\n` +
            `生成侧输入合计约 ${out.approxGenerationInputChars} 字符（另加各提示词固定部分）\n`,
        )
      }
      return EXIT.PASS
    }

    // ── 路由解析（先解析再花钱） ──
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
    const maxTokens = Number.isFinite(flags.maxTokens) ? flags.maxTokens : DEFAULT_GATE2_MAX_TOKENS

    // 不静默覆盖：本轮会重写的三份正式产物，先把旧版按内容哈希归档进 registry/history/。
    await archiveIfExists(repoRoot, scenariosAbs)
    await archiveIfExists(repoRoot, path.join(repoRoot, reportRelPath(blindMode)))
    await archiveIfExists(repoRoot, answersPartialAbs)

    const scenariosDoc = usableBase ?? {
      schemaVersion: GATE2_SCENARIOS_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      promptFingerprint: scenarioGenPromptFingerprint(),
      model: { modelId },
      candidates: [],
      unrelated: null,
      usage: { promptTokens: 0, completionTokens: 0 },
    }
    if (!Array.isArray(scenariosDoc.candidates)) scenariosDoc.candidates = []
    if (!scenariosDoc.usage) scenariosDoc.usage = { promptTokens: 0, completionTokens: 0 }
    scenariosDoc.model = { modelId }

    // ── 场景生成（逐候选复用/生成） ──
    for (const c of candidates) {
      const candidateForGen = { name: c.name, trigger: c.trigger, description: c.description }
      const wantHash = scenarioGenInputHash({ candidate: candidateForGen, objectRows: c.objectRows, k: K, modelId })
      const existing = scenariosDoc.candidates.find((x) => x.skillId === c.skillId)
      if (existing?.inputHash === wantHash) {
        process.stdout.write(`  ${c.skillId}：场景复用（输入身份一致，0 次调用）\n`)
        continue
      }
      const gen = await generateScenariosForCandidate({
        config,
        candidate: candidateForGen,
        objectRows: c.objectRows,
        k: K,
        maxTokens,
      })
      const withIds = {
        skillId: c.skillId,
        name: c.name,
        inputHash: gen.inputHash ?? wantHash,
        scenarios: gen.scenarios.map((s, i) => ({ scenarioId: `${c.skillId}-sc${i + 1}`, ...s })),
        problems: gen.problems,
        finishReason: gen.finishReason,
      }
      const at = scenariosDoc.candidates.findIndex((x) => x.skillId === c.skillId)
      if (at >= 0) scenariosDoc.candidates[at] = withIds
      else scenariosDoc.candidates.push(withIds)
      addUsage(scenariosDoc.usage, gen.usage)
      await writeJson(scenariosPartialAbs, scenariosDoc)
      process.stdout.write(
        `  ${c.skillId}：场景 ${withIds.scenarios.length}/${K}${gen.problems.length ? `（问题 ${gen.problems.map((p) => p.code).join(',')}）` : ''}\n`,
      )
    }

    const wantUnrelatedHash = unrelatedGenInputHash({ catalog: candidates, n: N, modelId })
    if (scenariosDoc.unrelated?.inputHash === wantUnrelatedHash) {
      process.stdout.write(`  无关场景：复用（0 次调用）\n`)
    } else {
      const gen = await generateUnrelatedScenarios({ config, catalog: candidates, n: N, maxTokens })
      scenariosDoc.unrelated = {
        inputHash: gen.inputHash ?? wantUnrelatedHash,
        scenarios: gen.scenarios.map((s, i) => ({ scenarioId: `unrelated-sc${i + 1}`, ...s })),
        problems: gen.problems,
        finishReason: gen.finishReason,
      }
      addUsage(scenariosDoc.usage, gen.usage)
      await writeJson(scenariosPartialAbs, scenariosDoc)
      process.stdout.write(`  无关场景：${scenariosDoc.unrelated.scenarios.length}/${N}\n`)
    }

    // ── 盲测目录：乱序 + 代号，种子取自场景集哈希（可复算） ──
    const seed = scenarioSetSha(scenariosDoc).slice('sha256:'.length)
    const mapping = buildBlindCatalog(candidates, { seed })
    const codeToSkillId = new Map(mapping.map((m) => [m.code, m.skillId]))
    const promptCatalog = mapping.map(({ code, name, description }) => ({ code, name, description }))

    // ── 盲测（逐场景复用/调用） ──
    const answers = answersUsable ?? {
      schemaVersion: `${GATE2_REPORT_SCHEMA_VERSION}-answers`,
      promptFingerprint: blindPromptFingerprint({ max: blindMax }),
      scenarios: {},
      usage: { promptTokens: 0, completionTokens: 0 },
    }
    if (!answers.scenarios) answers.scenarios = {}
    if (!answers.usage) answers.usage = { promptTokens: 0, completionTokens: 0 }
    // 重切（或其他原因）移除的候选：其场景集在库里保留作历史，但**不得进入本轮**——
    // 一个没有对应候选的「应触发场景」会让判分出现无主的 intended。
    const currentIds = new Set(candidates.map((c) => c.skillId))
    const liveScenarioChapters = scenariosDoc.candidates.filter((c) => currentIds.has(c.skillId))
    const allScenarios = [
      ...liveScenarioChapters.flatMap((c) => (c.scenarios ?? []).map((s) => ({ ...s, kind: 'candidate' }))),
      ...(scenariosDoc.unrelated?.scenarios ?? []).map((s) => ({ ...s, kind: 'unrelated' })),
    ]
    let blindCalls = 0
    for (const sc of allScenarios) {
      const wantHash = blindInputHash({ scenarioText: sc.text, catalog: promptCatalog, modelId, max: blindMax })
      const existing = answers.scenarios[sc.scenarioId]
      if (existing?.inputHash === wantHash) continue
      const res = await runBlindScenario({
        config,
        scenarioId: sc.scenarioId,
        scenarioText: sc.text,
        catalog: promptCatalog,
        codeToSkillId,
        max: blindMax,
        maxTokens,
      })
      answers.scenarios[sc.scenarioId] = {
        inputHash: res.inputHash ?? wantHash,
        skillIds: res.skillIds,
        unknownCodes: res.unknownCodes,
        overMax: res.overMax,
        finishReason: res.finishReason,
      }
      addUsage(answers.usage, res.usage)
      blindCalls += 1
      await writeJson(answersPartialAbs, answers)
      if (blindCalls % 20 === 0) process.stdout.write(`  …盲测进行中（已调用 ${blindCalls} 次）\n`)
    }
    process.stdout.write(`盲测完成：本轮调用 ${blindCalls} 次（复用 ${allScenarios.length - blindCalls} 场景）\n`)

    // ── 报告 ──
    const scenarioSet = {
      candidates: liveScenarioChapters.map((c) => ({ skillId: c.skillId, scenarios: c.scenarios })),
      unrelated: scenariosDoc.unrelated?.scenarios ?? [],
    }
    const answersMap = Object.fromEntries(
      Object.entries(answers.scenarios).map(([id, a]) => [id, { skillIds: a.skillIds, unknownCodes: a.unknownCodes }]),
    )
    const scored = buildGate2Report({
      candidates: candidates.map((c) => ({ skillId: c.skillId, name: c.name })),
      catalog: mapping,
      scenarioSet,
      answers: answersMap,
    })
    const report = {
      schemaVersion: GATE2_REPORT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      subset: flags.skill ?? null,
      model: { modelId },
      blindMode,
      promptFingerprints: { scenarioGen: scenarioGenPromptFingerprint(), blind: blindPromptFingerprint({ max: blindMax }) },
      scenarioSetFile: rel(scenariosAbs),
      scenarioSetSha256: scenarioSetSha(scenariosDoc),
      catalogSha256: catalogHash(candidates),
      codeMapping: mapping.map(({ code, skillId }) => ({ code, skillId })),
      usage: {
        generation: scenariosDoc.usage,
        blind: answers.usage,
      },
      ...scored,
    }

    if (flags.skill) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
      process.stdout.write('（--skill 单候选模式：未写正式产物。）\n')
      return EXIT.PASS
    }

    await writeJson(scenariosAbs, scenariosDoc)
    const reportAbs = await writeJson(path.join(repoRoot, reportRelPath(blindMode)), report)

    const t = report.totals
    const summary = {
      report: rel(reportAbs),
      scenarios: rel(scenariosAbs),
      totals: t,
      actions: report.actions.map((a) => ({ kind: a.kind, candidates: a.candidates })),
      usage: report.usage,
    }
    if (flags.json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
    else {
      process.stdout.write(
        `门禁二完成：${t.candidates} 个候选 × ${K} 场景 + ${t.unrelatedScenarios} 个无关场景\n` +
          `判定：通过 ${t.triggerPassed} / 争抢 ${t.triggerConflict} / 零命中 ${t.triggerMiss}；` +
          `无关场景误触发 ${t.unrelatedFalseTriggers}/${t.unrelatedScenarios}\n` +
          `报告：${rel(reportAbs)}\n` +
          `动作清单（ADR-007；本命令不执行）：\n`,
      )
      for (const a of report.actions) {
        process.stdout.write(`  [${a.kind}] ${a.names.join(' + ')}——${a.basis}\n`)
      }
    }
    return EXIT.PASS
  } catch (err) {
    process.stderr.write(`门禁二失败：${err?.message ?? err}\n`)
    return EXIT.RUN_FAILED
  }
}

export { parseArgs }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
