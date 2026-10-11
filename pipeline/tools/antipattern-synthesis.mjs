/**
 * 跨章综合（ticket 06）——按主题组织输入，产出真正跨章的反模式。
 *
 * ## 本模块要做对的三件事
 *
 * **一、输入按主题组织，不按章节。** 一个主题的输入是该主题名下**全书的**锚点正文，
 * 按**主题提案给出的顺序**拼接（提案顺序是模型对主题的组织方式，不是文件顺序——按文件重排
 * 就等于把主题组织换回章节组织，那正是本卡要换掉的东西）。每个锚点带自己的标识与标题，
 * 使模型能逐条引用；正文**逐字给出**，使「引文在锚点区间内逐字命中」这条判据的比对范围
 * 与模型看到的范围一致（与第 2 层同一条理由）。
 *
 * **二、每条出处都要自己带引文。** 模型产出 `supportingAnchors: [{anchor, quote}]`，
 * 本模块把每条锚点落成一条 `sourceRef`，**引文挂在它自己那条 sourceRef 上**。
 * 第 3 层逐条比对（见 verifier 的 `refQuoteComparisons`）。这是把「跨章」从**自述**
 * 变成**可验证的事实**的那一步：多写一条出处不花成本，所以不逐条验就等于没验。
 *
 * **三、主张的粒度跟着判定者的视野走。** 这一点是本轮的**已知约束**，不是设计偏好：
 * 判定者的输入契约（卡 05 的 `JUDGE_INPUT_KEYS`）原先只给「主张 + 一条引文 + **那一个**锚点的原文」，
 * 因此一条主张若把两章的结论**合并**成一个更大的断言，主引文一个人扛不住，判定者会（正确地）
 * 判不充分——ADR-011 记录的 AntiPattern 100% 不充分就是这条路的终点。
 *
 * ⚠️ **契约已于 `judge-prompt/v2` 变更**（本节原文如此，保留不改，便于对照）：判定者现在看到
 * 对象声明的**全部**锚点区间，主张可以由任意一段承载，不必由主锚点单独承载。触发这次变更的实测
 * 数字是：跨章 16 条被拒 5 条，其中 `AP-SYNTH-T02-01` 的拒绝理由要的那句话**逐字就在该对象
 * 第二条锚点里**——旧契约让它按结构看不到；同一批里单章提取 39 条则 39/39 全过。
 * 「先把数字跑出来再决定改不改契约」这条自我约束已经执行完毕，见 `docs/adr/` 的判据修订记录。
 *
 * ✅ **系统提示词 §3 已重新对齐**（`judge-prompt/v2` 之后的第二步，此前记为「尚未重新对齐」）。
 * 旧 §3 要求「主张必须收窄到主锚点能承载的粒度」，那是照着**旧**判定者的输入写的；判定者放宽后
 * 这条要求就成了一条**比判据更紧**的自我限制——它只会让产出更保守，但也让跨章综合的收益
 * （合并两章结论）系统地拿不到。新 §3 把支撑范围改成「你声明的全部锚点段落」，并把两条边界
 * 写清楚：**引文是「点名」不是「唯一依据」**（允许合并），**但不得超出声明的段落**
 * （判定者看不到没声明的内容）。
 *
 * ⚠️ **代价（必须与收益一起读）**：§3 是系统提示词的一部分，因此它的指纹进了**生产者身份**
 * （`synthRawRunId`），改它等于宣布此前所有主题的原始响应作废——已付费的 T02/T12 必须重买。
 * 这是「提示词一改，产出就不对应」这条既有纪律的正常后果，不是本次引入的缺陷。
 *
 * ## 与第 2 层的关系
 *
 * 本模块与 `layer2-extractor.mjs` 占**不同的接口位置**：那个是「一个锚点一次调用」，
 * 这个是「一个主题一次调用」。两者共用的是同一条纪律——**模型只管知识，身份与出处由流水线
 * 确定性填入**——而不是同一份提示词。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { OBJECT_TYPES } from './object-contract.mjs'
import { chatCompletion } from './llm-client.mjs'
import { normalizeSourceLines } from './anchor-index.mjs'

export class SynthesisError extends Error {
  constructor(message, { rawText = null } = {}) {
    super(message)
    this.name = 'SynthesisError'
    this.rawText = rawText
  }
}

/** 综合产物的对象标识前缀。它同时就是「这条不是抽出来的、是综合出来的」的标记。 */
export const SYNTH_ID_PREFIX = 'AP-SYNTH'

