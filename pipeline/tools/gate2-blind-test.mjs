/**
 * 门禁二 · 触发盲测（ticket 12，决策见 ADR-026）。
 *
 * 三段流水线，各自有独立的提示词与身份：
 *   1. **场景生成**（允许看到内容）：每候选 K 个应触发场景 + N 个无关场景，落盘 + 哈希进身份；
 *   2. **盲测**（只给题面）：场景 + 乱序代号化的 `name` + `description`，回答「哪些会被触发」；
 *   3. **判分与动作清单**：命中 / 零命中 / 争抢三类判定 + ADR-007 的修正动作清单。
 *
 * ## 三条不变量（机制，不是约定）
 *
 *   1. **盲测题面只允许包含白名单字段。** `buildBlindUserPrompt` 只读
 *      `{code, name, description}` 与场景文本——不读对象、不读 units、不读来源。
 *      测试里用哨兵字符串往这些字段外塞内容，题面一旦漏出即红。
 *   2. **代号不透出处**：题面里没有 `skillId`（`chapter4-s1` 本身就泄露来源），
 *      只有 `k01…`；映射表存在报告里（报告不是盲测者的输入）。
 *   3. **不设数字阈值**（承 ADR-021）：命中率/误触发率只报数字；动作清单按
 *      ADR-007 的语义（零命中、争抢、误触发）产出，不靠一个卡出来的百分比。
 *
 * 生成侧与盲测侧**同模型不同上下文**——独立性是上下文与信息的独立，ADR-026 如实记录，
 * 不作更强的声明。本模块不读 `benchmark/`（承 ADR-001）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { chatCompletion } from './llm-client.mjs'
import { extractJsonPayload } from './model-json.mjs'

export const GATE2_SCENARIOS_SCHEMA_VERSION = 'gate2-scenarios/v1'
export const GATE2_REPORT_SCHEMA_VERSION = 'gate2-report/v1'
export const SCENARIOS_REL_PATH = path.join('pipeline', 'knowledge', 'gate2-scenarios.json')
export const SCENARIOS_PARTIAL_REL_PATH = path.join('pipeline', 'knowledge', 'gate2-scenarios.partial.json')
export const ANSWERS_PARTIAL_REL_PATH = path.join('pipeline', 'registry', 'gate2-answers.partial.json')
export const REPORT_REL_PATH = path.join('pipeline', 'registry', 'gate2-report.json')

export const DEFAULT_HIT_SCENARIOS_PER_CANDIDATE = 3
export const DEFAULT_UNRELATED_SCENARIOS = 20
export const DEFAULT_GATE2_MAX_TOKENS = 16000
export const DEFAULT_GATE2_TEMPERATURE = 0

export class Gate2Error extends Error {
  constructor(message, { rawText = null } = {}) {
    super(message)
    this.name = 'Gate2Error'
    this.rawText = rawText
  }
}

/* ──────────────────────────── 提示词 · 场景生成 ──────────────────────────── */

export function buildScenarioGenSystemPrompt({ k }) {
  return [
    '你是「触发场景生成器」。输入是一个 Agent 技能的短名、触发说明与它的知识对象要点。',
    `你的任务：写出 ${k} 个**真实用户任务场景**——一个工程师在真实工作里会提出的请求，`,
    '它自然地应当由这个技能来回应。',
    '',
    '硬性要求：',
    '1. 场景是第一人称的工作请求（一两句话），具体、可执行；不要复述技能的标题或描述原句——',
    '   场景要像用户说的话，不像技能的简介。**不得出现该技能的短名。**',
    '2. 同一个技能的多个场景应覆盖它不同的使用角度，不要三个场景只说同一件事。',
    '3. 每个场景附一句 why：为什么它应由这个技能回应（不是别的技能）。',
    '4. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"scenarios": [{"text": "<场景>", "why": "<为什么它应触发该技能>"}]}',
  ].join('\n')
}

export function buildScenarioGenUserPrompt({ candidate, objectRows }) {
  const lines = objectRows.map((r) => `- [${r.objectType}] ${r.summary}`)
  return [
    `技能短名：${candidate.name}`,
    `触发说明：${candidate.trigger || '（无）'}`,
    `技能描述（发布产物会携带的那一份）：${candidate.description}`,
    '',
    '知识对象要点（该技能实际包含的内容）：',
    ...lines,
  ].join('\n')
}

