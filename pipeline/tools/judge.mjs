/**
 * 第 3 层 · 判定者判据（ticket 05）
 *
 * 职责：对每个对象问一次「这条引文是否支撑这个主张」，由一次**独立调用**作答。
 *
 * 三条结构性约束（**写在代码结构里**，不是文档约定）：
 *
 *   1. **输入是构造出来的，不是删出来的。** `buildJudgeInput` 只接受 `{objectType, object,
 *      anchorText}`，并按 `CLAIM_FIELDS` 逐字段取值，产出**恰好三个键**的输入。之所以不用
 *      「传整个对象再删敏感字段」的写法：删除式隔离会被**新增字段默默绕过**——将来有人给对象
 *      加了一个字段，判定者的视野就悄悄扩大了，而没有任何测试会失败。
 *   2. **判定者拿不到生产者上下文，因为没有任何参数能传给它。** 本模块不 import 第 2 层的
 *      任何东西，函数签名里没有提示词、没有推理过程、没有调用句柄。
 *   3. **判定者与生产者不共享账本。** 调用与 token 各自记账，否则回执无法回答
 *      「判定者花了多少」——而 ADR-010 明确要求定档时两层都要评估。
 *
 * 本模块**不做确定性判据**（那是 verifier 的 `checkDeterministic`），也不决定对象是否被拒
 * （判定值到理由码的映射在 `VERDICT_TO_REASON_CODE`，拒绝动作在 verifier 的入口）。
 *
 * 与规格的对应：D6「判定者只接收引文与该锚点区间的文本，判定该引文是否支撑该对象的主张，
 * 输出结构化结果（支撑 / 不支撑 / 不充分 + 一句理由）」。
 */

import { chatCompletion, createUsageLedger, redact, urlHost } from './llm-client.mjs'
import { CLAIM_FIELDS, OBJECT_TYPES } from './object-contract.mjs'
import { sha256Hex } from './anchor-index.mjs'

/** 提示词版本。进指纹；改提示词必须改它，否则「换了提示词却分不出产出」就成了隐形行为。 */
export const JUDGE_PROMPT_VERSION = 'judge-prompt/v1'

/**
 * 判定者的三值输出（封闭集合）。
 *
 * 取值用英文而不用中文：判定值要进回执、进理由码映射、进交叉表统计，用字形固定的标识
 * 比用「支撑/不支撑/不充分」这种会被输入法改动的词更不容易在比较时出错。
 */
export const VERDICTS = Object.freeze(['supported', 'insufficient', 'unsupported'])

/** 判定值 → 理由码。`supported` 映射为 null，即「不产生拒绝理由」。 */
export const VERDICT_TO_REASON_CODE = Object.freeze({
  supported: null,
  insufficient: 'JUDGE_INSUFFICIENT',
  unsupported: 'JUDGE_NOT_SUPPORTED',
})

/**
 * 判定者输入的**唯一允许的键**（顺序即构造顺序）。
 * 测试逐字断言它——规格 D6 说判定者输入「只含引文、锚点文本与主张本身」，
 * 「只」这个字必须能被一条断言执行，而不是被一句注释声称。
 */
export const JUDGE_INPUT_KEYS = Object.freeze(['claim', 'quote', 'anchorText'])

/** 判定者的失败（响应不合约定）。属「运行失败」，不是「对象被拒」。 */
export class JudgeError extends Error {
  constructor(message, extra = {}) {
    super(message)
    this.name = 'JudgeError'
    Object.assign(this, extra)
  }
}

/**
 * 判定者输出的 token 上限。
 *
 * 为什么不是一个小数字：思考模式下**思维链计入 completion_tokens**（卡 04 实测踩过：
 * 8000 额度被推理吃光，响应被截断且 content 为空）。判定任务比提取窄，但推理开销不归零，
 * 故留 8,000（约为第 2 层 16,000 的一半）。触发截断时会抛出带 `truncated` 的明确错误，
 * 而不是静默当成「判定者说没问题」。
 */
export const DEFAULT_JUDGE_MAX_TOKENS = 8000

/** 判定者的温度。思考模式下 `temperature` 不生效（ADR-010 附带发现），此处保留是为思考模式关闭时仍有值。 */
export const DEFAULT_JUDGE_TEMPERATURE = 0