/**
 * 输出上限（**含推理 token**）。
 *
 * 取 32000，而不是沿用第 2 层的 16000——依据是一次**实测的失败**：
 * T12（6 章 / 39 KB 输入）在 16000 下被截断，`finish_reason=length`，
 * 响应停在第五条对象的一个未闭合字符串上，JSON 解析失败。
 * 6 个章节的输入会让模型先做一轮很长的跨章比对，那部分推理与正文**共用**这一个额度；
 * 额度卡在推理上时的表象是「JSON 坏了」，而真实原因是预算不够——
 * 一个成本问题伪装成一个解析问题，是最难归因的一种失败。
 */
export const DEFAULT_SYNTH_MAX_TOKENS = 32000
export const DEFAULT_SYNTH_TEMPERATURE = 0

/**
 * 每个主题最多产出多少条反模式。
 *
 * 与第 2 层的 `maxObjectsPerAnchor` 同理：它是一个**成本旋钮**，不是质量判据。
 * 8 的依据是原书每个 skill 有 6–8 条「常见陷阱」——一个主题对应的正是这一类粒度。
 */
export const DEFAULT_MAX_PATTERNS_PER_THEME = 8

/**
 * 反模式的**标记**（ticket 06）。
 *
 * 与 `REASON_CODES` **分开**是刻意的：那几个码的语义是「这个对象被拒绝了」，
 * 而这三个标记描述的是「这个对象成立，但它的跨章支撑到什么程度」。把它们混进拒绝码表，
 * 会让「被拒」与「通过了、但支撑只有一章」在统计里长得一样。
 *
 * `CROSS_CHAPTER_CLAIM_UNSUPPORTED` 是卡 06 指定的**「抄取冒充综合」检出点**：
 * 它抓的是「声称跨章、实际只有一章」——对象引用了 ≥2 个锚点（看起来做了综合），
 * 但这些锚点解析后全部落在同一章里。单看 sourceRefs 的**条数**看不出来，
 * 必须看**去重后的章节数**。
 */
export const ANTIPATTERN_MARKS = Object.freeze([
  'CROSS_CHAPTER_SUPPORTED',
  'SINGLE_CHAPTER_ONLY',
  'CROSS_CHAPTER_CLAIM_UNSUPPORTED',
])

export const MARK_MEANING = Object.freeze({
  CROSS_CHAPTER_SUPPORTED: 'sourceRefs 覆盖 ≥2 个章节——跨章支撑成立',
  SINGLE_CHAPTER_ONLY: 'sourceRefs 只覆盖 1 个章节——单章反模式（可能是合法的，但不得声称跨章）',
  CROSS_CHAPTER_CLAIM_UNSUPPORTED:
    '引用 ≥2 个锚点、去重后却只落在 1 个章节，且主题输入跨 ≥2 章——「抄取冒充综合」的检出点',
})