export function buildUnrelatedGenSystemPrompt({ n }) {
  return [
    '你是「无关场景生成器」。输入是一批 Agent 技能的短名与描述。',
    `你的任务：写出 ${n} 个**看似合理、但不该触发其中任何一个**的用户任务场景。`,
    '',
    '硬性要求：',
    '1. 场景是第一人称的工作请求（一两句话），要真的像用户会说的话——不是对这些技能主题的否定',
    '   （「不设计工具」不是无关场景），而是**落在它们主题之外**的别的任务。',
    '2. 场景之间彼此不同，也别集中在同一个邻域（如“全都与前端有关”）。',
    '3. 每个场景附一句 why：为什么它不该触发清单里的任何技能。',
    '4. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"scenarios": [{"text": "<场景>", "why": "<为什么它不该触发任何技能>"}]}',
  ].join('\n')
}

export function buildUnrelatedGenUserPrompt({ catalog }) {
  return [
    '现有技能清单（短名 —— 描述）：',
    ...catalog.map((c) => `- ${c.name} —— ${c.description}`),
  ].join('\n')
}

/* ──────────────────────────── 提示词 · 盲测 ──────────────────────────── */

/**
 * 盲测系统提示词。`max` 为 `null` = 第一读数（列全部适用者）；
 * `max = 2` = **严格口径第二读数**（至多 1–2 个最匹配者）——它是 ADR-026 未决 2
 * 的敏感性校准仪器，不是判据变更：两份读数并存，对照之后才谈「哪种口径是对的」。
 */
export function buildBlindSystemPrompt({ max = null } = {}) {
  const lines = [
    '你是「技能触发器」。你只会看到：一个用户场景，以及若干技能的短名与描述。',
    '你的任务：判断这个场景会触发下列**哪些**技能——可能一个都不触发。',
    '',
    '硬性要求：',
    '1. 只依据场景本身的意图与技能描述里的触发条件判断；**宁缺毋滥**：',
    '   只有描述真的覆盖这个场景时才列入。',
  ]
  if (max === null) {
    lines.push('2. 输出场景会触发的**全部**技能（可能不止一个），或空列表。')
  } else {
    lines.push(
      `2. **至多列 ${max} 个**——只列与该场景**最匹配**的，不要把所有沾边的都列上。`,
      '   若没有明确匹配的，空列表。',
    )
  }
  lines.push(
    '3. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"triggered": ["<技能代号>", "…"]}   // 空列表写作 []',
  )
  return lines.join('\n')
}

/**
 * 盲测题面。**这是盲测隔离的实现**：函数只读白名单字段 `{code, name, description}`，
 * 任何对象内容、units、来源都不可能经由这里进入题面。
 */
export function buildBlindUserPrompt({ scenarioText, catalog, max = null }) {
  return [
    `用户场景：${scenarioText}`,
    '',
    '候选技能（代号 —— 短名 —— 描述）：',
    ...catalog.map((c) => `- ${c.code} —— ${c.name} —— ${c.description}`),
    '',
    max === null
      ? '这个场景会触发下列哪些技能？给出代号列表（可以为空）。'
      : `这个场景最匹配下列哪${max === 1 ? '一' : ` 1–${max} `}个技能？给出代号列表（可以为空，至多 ${max} 个）。`,
  ].join('\n')
}

/** 盲测提示词指纹（与全仓同构：提示词是实现的一部分；两种口径各有各的指纹）。 */
export function blindPromptFingerprint({ max = null } = {}) {
  const sample = buildBlindUserPrompt({
    scenarioText: '<scenario>',
    catalog: [{ code: 'k01', name: '<name>', description: '<description>' }],
    max,
  })
  const digest = createHash('sha256').update(`${buildBlindSystemPrompt({ max })}\n\u0000\n${sample}`).digest('hex').slice(0, 12)
  return `prompt-${digest}`
}