/**
 * 取对象的**主张**：只按 `CLAIM_FIELDS` 取字段，其余一律不进。
 *
 * @returns {object} 只含主张字段的新对象（不含 `id` / `sourceRefs` / 时间戳等元数据）
 */
export function buildClaim(objectType, object) {
  if (!OBJECT_TYPES.includes(objectType)) {
    throw new JudgeError(`未知对象类型：${JSON.stringify(objectType)}（集合封闭，见 OBJECT_TYPES）`)
  }
  const fields = CLAIM_FIELDS[objectType]
  const claim = {}
  for (const f of fields) {
    if (object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, f)) {
      claim[f] = object[f]
    }
  }
  return claim
}

/**
 * 构造判定者的输入。**恰好三个键**。
 *
 * @param {{objectType:string, object:object, anchorText:string}} args
 * @returns {{claim:object, quote:*, anchorText:string}}
 */
export function buildJudgeInput({ objectType, object, anchorText }) {
  return {
    claim: buildClaim(objectType, object),
    quote: object === null || typeof object !== 'object' ? undefined : object.evidenceQuote,
    anchorText: typeof anchorText === 'string' ? anchorText : '',
  }
}

const JUDGE_SYSTEM_PROMPT = `你是独立判定者。你的唯一任务：给定一条【主张】、一条【引文】和【锚点原文】，判定该引文是否支撑该主张。

三种判定，必须选其一：
- supported（支撑）：引文的内容足以支持主张。引文不必与主张逐字相同，但主张里的断言必须能从引文中读出。
- insufficient（不充分）：引文与主张相关，但不足以支持主张——主张比引文断言得更多、更宽、更绝对，或引文只覆盖了主张的一部分。
- unsupported（不支撑）：引文与主张无关，或引文的内容与主张相矛盾。

判定纪律：
- 只看给定的这三样。你没有原文的其余部分，不要推测，也不要依据常识补全。
- 不要因为主张听起来合理、或与引文主题相同，就判支撑；引文必须真的承载这个断言。
- 主张里出现而引文里没有的关键限定（如「总是」「唯一」「必须」「首次」），判 insufficient。
- 引文的说法与主张的方向相反（如引文说「不宜」，主张说「应当」），判 unsupported。
- 只输出 JSON，不要输出任何其他文字、不要用代码块包裹。

输出格式（严格）：
{"verdict":"supported|insufficient|unsupported","reason":"一句话理由"}`

/** 判定者提示词的指纹。进回执，使「两次运行是不是同一套判据」可查。 */
export function judgePromptFingerprint() {
  return `judge-${sha256Hex(`${JUDGE_PROMPT_VERSION}\n${JUDGE_SYSTEM_PROMPT}`).slice(0, 12)}`
}

/**
 * 由输入构造请求的两个消息。
 *
 * 注意这里**没有**任何来自生产者的东西：system 是常量，user 只由 `buildJudgeInput` 的三个键渲染。
 */
export function buildJudgePrompts(input) {
  const user =
    `【主张】\n${JSON.stringify(input.claim, null, 2)}\n\n` +
    `【引文】\n${input.quote === undefined ? '（该对象未携带引文）' : String(input.quote)}\n\n` +
    `【锚点原文】\n${input.anchorText}`
  return { system: JUDGE_SYSTEM_PROMPT, user }
}

/** 宽容解析：容忍代码块包裹与前后夹带的解释文字，但**不**容忍判定值不在封闭集合内。 */
export function parseJudgeVerdict(text) {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = (fenced ? fenced[1] : raw).trim()

  let payload = null
  const attempts = [body]
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start >= 0 && end > start) attempts.push(body.slice(start, end + 1))

  let lastErr = null
  for (const a of attempts) {
    try {
      payload = JSON.parse(a)
      break
    } catch (err) {
      lastErr = err
    }
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new JudgeError(`判定者响应不是可解析的 JSON 对象：${lastErr ? lastErr.message : '未找到 JSON'}`, {
      rawText: raw,
    })
  }

  const verdict = payload.verdict
  if (!VERDICTS.includes(verdict)) {
    throw new JudgeError(
      `判定者的 verdict 不在封闭集合内：${JSON.stringify(verdict ?? null)}（合法取值：${VERDICTS.join(' / ')}）`,
      { rawText: raw },
    )
  }
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
  return { verdict, reason }
}