/** 系统提示词。跨章综合的全部要求都在这里，且每一条都对应一个会被机器检验的东西。 */
export function buildSynthSystemPrompt({ maxPatterns = DEFAULT_MAX_PATTERNS_PER_THEME } = {}) {
  return [
    '你是「反模式综合器」。输入是同一**主题**下的多段原文，这些段落来自这本书的**不同章节**，',
    '每段都带自己的出处标识（形如 chapter5#h2-2）。',
    '',
    '你的任务：综合出这个主题下的**反模式**——即书中警告过的失败做法。',
    '这不是摘要，是**归纳**：书里往往没有一节叫「常见陷阱」，同一个坑可能在第 5 章讲做法时被提及、',
    '在第 7 章讲失效时被说透、在第 10 章讲规避时被补上。你要把它们合成一条完整的反模式。',
    '',
    '## 硬性要求',
    '',
    '1. **每条反模式必须给出它在各章节的支撑**：`supportingAnchors` 是一个数组，每条含',
    '   `anchor`（**逐字复制**上文给出的出处标识）与 `quote`（该段原文里的**逐字连续片段**）。',
    '   你要为**每一个**你声称提供支撑的章节各给一条引文。只给部分章节的引文，',
    '   等于声称了没有证据的支撑。',
    '2. **第一条 supportingAnchors 是主锚点**：`evidenceQuote` 必须**逐字等于**它的 `quote`。',
    '   顺序有意义，不要把主锚点排在后面。',
    '3. **主张的支撑范围 = 你声明的全部锚点段落。** `pattern` 与 `harm` 合起来构成这条反模式的',
    '   主张。独立判定者会拿到**你声明的每一段锚点原文**来判断这些段落是否支撑该主张——',
    '   因此主张里的**每一条断言**都要能在这些段落里读出来；读不出来的断言会被判不充分。',
    '   两条边界都要说清楚：',
    '   ① **引文是「点名」，不是「唯一依据」。** 把两章的结论合成一个更大的断言是**允许的**，',
    '      只要那个断言确实由这些段落共同承载——判定者看得到全部段落，不再只看主锚点那一段。',
    '   ② **但不得超出这些段落。** 判定者看不到你没声明的内容，书里别处的支持等于没有支持。',
    '      若某条断言只能由你自己的概括推出、任何一段声明原文里都没有对应文字，就删掉它。',
    '   主锚点那一段的分量没有降低：`evidenceQuote` 仍须逐字等于主引文（第 2 条），',
    '   它应当是最直接说出这个失败做法的那一段。宁可产出几条窄而实的，不要一条宽而虚的。',
    '4. **引文必须逐字复制**：不得改写、不得拼接、不得翻译、不得添加原文没有的标点。',
    '   第 3 层会把每条引文与**它自己那条出处的区间**做逐字比对，并对不上就拒绝整个对象。',
    '   引文长度上限 400 字。',
    '5. 不要输出 id / revision / status / createdAt / sourceRefs / evidenceRefs / chapterRef——',
    '   这些由流水线按锚点确定性填入；你若提供了它们，会被忽略。',
    '6. `chapterRef` 由流水线取主锚点所在章节填入，你不要给。',
    '7. 字段形状：`pattern`/`harm`/`corrective` 是字符串；`evidence` 是数组（至少 1 项）；',
    '   `corrective` 要写**该怎么做**，不是「不要犯错」这类空话。',
    `8. 本主题最多产出 ${maxPatterns} 条。若这些段落确实不承载任何失败做法，返回 {"objects": []}。`,
    '   不要为了凑数编造：第 3 层逐字校验引文，编造的内容一定被拒。',
    '9. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"objects": [',
    '     {"objectType": "AntiPattern",',
    '      "supportingAnchors": [{"anchor": "<主锚点标识>", "quote": "<逐字引文>"},',
    '                            {"anchor": "<另一章出处标识>", "quote": "<逐字引文>"}],',
    '      "evidenceQuote": "<逐字等于主锚点的 quote>",',
    '      "pattern": "<失败做法是什么>", "harm": "<它造成什么损害>",',
    '      "corrective": "<应该怎么做>", "evidence": ["<书中支持该判断的原文要点>"]}',
    '   ]}',
  ].join('\n')
}

/** 提示词指纹。与本层实现同级进回执——换提示词必须看得见。 */
export function synthPromptFingerprint({ maxPatterns = DEFAULT_MAX_PATTERNS_PER_THEME } = {}) {
  const system = buildSynthSystemPrompt({ maxPatterns })
  return `prompt-${createHash('sha256').update(system).update('\n').digest('hex').slice(0, 12)}`
}