export function scenarioGenPromptFingerprint() {
  const digest = createHash('sha256')
    .update(
      `${buildScenarioGenSystemPrompt({ k: DEFAULT_HIT_SCENARIOS_PER_CANDIDATE })}\n\u0000\n` +
        `${buildScenarioGenUserPrompt({ candidate: { name: '<n>', trigger: '<t>', description: '<d>' }, objectRows: [] })}\n\u0000\n` +
        `${buildUnrelatedGenSystemPrompt({ n: DEFAULT_UNRELATED_SCENARIOS })}\n\u0000\n` +
        `${buildUnrelatedGenUserPrompt({ catalog: [{ name: '<n>', description: '<d>' }] })}`,
    )
    .digest('hex')
    .slice(0, 12)
  return `prompt-${digest}`
}

/* ──────────────────────────── 解析与校验 ──────────────────────────── */

function parseJsonOrThrow(text, what) {
  const raw = String(text ?? '')
  const result = extractJsonPayload(raw)
  if (result.ok) return result.value
  throw new Gate2Error(`${what}响应不是可解析的 JSON：${result.diagnostic}`, { rawText: raw })
}

/** 场景生成的解析与校验：数量不足、空文本、名称泄漏——逐条记录，不静默。 */
export function validateScenarioGen(parsed, { expected, forbiddenName = null }) {
  const list = Array.isArray(parsed?.scenarios) ? parsed.scenarios : null
  if (list === null) {
    throw new Gate2Error(
      `场景响应里没有 scenarios 数组（顶层键：${
        parsed && typeof parsed === 'object' ? Object.keys(parsed).join(', ') || '无' : typeof parsed
      }）`,
    )
  }
  const scenarios = []
  const problems = []
  list.forEach((raw, i) => {
    const text = typeof raw?.text === 'string' ? raw.text.trim() : ''
    const why = typeof raw?.why === 'string' ? raw.why.trim() : ''
    if (text === '') {
      problems.push({ index: i, code: 'EMPTY_TEXT' })
      return
    }
    const leak = forbiddenName !== null && forbiddenName !== '' && text.includes(forbiddenName)
    if (leak) problems.push({ index: i, code: 'NAME_LEAK', text })
    scenarios.push({ text, why, containsNameLeak: leak })
  })
  if (scenarios.length < expected) {
    problems.push({ code: 'COUNT_BELOW_EXPECTED', expected, actual: scenarios.length })
  }
  return { scenarios, problems }
}

/** 盲测回答的解析：代号解析到映射表；未知代号与超限逐条记录（不静默丢）。 */
export function validateBlindAnswer(parsed, { codeToSkillId, max = null }) {
  const list = Array.isArray(parsed?.triggered) ? parsed.triggered : null
  if (list === null) {
    throw new Gate2Error(
      `盲测回答里没有 triggered 数组（顶层键：${
        parsed && typeof parsed === 'object' ? Object.keys(parsed).join(', ') || '无' : typeof parsed
      }）`,
    )
  }
  const skillIds = []
  const unknownCodes = []
  const seen = new Set()
  for (const c of list) {
    if (typeof c !== 'string' || c === '' || seen.has(c)) continue
    seen.add(c)
    const hit = codeToSkillId.get(c)
    if (!hit) {
      unknownCodes.push(c)
      continue
    }
    skillIds.push(hit)
  }
  // 超限**不截断**（截断会替模型改答案），如实带上标志由判分层处理。
  const overMax = max !== null && skillIds.length > max ? skillIds.length : null
  return { skillIds, unknownCodes, overMax }
}

/* ──────────────────────────── 乱序与代号 ──────────────────────────── */

/** xorshift32：由种子给出确定性乱序（复算要用同一顺序，不引入 Math.random 这类不可复算源）。 */
function seededShuffle(list, seedHex) {
  let s = parseInt(seedHex.slice(0, 8), 16) || 1
  const next = () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s
  }
  const out = [...list]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * 为盲测构造「代号 → 候选」的映射：乱序由场景集的哈希做种子（可复算），
 * 代号按乱序后的位置编号——`k01` 与 skillId 没有任何可推断关系。
 */
export function buildBlindCatalog(candidates, { seed }) {
  const shuffled = seededShuffle(candidates, seed)
  return shuffled.map((c, i) => ({
    code: `k${String(i + 1).padStart(2, '0')}`,
    skillId: c.skillId,
    name: c.name,
    description: c.description,
  }))
}

