/**
 * 第 2 层 · 真实模型提取器（ticket 04）
 *
 * 与 `model-stub.mjs` 的关系：两者占据同一个接口位置（输入第 1 层索引，输出对象数组），
 * 但实现的确定性来源不同——替身按「标题层级 + 序号」查表，本模块**问模型**。
 *
 * 本模块的职责边界刻意收窄成两条：
 *
 *   1. **模型只负责「知识」**：这段正文承载哪些对象、每个对象属于哪一类、逐字引文是哪一句、
 *      各类型的知识字段填什么。它**不负责**对象身份——`id` / `sourceRefs` / `createdAt` /
 *      `evidenceRefs` / `chapterRef` 由本模块按锚点确定性填入。理由：这些是「出处与身份」，
 *      是流水线**已知**的事实；让模型复述只会引入它写错的概率，并让「重跑不产生新 id」
 *      这条性质依赖模型的稳定性。
 *   2. **本模块不判定对错**。模型给什么就落什么（含缺字段、错类型、改写过的引文），
 *      由第 3 层拒绝并给出理由码。第 2 层自行「顺手修正」会让失败无法归因到具体环节。
 *
 * 因此：模型返回到磁盘的产物是**原样**的（未经第 3 层的部分也在其中），
 * 唯一被本模块覆写的是上面那组身份字段，且每一次覆写都记进 `derivedFieldsIgnored`。
 */

import { createHash } from 'node:crypto'

import {
  OBJECT_TYPES,
  PIPELINE_REQUIRED_FIELDS,
  TYPE_BOUNDARY_CRITERIA,
  TYPE_REQUIRED_FIELDS,
  describeFieldShapes,
  objectIdFor,
} from './object-contract.mjs'
import { chatCompletion, createUsageLedger } from './llm-client.mjs'

/** 第 2 层自身失败（响应不可解析等）。属「工程问题」，由调用方判为运行失败。 */
export class Layer2Error extends Error {
  constructor(message, { rawText = null } = {}) {
    super(message)
    this.name = 'Layer2Error'
    this.rawText = rawText
  }
}

/**
 * 提示词指纹：系统提示词 + 用户提示词模板的 sha256 前 12 位。
 *
 * 为什么要它：提示词是本层实现的一部分，与 modelId 同级。没有它，盘上的对象只说得清
 * 「哪个模型产的」，说不清「哪版提示词产的」——而提示词一改，同样的模型会给出不同结果。
 * 因此它进回执，也进审计平面的原始响应文件。
 */
export function promptFingerprint({ maxObjectsPerAnchor = DEFAULT_MAX_OBJECTS_PER_ANCHOR } = {}) {
  const system = buildSystemPrompt({ maxObjectsPerAnchor })
  const userTemplate = buildUserPrompt({
    anchor: '<锚点>',
    title: '<标题>',
    lineStart: 0,
    lineEnd: 0,
    anchorText: '<正文>',
    sourceFile: '<源文件>',
  })
  return `prompt-${createHash('sha256').update(`${system}\n\u0000\n${userTemplate}`).update('\n').digest('hex').slice(0, 12)}`
}

/** 由本模块确定性填入、不接受模型提供的字段。 */
export const DERIVED_FIELDS = Object.freeze([
  'id',
  'revision',
  'status',
  'createdAt',
  'sourceRefs',
  'evidenceRefs',
  'chapterRef',
])

/** 每次调用的默认上限与采样参数。温度取 0：本层要的是可复核的抽取，不是文采。 */
/**
 * 每次调用的输出上限。**包含推理 token**——实测 deepseek-v4-pro 单锚点的思维链可达
 * 2.7 万字（8000 token）且仍无正文，因此默认值必须显著高于「正文所需」。
 * 调这个值是卡 04 的成本旋钮（见 ticket 04 的构建记录）。
 */
export const DEFAULT_MAX_TOKENS = 16000
export const DEFAULT_TEMPERATURE = 0
export const DEFAULT_MAX_OBJECTS_PER_ANCHOR = 2

/**
 * 组装系统提示词。
 *
 * 从 `object-contract.mjs` 生成（而不是在字符串里再抄一遍类型与字段），因此
 * 「提示词要求什么」与「schema 要求什么」不会各自漂移。
 */