/**
 * 用户提示词：**一个主题的**多章段落。
 *
 * 分段而不是平铺：模型必须能把 `quote` 精确对回某一个锚点，因此每段的边界必须显式。
 */
export function buildSynthUserPrompt({ theme, sources }) {
  const blocks = sources.map((s) => {
    return [
      `<出处 ${s.anchor}>  ${s.title}（${s.file} 第 ${s.lineStart}–${s.lineEnd} 行）`,
      s.text,
      `</出处 ${s.anchor}>`,
    ].join('\n')
  })

  return [
    `主题：${theme.id} ${theme.name}`,
    `主题说明：${theme.statement}`,
    '',
    `本主题共 ${sources.length} 段原文，来自 ${theme.chapterKeys.length} 个章节：${theme.chapterKeys.join('、')}。`,
    '请综合出这个主题下的反模式。',
    '',
    blocks.join('\n\n'),
  ].join('\n')
}

/** 从响应文本里取出 JSON（去壳，不修补）。 */
export function parseSynthPayload(text) {
  const raw = String(text ?? '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = (fenced ? fenced[1] : raw).trim()
  try {
    return JSON.parse(body)
  } catch (err) {
    const start = body.indexOf('{')
    const end = body.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(body.slice(start, end + 1))
      } catch {
        /* 落到下面的报错 */
      }
    }
    throw new SynthesisError(`综合响应不是可解析的 JSON：${err.message}`, { rawText: raw })
  }
}

/** 从解析结果里取对象列表。形状不符即报错，不静默当作空列表。 */
export function extractSynthObjectList(payload) {
  if (payload && typeof payload === 'object' && Array.isArray(payload.objects)) return payload.objects
  throw new SynthesisError(
    `综合响应里没有 objects 数组（顶层键：${
      payload && typeof payload === 'object' ? Object.keys(payload).join(', ') || '无' : typeof payload
    }）`,
  )
}

/** 由主题与会话内的序号确定性生成对象 id。重跑不产生新 id。 */
export function synthesizedIdFor(themeId, seq) {
  if (!/^T\d{2,}$/.test(themeId)) {
    throw new SynthesisError(`主题 id 不合 T\\d{2,}：${JSON.stringify(themeId)}`)
  }
  const id = `${SYNTH_ID_PREFIX}-${themeId}-${String(seq).padStart(2, '0')}`
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(id)) {
    throw new SynthesisError(`由主题派生出的标识不合 identifier 正则：${id}`)
  }
  return id
}

