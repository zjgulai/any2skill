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

import { computeFencedFlags } from './anchor-index.mjs'
import {
  OBJECT_TYPES,
  PIPELINE_REQUIRED_FIELDS,
  TYPE_BOUNDARY_CRITERIA,
  TYPE_REQUIRED_FIELDS,
  describeFieldShapes,
  objectIdFor,
} from './object-contract.mjs'
import { chatCompletion, createUsageLedger } from './llm-client.mjs'
import { extractJsonPayload } from './model-json.mjs'

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
  const base = {
    anchor: '<锚点>',
    title: '<标题>',
    lineStart: 0,
    lineEnd: 0,
    anchorText: '<正文>',
    sourceFile: '<源文件>',
  }
  const system = buildSystemPrompt({ maxObjectsPerAnchor })
  // **两种形态都要进指纹**（ticket 07）：本层现在有两套用户提示词——「整节」与「切片」。
  // 只哈希其中一套，就会让「另一套被改过」在指纹上不可见——而那正是提示词指纹存在的理由。
  const userWhole = buildUserPrompt({ ...base, slice: { index: 0, sliceCount: 1, lineStart: 0, lineEnd: 0 } })
  const userSlice = buildUserPrompt({ ...base, slice: { index: 1, sliceCount: 3, lineStart: 0, lineEnd: 0 } })
  return `prompt-${createHash('sha256')
    .update([system, userWhole, userSlice].join('\n\u0000\n'))
    .update('\n')
    .digest('hex')
    .slice(0, 12)}`
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

// ---------------------------------------------------------------------------
// 切分：超出单次输入预算的锚点按结构边界切开（ticket 07）
// ---------------------------------------------------------------------------

/**
 * 字节 → 输入 token 的换算基准。**是实测值，不是估计。**
 *
 * 实测口径（2026-10-09）：取 `run-7afb98d262b5.layer2-raw.json` 里 `chapter4.md` 全部 20 个锚点，
 * 每个锚点的 `usage.prompt_tokens` 与索引里的 `contentBytes` 做最小二乘拟合，得
 * `prompt_tokens = 1213.2 + 0.21175 × bytes`，残差 max|.| = **125.5** token。
 *
 * 复算命令见 docs/adr/ADR-017-anchor-slicing-and-input-budget.md 的「复算口径」一节。
 *
 * 因此：**1 输入 token ≈ 4.72 字节正文**，另加约 1213 token 的固定开销
 * （系统提示词 + 用户提示词模板 + 服务端 chat 模板）。
 *
 * 这两个数只用来把「字节预算」翻译成人看得懂的 token 量级，**不参与任何判据**——
 * 判据是字节数本身，因此不会随模型的换算出错而漂移。
 */
export const BYTES_PER_INPUT_TOKEN_MEASURED = 4.72
export const INPUT_TOKEN_OVERHEAD_MEASURED = 1213

/**
 * 单个锚点的正文预算（字节）。超过它才触发切分。
 *
 * **缺省值是选定的策略，不是测量结果**——说清楚这一点比数字本身重要：
 *   - 全书 336 个锚点里最大的是 `chapter10#h3-6` **16,718 字节**（实测，见 ADR-017）。
 *     按上式换算 = 1,213 + 3,542 ≈ **4,755 输入 token**。
 *   - 24,000 字节换算 ≈ 6,298 输入 token，**高于全书最大锚点**。
 *   - 因此：**缺省预算下全书没有任何锚点会被切分**。切分是为「换一本更大的书、
 *     或模型输入窗口更小」准备的容量护栏，不是当前会走到的路径。
 *     它的行为由构造出来的超预算锚点钉住（`single-chapter-batch.test.mjs`），
 *     不靠真实语料偶然触发。
 *
 * 为什么不设更小（例如 8,000）：切分会把一个锚点的语义切开，而「一节内跨段落的综合」
 * 正是最有价值的对象形态（第 2 层提示词里专门为此写过一条要求）。无必要不切。
 */
export const DEFAULT_MAX_ANCHOR_BYTES = 24000