export function buildSystemPrompt({ maxObjectsPerAnchor = DEFAULT_MAX_OBJECTS_PER_ANCHOR } = {}) {
  const typeLines = OBJECT_TYPES.map((t) => `- ${t}：${describeFieldShapes(t)}`).join('\n')
  const boundaryLines = TYPE_BOUNDARY_CRITERIA.map((c) => `- ${c}`).join('\n')

  return [
    '你是「知识对象提取器」。输入是一个中文技术书稿的**一个章节片段**（含标题行）；',
    '任务是从这段正文中提取出可复用的知识对象。',
    '',
    '九种对象类型与各自的必填字段（字段名必须逐字使用，不得改名、不得自创类型）：',
    typeLines,
    '',
    '类型判定必须依据以下三者边界判据，不得凭感觉选：',
    boundaryLines,
    '其余类型只有在该片段确实承载其知识时才可用；判不准时宁可不产出。',
    '',
    '每个对象还必须带 evidenceQuote，且其值是正文里的逐字引文（见下）。',
    '形状标注的含义——实测这一条最能减少无谓的返工：字符串字段**不要**写成数组，',
    '数组字段**不要**写成字符串；标了「至少 1 项」的数组不得为空数组。',
    '',
    '硬性要求：',
    `1. **引文必须支撑主张**——这是本层的核心要求，不是附加要求。${PIPELINE_REQUIRED_FIELDS[0]} 的值`,
    '   必须是一个**连续**的原文片段，且主张里的**每一条断言**都要能从它里面读出来。',
    '   反过来，主张**不得断言引文之外的内容**：主张里出现的限定与范围',
    '   （如「总是」「唯一」「必须」「首次」，或某个特定适用场景）必须能在引文里找到依据。',
    '   实测最常见的失败就是把一个跨段落的综合判断写成主张，却只附其中一句话作引文——',
    '   那样主张里大部分内容无人承载，第 3 层的判定者一定判不充分。',
    `   引文长度上限 400 字。短引文不足以承载主张时，**二选一**：把引文写长到能承载，`,
    '   或把主张收窄到引文能承载的粒度（宁可多产出几个窄而实的对象，不要一个宽而虚的）。',
    `2. ${PIPELINE_REQUIRED_FIELDS[0]} 必须是**逐字复制**：不得改写、不得拼接、不得翻译、`,
    '   不得添加原文没有的标点。第 3 层会把它与对应锚点区间做逐字比对，对不上即整个对象被拒。',
    '   第 3 层还有一位**独立判定者**会核对「该引文是否支撑该对象的主张」，判为不支撑或不充分',
    '   同样拒绝。因此引文不能随手挑一句相关的话，必须是**能立住主张**的那一段。',
    `3. 不要输出 id / revision / status / createdAt / sourceRefs / evidenceRefs / chapterRef ——`,
    '   这些由流水线按锚点确定性填入；你若提供了它们，会被忽略。',
    '4. 字段值用中文；数组字段即使只有一项也要写成数组；不要留空字符串占位。',
    '   - Heuristic 的 confidence 是 0–1 之间的数字。',
    '   - EngineeringRule 是硬规则，**没有** confidence 字段。',
    `5. 本片段最多产出 ${maxObjectsPerAnchor} 个对象。片段不承载任何上述知识时，返回 {"objects": []}。`,
    '   不要为了凑够数量而编造：第 3 层会逐字校验引文，编造的内容一定被拒。',
    '6. 只输出一个 JSON 对象。**判别类型用的字段名是 objectType**（不是 type），形状严格如下：',
    '   {"objects": [',
    '     {"objectType": "<九种类型之一>", "evidenceQuote": "<支撑该主张的连续原文片段>", "canonicalTerm": "…", "aliases": [], "definition": "…", "examples": ["…"]},',
    '     {"objectType": "Heuristic", "evidenceQuote": "<支撑该主张的连续原文片段>", "trigger": "…", "recommendation": "…", "confidence": 0.6, "exceptions": ["…"]}',
    '   ]}',
    '   每个对象里只放 **该 objectType 对应类型**的字段（上面第二例是 Heuristic，第三例的字段不要混进 Concept 对象里）。',
    '7. 不要输出任何解释文字，不要用 markdown 代码围栏。',
  ].join('\n')
}

/**
 * 组装用户提示词：给出锚点定位与正文。
 *
 * 正文**整段给出**（含标题行），使「引文在锚点区间内逐字命中」这条判据的比对范围
 * 与模型看到的范围一致——两者不一致时，模型会引用它看得见而第 3 层看不见的内容。
 */