/* ──────────────────────────── 判分与动作清单 ──────────────────────────── */

/**
 * 由「场景集 + 回答」构造门禁二报告。
 *
 * 三类判定（ADR-026 决策 2），优先级：先零命中、后争抢、其余通过；
 * 两个次级标志（被别的候选抢答自己的场景、在无关场景里被触发）无论主判是什么都记录。
 * **动作清单按 ADR-007 的修正表产出，本模块不执行任何修改。**
 */
export function buildGate2Report({ candidates, catalog, scenarioSet, answers }) {
  const codeOf = new Map(catalog.map((c) => [c.skillId, c.code]))
  const nameOf = new Map(candidates.map((c) => [c.skillId, c.name]))
  const perCandidate = []
  const conflictGroups = []
  const unrelatedDetails = []

  for (const cand of candidates) {
    const record = scenarioSet.candidates.find((c) => c.skillId === cand.skillId)
    const rows = []
    for (const sc of record?.scenarios ?? []) {
      const ans = answers[sc.scenarioId] ?? { skillIds: [], unknownCodes: [] }
      rows.push({
        scenarioId: sc.scenarioId,
        text: sc.text,
        triggered: ans.skillIds,
        unknownCodes: ans.unknownCodes,
        hit: ans.skillIds.includes(cand.skillId),
      })
    }
    const hits = rows.filter((r) => r.hit).length
    const claimedByOthers = rows.filter((r) => r.triggered.length >= 1 && !r.hit)
    const falseClaims = [] // 别的候选在**自己的**场景里被同时选中
    for (const sc of rows) {
      const others = sc.triggered.filter((id) => id !== cand.skillId)
      if (others.length > 0) falseClaims.push({ scenarioId: sc.scenarioId, others })
      if (sc.triggered.length >= 2) {
        conflictGroups.push({ scenarioId: sc.scenarioId, intended: cand.skillId, triggered: sc.triggered })
      }
    }
    // 该候选是否出现在**别人**的场景里
    const claimsOthers = []
    for (const other of scenarioSet.candidates) {
      if (other.skillId === cand.skillId) continue
      for (const sc of other.scenarios ?? []) {
        if ((answers[sc.scenarioId]?.skillIds ?? []).includes(cand.skillId)) {
          claimsOthers.push({ scenarioId: sc.scenarioId, intended: other.skillId })
        }
      }
    }

    const miss = rows.length > 0 && hits === 0
    const conflict = falseClaims.length > 0 || claimsOthers.length > 0
    const promotionState = miss ? 'trigger-miss' : conflict ? 'trigger-conflict' : 'trigger-passed'
    perCandidate.push({
      skillId: cand.skillId,
      name: cand.name,
      code: codeOf.get(cand.skillId),
      scenarioCount: rows.length,
      hits,
      hitRate: rows.length === 0 ? null : Number((hits / rows.length).toFixed(4)),
      promotionState,
      scenarios: rows,
      miss: rows.length > 0 && hits === 0,
      missedScenariosClaimedBy: claimedByOthers.map((r) => ({ scenarioId: r.scenarioId, triggered: r.triggered })),
      coClaimedScenarios: falseClaims,
      claimsOtherScenarios: claimsOthers,
    })
  }

  for (const sc of scenarioSet.unrelated ?? []) {
    const ans = answers[sc.scenarioId] ?? { skillIds: [], unknownCodes: [] }
    unrelatedDetails.push({
      scenarioId: sc.scenarioId,
      text: sc.text,
      triggered: ans.skillIds,
      unknownCodes: ans.unknownCodes,
      falseTrigger: ans.skillIds.length > 0,
    })
  }

  // ── ADR-007 的动作清单（本模块只产出清单，不执行） ──
  const actions = []
  const mergeGroups = new Map()
  for (const g of conflictGroups) {
    const key = [...g.triggered].sort().join('+')
    if (!mergeGroups.has(key)) mergeGroups.set(key, { candidates: g.triggered, scenarios: [] })
    mergeGroups.get(key).scenarios.push(g.scenarioId)
  }
  for (const [, group] of mergeGroups) {
    actions.push({
      kind: 'merge',
      candidates: group.candidates,
      names: group.candidates.map((id) => nameOf.get(id) ?? id),
      basis: `同一场景（${group.scenarios.join(', ')}）被 ≥2 个候选同时认领——ADR-007：粒度太碎，退回环 3 合并`,
      scenarios: group.scenarios,
    })
  }
  for (const c of perCandidate) {
    if (c.miss) {
      actions.push({
        kind: 'merge-or-demote',
        candidates: [c.skillId],
        names: [c.name],
        basis:
          c.missedScenariosClaimedBy.length > 0
            ? `零命中：它的全部应触发场景未被自己接住，反而被 ${[...new Set(c.missedScenariosClaimedBy.flatMap((m) => m.triggered))].join(', ')} 认领——ADR-007：并入邻近 skill 或降级为 references/`
            : '零命中：全部应触发场景无人认领——ADR-007：并入邻近 skill 或降级为 references/',
        scenarios: c.scenarios.map((s) => s.scenarioId),
      })
    }
  }
  const falseTriggered = new Map()
  for (const u of unrelatedDetails) {
    for (const id of u.triggered) {
      if (!falseTriggered.has(id)) falseTriggered.set(id, [])
      falseTriggered.get(id).push(u.scenarioId)
    }
  }
  for (const [id, scenarios] of falseTriggered) {
    actions.push({
      kind: 'route-to-risk-sampling',
      candidates: [id],
      names: [nameOf.get(id) ?? id],
      basis: `无关场景误触发 ${scenarios.length} 次——ADR-006：记入高风险抽样清单（门禁三重点覆盖）`,
      scenarios,
    })
  }

  const totals = {
    candidates: candidates.length,
    scenarios: perCandidate.reduce((s, c) => s + c.scenarioCount, 0),
    unrelatedScenarios: unrelatedDetails.length,
    triggerPassed: perCandidate.filter((c) => c.promotionState === 'trigger-passed').length,
    triggerConflict: perCandidate.filter((c) => c.promotionState === 'trigger-conflict').length,
    triggerMiss: perCandidate.filter((c) => c.promotionState === 'trigger-miss').length,
    unrelatedFalseTriggers: unrelatedDetails.filter((u) => u.falseTrigger).length,
    conflictGroups: conflictGroups.length,
  }

  return { perCandidate, unrelated: unrelatedDetails, conflictGroups, actions, totals }
}

