/**
 * 门禁三 · 效用 A/B（ticket 14，决策见 ADR-027）。
 *
 * 同一批**自包含可验证任务**，分别在「无该 skill」与「有该 skill」两种条件下执行；
 * 评分是**声明式检查单**（ADR-027 决策 2：不执行模型生成的代码），
 * 判定是配对比较 + 退化事件复跑制（决策 3，噪声底纪律落到机制上）。
 *
 * ## 三段流水线
 *
 *   1. **任务生成**（可见 skill 内容）：每 skill K 个任务 = `task.md` + 夹具 + `checker.json`；
 *   2. **两臂执行**：消费者产出 `{"files": {路径: 内容}}`，台架物化进临时沙箱后跑检查单；
 *   3. **判定**：配对表 → 退化事件（无 skill 过 ∧ 有 skill 败）→ 复跑 → 复现即拒，
 *      不复现记噪声；两臂都败记「任务无效」。
 *
 * ## 隔离与安全的实现边界
 *
 *   - **无 skill 臂的上下文不得出现 SKILL.md 任何片段**——注入只发生在有 skill 臂，
 *     且由 `buildExecutionSystemPrompt({arm, skillMarkdown})` 一个函数控制（有反证测试）；
 *   - **产物路径是白名单形状**（相对路径、无 `..`、无绝对路径）——越界路径不写盘、
 *     逐条记录，不让一次模型输出写到沙箱之外；
 *   - 检查单只认五种声明式类型；正则编译失败按该条失败处理，不炸整轮。
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { DEFAULT_SOURCE_KEY } from './anchor-index.mjs'
import { chatCompletion } from './llm-client.mjs'
import { extractJsonPayload } from './model-json.mjs'

export const GATE3_TASKS_SCHEMA_VERSION = 'gate3-tasks/v1'
export const GATE3_REPORT_SCHEMA_VERSION = 'gate3-report/v1'
export const TASKS_REL_PATH = path.join('pipeline', 'knowledge', 'gate3-tasks.json')
export const TASKS_PARTIAL_REL_PATH = path.join('pipeline', 'knowledge', 'gate3-tasks.partial.json')
export const RUNS_PARTIAL_REL_PATH = path.join('pipeline', 'registry', 'gate3-runs.partial.json')
export const REPORT_REL_PATH = path.join('pipeline', 'registry', 'gate3-report.json')

// 按源命名空间（卡 20）：缺省键逐字节不变；其他源加 `.<key>` 后缀。partial 必须仍以
// `.partial.json` 结尾（.gitignore 的 `*.partial.json` 靠它生效）。
export const tasksRelPath = (sourceKey = DEFAULT_SOURCE_KEY) =>
  sourceKey === DEFAULT_SOURCE_KEY ? TASKS_REL_PATH : path.join('pipeline', 'knowledge', `gate3-tasks.${sourceKey}.json`)
export const tasksPartialRelPath = (sourceKey = DEFAULT_SOURCE_KEY) =>
  sourceKey === DEFAULT_SOURCE_KEY
    ? TASKS_PARTIAL_REL_PATH
    : path.join('pipeline', 'knowledge', `gate3-tasks.${sourceKey}.partial.json`)
export const runsPartialRelPath = (sourceKey = DEFAULT_SOURCE_KEY) =>
  sourceKey === DEFAULT_SOURCE_KEY
    ? RUNS_PARTIAL_REL_PATH
    : path.join('pipeline', 'registry', `gate3-runs.${sourceKey}.partial.json`)
export const reportRelPath = (sourceKey = DEFAULT_SOURCE_KEY) =>
  sourceKey === DEFAULT_SOURCE_KEY
    ? REPORT_REL_PATH
    : path.join('pipeline', 'registry', `gate3-report.${sourceKey}.json`)

export const DEFAULT_TASKS_PER_SKILL = 6
/**
 * 输出上限（含推理 token）。取 32000（与主题提案同档）而不是 16000：
 * 2026-10-13 实测 `chapter5-s3-t4` 的推理吃掉 15,999/16,000、正文一个字没出
 * （`finish_reason=length`）——有 skill 臂的题面带着完整 SKILL.md，推理量显著更大。
 * 截断的失败形态会被如实报成「响应被 max_tokens 截断」（llm-client 的既有检测），
 * 但为它付一次整轮中断的代价不值。上限本身逐任务可被 --max-tokens 覆盖。
 */