/**
 * 把一个锚点按**结构边界**切成若干片。
 *
 * 切点只有一种：**空行且不在代码围栏内**——即 markdown 的段落边界。
 * 刻意**不做**的事：
 *   - 不按字节数硬切（会在句子中间断开，模型看到半句话）；
 *   - 不在代码围栏内切（会把一个代码块劈成两半，两半都失去意义，而代码块往往正是
 *     一段工程规则的唯一证据）。
 *
 * 单个段落自身就超出预算时，**整段交出并标 `oversized: true`**——宁可让这一次调用超预算，
 * 也不把它切断。这是本函数唯一允许超预算的出口，且它是**可见的**（进回执的 `layer2.splits`）。
 *
 * 溯源不受影响：切片只是**喂给模型的窗口**，`sourceRefs` 仍由 `materializeObject`
 * 按**锚点**（不是切片）填入，因此每个对象依旧解析到第 1 层的同一个锚点、同一个
 * `lineStart`/`lineEnd`/`contentHash`。切分因此不能、也不该被下游看见。
 *
 * @returns {{index:number, sliceCount:number, lineStart:number, lineEnd:number, bytes:number, oversized:boolean}[]}
 *          行号是**全文绝对行号**（与索引同口径），不是片内偏移。
 */
export function splitAnchorIntoSlices(anchorEntry, lines, { maxAnchorBytes = DEFAULT_MAX_ANCHOR_BYTES } = {}) {
  const start0 = anchorEntry.lineStart - 1
  const end0 = anchorEntry.lineEnd
  const bytesOf = (a, b) => Buffer.byteLength(lines.slice(a, b).join('\n'), 'utf8')

  const wholeBytes = bytesOf(start0, end0)
  if (wholeBytes <= maxAnchorBytes) {
    return [
      {
        index: 0,
        sliceCount: 1,
        lineStart: anchorEntry.lineStart,
        lineEnd: anchorEntry.lineEnd,
        bytes: wholeBytes,
        oversized: false,
      },
    ]
  }

  // 围栏标记按**整份正文**计算：锚点首行一定是标题行（围栏内的行不会被第 1 层当成标题），
  // 因此锚点起点处围栏必然是关闭的；但为了让「切点是否在围栏内」与第 1 层同口径，
  // 这里仍按全文计算，而不是只看锚点内部。
  const fenced = computeFencedFlags(lines)
  const cuts = []
  // 末尾那一行不作切点：切在它上面会产出一个空片。
  for (let i = start0; i < end0 - 1; i += 1) {
    if (lines[i].trim() === '' && !fenced[i]) cuts.push(i)
  }

  const spans = []
  let from = start0
  let pendingEnd = null
  for (const cut of cuts) {
    // 加上这一段就超预算 → 在上一个可用切点收尾。
    if (pendingEnd !== null && bytesOf(from, cut + 1) > maxAnchorBytes) {
      spans.push([from, pendingEnd + 1])
      from = pendingEnd + 1
      pendingEnd = null
    }
    // 从当前起点到本切点若仍超预算，说明中间有单个超大段落：本切点不能当片尾
    // （再往后只会更大），留着让收尾逻辑把它整段交出并标记 oversized。
    pendingEnd = bytesOf(from, cut + 1) <= maxAnchorBytes ? cut : null
  }
  // 收尾。**必须先看待收的那一片**：若「从本片起点到锚点末尾」仍超预算，就在待收切点断开。
  // 少了这一步，最后一片会把剩下的全部内容一口吞下——实测踩到：预算 265 字节、六段正文、
  // 六处可用切点，结果产出 138 / 255 / **382** 三片，最后一片比预算大 44%，
  // 而它明明还能在 `pendingEnd` 处再切一刀。**切片尺寸不对不会报错，只会让这次调用更贵、
  // 且切分机制在它本该生效的地方悄悄失效**——因此由测试逐条钉住「非超大单段不得超预算」。
  if (pendingEnd !== null && bytesOf(from, end0) > maxAnchorBytes) {
    spans.push([from, pendingEnd + 1])
    from = pendingEnd + 1
  }
  spans.push([from, end0])

  return spans.map(([a, b], i) => ({
    index: i,
    sliceCount: spans.length,
    lineStart: a + 1,
    lineEnd: b,
    bytes: bytesOf(a, b),
    oversized: bytesOf(a, b) > maxAnchorBytes,
  }))
}

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
 *
 * `slice` 是**必须显式给出**的一行（缺省按「1/1」渲染），而不是「切分时才加」：
 * 两套提示词各只在一种情况下出现，会让「模型是否知道自己在看整节」这件事
 * 无法从指纹上分辨。提示词指纹同时哈希两种形态（见 promptFingerprint）。
 *
 * 注意锚点行里的行号是**锚点**的区间，不是切片的区间——切片自己的区间单列一行。
 * 这样模型既知道自己在整节里的位置，也不会把片子当成整节。
 */