/* ──────────────────────────── 运行 ──────────────────────────── */

/** 单候选的场景生成（一次调用）。身份 = 该候选真正要发出的两条提示词 + 模型。 */
export async function generateScenariosForCandidate({
  config,
  candidate,
  objectRows,
  k = DEFAULT_HIT_SCENARIOS_PER_CANDIDATE,
  chat,
  fetchImpl,
  ledger,
  maxTokens = DEFAULT_GATE2_MAX_TOKENS,
  temperature = DEFAULT_GATE2_TEMPERATURE,
}) {
  const chatFn = chat ?? chatCompletion
  const system = buildScenarioGenSystemPrompt({ k })
  const user = buildScenarioGenUserPrompt({ candidate, objectRows })
  const res = await chatFn(config, { system, user, maxTokens, temperature, fetchImpl, ledger })
  const parsed = parseJsonOrThrow(res.text, '场景生成')
  const { scenarios, problems } = validateScenarioGen(parsed, { expected: k, forbiddenName: candidate.name })
  return {
    scenarios,
    problems,
    usage: res.usage ?? null,
    finishReason: res.finishReason ?? null,
    inputHash: scenarioGenInputHash({ candidate, objectRows, k, modelId: config?.modelId }),
  }
}

export async function generateUnrelatedScenarios({
  config,
  catalog,
  n = DEFAULT_UNRELATED_SCENARIOS,
  chat,
  fetchImpl,
  ledger,
  maxTokens = DEFAULT_GATE2_MAX_TOKENS,
  temperature = DEFAULT_GATE2_TEMPERATURE,
}) {
  const chatFn = chat ?? chatCompletion
  const system = buildUnrelatedGenSystemPrompt({ n })
  const user = buildUnrelatedGenUserPrompt({ catalog: catalog.map((c) => ({ name: c.name, description: c.description })) })
  const res = await chatFn(config, { system, user, maxTokens, temperature, fetchImpl, ledger })
  const parsed = parseJsonOrThrow(res.text, '无关场景生成')
  const { scenarios, problems } = validateScenarioGen(parsed, { expected: n, forbiddenName: null })
  return {
    scenarios,
    problems,
    usage: res.usage ?? null,
    finishReason: res.finishReason ?? null,
    inputHash: unrelatedGenInputHash({ catalog, n, modelId: config?.modelId }),
  }
}

