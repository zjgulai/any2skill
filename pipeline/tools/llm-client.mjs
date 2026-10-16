/**
 * 第 2 层 · 模型接入（ticket 04）
 *
 * 职责：把「调哪个模型、用哪把凭据」从代码里赶出去，变成**配置**；把「花了多少次调用、多少 token」
 * 变成**可记账的事实**。本模块只做这三件事，不做提示词、不做对象解析（那是 layer2-extractor 的事）。
 *
 * 三条纪律（都是 ticket 04 的验收项或其前提）：
 *
 *   1. **模型路由可配置，不硬编码具体模型。** modelId / baseUrl 一律来自配置解析，
 *      代码里只有「没有配置时该报错」这一条路径，没有「默认用某个具体模型」这一条。
 *   2. **凭据只走一条明确的解析顺序，且永不外泄。** 顺序是：
 *      显式传入 > 环境变量 > `$DSH_HOME/.credentials.yaml` 的 `refs`。凭据值不进入任何
 *      返回值以外的结构——错误信息、回执、日志一律只出现 `apiKeyPresent: true` 与 URL 主机名。
 *   3. **调用与用量必须记账，且失败的尝试也算账。** HTTP 重试每一次都计入 `calls`，
 *      否则「本次花了多少次调用」会低于实际，而 token 用量又是按成功响应累计的，
 *      两者口径不一致就再也无法核对账单。
 */

import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** 配置解析失败。属「工程问题」——不该用它去解释内容问题。 */
export class LlmConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'LlmConfigError'
  }
}