export function buildUserPrompt({ anchor, title, lineStart, lineEnd, anchorText, sourceFile }) {
  return [
    `内容源：${sourceFile}`,
    `锚点：${anchor}（第 ${lineStart}–${lineEnd} 行，标题：${title}）`,
    '',
    '正文如下（--- 之间，含标题行）：',
    '---',
    anchorText,
    '---',
  ].join('\n')
}

/** 从响应文本里取出 JSON。模型偶尔会套 markdown 围栏，这里只是去壳，不做语义修补。 */
export function parseModelPayload(text) {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = (fenced ? fenced[1] : raw).trim()
  try {
    return JSON.parse(body)
  } catch (err) {
    // 退一步：截取第一个 { 到最后一个 }，容忍前后夹带的解释文字。
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        /* 落到下面的报错 */
      }
    }
    throw new Layer2Error(`第 2 层响应不是可解析的 JSON：${err.message}`, { rawText: raw })
  }
}

/** 从解析结果里取对象列表。形状不符即报错，不静默当作空列表。 */
export function extractObjectList(payload) {
  if (Array.isArray(payload)) return payload
  if (payload && typeof payload === 'object' && Array.isArray(payload.objects)) return payload.objects
  throw new Layer2Error(
    `第 2 层响应里没有 objects 数组（顶层键：${payload && typeof payload === 'object' ? Object.keys(payload).join(', ') || '无' : typeof payload}）`,
  )
}

/**
 * 把模型产出的一条记录补成完整知识对象。
 *
 * @param {object} rec 模型给的一条记录
 * @param {{anchorEntry:object, sourceFile:string, seq:number, createdAt:string, chapterRef:string}} ctx
 */
export function materializeObject(rec, ctx) {
  const src = rec && typeof rec === 'object' ? rec : {}
  const { anchorEntry, sourceFile, seq, createdAt, chapterRef } = ctx

  const objectType = typeof src.objectType === 'string' ? src.objectType : null
  const id =
    objectType !== null && OBJECT_TYPES.includes(objectType)
      ? objectIdFor(chapterRef, objectType, seq)
      : // 未知类型仍要落盘（第 3 层据此报 SCHEMA_INVALID）；id 只能退化成一个占位标识，
        // 且它必定通不过 identifier 正则——这正是我们希望第 3 层如实报出来的样子。
        `${chapterRef.toUpperCase()}-UNKNOWN-${String(seq).padStart(2, '0')}`

  const ignored = DERIVED_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(src, f))

  const payload = { ...src }
  for (const f of DERIVED_FIELDS) delete payload[f]

  const sourceRef = {
    file: sourceFile,
    anchor: anchorEntry.anchor,
    title: anchorEntry.title,
    lineStart: anchorEntry.lineStart,
    lineEnd: anchorEntry.lineEnd,
    contentHash: anchorEntry.contentHash,
  }

  const obj = {
    id,
    objectType,
    revision: 1,
    status: 'candidate',
    createdAt,
    evidenceGrade: 'E1-observed',
    freshness: { state: 'fresh', asOf: createdAt },
    sourceRefs: [sourceRef],
    ...payload,
  }

  // 出处指针由本模块填，且只在模型未给出**可用**值时填——填缺而非覆盖。
  if (objectType === 'Case' && (!Array.isArray(obj.evidenceRefs) || obj.evidenceRefs.length === 0)) {
    obj.evidenceRefs = [{ ...sourceRef }]
  }
  if (
    (objectType === 'EngineeringRule' || objectType === 'AntiPattern') &&
    (typeof obj.chapterRef !== 'string' || obj.chapterRef === '')
  ) {
    obj.chapterRef = chapterRef
  }

  return { obj, ignored }
}

/**
 * 对**一个锚点**跑一次提取。
 *
 * @returns {Promise<{anchor:string, objects:object[], rawText:string, usage:object|null}>}
 */