export function buildUserPrompt({ anchor, title, lineStart, lineEnd, anchorText, sourceFile, slice = null }) {
  const s = slice ?? { index: 0, sliceCount: 1, lineStart, lineEnd }
  const sliceLine =
    s.sliceCount === 1
      ? '切片：第 1 片，共 1 片（本节完整，未被切分）'
      : `切片：第 ${s.index + 1} 片，共 ${s.sliceCount} 片（本片为第 ${s.lineStart}–${s.lineEnd} 行；` +
        '本节因超出单次输入预算被**按段落边界**切分）。' +
        '本片只是这一节的一部分：**只提取本片正文承载得住的对象**，' +
        '不要因为「这一节大概还讲了别的」而补写本片里没有的内容，' +
        '也不要产出跨片综合的结论（那样的主张在本片里找不到承载它的引文）。'
  return [
    `内容源：${sourceFile}`,
    `锚点：${anchor}（第 ${lineStart}–${lineEnd} 行，标题：${title}）`,
    sliceLine,
    '',
    '正文如下（--- 之间，含标题行）：',
    '---',
    anchorText,
    '---',
  ].join('\n')
}

/**
 * 从响应文本里取出 JSON。
 *
 * 实现搬到了 `model-json.mjs`——**四个解析器（第 2 层 / 判定者 / 主题提案 / 跨章综合）
 * 曾各自抄了一份同样的、未锚定的围栏正则**，2026-10-11 全书首跑的 6 例失败全部出在这里：
 * 响应本来合法，是解析器把字符串**内部**的代码围栏当成了外层壳。修一次四处都修好，
 * 见该模块的注释。
 *
 * 本函数只做「把裸解析结果包成 `Layer2Error`」这一件本层特有的事——
 * 错误类型不能统一，`run.mjs` 靠它把失败归到 `layer2-response` 这个 kind。
 *
 * @throws {Layer2Error} 三种形态都取不出合法 JSON 时，附上原文（`rawText`）供事后归因
 */