/** 模型调用失败（传输层 / 协议层 / 服务端拒绝 / 响应不可用）。同样属「工程问题」。 */
export class LlmCallError extends Error {
  constructor(message, { status = null, attempts = 0, truncated = false, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = 'LlmCallError'
    this.status = status
    this.attempts = attempts
    /** 响应因 max_tokens 被截断——这是配置问题，不是内容问题。 */
    this.truncated = truncated
  }
}

/** 环境变量名。集中在此处，使「配置从哪来」只有一个可检索的答案。 */
const LLM_ENV = Object.freeze({
  apiKey: 'ANY2SKILLS_LLM_API_KEY',
  modelId: 'ANY2SKILLS_LLM_MODEL',
  baseUrl: 'ANY2SKILLS_LLM_BASE_URL',
  provider: 'ANY2SKILLS_LLM_PROVIDER',
  reasoningEffort: 'ANY2SKILLS_LLM_REASONING_EFFORT',
  home: 'DSH_HOME',
})

/**
 * 推理档位的允许取值（DeepSeek 思考模式的控制参数）。
 *
 * **null 是合法且是默认值**，含义是「请求体里不发 `reasoning_effort` 字段」——
 * 即交给服务端的默认行为。把 null 与某个具体档位区分开是刻意的：
 * `resolveLlmConfig` 的既有风格是「不指定就回落」，若在这里硬塞一个默认档位，
 * 就会把「我们没表态」变成「我们表态了，选了 X」——而 ADR-009 定档之前，
 * 事实上我们从未表态。回执里因此能区分「默认」与「显式选了 high」。
 */
export const REASONING_EFFORTS = Object.freeze(['low', 'high', 'max'])

/** 把档位取值归一化；空串/未设 → null（不发字段）；非法值抛错而非静默忽略。 */
export function normalizeReasoningEffort(value, what = 'reasoningEffort') {
  if (value === null || value === undefined) return null
  const v = String(value).trim().toLowerCase()
  if (v === '') return null
  if (!REASONING_EFFORTS.includes(v)) {
    throw new LlmConfigError(
      `${what} 取值非法：${JSON.stringify(value)}；允许 ${REASONING_EFFORTS.join(' / ')}，或留空表示跟随服务端默认。`,
    )
  }
  return v
}

/** DSH 凭据存储里对应的 ref 名（该文件由 DSH 自己维护，本项目只读）。 */
const DSH_CREDENTIAL_REF = 'DEEPSEEK_API_KEY'

/**
 * 判定者（第 3 层）专属的环境变量名（ADR-010 决策 1）。
 *
 * 为什么单列一张表而不是「判定者复用 LLM_ENV」：规格 D6 要求判定者与生产者**不同实例**，
 * 而 ADR-010 的取舍是「同模型、独立可配」——独立可配的意义在于**换判定者模型是一次配置改动，
 * 不是一次重写**。若判定者硬编码复用 LLM_ENV，那么「将来用不同家族模型互审」这个留口
 * 就退化成了改代码。此处的每个变量都缺省继承生产者路由（见 resolveJudgeLlmConfig）。
 */
const JUDGE_LLM_ENV = Object.freeze({
  apiKey: 'ANY2SKILLS_JUDGE_API_KEY',
  modelId: 'ANY2SKILLS_JUDGE_MODEL',
  baseUrl: 'ANY2SKILLS_JUDGE_BASE_URL',
  provider: 'ANY2SKILLS_JUDGE_PROVIDER',
})

/** 凭据文件里 `refs` 段的键允许的形状。格式出处：dsh-credentials-local 的 refs 段准入规则。 */
const REF_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 屏蔽凭据：任何可能被写进日志/回执的字符串都先过这里。 */
export function redact(text, apiKey) {
  let out = String(text)
  if (typeof apiKey === 'string' && apiKey.length >= 8) out = out.split(apiKey).join('«已屏蔽»')
  // 兜底：Bearer 后面跟的任何长串都视为凭据，避免未知来源的 key 漏出。
  return out.replace(/(Bearer\s+)\S{8,}/gi, '$1«已屏蔽»')
}

/** 只取主机名，用于回执——既能核对路由，又不泄露路径与查询串。 */
export function urlHost(url) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

/**
 * 解析 `$DSH_HOME/.credentials.yaml` 的 `refs` 段，取一个键。
 *
 * 为什么手写而不用 YAML 库：本项目零依赖，且该文件的格式由 DSH 单方面定义、
 * 只需读 `refs` 这一层扁平映射。**取舍与边界**：只支持该文件的实际布局
 * （`version: 1` + 两空格缩进的 `refs:` 段 + `KEY: value`），值支持裸值与成对引号两种写法。
 * 遇到不认识的形状**显式报错**，绝不静默返回空值——静默返回空值会把「凭据解析失败」
 * 伪装成「没有配置凭据」，从而让人去查错的地方。
 */
export function parseCredentialRefs(text, { filename = '.credentials.yaml' } = {}) {
  const lines = String(text).split(/\r\n|\n|\r/)
  const refs = {}
  let inRefs = false

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue
    const indent = line.length - line.trimStart().length

    if (indent === 0) {
      const top = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(line)
      if (!top) throw new LlmConfigError(`${filename}:${i + 1} 顶层行无法解析：${line.slice(0, 40)}`)
      inRefs = top[1] === 'refs'
      continue
    }

    if (!inRefs) continue // records 段不读
    if (indent !== 2) {
      throw new LlmConfigError(
        `${filename}:${i + 1} refs 段出现非预期缩进（${indent} 空格）——本读取器只支持 ` +
          '「两空格缩进的键值对」这一种形状，遇未知形状即报错，不静默跳过。',
      )
    }
    const m = /^\s+([^:\s][^:]*):\s?(.*)$/.exec(line)
    if (!m) throw new LlmConfigError(`${filename}:${i + 1} refs 段行无法解析`)
    const key = m[1].trim()
    if (!REF_KEY_RE.test(key)) {
      throw new LlmConfigError(`${filename}:${i + 1} refs 段的键不符合 ${REF_KEY_RE.source}`)
    }
    let value = m[2].trim()
    const quoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    if (quoted) value = value.slice(1, -1)
    refs[key] = value
  }

  return refs
}