/**
 * 判定者实例标识。进回执，使「谁判的」可审计。
 *
 * 形状 `${modelId}/${promptFingerprint}#${序号}`：模型 + 判据版本 + 该次运行内的第几次判定。
 * 序号由调用方按**判定者自己的**计数给出（不是对象序号），因此它能回答
 * 「这次运行里判定者被调用了几次、这一条是第几次」——那正是「独立实例」在回执里的可查形式。
 */
export function judgeInstanceId({ modelId, promptFingerprint, ordinal }) {
  return `${modelId}/${promptFingerprint}#${String(ordinal).padStart(3, '0')}`
}

/**
 * 对一个对象跑一次判定。**一次调用、一个独立上下文。**
 *
 * @param {object} args
 * @param {object} args.config 判定者路由（`resolveJudgeLlmConfig` 的产出）
 * @param {{claim:object, quote:*, anchorText:string}} args.input
 * @param {number} args.ordinal 该次运行内判定者的第几次调用（从 1 起）
 * @param {object} [args.ledger] 判定者自己的账本（与第 2 层分开记）
 * @param {Function} [args.chat] 聊天实现（测试注入替身；缺省为真实调用）
 * @returns {Promise<{verdict:string, reason:string, judgeInstanceId:string, modelId:string,
 *                    promptFingerprint:string, usage:object|null, rawText:string}>}
 */
export async function judgeObject({
  config,
  input,
  ordinal,
  ledger,
  chat,
  fetchImpl,
  maxTokens = DEFAULT_JUDGE_MAX_TOKENS,
  temperature = DEFAULT_JUDGE_TEMPERATURE,
  maxAttempts,
  retryDelayMs,
  reasoningEffort,
}) {
  const chatFn = chat ?? chatCompletion
  const promptFingerprint = judgePromptFingerprint()
  const { system, user } = buildJudgePrompts(input)

  const res = await chatFn(config, {
    system,
    user,
    maxTokens,
    temperature,
    fetchImpl,
    ledger,
    maxAttempts,
    retryDelayMs,
    // 单次调用可覆盖档位：ADR-009 要求定档时分别评估两层，
    // 而「同一批对象在两个档位各判一遍」必须在**同一次进程**里做到，
    // 否则两次运行的模型/端点差异会混进对照结果。
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
  })

  const { verdict, reason } = parseJudgeVerdict(res.text)
  return {
    verdict,
    reason,
    judgeInstanceId: judgeInstanceId({ modelId: config.modelId, promptFingerprint, ordinal }),
    modelId: config.modelId,
    promptFingerprint,
    usage: res.usage ?? null,
    rawText: redact(res.text ?? '', config.apiKey),
  }
}

/**
 * 判定者的账本 + 路由来源，供回执使用。
 *
 * 与第 2 层的 `model` 块同构，外加两条 ADR-010 明确要求的可见性字段：
 * `sameModelAsProducer`（同模型自审必须可见）与 `instanceIdPrefix`（判定者身份可查）。
 */
export function describeJudgeRoute(config, ledger = createUsageLedger()) {
  return {
    provider: config.provider ?? urlHost(config.baseUrl) ?? 'unrecorded',
    modelId: config.modelId,
    baseUrlHost: urlHost(config.baseUrl),
    calls: ledger.calls,
    tokens: { ...ledger.tokens },
    tokensDetail: { ...ledger.tokensDetail },
    failedCalls: ledger.failedCalls,
    retries: ledger.retries,
    usageNote: ledger.note,
    promptVersion: JUDGE_PROMPT_VERSION,
    promptFingerprint: judgePromptFingerprint(),
    instanceIdPrefix: `${config.modelId}/${judgePromptFingerprint()}`,
    // ADR-010：同模型自审是本卡明确接受的代价，接受的前提是它可见。
    sameModelAsProducer: config.sameModelAsProducer === true,
    producerModelId: config.producerModelId ?? null,
    // ADR-009：定档必须分别看得见两层。判定者这一层的档位独立记录，
    // 与生产者的档位并排——否则「两层都降档了」在回执里会读成「一切照旧」。
    reasoningEffort: config.reasoningEffort ?? null,
    configSource: {
      modelId: config.modelSource ?? null,
      baseUrl: config.baseUrlSource ?? null,
      apiKey: config.apiKeySource ?? null,
      reasoningEffort: config.reasoningEffortSource ?? null,
    },
  }
}