export function parseModelPayload(text) {
  const result = extractJsonPayload(text)
  if (result.ok) return result.value
  throw new Layer2Error(`第 2 层响应不是可解析的 JSON：${result.diagnostic}`, {
    rawText: String(text ?? ''),
  })
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

/** 从服务商的 usage 对象里取输入/输出 token；取不到就是 null（**不估算**）。 */
export function usageTokensOf(usage) {
  if (!usage || typeof usage !== 'object') return null
  const input = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : null
  const output = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : null
  if (input === null && output === null) return null
  return { input: input ?? 0, output: output ?? 0 }
}

/**
 * 对**一个锚点**跑一次提取。锚点超出单次输入预算时，内部按结构边界切成若干片分别调用。
 *
 * 三件与切分相关的性质，都在这里落实：
 *   1. **序号连续**：`seq` 是「该锚点内第几条」的**跨片累计**值（从 `carriedObjects.length + 1`
 *      起算）。因此对象 id 只取决于「锚点 + 该锚点内的次序」，与切法无关——同一锚点两次运行
 *      产出同一 id，这才让「重跑不产生新 id」在切分条件下依然成立。
 *   2. **出处指向锚点**：`sourceRefs` 由 `materializeObject` 按 `anchorEntry` 填，
 *      切片窗口不进出处。切分因此对第 3 层完全不可见。
 *   3. **可续**：`startSlice` / `carriedObjects` 让「上一片已付费跑完、下一片没跑」的
 *      中断点可以从片中间续上，而不是把整节重跑一遍。
 *
 * @param {number} [opts.startSlice] 从第几片开始跑（断点续跑；缺省 0）
 * @param {object[]} [opts.carriedObjects] `startSlice` 之前那些片已经产出的对象
 * @param {Function} [opts.onSliceDone] 每跑完**一片**回调一次，收到
 *        `{objects, slices, slice, index, sliceCount}` 的**快照**。
 * @returns {Promise<{anchor:string, objects:object[], slices:object[], sliceCount:number,
 *   rawText:string|null, usage:object|null, finishReason:string|null, reasoningChars:number,
 *   derivedFieldsIgnored:object[], oversizedSlices:number[], usageTotals:object}>}
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
  maxAnchorBytes = DEFAULT_MAX_ANCHOR_BYTES,
  startSlice = 0,
  carriedObjects = [],
  onSliceDone,
}) {
  const chatFn = chat ?? chatCompletion
  const slices = splitAnchorIntoSlices(anchorEntry, lines, { maxAnchorBytes })
  const chapterRef = anchorEntry.anchor.replace('#', '-')

  const objects = [...carriedObjects]
  const sliceRecords = []
  const derivedFieldsIgnored = []
  let usageTotals = { calls: 0, tokens: { input: 0, output: 0 } }

  for (let s = startSlice; s < slices.length; s += 1) {
    const slice = slices[s]
    const anchorText = lines.slice(slice.lineStart - 1, slice.lineEnd).join('\n')
    const system = buildSystemPrompt({ maxObjectsPerAnchor })
    const user = buildUserPrompt({
      anchor: anchorEntry.anchor,
      title: anchorEntry.title,
      lineStart: anchorEntry.lineStart,
      lineEnd: anchorEntry.lineEnd,
      anchorText,
      sourceFile,
      slice,
    })

    const res = await chatFn(config, {
      system,
      user,
      maxTokens,
      temperature,
      fetchImpl,
      ledger,
      maxAttempts,
      retryDelayMs,
    })
    const payload = parseModelPayload(res.text)
    const records = extractObjectList(payload)
    const before = objects.length
    for (let i = 0; i < records.length; i += 1) {
      const { obj, ignored } = materializeObject(records[i], {
        anchorEntry,
        sourceFile,
        // 跨片累计：切法变了也不会让已有对象的 id 漂移（除非对象的**次序**本身变了）。
        seq: objects.length + 1,
        createdAt,
        chapterRef,
      })
      objects.push(obj)
      if (ignored.length > 0) {
        derivedFieldsIgnored.push({ index: objects.length - 1, slice: slice.index, fields: ignored })
      }
    }
    const produced = objects.slice(before)

    const tokens = usageTokensOf(res.usage)
    if (tokens !== null) {
      usageTotals = {
        calls: usageTotals.calls + 1,
        tokens: {
          input: usageTotals.tokens.input + tokens.input,
          output: usageTotals.tokens.output + tokens.output,
        },
      }
    } else {
      usageTotals = { ...usageTotals, calls: usageTotals.calls + 1 }
    }

    const record = {
      index: slice.index,
      lineStart: slice.lineStart,
      lineEnd: slice.lineEnd,
      bytes: slice.bytes,
      oversized: slice.oversized,
      objectIds: produced.map((o) => o.id),
      objectCount: produced.length,
      rawText: res.text,
      usage: res.usage ?? null,
      finishReason: res.finishReason ?? null,
      // 只记长度，**不落盘推理正文**：它是生产者的思维链，ticket 05 的判定者隔离
      // 明确要求判定者看不到生产者推理；把它写到盘上就等于给它留了一条回流路径。
      reasoningChars: res.reasoningChars ?? 0,
    }
    sliceRecords.push(record)

    if (typeof onSliceDone === 'function') {
      await onSliceDone({
        objects: [...objects],
        slices: slices.map((x) => ({ ...x })),
        slice,
        index: slice.index,
        sliceCount: slices.length,
      })
    }
  }

  return {
    anchor: anchorEntry.anchor,
    objects,
    slices: slices.map((x) => ({ ...x })),
    sliceCount: slices.length,
    // 单片时 rawText 与切片记录里那份逐字相同（字段类型不变，老消费者不受影响）。
    // 多片时**不拼接**：把三份响应拼成一个字符串会伪造出「一次调用回了这些」的假记录。
    rawText: slices.length === 1 ? (sliceRecords[0]?.rawText ?? null) : null,
    usage: slices.length === 1 ? (sliceRecords[0]?.usage ?? null) : null,
    finishReason: slices.length === 1 ? (sliceRecords[0]?.finishReason ?? null) : null,
    reasoningChars: sliceRecords.reduce((n, r) => n + (r.reasoningChars ?? 0), 0),
    derivedFieldsIgnored,
    oversizedSlices: slices.filter((x) => x.oversized).map((x) => x.index),
    usageTotals,
    sliceRecords,
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
  maxAnchorBytes = DEFAULT_MAX_ANCHOR_BYTES,
  onAnchorDone,
  initialObjects = [],
  initialPerAnchor = [],
  resumeInFlight = null,
}) {
  const chat = chatImpl ?? chatCompletion
  const objects = [...initialObjects]
  const perAnchor = [...initialPerAnchor]

  for (const anchorEntry of anchors) {
    // 断点续跑可以停在**片中间**：上一片已付费产出、下一片没跑。此时该锚点还不能算完成
    // （它的 perAnchor 条目尚未写入），因此续跑点只能是「最后一个已完成锚点之后的那一个」。
    const inFlight =
      resumeInFlight !== null && resumeInFlight.anchor === anchorEntry.anchor ? resumeInFlight : null

    if (inFlight !== null) {
      // 半成品里「在跑锚点」的那些对象是已产出对象的**尾部**（它们在收尾那次落盘时最后写入）。
      // 这里显式核对这条不变量，而不是默认它成立：续错位置会**静默重复产出或丢对象**，
      // 而两者都不会在计数上露出破绽（总数看起来一样）。
      const tail = objects.slice(objects.length - inFlight.objects.length)
      const same =
        tail.length === inFlight.objects.length &&
        tail.every((o, i) => o?.id === inFlight.objects[i]?.id)
      if (!same) {
        throw new Layer2Error(
          `断点续跑：半成品里「正在跑」的锚点 ${anchorEntry.anchor} 的 ${inFlight.objects.length} 个对象` +
            '不是已产出对象的尾部——拒绝续跑（续错位置会重复产出或丢对象，而两者都不会在计数上露出破绽）。' +
            '请传 --no-resume 从头跑，或删掉半成品文件。',
        )
      }
      objects.length = objects.length - inFlight.objects.length
    }

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
      maxAnchorBytes,
      startSlice: inFlight === null ? 0 : inFlight.slicesDone,
      carriedObjects: inFlight === null ? [] : inFlight.objects,
      onSliceDone: async ({ objects: snapshot, index: sliceIndex, sliceCount }) => {
        if (typeof onAnchorDone !== 'function') return
        // 每片都落一次盘：整章要跑十几分钟，而一次超预算锚点的切分可能是 3–4 次调用；
        // 只在锚点收尾时落盘，会让「跑到第 3 片时进程被杀」白丢前两片的钱。
        await onAnchorDone({
          objects: snapshot,
          perAnchor: [...perAnchor],
          inFlight: { anchor: anchorEntry.anchor, slicesDone: sliceIndex + 1, sliceCount },
          ledger: { ...ledger, tokens: { ...ledger.tokens }, tokensDetail: { ...ledger.tokensDetail } },
          lastAnchor: anchorEntry.anchor,
        })
      },
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
      sliceCount: outcome.sliceCount,
      slices: outcome.sliceRecords,
      oversizedSlices: outcome.oversizedSlices,
      usageTotals: outcome.usageTotals,
    })
    // 锚点收尾后再落一次：这一次把 inFlight 清空，使半成品文件里的
    // 「已完成锚点数」能往前推进一格。
    if (typeof onAnchorDone === 'function') {
      await onAnchorDone({
        objects: [...objects],
        perAnchor: [...perAnchor],
        inFlight: null,
        ledger: { ...ledger, tokens: { ...ledger.tokens }, tokensDetail: { ...ledger.tokensDetail } },
        lastAnchor: outcome.anchor,
      })
    }
  }

  return { objects, ledger, perAnchor }
}