/**
 * 解析第 2 层要用的模型配置。
 *
 * @param {object} [opts]
 * @param {object} [opts.env] 环境变量表（测试可注入；缺省为 process.env）
 * @param {string} [opts.credentialsFile] 凭据文件路径（缺省 `$DSH_HOME/.credentials.yaml`）
 * @param {{provider?:string, modelId?:string, baseUrl?:string, apiKey?:string}} [opts.overrides]
 *        显式传入（命令行参数）——优先级最高。
 * @returns {Promise<{provider:string|null, modelId:string, baseUrl:string, apiKey:string,
 *                    apiKeySource:string, modelSource:string, baseUrlSource:string}>}
 */
export async function resolveLlmConfig(opts = {}) {
  const env = opts.env ?? process.env
  const overrides = opts.overrides ?? {}

  const readEnv = (name) => {
    const v = env[name]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }

  const pick = (overrideValue, envValue, sourceName, what) => {
    if (typeof overrideValue === 'string' && overrideValue.trim() !== '') {
      return { value: overrideValue.trim(), source: `override(${what})` }
    }
    if (envValue !== null) return { value: envValue, source: `env:${sourceName}` }
    return { value: null, source: null }
  }

  const model = pick(overrides.modelId, readEnv(LLM_ENV.modelId), LLM_ENV.modelId, 'modelId')
  const base = pick(overrides.baseUrl, readEnv(LLM_ENV.baseUrl), LLM_ENV.baseUrl, 'baseUrl')
  const provider = pick(overrides.provider, readEnv(LLM_ENV.provider), LLM_ENV.provider, 'provider')

  let apiKey = null
  let apiKeySource = null
  if (typeof overrides.apiKey === 'string' && overrides.apiKey.trim() !== '') {
    apiKey = overrides.apiKey.trim()
    apiKeySource = 'override(apiKey)'
  } else {
    const fromEnv = readEnv(LLM_ENV.apiKey)
    if (fromEnv !== null) {
      apiKey = fromEnv
      apiKeySource = `env:${LLM_ENV.apiKey}`
    }
  }

  // 环境变量没有才回落读 DSH 的凭据存储；这是「复用既有凭据」的唯一通道。
  let credentialsFile = opts.credentialsFile ?? null
  if (apiKey === null) {
    const home = env[LLM_ENV.home] ?? os.homedir()
    credentialsFile = credentialsFile ?? path.join(home === '' ? os.homedir() : home, '.credentials.yaml')
    let text
    try {
      text = await readFile(credentialsFile, 'utf8')
    } catch (err) {
      throw new LlmConfigError(
        `未找到模型凭据：环境变量 ${LLM_ENV.apiKey} 未设置，且凭据文件读不到（${credentialsFile}）：` +
          `${redact(err.message)}。\n` +
          `两种做法择一：export ${LLM_ENV.apiKey}=…；或确认 DSH 的凭据存储位于上述路径。`,
      )
    }
    const refs = parseCredentialRefs(text, { filename: credentialsFile })
    if (typeof refs[DSH_CREDENTIAL_REF] !== 'string' || refs[DSH_CREDENTIAL_REF] === '') {
      throw new LlmConfigError(
        `凭据文件 ${credentialsFile} 的 refs 段里没有 ${DSH_CREDENTIAL_REF}（现有键：` +
          `${Object.keys(refs).join(', ') || '无'}）。`,
      )
    }
    apiKey = refs[DSH_CREDENTIAL_REF]
    apiKeySource = `dsh-credentials:${DSH_CREDENTIAL_REF}`
  }

  if (model.value === null) {
    throw new LlmConfigError(
      `未指定模型：请设置 ${LLM_ENV.modelId} 或传 --llm-model。\n` +
        '本项目不提供默认模型——硬编码一个具体模型会让「换了模型却没人察觉」变成默认行为。',
    )
  }
  if (base.value === null) {
    throw new LlmConfigError(
      `未指定端点：请设置 ${LLM_ENV.baseUrl} 或传 --llm-base-url（例如 https://api.deepseek.com）。`,
    )
  }

  return {
    provider: provider.value,
    providerSource: provider.source,
    modelId: model.value,
    modelSource: model.source,
    baseUrl: base.value.replace(/\/+$/, ''),
    baseUrlSource: base.source,
    apiKey,
    apiKeySource,
    // null = 请求体里不发 reasoning_effort（跟随服务端默认）。缺省即此值，且 ADR-015 的定档
    // 结论就是维持缺省——降档在生产者层实测省 45.4% 推理，代价是对象数 −10.9%。
    reasoningEffort: normalizeReasoningEffort(
      overrides.reasoningEffort ?? readEnv(LLM_ENV.reasoningEffort),
    ),
    reasoningEffortSource:
      overrides.reasoningEffort !== undefined && String(overrides.reasoningEffort).trim() !== ''
        ? 'override(reasoningEffort)'
        : readEnv(LLM_ENV.reasoningEffort) !== null
          ? `env:${LLM_ENV.reasoningEffort}`
          : null,
  }
}