export const DEFAULT_GATE3_MAX_TOKENS = 32000
export const DEFAULT_GATE3_TEMPERATURE = 0

export const CHECK_TYPES = Object.freeze(['file_exists', 'contains', 'not_contains', 'regex', 'json_field'])

export class Gate3Error extends Error {
  constructor(message, { rawText = null } = {}) {
    super(message)
    this.name = 'Gate3Error'
    this.rawText = rawText
  }
}

/* ──────────────────────────── 提示词 ──────────────────────────── */

export function buildTaskGenSystemPrompt({ k }) {
  return [
    '你是「效用测试任务设计器」。输入是一个 Agent 技能（名称、描述、正文全文）。',
    `你的任务：设计 ${k} 个**自包含、可验证**的任务——每个任务是一个用户在真实工作里会提出的请求，`,
    '它应当由这个技能来回答；任务必须能在一个**空目录**里完成，交付物是文件。',
    '',
    '硬性要求：',
    '1. 每个任务的 prompt 用用户口吻（一两句可执行请求），**不得出现技能短名**，',
    `   不得引用网络、外部服务或未提供的依赖；产物是纯文本/代码/JSON 等可写文件。`,
    '2. 每个任务给 `fixtures`（可选，预置在工作目录里的文件）与 `checks`（声明式检查单）。',
    `   checks 的 type 只允许：${CHECK_TYPES.join(' / ')}，语义：`,
    '   file_exists{path}；contains{path,patterns[]}（全部出现即过）；',
    '   not_contains{path,patterns[]}（一个都不出现即过）；regex{path,pattern}（能匹配即过）；',
    '   json_field{path,pointer,equals}（JSON 指针取值深等于 equals 即过）。',
    '3. 检查单必须**真的能分辨对错**：只检查请求里明确要求的、可判定的内容；',
    '   不要检查文风、字数这类主观项；不要写出必然通过或必然失败的检查。',
    '4. 任务之间彼此不同（覆盖该技能的不同使用角度）。',
    '5. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"tasks": [',
    '     {"prompt": "<用户口吻的任务>", "fixtures": {"<相对路径>": "<内容>"},',
    '      "checks": [{"type": "contains", "path": "out.md", "patterns": ["…"]}]}',
    '   ]}',
  ].join('\n')
}

export function buildTaskGenUserPrompt({ skillName, skillDescription, skillMarkdown }) {
  return [
    `技能短名：${skillName}`,
    `技能描述：${skillDescription}`,
    '',
    '技能正文（SKILL.md 原文）：',
    '```markdown',
    skillMarkdown.trim(),
    '```',
  ].join('\n')
}

/**
 * 执行臂的 system 提示词。**唯一**的注入点：`arm === 'with'` 时把 SKILL.md 原文
 * 追加进上下文；`without` 臂拿到的字符串里不可能出现正文的任何一个片段。
 */
export function buildExecutionSystemPrompt({ arm, skillMarkdown = null }) {
  const base = [
    '你是执行任务的 Agent。你只能通过输出一个 JSON 对象来交付工作：',
    '{"files": {"<相对路径>": "<文件内容>", …}}——台架会把这些文件写进工作目录。',
    '硬性要求：',
    '1. 路径必须是相对路径，不得包含 `..`、不得以 `/` 开头。',
    '2. 只输出这一个 JSON 对象，不要解释文字，不要 markdown 代码围栏。',
  ]
  if (arm === 'with') {
    base.push(
      '',
      '以下是可参考的技能文档（与你当前任务可能相关，也可能不相关；是否采用由你判断）：',
      '—— 技能文档开始 ——',
      String(skillMarkdown ?? '').trim(),
      '—— 技能文档结束 ——',
    )
  }
  return base.join('\n')
}