/** 单场景盲测（一次调用）。返回的 skillIds 已由代号解析回真实 id。 */
export async function runBlindScenario({
  config,
  scenarioId,
  scenarioText,
  catalog,
  codeToSkillId,
  chat,
  fetchImpl,
  ledger,
  max = null,
  maxTokens = 4000,
  temperature = DEFAULT_GATE2_TEMPERATURE,
}) {
  const chatFn = chat ?? chatCompletion
  const system = buildBlindSystemPrompt({ max })
  const user = buildBlindUserPrompt({ scenarioText, catalog, max })
  const res = await chatFn(config, { system, user, maxTokens, temperature, fetchImpl, ledger })
  const parsed = parseJsonOrThrow(res.text, '盲测')
  const { skillIds, unknownCodes, overMax } = validateBlindAnswer(parsed, { codeToSkillId, max })
  return {
    scenarioId,
    skillIds,
    unknownCodes,
    overMax,
    usage: res.usage ?? null,
    finishReason: res.finishReason ?? null,
    inputHash: blindInputHash({ scenarioText, catalog, modelId: config?.modelId, max }),
  }
}

function hashOf(parts) {
  return `sha256:${createHash('sha256').update(parts.join('\n\u0000\n')).digest('hex')}`
}

/**
 * 三个身份辅助（复用键的**单一真源**）：都直接哈希「真正要发出的两条提示词 + 模型 id」。
 * 调用方在**调用之前**先算键决定是否复用——键相同 ⟺ 输入相同，不存在需要论证的等价性。
 */
export function scenarioGenInputHash({ candidate, objectRows, k = DEFAULT_HIT_SCENARIOS_PER_CANDIDATE, modelId }) {
  return hashOf([
    buildScenarioGenSystemPrompt({ k }),
    buildScenarioGenUserPrompt({ candidate, objectRows }),
    `model:${modelId ?? 'default'}`,
  ])
}

export function unrelatedGenInputHash({ catalog, n = DEFAULT_UNRELATED_SCENARIOS, modelId }) {
  return hashOf([
    buildUnrelatedGenSystemPrompt({ n }),
    buildUnrelatedGenUserPrompt({ catalog: catalog.map((c) => ({ name: c.name, description: c.description })) }),
    `model:${modelId ?? 'default'}`,
  ])
}

export function blindInputHash({ scenarioText, catalog, modelId, max = null }) {
  return hashOf([
    buildBlindSystemPrompt({ max }),
    buildBlindUserPrompt({ scenarioText, catalog, max }),
    `model:${modelId ?? 'default'}`,
  ])
}

/** 盲测口径：`list` = 第一读数（列全部适用者）；`strict` = 严格口径第二读数（至多 2 个最匹配者）。 */
export const BLIND_MODES = Object.freeze({
  list: { max: null },
  strict: { max: 2 },
})

/** 口径对应的 partial/报告路径（两份读数并存，不互相覆盖）。 */
export function answersPartialRelPath(mode) {
  return mode === 'list'
    ? ANSWERS_PARTIAL_REL_PATH
    : path.join('pipeline', 'registry', `gate2-answers.${mode}.partial.json`)
}
export function reportRelPath(mode) {
  return mode === 'list' ? REPORT_REL_PATH : path.join('pipeline', 'registry', `gate2-report.${mode}.json`)
}

/** 候选目录（盲测用）的整体哈希：描述或名称改变 → 身份变。 */
export function catalogHash(candidates) {
  return hashOf([...candidates].map((c) => `${c.skillId}\t${c.name}\t${c.description}`).sort())
}

/* ──────────────────────────── 落盘 ──────────────────────────── */

export async function readJsonOrNull(absPath) {
  try {
    return JSON.parse(await readFile(absPath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export async function writeJson(absPath, doc) {
  await mkdir(path.dirname(absPath), { recursive: true })
  await writeFile(absPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
  return absPath
}