/**
 * 解析**判定者**（第 3 层）要用的模型配置（ADR-010 决策 1：同模型、独立实例，路由独立可配）。
 *
 * 解析顺序：生产者路由（含其全部既有回落链）→ 判定者专属环境变量 → 判定者专属显式覆盖。
 * 即「缺省与生产者同路由，需要时单点覆盖」，且**每个字段的来源都单独记录**——
 * 回执因此能回答「判定者到底用了哪个模型」，而不是只回答「大概一样」。
 *
 * `sameModelAsProducer` 是 ADR-010 要求的可见性措施：同模型自审在 MVP 阶段不设防，
 * 但必须**在审计时看得见**，不能是隐形的。
 */
export async function resolveJudgeLlmConfig(opts = {}) {
  const env = opts.env ?? process.env
  const producer = await resolveLlmConfig(opts)
  const overrides = opts.judgeOverrides ?? {}

  const readEnv = (name) => {
    const v = env[name]
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
  }

  const pick = (overrideValue, envValue, envName, inherited, inheritedSource, what) => {
    if (typeof overrideValue === 'string' && overrideValue.trim() !== '') {
      return { value: overrideValue.trim(), source: `override(${what})` }
    }
    if (envValue !== null) return { value: envValue, source: `env:${envName}` }
    return { value: inherited, source: inheritedSource }
  }

  const model = pick(
    overrides.modelId, readEnv(JUDGE_LLM_ENV.modelId), JUDGE_LLM_ENV.modelId,
    producer.modelId, producer.modelSource, 'judgeModelId',
  )
  const base = pick(
    overrides.baseUrl, readEnv(JUDGE_LLM_ENV.baseUrl), JUDGE_LLM_ENV.baseUrl,
    producer.baseUrl, producer.baseUrlSource, 'judgeBaseUrl',
  )
  const provider = pick(
    overrides.provider, readEnv(JUDGE_LLM_ENV.provider), JUDGE_LLM_ENV.provider,
    producer.provider, producer.providerSource, 'judgeProvider',
  )
  const key = pick(
    overrides.apiKey, readEnv(JUDGE_LLM_ENV.apiKey), JUDGE_LLM_ENV.apiKey,
    producer.apiKey, producer.apiKeySource, 'judgeApiKey',
  )

  // 档位单独走一遍归一化：它可能来自 overrides、来自判定者专属环境变量，
  // 也可能继承生产者——三条路径都必须过同一个白名单校验，非法值一律抛错。
  const judgeEffortRaw = pick(
    overrides.reasoningEffort, readEnv(JUDGE_LLM_ENV.reasoningEffort), JUDGE_LLM_ENV.reasoningEffort,
    producer.reasoningEffort, 'inherited(producer)', 'judgeReasoningEffort',
  )
  const judgeEffort = {
    value: normalizeReasoningEffort(judgeEffortRaw.value, 'judgeReasoningEffort'),
    source: judgeEffortRaw.value === null ? null : judgeEffortRaw.source,
  }

  return {
    provider: provider.value,
    providerSource: provider.source,
    modelId: model.value,
    modelSource: model.source,
    baseUrl: String(base.value).replace(/\/+$/, ''),
    baseUrlSource: base.source,
    apiKey: key.value,
    apiKeySource: key.source,
    // 判定者与生产者是否同模型。**必须进回执**：同模型自审是 ADR-010 明确接受的代价，
    // 接受的前提是它可见——隐形地同模型自审与显式地同模型自审，审计含义完全不同。
    sameModelAsProducer: model.value === producer.modelId,
    producerModelId: producer.modelId,
    // 档位是**独立的一维**，缺省继承生产者（ADR-009「必须同时评估两层」的前提，
    // 是这两层各自可单独拨档；否则「生产者降档」与「判定者降档」无法分离）。
    reasoningEffort: judgeEffort.value,
    reasoningEffortSource: judgeEffort.source,
    producerReasoningEffort: producer.reasoningEffort,
  }
}