export function buildExecutionUserPrompt({ task }) {
  const fixtureLines = Object.entries(task.fixtures ?? {}).map(
    ([p, content]) => `--- ${p}\n${String(content)}`,
  )
  return [
    `任务：${task.prompt}`,
    '',
    fixtureLines.length > 0 ? '工作目录里已有以下文件：' : '工作目录为空。',
    ...fixtureLines,
    '',
    '请输出交付文件的 JSON。',
  ].join('\n')
}

export function taskGenPromptFingerprint() {
  const digest = createHash('sha256')
    .update(
      `${buildTaskGenSystemPrompt({ k: DEFAULT_TASKS_PER_SKILL })}\n\u0000\n` +
        `${buildTaskGenUserPrompt({ skillName: '<n>', skillDescription: '<d>', skillMarkdown: '<m>' })}`,
    )
    .digest('hex')
    .slice(0, 12)
  return `prompt-${digest}`
}

export function executionPromptFingerprint() {
  const digest = createHash('sha256')
    .update(
      `${buildExecutionSystemPrompt({ arm: 'without' })}\n\u0000\n${buildExecutionSystemPrompt({ arm: 'with', skillMarkdown: '<m>' })}\n\u0000\n` +
        `${buildExecutionUserPrompt({ task: { prompt: '<p>', fixtures: {} } })}`,
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
  throw new Gate3Error(`${what}响应不是可解析的 JSON：${result.diagnostic}`, { rawText: raw })
}

/** 产物路径白名单：相对、无 `..`、无绝对路径、无空段。越界不写盘、逐条记录。 */
export function isSafeRelPath(p) {
  if (typeof p !== 'string' || p === '' || p.length > 200) return false
  if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return false
  if (p.split(/[\\/]/).some((seg) => seg === '..' || seg === '')) return false
  return /^[A-Za-z0-9._\-一-鿿/\\]+$/.test(p)
}

/** 任务集校核：数量不足、空 prompt、非法检查类型、越界夹具路径——逐条记录，不静默。 */
export function validateTaskSet(parsed, { expected, forbiddenName = null }) {
  const list = Array.isArray(parsed?.tasks) ? parsed.tasks : null
  if (list === null) {
    throw new Gate3Error(
      `任务响应里没有 tasks 数组（顶层键：${
        parsed && typeof parsed === 'object' ? Object.keys(parsed).join(', ') || '无' : typeof parsed
      }）`,
    )
  }
  const tasks = []
  const problems = []
  list.forEach((raw, i) => {
    const prompt = typeof raw?.prompt === 'string' ? raw.prompt.trim() : ''
    if (prompt === '') {
      problems.push({ index: i, code: 'EMPTY_PROMPT' })
      return
    }
    if (forbiddenName !== null && forbiddenName !== '' && prompt.includes(forbiddenName)) {
      problems.push({ index: i, code: 'NAME_LEAK', prompt })
    }
    const fixtures = {}
    for (const [p, content] of Object.entries(raw?.fixtures ?? {})) {
      if (!isSafeRelPath(p)) {
        problems.push({ index: i, code: 'UNSAFE_FIXTURE_PATH', path: p })
        continue
      }
      fixtures[p] = String(content)
    }
    const checks = []
    for (const c of Array.isArray(raw?.checks) ? raw.checks : []) {
      if (!CHECK_TYPES.includes(c?.type)) {
        problems.push({ index: i, code: 'UNKNOWN_CHECK_TYPE', type: c?.type ?? null })
        continue
      }
      if (typeof c.path !== 'string' || !isSafeRelPath(c.path)) {
        problems.push({ index: i, code: 'UNSAFE_CHECK_PATH', path: c?.path ?? null })
        continue
      }
      checks.push(c)
    }
    if (checks.length === 0) problems.push({ index: i, code: 'NO_CHECKS' })
    tasks.push({ prompt, fixtures, checks, containsNameLeak: problems.some((p) => p.index === i && p.code === 'NAME_LEAK') })
  })
  if (tasks.length < expected) problems.push({ code: 'COUNT_BELOW_EXPECTED', expected, actual: tasks.length })
  return { tasks, problems }
}

/** 执行臂产物的校核：`{"files": {路径: 字符串}}`；不安全路径进 invalidPaths、不写盘。 */
export function validateExecutionOutput(parsed) {
  const files = parsed?.files
  if (files === null || typeof files !== 'object' || Array.isArray(files)) {
    throw new Gate3Error(
      `执行产物里没有 files 对象（顶层键：${
        parsed && typeof parsed === 'object' ? Object.keys(parsed).join(', ') || '无' : typeof parsed
      }）`,
    )
  }
  const safe = {}
  const invalidPaths = []
  for (const [p, content] of Object.entries(files)) {
    if (!isSafeRelPath(p) || typeof content !== 'string') {
      invalidPaths.push(p)
      continue
    }
    safe[p] = content
  }
  return { files: safe, invalidPaths }
}

/* ──────────────────────────── 检查单求值（声明式，不执行生成代码） ──────────────────────────── */

/** JSON 指针（`/a/b/0`）解析；取不到返回 undefined。 */
function resolvePointer(root, pointer) {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined
  let cur = root
  for (const seg of pointer.slice(1).split('/')) {
    const key = seg.replace(/~1/g, '/').replace(/~0/g, '~')
    if (cur === null || typeof cur !== 'object') return undefined
    cur = cur[key]
  }
  return cur
}

const readTextIfExists = (abs) => {
  try {
    if (!existsSync(abs) || !statSync(abs).isFile()) return null
    return readFileSync(abs, 'utf8')
  } catch {
    return null
  }
}

/**
 * 求值检查单：逐条判、逐条记；**任何一条内的异常（如正则编译失败）只判该条失败**，
 * 不炸整轮——一个坏检查不该让两臂的比较失去其余数据点。
 *
 * @returns {{passed:boolean, results:object[]}}
 */
export function evaluateChecker(checker, sandboxDir) {
  const src = checker?.checks
  if (!Array.isArray(src) || src.length === 0) {
    return { passed: false, results: [{ type: '(none)', ok: false, detail: '检查单为空' }] }
  }
  const results = []
  for (const c of src) {
    const abs = path.join(sandboxDir, c.path)
    let ok = false
    let detail = ''
    try {
      switch (c.type) {
        case 'file_exists':
          ok = existsSync(abs) && statSync(abs).isFile()
          detail = ok ? '' : `文件不存在：${c.path}`
          break
        case 'contains': {
          const text = readTextIfExists(abs)
          ok = text !== null && (c.patterns ?? []).every((p) => text.includes(String(p)))
          detail = text === null ? `文件不存在：${c.path}` : ok ? '' : `缺少片段：${(c.patterns ?? []).filter((p) => !text.includes(String(p))).join(' | ')}`
          break
        }
        case 'not_contains': {
          const text = readTextIfExists(abs)
          ok = text !== null && (c.patterns ?? []).every((p) => !text.includes(String(p)))
          detail = text === null ? `文件不存在：${c.path}` : ok ? '' : `出现了禁止片段：${(c.patterns ?? []).filter((p) => text.includes(String(p))).join(' | ')}`
          break
        }
        case 'regex': {
          const text = readTextIfExists(abs)
          const re = new RegExp(String(c.pattern))
          ok = text !== null && re.test(text)
          detail = text === null ? `文件不存在：${c.path}` : ok ? '' : `未匹配：${c.pattern}`
          break
        }
        case 'json_field': {
          const text = readTextIfExists(abs)
          let value
          try {
            value = text === null ? undefined : resolvePointer(JSON.parse(text), c.pointer)
          } catch {
            value = undefined
          }
          ok = JSON.stringify(value) === JSON.stringify(c.equals)
          detail = ok ? '' : `${c.pointer} 实际为 ${JSON.stringify(value)}，期望 ${JSON.stringify(c.equals)}`
          break
        }
        default:
          detail = `未知检查类型：${c.type}`
      }
    } catch (err) {
      ok = false
      detail = `检查自身出错（按该条失败处理）：${err?.message ?? err}`
    }
    results.push({ type: c.type, path: c.path, ok, detail })
  }
  return { passed: results.every((r) => r.ok), results }
}

/* ──────────────────────────── 运行 ──────────────────────────── */

const hashOf = (parts) => `sha256:${createHash('sha256').update(parts.join('\n\u0000\n')).digest('hex')}`

export function taskGenInputHash({ skillName, skillDescription, skillMarkdown, k = DEFAULT_TASKS_PER_SKILL, modelId }) {
  return hashOf([
    buildTaskGenSystemPrompt({ k }),
    buildTaskGenUserPrompt({ skillName, skillDescription, skillMarkdown }),
    `model:${modelId ?? 'default'}`,
  ])
}

export function armInputHash({ arm, task, skillMarkdown = null, modelId }) {
  return hashOf([
    buildExecutionSystemPrompt({ arm, skillMarkdown: arm === 'with' ? skillMarkdown : null }),
    buildExecutionUserPrompt({ task }),
    `model:${modelId ?? 'default'}`,
  ])
}

/** 任务生成（一次调用）。 */
export async function generateTasksForSkill({
  config,
  skillName,
  skillDescription,
  skillMarkdown,
  k = DEFAULT_TASKS_PER_SKILL,
  chat,
  fetchImpl,
  ledger,
  maxTokens = DEFAULT_GATE3_MAX_TOKENS,
  temperature = DEFAULT_GATE3_TEMPERATURE,
}) {
  const chatFn = chat ?? chatCompletion
  const system = buildTaskGenSystemPrompt({ k })
  const user = buildTaskGenUserPrompt({ skillName, skillDescription, skillMarkdown })
  const res = await chatFn(config, { system, user, maxTokens, temperature, fetchImpl, ledger })
  const parsed = parseJsonOrThrow(res.text, '任务生成')
  const { tasks, problems } = validateTaskSet(parsed, { expected: k, forbiddenName: skillName })
  return {
    tasks,
    problems,
    usage: res.usage ?? null,
    finishReason: res.finishReason ?? null,
    inputHash: taskGenInputHash({ skillName, skillDescription, skillMarkdown, k, modelId: config?.modelId }),
  }
}

/**
 * 单臂执行：物化夹具 → 调用消费者 → 校核并物化产物 → 跑检查单。
 * 沙箱是临时目录（每次调用一个），跑完即删——任务之间互不污染。
 */
export async function runTaskArm({
  config,
  arm,
  task,
  taskId,
  skillMarkdown = null,
  chat,
  fetchImpl,
  ledger,
  maxTokens = DEFAULT_GATE3_MAX_TOKENS,
  temperature = DEFAULT_GATE3_TEMPERATURE,
  keepSandbox = false,
}) {
  const chatFn = chat ?? chatCompletion
  const sandbox = await mkdtemp(path.join(os.tmpdir(), `any2skills-gate3-${taskId}-${arm}-`))
  try {
    for (const [p, content] of Object.entries(task.fixtures ?? {})) {
      const abs = path.join(sandbox, p)
      await mkdir(path.dirname(abs), { recursive: true })
      await writeFile(abs, content, 'utf8')
    }
    const system = buildExecutionSystemPrompt({ arm, skillMarkdown })
    const user = buildExecutionUserPrompt({ task })
    const res = await chatFn(config, { system, user, maxTokens, temperature, fetchImpl, ledger })
    let parsed
    let shapeError = null
    try {
      parsed = parseJsonOrThrow(res.text, '执行产物')
    } catch (err) {
      shapeError = err.message
      parsed = null
    }
    let filesWritten = []
    let invalidPaths = []
    if (parsed !== null) {
      const checked = validateExecutionOutput(parsed)
      invalidPaths = checked.invalidPaths
      for (const [p, content] of Object.entries(checked.files)) {
        const abs = path.join(sandbox, p)
        await mkdir(path.dirname(abs), { recursive: true })
        await writeFile(abs, content, 'utf8')
        filesWritten.push(p)
      }
    }
    const verdict = parsed === null
      ? { passed: false, results: [{ type: '(parse)', ok: false, detail: shapeError }] }
      : evaluateChecker({ checks: task.checks }, sandbox)
    return {
      taskId,
      arm,
      passed: verdict.passed,
      checks: verdict.results,
      filesWritten,
      invalidPaths,
      usage: res.usage ?? null,
      finishReason: res.finishReason ?? null,
      inputHash: armInputHash({ arm, task, skillMarkdown, modelId: config?.modelId }),
      sandbox: keepSandbox ? sandbox : null,
      rawText: parsed === null ? res.text : null,
    }
  } finally {
    if (!keepSandbox) await rm(sandbox, { recursive: true, force: true })
  }
}

/* ──────────────────────────── 判定（ADR-027 决策 3） ──────────────────────────── */

/**
 * 单 skill 的判定。输入是逐任务的配对结果（含可能的复跑结果）：
 *   `[{taskId, without:{passed}, with:{passed}, rerun?{without,with}}]`
 *
 * 规则（ADR-027 决策 3）：
 *   - 退化事件（无 skill 过 ∧ 有 skill 败）→ 复跑确认；复现即 **rejected**；不复现记噪声；
 *   - 改进事件（无 skill 败 ∧ 有 skill 过）→ 计入改进；
 *   - 两臂都败 → 「任务无效」并可见（不计入效用）；
 *   - 无确认退化且 ≥1 改进 → **passed**；无退化无改进（有效任务都双过或双败）→ **low-utility**。
 */
export function verdictForSkill({ skillId, name, riskFlags = [], taskResults }) {
  const confirmedDegradations = []
  const noiseDegradations = []
  const pendingReruns = []
  const improvements = []
  const invalidTasks = []
  const paired = []

  for (const r of taskResults) {
    const w = r.without?.passed === true
    const t = r.with?.passed === true
    let state
    if (!w && !t) {
      state = 'invalid'
      invalidTasks.push(r.taskId)
    } else if (w && !t) {
      // 退化事件 → 看复跑
      if (r.rerun) {
        const rw = r.rerun.without?.passed === true
        const rt = r.rerun.with?.passed === true
        if (rw && !rt) {
          state = 'degradation-confirmed'
          confirmedDegradations.push(r.taskId)
        } else {
          state = 'degradation-noise'
          noiseDegradations.push(r.taskId)
        }
      } else {
        // 未复跑**不得当作噪声、也不得直接判拒**——先记为待证，由调用方补复跑。
        state = 'degradation-pending-rerun'
        pendingReruns.push(r.taskId)
      }
    } else if (!w && t) {
      state = 'improvement'
      improvements.push(r.taskId)
    } else {
      state = 'both-pass'
    }
    paired.push({ taskId: r.taskId, without: r.without?.passed ?? null, with: r.with?.passed ?? null, state })
  }

  let verdict
  let reason
  if (confirmedDegradations.length > 0) {
    verdict = 'rejected'
    reason = `negative transfer 复现：${confirmedDegradations.join(', ')}（无 skill 通过、有 skill 失败，且复跑复现）——ADR-006：必须拒绝`
  } else if (pendingReruns.length > 0) {
    // 未复跑就下结论会把噪声当信号——停在中间态，由调用方补复跑后重判。
    verdict = 'pending-rerun'
    reason = `退化事件待复跑确认：${pendingReruns.join(', ')}——复跑复现即拒，不复现记噪声`
  } else if (improvements.length > 0) {
    verdict = 'passed'
    reason = `有 skill 臂在 ${improvements.length} 个任务上严格更优（${improvements.join(', ')}），无确认退化`
  } else {
    verdict = 'low-utility'
    reason =
      noiseDegradations.length > 0
        ? `无确认退化也无改进；${noiseDegradations.length} 个退化事件复跑后不复现（记噪声）——ADR-006：标记低效用（不拒绝，但降级）`
        : '无确认退化也无改进（任务要么双过要么双败）——ADR-006：标记低效用（不拒绝，但降级）'
  }
  return {
    skillId,
    name,
    riskFlags,
    verdict,
    reason,
    counts: {
      tasks: taskResults.length,
      improvements: improvements.length,
      confirmedDegradations: confirmedDegradations.length,
      noiseDegradations: noiseDegradations.length,
      pendingReruns: pendingReruns.length,
      invalidTasks: invalidTasks.length,
    },
    paired,
  }
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