/** 由 `sources/…/chapter5.md` 取 `chapter5`。 */
export function chapterKeyOf(file) {
  return String(file ?? '').replace(/^.*\//, '').replace(/\.md$/, '')
}

/**
 * 把模型产出的一条记录补成完整的 AntiPattern 对象。
 *
 * 纪律与第 2 层一致：**模型只管知识，身份与出处由流水线确定性填入**。
 * 这里多了一层——`sourceRefs` 不再是「那一个锚点」，而是**模型声称的全部支撑锚点**，
 * 且每条挂上它自己的引文。
 *
 * 解析不到的锚点：**不静默丢弃**。它们进 `unresolvedAnchors`（进回执），
 * 且**不被计入 sourceRefs**——因为一条解析不到的出处不构成任何支撑。
 * 若因此一条 sourceRef 都不剩，对象仍落盘且 `sourceRefs` 为空数组：
 * 第 3 层会以 `REFERENCE_MISSING` 拒绝它。**不在本层替它判死**——
 * 「第 2 层不判定对错」这条纪律在这里同样适用，否则失败就无法归因到具体环节。
 */
export function materializeSynthesizedAntiPattern(rec, ctx) {
  const src = rec && typeof rec === 'object' ? rec : {}
  const { theme, anchorEntries, createdAt, seq } = ctx

  const rawObjectType = typeof src.objectType === 'string' ? src.objectType : null
  const objectType = rawObjectType ?? 'AntiPattern'
  const id =
    rawObjectType !== null && OBJECT_TYPES.includes(rawObjectType)
      ? synthesizedIdFor(theme.id, seq)
      : rawObjectType === null
        ? synthesizedIdFor(theme.id, seq)
        : // 模型给了契约外的类型：仍落盘，id 退化为必定通不过 identifier 正则的占位标识，
          // 让第 3 层如实报出 SCHEMA_INVALID（与第 2 层同一处理）。
          `${SYNTH_ID_PREFIX}-${theme.id}-UNKNOWN-${String(seq).padStart(2, '0')}`

  const cited = Array.isArray(src.supportingAnchors) ? src.supportingAnchors : []
  const sourceRefs = []
  const unresolvedAnchors = []
  const citedAnchors = []
  const seen = new Set()
  for (const item of cited) {
    const token = typeof item?.anchor === 'string' ? item.anchor.trim() : ''
    if (token === '') continue
    if (!seen.has(token)) {
      seen.add(token)
      citedAnchors.push(token)
    }
    const entry = anchorEntries.get(token)
    if (!entry) {
      unresolvedAnchors.push(token)
      continue
    }
    // 只认**主题自己**的锚点。模型引用了不在本主题输入里的锚点，属于「引用了它没看到的东西」，
    // 与本主题无关，按未解析处理——否则一个幻觉锚点只要能全仓解析到，就会被当成有效支撑。
    if (!theme.anchors.some((a) => a.anchor === token)) {
      unresolvedAnchors.push(token)
      continue
    }
    const ref = {
      file: entry.file,
      anchor: entry.anchor,
      title: entry.title,
      lineStart: entry.lineStart,
      lineEnd: entry.lineEnd,
      contentHash: entry.contentHash,
    }
    if (typeof item?.quote === 'string' && item.quote !== '') ref.quote = item.quote
    sourceRefs.push(ref)
  }

  const primary = sourceRefs[0] ?? null

  const payload = { ...src }
  for (const f of [
    'id',
    'revision',
    'status',
    'createdAt',
    'sourceRefs',
    'evidenceRefs',
    'chapterRef',
    'supportingAnchors',
    'objectType',
    // `evidenceQuote` 必须一起删：本对象在下面用**主锚点的引文**重新接线它，
    // 而 `...payload` 展开在最后——漏删这一项会让模型的版本覆盖流水线的版本，
    // 且因为模型多半写的是同一句话，这个覆盖**看上去什么也没发生**。
    // 实测踩到：测试「evidenceQuote 由主锚点的引文接线而来」就是这么红起来的。
    'evidenceQuote',
  ]) {
    delete payload[f]
  }

  // 主引文由**流水线的接线**决定，而不是让模型给两遍：`evidenceQuote` 与主锚点的引文必须是
  // 同一个值，而判定者拿 `evidenceQuote` 对着主锚点原文做判断。让模型写两遍，
  // 两处不一致时的失败形态是「引文与主张的关系看起来没问题、但判定者看的是另一句」。
  const evidenceQuote = primary?.quote ?? src.evidenceQuote

  const obj = {
    id,
    objectType,
    revision: 1,
    status: 'candidate',
    createdAt,
    // 综合物不是「在某一段里观察到」的，是从多段推导出来的。用 E2-derived 如实标注，
    // 使下游能区分「书上这么写的」与「归纳出来的」。第 2 层抽出来的对象用 E1-observed。
    evidenceGrade: 'E2-derived',
    freshness: { state: 'fresh', asOf: createdAt },
    sourceRefs,
    ...(evidenceQuote === undefined ? {} : { evidenceQuote }),
    ...(primary === null ? {} : { chapterRef: chapterKeyOf(primary.file) }),
    ...payload,
  }

  return { obj, unresolvedAnchors, citedAnchors }
}

/**
 * 同主题内按 `corrective` **精确相等**合并（卡 06 的判据：字段值完全相同，不引入语义相似度）。
 *
 * 为什么是精确相等而不是相似度：卡 06 明令不预设阈值，而相似度必须有一个阈值才有输出。
 * 宁可漏合（两条本该合并的留着），也不要凭一个凭空定的数字去合并不同的东西。
 *
 * 合并只发生在**同一主题内**。跨主题若出现完全相同的 `corrective`，**只报告不合并**——
 * 强行合并会抹掉主题归属，而主题归属正是本卡的组织方式本身。
 */
export function mergeByExactCorrective(objects, { themeId }) {
  const byCorrective = new Map()
  const merged = []
  const records = []

  for (const obj of objects) {
    const key = typeof obj.corrective === 'string' && obj.corrective !== '' ? obj.corrective : null
    if (key === null) {
      merged.push(obj)
      continue
    }
    const hit = byCorrective.get(key)
    if (hit === undefined) {
      byCorrective.set(key, obj)
      merged.push(obj)
      continue
    }
    // 合并：并上后面那条的 sourceRefs，去掉与已有出处完全重复的那些。
    const existing = new Set(hit.sourceRefs.map((r) => `${r.file}::${r.anchor}`))
    const added = obj.sourceRefs.filter((r) => !existing.has(`${r.file}::${r.anchor}`))
    hit.sourceRefs.push(...added)
    // **声称**的锚点也要并集。少了这一行，「引用了几条锚点」在合并后会偏小，
    // 于是 `CROSS_CHAPTER_CLAIM_UNSUPPORTED` 那个检出点恰好会漏掉
    // 「两条同 corrective 的单章记录被合并、看起来像跨章」这一种形态——
    // 而它正是最像「抄取冒充综合」的一种。
    const citedBefore = Array.isArray(hit.__citedAnchors) ? hit.__citedAnchors : []
    const citedAfter = Array.isArray(obj.__citedAnchors) ? obj.__citedAnchors : []
    hit.__citedAnchors = [...new Set([...citedBefore, ...citedAfter])]
    records.push({
      themeId,
      keptId: hit.id,
      mergedId: obj.id,
      corrective: key,
      addedSourceRefs: added.map((r) => r.anchor),
      distinctCorrectiveMatch: 'exact',
    })
  }

  return { objects: merged, merges: records }
}

/**
 * 给一条对象打跨章标记。
 *
 * 「声称跨章」的机械定义：该对象**引用了 ≥2 个锚点**，而主题输入本身跨 ≥2 章，
 * 但这些锚点解析后**全部落在同一章**。它比「只有一条 sourceRef」更可疑——
 * 后者看起来就是单章的，前者**看起来像做了综合**。
 */
export function markForAntiPattern(obj, { theme }) {
  const chapters = [...new Set(obj.sourceRefs.map((r) => chapterKeyOf(r.file)))]
  if (chapters.length >= 2) {
    return { mark: 'CROSS_CHAPTER_SUPPORTED', chapters }
  }
  const citedCount = Array.isArray(obj.__citedAnchors) ? obj.__citedAnchors.length : obj.sourceRefs.length
  if (citedCount >= 2 && theme.chapterKeys.length >= 2) {
    return { mark: 'CROSS_CHAPTER_CLAIM_UNSUPPORTED', chapters }
  }
  return { mark: 'SINGLE_CHAPTER_ONLY', chapters }
}

/**
 * 真实分布（卡 06 要求的四项 + 逐条明细，供复算比对）。
 *
 * 四项：反模式总数、引用 ≥2 个章节的条数、跨章占比、被引用章节的分布。
 * **不设任何阈值**——本函数只报数，不判定「够不够」。
 */
export function buildDistribution(marks) {
  const total = marks.length
  const multiChapter = marks.filter((m) => m.mark === 'CROSS_CHAPTER_SUPPORTED').length
  const chaptersCited = {}
  for (const m of marks) {
    for (const c of m.chapters) chaptersCited[c] = (chaptersCited[c] ?? 0) + 1
  }
  const byMark = {}
  for (const code of ANTIPATTERN_MARKS) {
    const n = marks.filter((m) => m.mark === code).length
    if (n > 0) byMark[code] = n
  }

  return {
    total,
    multiChapter,
    // 比值用**精确有理数**给出，同时附一个小数方便阅读。小数是四舍五入的展现，
    // 有理数才是口径本身——只给小数会让「占比 0.67」在下游被当成精确值参与运算。
    crossChapterRatio: {
      numerator: multiChapter,
      denominator: total,
      decimal: total === 0 ? null : Number((multiChapter / total).toFixed(4)),
    },
    chaptersCited,
    byMark,
    perObject: marks.map((m) => ({
      id: m.id,
      themeId: m.themeId,
      mark: m.mark,
      chapters: m.chapters,
      sourceRefCount: m.sourceRefCount,
      citedAnchorCount: m.citedAnchorCount,
      unresolvedAnchorCount: m.unresolvedAnchorCount,
    })),
  }
}

/** 把一个主题的锚点正文取出来（按主题给出的顺序）。 */
export function collectThemeSources({ theme, linesByFile }) {
  return theme.anchors.map((a) => {
    const lines = linesByFile[a.fileKey]
    if (lines === undefined) {
      throw new SynthesisError(`主题 ${theme.id} 引用了未载入的源文件：${a.fileKey}`)
    }
    return {
      file: a.file,
      fileKey: a.fileKey,
      anchor: a.anchor,
      title: a.title,
      lineStart: a.lineStart,
      lineEnd: a.lineEnd,
      text: lines.slice(a.lineStart - 1, a.lineEnd).join('\n'),
    }
  })
}

/** 载入源文件的行（与第 1 层同一归一化口径）。 */
export async function loadThemeSourceLines({ theme, repoRoot }) {
  const linesByFile = {}
  for (const a of theme.anchors) {
    if (linesByFile[a.fileKey] !== undefined) continue
    const raw = await readFile(path.join(repoRoot, a.file), 'utf8')
    linesByFile[a.fileKey] = normalizeSourceLines(raw)
  }
  return linesByFile
}

/**
 * 对一个主题跑一次综合。
 *
 * @returns {Promise<{objects:object[], marks:object[], merges:object[], rawText:string,
 *                    usage:object|null, unresolvedAnchors:object[], themeId:string}>}
 */
export async function synthesizeTheme({
  config,
  theme,
  linesByFile,
  anchorEntries,
  chat,
  fetchImpl,
  ledger,
  createdAt,
  maxPatterns = DEFAULT_MAX_PATTERNS_PER_THEME,
  maxTokens = DEFAULT_SYNTH_MAX_TOKENS,
  temperature = DEFAULT_SYNTH_TEMPERATURE,
  maxAttempts,
  retryDelayMs,
}) {
  const chatFn = chat ?? chatCompletion
  const sources = collectThemeSources({ theme, linesByFile })
  const system = buildSynthSystemPrompt({ maxPatterns })
  const user = buildSynthUserPrompt({ theme, sources })

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

  let payload
  try {
    payload = parseSynthPayload(res.text)
  } catch (err) {
    // 截断必须**被报成截断**。第一版把它报成「不是可解析的 JSON」，于是
    // 「输出预算不够」在日志里长得像「模型输出格式坏了」——两者的修法完全相反
    // （调大额度 vs 改提示词），而前者只要一行参数。
    if (res.finishReason === 'length') {
      throw new SynthesisError(
        `主题 ${theme.id} 的响应在输出上限处被截断（finish_reason=length），JSON 未闭合。` +
          `**这是预算问题，不是解析问题**：推理与正文共用同一个额度，` +
          `调大 --max-tokens（本次 ${maxTokens}）或缩小该主题的输入。` +
          `原始响应已附在本错误上，可从 partial 文件取回，无需重新付费。`,
        { rawText: res.text },
      )
    }
    throw err
  }
  const records = extractSynthObjectList(payload)

  return materializeThemeResult({
    records,
    theme,
    anchorEntries,
    createdAt,
    maxPatterns,
    rawText: res.text,
    usage: res.usage ?? null,
    finishReason: res.finishReason ?? null,
    reasoningChars: res.reasoningChars ?? 0,
    inputBytes: Buffer.byteLength(user, 'utf8'),
  })
}

/**
 * 把**一次模型响应**变成统一形状的主题结果（物化 + 合并 + 标记）。
 *
 * ## 为什么把它从 `synthesizeTheme` 里拆出来
 *
 * 因为它是**免费**的那一半，而调模型是**花钱**的那一半。拆开之后，
 * 存下来的原始响应就是完整的可重放凭据：重跑不必再付一次钱，
 * 改合并规则/标记规则也不必再调一次模型。这一条不是设计洁癖——它是被一次真实损失逼出来的：
 * 综合 CLI 第一版把写盘放在**全部主题之后**，T12 截断时整轮崩溃，
 * 已付费跑完的 T02 连同它的原始响应一起丢了。**付过钱的东西必须当场落地。**
 */
export function materializeThemeResult({
  records,
  theme,
  anchorEntries,
  createdAt,
  maxPatterns = DEFAULT_MAX_PATTERNS_PER_THEME,
  rawText = '',
  usage = null,
  finishReason = null,
  reasoningChars = 0,
  inputBytes = 0,
}) {
  const built = []
  const unresolvedAnchors = []
  for (let i = 0; i < records.length; i += 1) {
    const out = materializeSynthesizedAntiPattern(records[i], {
      theme,
      anchorEntries,
      createdAt,
      seq: i + 1,
    })
    // `__citedAnchors` 只在本模块内用于打分标记，落盘前由 `stripInternal` 去掉——
    // 对象 schema 是封闭的，多一个字段会让整条对象变成 SCHEMA_INVALID。
    built.push({ obj: { ...out.obj, __citedAnchors: out.citedAnchors }, unresolved: out.unresolvedAnchors })
    for (const a of out.unresolvedAnchors) unresolvedAnchors.push({ themeId: theme.id, anchor: a })
  }

  const onlyAnti = built.map((b) => b.obj)
  const { objects: mergedObjects, merges } = mergeByExactCorrective(onlyAnti, { themeId: theme.id })

  const marks = mergedObjects.map((obj) => {
    const { mark, chapters } = markForAntiPattern(obj, { theme })
    return {
      id: obj.id,
      themeId: theme.id,
      mark,
      chapters,
      sourceRefCount: obj.sourceRefs.length,
      citedAnchorCount: Array.isArray(obj.__citedAnchors) ? obj.__citedAnchors.length : 0,
      unresolvedAnchorCount: built.find((b) => b.obj.id === obj.id)?.unresolved.length ?? 0,
      themeChapters: theme.chapterKeys,
    }
  })

  return {
    themeId: theme.id,
    objects: mergedObjects.map(stripInternal),
    marks,
    merges,
    unresolvedAnchors,
    rawText,
    usage,
    finishReason,
    reasoningChars,
    inputBytes,
    promptFingerprint: synthPromptFingerprint({ maxPatterns }),
  }
}

/**
 * 从**已落盘的原始响应**重放一个主题的物化结果（零模型调用）。
 *
 * 它存在的理由是「付过钱的产出不得因下游改动而重花一次」：改合并规则、改标记规则、
 * 修一个物化 bug，都走这条路，而不是重新调模型。
 */
export function replayThemeFromRaw({ rawText, theme, anchorEntries, createdAt, maxPatterns }) {
  const payload = parseSynthPayload(rawText)
  const records = extractSynthObjectList(payload)
  return materializeThemeResult({ records, theme, anchorEntries, createdAt, maxPatterns, rawText })
}

/**
 * 去掉模块内部的记账字段。
 *
 * 它不是可选的清理：知识对象的 schema `additionalProperties: false`，多一个字段会让
 * 整个对象变成 `SCHEMA_INVALID`——一条完整的反模式会因为一个我们自己的调试字段被拒。
 */
export function stripInternal(obj) {
  const { __citedAnchors, ...rest } = obj
  return rest
}