/**
 * 记账器：把「次数」与「用量」变成必须显式累加的对象，避免某个分支忘记计数。
 *
 * `calls` 在**每次 HTTP 尝试**时递增（含失败与重试）；`tokens` 只在服务端返回用量时累加。
 * 两者口径不同是刻意的：能量到多少算多少，但绝不用「成功次数」冒充「调用次数」。
 */
export function createUsageLedger() {
  return {
    calls: 0,
    failedCalls: 0,
    tokens: { input: 0, output: 0 },
    /** 推理型模型把思维链计入 completion；单列出来，否则「输出很少却很贵」无法解释。 */
    tokensDetail: { reasoning: 0, cachedInput: 0 },
    retries: 0,
    note: null,
  }
}

function readTokenCount(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function recordUsage(ledger, usage) {
  if (!usage || typeof usage !== 'object') {
    ledger.note = '服务端未返回可识别的 token 用量；tokens 保持为 0 而不是估算值。'
    return
  }
  const input = readTokenCount(usage.prompt_tokens ?? usage.input_tokens)
  const output = readTokenCount(usage.completion_tokens ?? usage.output_tokens)
  if (input !== null) ledger.tokens.input += input
  if (output !== null) ledger.tokens.output += output
  const reasoning = readTokenCount(
    usage.completion_tokens_details?.reasoning_tokens ?? usage.reasoning_tokens,
  )
  if (reasoning !== null) ledger.tokensDetail.reasoning += reasoning
  const cached = readTokenCount(
    usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens,
  )
  if (cached !== null) ledger.tokensDetail.cachedInput += cached
  if (input === null && output === null) {
    ledger.note = '服务端未返回可识别的 token 用量；tokens 保持为 0 而不是估算值。'
  }
}

/**
 * 发一次 chat completion 并返回文本 + 用量。
 *
 * @param {object} config resolveLlmConfig 的产出
 * @param {{system:string, user:string, maxTokens?:number, temperature?:number,
 *          reasoningEffort?:string|null, fetchImpl?:Function, ledger?:object, maxAttempts?:number,
 *          retryDelayMs?:number, signal?:AbortSignal}} req
 * @returns {Promise<{text:string, usage:object|null, calls:number, raw:object}>}
 */
export async function chatCompletion(config, req) {
  const fetchImpl = req.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new LlmConfigError('当前运行环境没有可用的 fetch：请传入 fetchImpl。')
  }
  const ledger = req.ledger ?? createUsageLedger()
  const maxAttempts = Math.max(1, req.maxAttempts ?? 2)
  const retryDelayMs = req.retryDelayMs ?? 0

  const endpoint = `${config.baseUrl}/chat/completions`
  // 档位的取值优先级：单次请求覆盖 > 路由配置 > 不发。null 走「不发」分支，
  // 于是「跟随服务端默认」与「显式选了某个档」在请求体上就是可区分的两种东西。
  const effort = normalizeReasoningEffort(req.reasoningEffort ?? config.reasoningEffort ?? null)
  const body = {
    model: config.modelId,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    ...(req.maxTokens === undefined ? {} : { max_tokens: req.maxTokens }),
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(effort === null ? {} : { reasoning_effort: effort }),
  }

  let lastError = null
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    ledger.calls += 1
    let res
    try {
      res = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify(body),
        ...(req.signal ? { signal: req.signal } : {}),
      })
    } catch (err) {
      ledger.failedCalls += 1
      lastError = new LlmCallError(
        `模型调用传输失败（${urlHost(config.baseUrl) ?? config.baseUrl}）：${redact(err.message, config.apiKey)}`,
        { attempts: attempt, cause: err },
      )
      if (attempt < maxAttempts) {
        ledger.retries += 1
        if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs))
        continue
      }
      throw lastError
    }

    // 读响应体同样是传输层：响应头已到、连接在读完正文前中断时（undici 报 `terminated`），
    // 这里若不接住就会**裸抛且不重试**——实测三次门禁二运行全栽在这一行上。
    // 与 fetch 失败同一套重试策略、同一种包装（错误串必须能说明是传输故障）。
    let text
    try {
      text = await res.text()
    } catch (err) {
      ledger.failedCalls += 1
      lastError = new LlmCallError(
        `读取模型响应体失败（${urlHost(config.baseUrl) ?? config.baseUrl}）：${redact(err?.message ?? err, config.apiKey)}` +
          '——响应头已返回、正文未读完，属传输层故障，不是模型输出问题。',
        { attempts: attempt, cause: err },
      )
      if (attempt < maxAttempts) {
        ledger.retries += 1
        if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs))
        continue
      }
      throw lastError
    }
    if (!res.ok) {
      ledger.failedCalls += 1
      lastError = new LlmCallError(
        `模型调用被拒绝：HTTP ${res.status}（${urlHost(config.baseUrl) ?? config.baseUrl}）` +
          `——${redact(text.slice(0, 400), config.apiKey)}`,
        { status: res.status, attempts: attempt },
      )
      // 只对可重试的状态码重试：4xx 里的认证/请求错误重试无意义，重复花钱。
      const retriable = res.status === 429 || res.status >= 500
      if (retriable && attempt < maxAttempts) {
        ledger.retries += 1
        if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs))
        continue
      }
      throw lastError
    }

    let parsed
    try {
      parsed = JSON.parse(text)
    } catch (err) {
      ledger.failedCalls += 1
      throw new LlmCallError(`模型返回的不是 JSON：${redact(text.slice(0, 200), config.apiKey)}`, {
        status: res.status,
        attempts: attempt,
      })
    }

    recordUsage(ledger, parsed.usage)
    const choice = parsed?.choices?.[0]
    const content = choice?.message?.content
    const finishReason = choice?.finish_reason ?? null
    // 推理型模型把思维链计入 completion_tokens：max_tokens 太小时，思维链会把额度吃光，
    // 于是 content 为空而 HTTP 仍是 200。这不是「模型没回答」，是配置给少了——
    // 必须报成截断而不是让人去猜「为什么返回的不是 JSON」。
    const reasoningChars = typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content.length : 0
    if (typeof content !== 'string' || content.trim() === '') {
      ledger.failedCalls += 1
      const reasoningTokens = readTokenCount(
        parsed.usage?.completion_tokens_details?.reasoning_tokens,
      )
      throw new LlmCallError(
        `模型响应没有可用内容（finish_reason=${finishReason ?? 'null'}，` +
          `completion_tokens=${parsed.usage?.completion_tokens ?? '未知'}` +
          `${reasoningTokens === null ? '' : `，其中推理占用 ${reasoningTokens}`}` +
          `${reasoningChars === 0 ? '' : `，推理文本 ${reasoningChars} 字`}）。` +
          (finishReason === 'length'
            ? '响应被 max_tokens 截断——提高 maxTokens 后重试。'
            : '服务端返回了空内容。'),
        { status: res.status, attempts: attempt, truncated: finishReason === 'length' },
      )
    }
    return {
      text: content,
      usage: parsed.usage ?? null,
      calls: attempt,
      finishReason,
      reasoningChars,
      raw: parsed,
    }
  }

  throw lastError ?? new LlmCallError('模型调用失败且未记录到具体原因')
}