export async function extractAnchor({
  config,
  anchorEntry,
  sourceFile,
  lines,
  chat,
  fetchImpl,
  ledger,
  createdAt,
  maxObjectsPerAnchor = DEFAULT_MAX_OBJECTS_PER_ANCHOR,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  maxAttempts,
  retryDelayMs,
}) {
  const chatFn = chat ?? chatCompletion
  const anchorText = lines.slice(anchorEntry.lineStart - 1, anchorEntry.lineEnd).join('\n')
  const system = buildSystemPrompt({ maxObjectsPerAnchor })
  const user = buildUserPrompt({
    anchor: anchorEntry.anchor,
    title: anchorEntry.title,
    lineStart: anchorEntry.lineStart,
    lineEnd: anchorEntry.lineEnd,
    anchorText,
    sourceFile,
  })

  const res = await chatFn(config, { system, user, maxTokens, temperature, fetchImpl, ledger, maxAttempts, retryDelayMs })
  const payload = parseModelPayload(res.text)
  const records = extractObjectList(payload)

  const chapterRef = anchorEntry.anchor.replace('#', '-')
  const objects = []
  const derivedFieldsIgnored = []
  for (let i = 0; i < records.length; i += 1) {
    const { obj, ignored } = materializeObject(records[i], {
      anchorEntry,
      sourceFile,
      seq: i + 1,
      createdAt,
      chapterRef,
    })
    objects.push(obj)
    if (ignored.length > 0) derivedFieldsIgnored.push({ index: i, fields: ignored })
  }

  return {
    anchor: anchorEntry.anchor,
    objects,
    rawText: res.text,
    usage: res.usage,
    finishReason: res.finishReason ?? null,
    // 只记长度，**不落盘推理正文**：它是生产者的思维链，ticket 05 的判定者隔离
    // 明确要求判定者看不到生产者推理；把它写到盘上就等于给它留了一条回流路径。
    reasoningChars: res.reasoningChars ?? 0,
    derivedFieldsIgnored,
  }
}

/**
 * 对**整份索引**跑提取：每个锚点一次调用。
 *
 * 为什么按锚点而不是整章一次调用：本层的失败必须能定位到具体锚点（卡 04 要求
 * 「原样落盘，以便失败可归因到具体环节」），而整章一次调用只能给出「这一章有问题」。
 * 每次调用的证据也因此自洽——引文与它该命中的那一段原文在同一个请求里，这正是 05
 * 判定者需要的输入形状。整章批量的成本优化属卡 07。
 *
 * @param {Function} [opts.onAnchorDone] 每个锚点完成后回调一次，收到
 *        `{ objects, perAnchor, ledger }` 的**快照**。调用方据此做增量落盘——
 *        整章 20 次调用要跑十几分钟，中途失败若什么都不留，已付费的产出就全丢了。
 * @returns {Promise<{objects:object[], ledger:object, perAnchor:object[]}>}
 *
 * 关于 `chatImpl`：它必须**自己维护传入的 `ledger`**（calls / tokens / retries）。
 * 记账职责在客户端——只有它知道发生了几次 HTTP 尝试——因此替换客户端就得接过记账，
 * 否则回执里的用量数字会静默变成 0 而没人发现。
 */
export async function extractByAnchor({
  config,
  index,
  lines,
  anchors = index.anchors,
  createdAt,
  chatImpl,
  fetchImpl,
  ledger = createUsageLedger(),
  maxObjectsPerAnchor = DEFAULT_MAX_OBJECTS_PER_ANCHOR,
  maxTokens = DEFAULT_MAX_TOKENS,
  temperature = DEFAULT_TEMPERATURE,
  maxAttempts,
  retryDelayMs,
  onAnchorDone,
  initialObjects = [],
  initialPerAnchor = [],
}) {
  const chat = chatImpl ?? chatCompletion
  const objects = [...initialObjects]
  const perAnchor = [...initialPerAnchor]

  for (const anchorEntry of anchors) {
    const outcome = await extractAnchor({
      config,
      anchorEntry,
      sourceFile: index.sourceFile,
      lines,
      chat,
      fetchImpl,
      ledger,
      createdAt,
      maxObjectsPerAnchor,
      maxTokens,
      temperature,
      maxAttempts,
      retryDelayMs,
    })
    objects.push(...outcome.objects)
    perAnchor.push({
      anchor: outcome.anchor,
      lineStart: anchorEntry.lineStart,
      lineEnd: anchorEntry.lineEnd,
      objectIds: outcome.objects.map((o) => o.id),
      rawText: outcome.rawText,
      usage: outcome.usage,
      finishReason: outcome.finishReason,
      reasoningChars: outcome.reasoningChars,
      derivedFieldsIgnored: outcome.derivedFieldsIgnored,
    })
    // 增量落盘：每完成一个锚点就把「到目前为止」的快照交出去，使中途失败不吞掉已付费的产出。
    if (typeof onAnchorDone === 'function') {
      await onAnchorDone({
        objects: [...objects],
        perAnchor: [...perAnchor],
        ledger: { ...ledger, tokens: { ...ledger.tokens }, tokensDetail: { ...ledger.tokensDetail } },
        lastAnchor: outcome.anchor,
      })
    }
  }

  return { objects, ledger, perAnchor }
}
