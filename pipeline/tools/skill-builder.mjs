/**
 * 环 4 · Skill 装配器（tracer bullet 第一版）
 *
 * 职责：把一批知识对象**确定性地**装配成一个 `SKILL.md`（ADR-004 的 6 段骨架），
 * 并如实报告**哪些段落装不出来**。
 *
 * ## 为什么第一版不调用模型
 *
 * 本环节要回答的问题是「**对象里到底有什么**」，而不是「能不能写出一篇读起来通顺的 skill」。
 * 一旦引入 LLM 补写，缺口会被生成内容填平，骨架看起来完整，而「环 2 的字段够不够」这个
 * 问题就永远得不到答案。所以：**填不出的段落一律留空并记缺口，绝不编内容。**
 *
 * 模型按契约确实会进环 4（ADR-004 的 6 段里有几段本质是散文），但那要等到本文测出
 * 「哪些字段能填、哪些段完全没有来源」之后，才有依据决定提示词该补什么。
 *
 * ## 输出落在哪里
 *
 * 装配产物一律写 `pipeline/registry/build/<slug>/`（暂存区），**不直接进 `skills/`**。
 * 依据 ADR-002 的平面隔离：`skills/` 是只读发布区，只接收门禁通过的产物。
 * 装配成功不等于通过门禁——这两件事在本文件里被刻意分开。
 *
 * ## 段的字段来源映射（本节就是「对象够不够装」的答案表）
 *
 * | 骨架段 | 对象来源 | 完整度 |
 * |---|---|---|
 * | 何时使用 | `EngineeringRule.appliesWhen` / `Heuristic.trigger` | 部分 |
 * | 核心原则 | `EngineeringRule.statement` + `rationale` | 完整 |
 * | 实践模式 | `Concept.canonicalTerm` + `definition` + `examples` | **语义不符** |
 * | 常见陷阱 | `AntiPattern.pattern` + `harm` + `corrective` | 受条目数上限约束 |
 * | 配套代码 | **无来源**（见 SKELETON_SECTIONS 的说明） | 零 |
 * | 深度阅读 | `sourceRefs[].file` + `.title` + 行号 | 完整 |
 */

import path from 'node:path'

import { DEFAULT_REPO_ROOT } from './anchor-index.mjs'

/**
 * 6 段骨架。名称与顺序逐字取自 ADR-004 对原书 22 个 skill 的实测契约，
 * **不得改动**（22/22 命中率是本项目唯一有实证背书的骨架）。
 *
 * `minItems` / `maxItems` 取自 ADR-004 对骨架形状的记录（何时使用 5–8 条、常见陷阱 6–8 条）。
 * ⚠ 口径说明：ADR-004 的「必须遵守的约束」一节**没有**把条目数列为硬约束，
 * 它列的是 frontmatter 硬限、6 段顺序与名称、深度阅读回链。本文按「骨架形状即契约」实现
 * 这个检查，属于**本文件的解释**；若判定为过严，应修订 ADR 而非在此悄悄放宽。
 */
export const SKELETON_SECTIONS = Object.freeze([
  {
    key: 'whenToUse',
    heading: '## 何时使用',
    shape: '列表，5–8 条用户场景/触发条件',
    minItems: 5,
    maxItems: 8,
    sources: ['EngineeringRule.appliesWhen', 'Heuristic.trigger'],
  },
  {
    key: 'principles',
    heading: '## 核心原则',
    shape: '加粗小标题 + 解释；列书的判断规则',
    minItems: 1,
    maxItems: null,
    sources: ['EngineeringRule.statement', 'EngineeringRule.rationale'],
  },
  {
    key: 'patterns',
    heading: '## 实践模式',
    shape: '主体；可再分 ### 1..N 编号子节，含表格',
    minItems: 1,
    maxItems: null,
    sources: ['Concept.canonicalTerm', 'Concept.definition', 'Concept.examples'],
  },
  {
    key: 'pitfalls',
    heading: '## 常见陷阱',
    shape: '列表，6–8 条反模式',
    minItems: 6,
    maxItems: 8,
    sources: ['AntiPattern.pattern', 'AntiPattern.harm', 'AntiPattern.corrective'],
  },
  {
    key: 'code',
    heading: '## 配套代码',
    shape: '仓库相对路径 + 每个目录一句话说明',
    minItems: 1,
    maxItems: null,
    sources: [],
  },
  {
    key: 'reading',
    heading: '## 深度阅读',
    shape: '`book/chapterN.md` + 书中小节名',
    minItems: 1,
    maxItems: null,
    sources: ['sourceRefs[].file', 'sourceRefs[].title'],
  },
])

/** 缺口理由码。命名与 verifier 的理由码同风格：全大写下划线，语义自明。 */
export const GAP_CODES = Object.freeze({
  NO_SOURCE: 'SECTION_NO_SOURCE',
  EMPTY: 'SECTION_EMPTY',
  BELOW_MIN: 'SECTION_ITEM_COUNT_BELOW_SKELETON',
  ABOVE_MAX: 'SECTION_ITEM_COUNT_ABOVE_SKELETON',
  SEMANTICS: 'SECTION_FIELD_SEMANTICS_MISMATCH',
  SUSPECT_TRIGGER: 'SECTION_ITEM_SUSPECT_NOT_TRIGGER',
  CONTRACT_UNSUPPORTED: 'CONTRACT_FIELD_UNSUPPORTED',
})

/**
 * ADR-004 决策 3 的契约侧车里，**当前对象模型没有任何字段能供给**的那些。
 *
 * 这与「配套代码」段同源：不是「还没做」，是「按当前对象模型不可满足」。
 * 第一版契约把 `tests` 写成 minItems: 2 塞进 schema，结果每一份产出的契约都不合法——
 * 那会把「这个 skill 还没法测」（内容缺口）与「这份契约写坏了」（格式缺陷）压成同一个错误。
 * 因此改为在缺口里逐条记录，schema 只查形状。
 */
export const CONTRACT_FIELDS_WITHOUT_SOURCE = Object.freeze([
  { field: 'inputContract', note: '输入契约。没有任何对象字段描述「这个 skill 要什么输入」。' },
  { field: 'outputContract', note: '输出契约。同上。' },
  { field: 'tools', note: '工具清单。对象模型里没有工具/依赖类字段。' },
  { field: 'steps', note: '可执行步骤。步骤属「实践模式」段的语义，而该段当前由 Concept 定义填充。' },
  { field: 'stopConditions', note: '停止条件。没有对象字段承载。' },
  { field: 'rollback', note: '回滚方式。没有对象字段承载。' },
  { field: 'tests', note: 'ADR-004 要求 ≥2。没有任何对象字段承载「这个 skill 怎么测」。' },
])

/**
 * 「何时使用」段的条目应是一条**触发条件**。实测发现 `appliesWhen` 并不总是条件：
 * 例如 `CHAPTER4-H3-3-ENGINEERINGRULE-02` 的值是
 * 「当确实需要对输入进行规范化处理（如统一编码格式）时，**必须**在工具描述中加以说明，
 * 并在工具返回中明确告知模型。」——它是「条件 + 要求」的复合句，后半句是规则不是触发。
 *
 * ⚠ 这是**启发式**检查，不是判据，也**不导致门禁失败**。它只把可疑条目挑出来给人看。
 * 局限：真实的触发条件里也可能出现「必须」（如「当合规要求必须留存日志时」），会被误报。
 * 之所以仍然保留：这类错位靠计数查不出来——它会让「何时使用」段看起来条数达标。
 */
export const TRIGGER_MODAL_WORDS = Object.freeze(['必须', '不得', '应当', '应该'])

export class SkillBuildError extends Error {
  constructor(message, opts = {}) {
    super(message)
    this.name = 'SkillBuildError'
    this.code = opts.code || 'SKILL_BUILD_FAILED'
    this.detail = opts.detail
  }
}

/**
 * 从一个根锚点派生内容单元：根锚点 + 其后所有层级更深的锚点，直到同层或更浅者出现。
 *
 * 确定性来自锚点索引的两个字段：锚点按文档顺序排列，且带 `level`。
 * 这是 ADR-004「同章 + 同问题空间」的一个**机械近似**——它不判断语义，只认文档结构。
 * 真正的语义聚类属环 3，本文不假装实现了它。
 */
export function deriveCluster(anchors, rootAnchor) {
  const list = Array.isArray(anchors) ? anchors : []
  const at = list.findIndex((a) => a.anchor === rootAnchor)
  if (at < 0) {
    throw new SkillBuildError(`根锚点不在索引中：${rootAnchor}`, {
      code: 'ROOT_ANCHOR_MISSING',
    })
  }
  const root = list[at]
  const members = [root]
  for (let i = at + 1; i < list.length; i += 1) {
    const next = list[i]
    if (next.level <= root.level) break
    members.push(next)
  }
  return { rootAnchor, title: root.title, level: root.level, anchors: members }
}

/**
 * 取出对象清单，兼容盘上实际存在的两种形状。
 *
 * 为什么必须有这个函数：`chapter4.objects.json` 是**数组**，而
 * `antipatterns.objects.json` 是**带元信息的对象**（`{ schemaVersion, runId, objects: [...] }`）。
 * 第一版装配器把后者整个传进 `collectCrossChapterAntipatterns`，那里的
 * `Array.isArray` 判断让它**静默返回空数组**——产物里显示「跨章反模式 0 条」，
 * 看上去像「本主题没有反模式」，实际是「读错了形状」。两者在输出里长得一样。
 * 因此本函数对认不出的形状**抛错**，不返回空数组。
 */
export function unwrapObjectsFile(doc, label = '对象文件') {
  if (Array.isArray(doc)) return doc
  if (doc && Array.isArray(doc.objects)) return doc.objects
  throw new SkillBuildError(
    `${label}的形状不可识别：既不是数组，也没有 objects 数组。顶层键：${
      doc && typeof doc === 'object' ? Object.keys(doc).join(', ') : String(doc)
    }`,
    { code: 'OBJECTS_FILE_SHAPE_UNKNOWN' },
  )
}

/** 取簇内对象：`sourceRefs` 中**任一**出处落在簇内锚点即算。 */
export function collectClusterObjects(objects, clusterAnchors) {
  if (!Array.isArray(objects)) {
    throw new SkillBuildError('collectClusterObjects 需要数组；请先用 unwrapObjectsFile', {
      code: 'OBJECTS_NOT_ARRAY',
    })
  }
  const set = new Set(clusterAnchors.map((a) => (typeof a === 'string' ? a : a.anchor)))
  return objects.filter((o) =>
    (o.sourceRefs || []).some((r) => set.has(r.anchor)),
  )
}

/**
 * 取跨章反模式池中「引用了簇内锚点」的那些。
 *
 * 为什么必须是独立输入：ADR-016 已证 `AntiPattern` 是**跨章综合物**而非提取物——
 * 全书显式失败小节只有 13 个标题行，而原书 22 个 skill 的常见陷阱段 22/22 各有 6–8 条。
 * 只喂同章对象，常见陷阱段必然凑不满。
 */
export function collectCrossChapterAntipatterns(antipatternObjects, clusterAnchors) {
  if (!Array.isArray(antipatternObjects)) {
    throw new SkillBuildError(
      'collectCrossChapterAntipatterns 需要数组；请先用 unwrapObjectsFile。' +
        '传对象进来会静默得到空数组，那会把「读错形状」显示成「本主题没有反模式」。',
      { code: 'OBJECTS_NOT_ARRAY' },
    )
  }
  const set = new Set(clusterAnchors.map((a) => (typeof a === 'string' ? a : a.anchor)))
  return antipatternObjects.filter(
    (o) =>
      o.objectType === 'AntiPattern' &&
      (o.sourceRefs || []).some((r) => set.has(r.anchor)),
  )
}

/** 去重：同一 id 在簇内与跨章池里各出现一次时只留一份。 */
function dedupeById(list) {
  const seen = new Set()
  const out = []
  for (const o of list) {
    if (seen.has(o.id)) continue
    seen.add(o.id)
    out.push(o)
  }
  return out
}

/** 去掉行尾空白后的单行化，供列表条目使用（不改变字面内容）。 */
function oneLine(text) {
  return String(text == null ? '' : text)
    .replace(/\s*\n\s*/g, ' ')
    .trim()
}

/**
 * 装配。**纯函数**：不读盘、不写盘、不调模型，输入相同则输出逐字节相同。
 *
 * @param {object} input
 * @param {object} input.cluster        `deriveCluster` 的返回值
 * @param {object[]} input.objects      簇内对象
 * @param {object[]} input.antipatterns 跨章反模式（可空）
 * @param {string} input.slug           frontmatter 的 `name`
 * @param {string} input.skillTitle     H1 标题
 * @returns {{ markdown: string, contract: object, gaps: object[], sectionCounts: object }}
 */
export function assembleSkill(input) {
  const { cluster, slug, skillTitle } = input
  if (!cluster || !cluster.rootAnchor) {
    throw new SkillBuildError('缺少 cluster', { code: 'CLUSTER_MISSING' })
  }
  if (!slug) throw new SkillBuildError('缺少 slug', { code: 'SLUG_MISSING' })
  if (!skillTitle) throw new SkillBuildError('缺少 skillTitle', { code: 'TITLE_MISSING' })

  const objects = Array.isArray(input.objects) ? input.objects : []
  const antipatterns = Array.isArray(input.antipatterns) ? input.antipatterns : []

  const rules = objects.filter((o) => o.objectType === 'EngineeringRule')
  const concepts = objects.filter((o) => o.objectType === 'Concept')
  const heuristics = objects.filter((o) => o.objectType === 'Heuristic')
  const localAnti = objects.filter((o) => o.objectType === 'AntiPattern')
  const pitfalls = dedupeById([...localAnti, ...antipatterns])

  const gaps = []

  // ── 何时使用 ────────────────────────────────────────────────────────────
  const whenToUse = []
  for (const r of rules) {
    if (r.appliesWhen) whenToUse.push({ text: oneLine(r.appliesWhen), from: r.id })
  }
  for (const h of heuristics) {
    if (h.trigger) whenToUse.push({ text: oneLine(h.trigger), from: h.id })
  }

  // ── 核心原则 ────────────────────────────────────────────────────────────
  const principles = rules
    .filter((r) => r.statement)
    .map((r) => ({
      text: oneLine(r.statement),
      rationale: r.rationale ? oneLine(r.rationale) : null,
      from: r.id,
    }))

  // ── 实践模式 ────────────────────────────────────────────────────────────
  const patterns = concepts
    .filter((c) => c.canonicalTerm)
    .map((c) => ({
      term: oneLine(c.canonicalTerm),
      definition: c.definition ? oneLine(c.definition) : null,
      examples: Array.isArray(c.examples) ? c.examples.map(oneLine).filter(Boolean) : [],
      from: c.id,
    }))

  // ── 常见陷阱 ────────────────────────────────────────────────────────────
  const pitfallItems = pitfalls
    .filter((a) => a.pattern)
    .map((a) => ({
      pattern: oneLine(a.pattern),
      harm: a.harm ? oneLine(a.harm) : null,
      corrective: a.corrective ? oneLine(a.corrective) : null,
      from: a.id,
    }))

  // ── 配套代码 ────────────────────────────────────────────────────────────
  // 刻意留空。信息源里没有配套代码目录（实测：sources/ai-agent-book-zh/ 下只有 book/ 与
  // skills/），没有任何对象字段可以填这一段。下面这条缺口不是「暂时没做」，
  // 是「按当前信息源不可满足」。
  const codeItems = []

  // ── 深度阅读 ────────────────────────────────────────────────────────────
  const readingSeen = new Set()
  const reading = []
  for (const a of cluster.anchors) {
    const key = `${a.file}#${a.anchor}`
    if (readingSeen.has(key)) continue
    readingSeen.add(key)
    reading.push({ file: a.file, anchor: a.anchor, title: a.title, lineStart: a.lineStart, lineEnd: a.lineEnd })
  }

  const built = {
    whenToUse,
    principles,
    patterns,
    pitfalls: pitfallItems,
    code: codeItems,
    reading,
  }

  // ── 缺口判定 ────────────────────────────────────────────────────────────
  const sectionCounts = {}
  for (const spec of SKELETON_SECTIONS) {
    const items = built[spec.key]
    sectionCounts[spec.key] = items.length

    if (spec.sources.length === 0) {
      gaps.push({
        code: GAP_CODES.NO_SOURCE,
        section: spec.key,
        heading: spec.heading,
        detail: `本段在信息源中没有对应字段。骨架要求「${spec.shape}」，而对象模型没有任何字段承载它。`,
        required: spec.minItems,
        actual: items.length,
      })
      continue
    }
    if (items.length === 0) {
      gaps.push({
        code: GAP_CODES.EMPTY,
        section: spec.key,
        heading: spec.heading,
        detail: `本段一个条目都凑不出（字段来源：${spec.sources.join(' / ')}）。`,
        required: spec.minItems,
        actual: 0,
      })
      continue
    }
    if (spec.minItems != null && items.length < spec.minItems) {
      gaps.push({
        code: GAP_CODES.BELOW_MIN,
        section: spec.key,
        heading: spec.heading,
        detail: `条目数低于骨架形状（${spec.shape}）。`,
        required: spec.minItems,
        actual: items.length,
      })
    }
    if (spec.maxItems != null && items.length > spec.maxItems) {
      gaps.push({
        code: GAP_CODES.ABOVE_MAX,
        section: spec.key,
        heading: spec.heading,
        detail: `条目数高于骨架形状（${spec.shape}）。`,
        required: spec.maxItems,
        actual: items.length,
      })
    }
  }

  // 「实践模式」的语义不符：Concept 提供的是**定义与示例**，而骨架要求的是**可操作的模式**。
  // 条目数够（没触发 BELOW_MIN），但装出来的东西不是这一段要的东西——这类缺口靠计数查不出来。
  if (patterns.length > 0) {
    gaps.push({
      code: GAP_CODES.SEMANTICS,
      section: 'patterns',
      heading: '## 实践模式',
      detail:
        '本段由 `Concept.definition` + `examples` 填充，装出来的是**术语定义**，而骨架要求的是**可操作的模式**（编号子节、含表格）。条目数达标不代表语义达标——这类缺口计数查不出来。',
      required: null,
      actual: patterns.length,
    })
  }

  // 「何时使用」里的可疑条目：见 TRIGGER_MODAL_WORDS 的说明。启发式，不入判据。
  const suspectTriggers = whenToUse.filter((w) =>
    TRIGGER_MODAL_WORDS.some((m) => w.text.includes(m)),
  )
  if (suspectTriggers.length) {
    gaps.push({
      code: GAP_CODES.SUSPECT_TRIGGER,
      section: 'whenToUse',
      heading: '## 何时使用',
      detail:
        `条目中包含「${TRIGGER_MODAL_WORDS.join('/')}」的 ${suspectTriggers.length} 条可能不是触发条件，` +
        '而是被写进 `appliesWhen` 的规则陈述（条件 + 要求 的复合句）。启发式，不导致门禁失败。',
      required: null,
      actual: suspectTriggers.length,
      items: suspectTriggers.map((w) => ({ from: w.from, text: w.text })),
    })
  }

  // 契约侧车里没有来源的字段。与「配套代码」段同源，故用同一套记录方式。
  for (const f of CONTRACT_FIELDS_WITHOUT_SOURCE) {
    gaps.push({
      code: GAP_CODES.CONTRACT_UNSUPPORTED,
      section: `contract.${f.field}`,
      heading: `契约字段 ${f.field}`,
      detail: f.note,
      required: null,
      actual: 0,
    })
  }

  // ── 正文装配 ────────────────────────────────────────────────────────────
  const L = []
  const description = buildDescription({ cluster, whenToUse, principles })
  L.push('---')
  L.push(`name: ${slug}`)
  L.push(`description: ${description}`)
  L.push('---')
  L.push('')
  L.push(`# ${skillTitle}`)
  L.push('')

  L.push(SKELETON_SECTIONS[0].heading)
  L.push('')
  for (const it of whenToUse) L.push(`- ${it.text}`)
  L.push('')

  L.push(SKELETON_SECTIONS[1].heading)
  L.push('')
  for (const p of principles) {
    L.push(`**${p.text}**`)
    L.push('')
    if (p.rationale) {
      L.push(p.rationale)
      L.push('')
    }
  }

  L.push(SKELETON_SECTIONS[2].heading)
  L.push('')
  for (const p of patterns) {
    L.push(`**${p.term}**`)
    L.push('')
    if (p.definition) {
      L.push(p.definition)
      L.push('')
    }
    for (const ex of p.examples) L.push(`- ${ex}`)
    if (p.examples.length) L.push('')
  }

  L.push(SKELETON_SECTIONS[3].heading)
  L.push('')
  for (const p of pitfallItems) {
    L.push(`- **${p.pattern}**`)
    if (p.harm) L.push(`  - 后果：${p.harm}`)
    if (p.corrective) L.push(`  - 纠正：${p.corrective}`)
  }
  L.push('')

  L.push(SKELETON_SECTIONS[4].heading)
  L.push('')
  L.push('')

  L.push(SKELETON_SECTIONS[5].heading)
  L.push('')
  for (const r of reading) {
    L.push(`- \`${r.file}\` · ${r.title}（第 ${r.lineStart}–${r.lineEnd} 行）`)
  }
  L.push('')

  const markdown = L.join('\n')

  // ── 契约侧车 ────────────────────────────────────────────────────────────
  // ADR-004 决策 3：机器契约不进 SKILL.md，放 pipeline/registry/。
  const sourceRefs = []
  const refSeen = new Set()
  for (const o of objects) {
    for (const r of o.sourceRefs || []) {
      const key = `${r.file}#${r.anchor}`
      if (refSeen.has(key)) continue
      refSeen.add(key)
      sourceRefs.push({ file: r.file, anchor: r.anchor, title: r.title, lineStart: r.lineStart, lineEnd: r.lineEnd })
    }
  }
  for (const a of antipatterns) {
    for (const r of a.sourceRefs || []) {
      const key = `${r.file}#${r.anchor}`
      if (refSeen.has(key)) continue
      refSeen.add(key)
      sourceRefs.push({ file: r.file, anchor: r.anchor, title: r.title, lineStart: r.lineStart, lineEnd: r.lineEnd })
    }
  }

  const contract = {
    schemaVersion: 'skill-contract/v1',
    skillId: input.skillId || `CHAPTER4-${cluster.rootAnchor.split('#')[1].toUpperCase()}-SKILL-01`,
    name: slug,
    description,
    // 环 5 未构建：这三项此刻只是占位，不得被读成「已通过」。
    promotionState: 'assembled',
    gateReceipt: null,
    inputContract: null,
    outputContract: null,
    tools: [],
    steps: [],
    stopConditions: [],
    rollback: null,
    tests: [],
    sourceObjects: objects.map((o) => o.id),
    crossChapterObjects: antipatterns.map((o) => o.id),
    sourceRefs,
    evidenceGrade: 'E2-derived',
    freshness: { state: 'fresh', asOf: new Date(0).toISOString() },
    gaps,
    sectionCounts,
  }

  return { markdown, contract, gaps, sectionCounts, description }
}

/**
 * 由对象内容拼 frontmatter 的 `description`。
 *
 * 官方硬限：≤1024 字符，且必须同时说明**做什么**与**何时用**（ADR-004 已核实）。
 * 本函数只做裁剪与拼接，不生成新事实——内容全部来自 `statement` 与 `appliesWhen`。
 */
export function buildDescription({ cluster, whenToUse, principles }) {
  // 拼接前先剥掉各片段尾部的句读。第一版直接拼，产出了
  // 「…底层的 API 操作。；适用于当设计面向 Agent 使用的工具时。、当…」这种标点——
  // 内容没错，但把中文句读叠在一起会让人读成生成物，而不是从对象装配出来的东西。
  const strip = (s) => String(s == null ? '' : s).replace(/[。；，,;.\s]+$/u, '')
  const head = `${cluster.title}：`
  const capability = principles.length ? strip(principles[0].text) : ''
  const triggers = whenToUse.slice(0, 3).map((w) => strip(w.text)).filter(Boolean)
  const body = [
    capability,
    triggers.length ? `适用于${triggers.join('、')}` : '',
  ]
    .filter(Boolean)
    .join('；')
  const text = `${head}${body}。`
  const MAX = 1024
  if (text.length <= MAX) return text
  return `${text.slice(0, MAX - 1)}…`
}

/** 暂存态 SKILL.md 的落盘路径。发布区是 `skills/`，暂存区是这里——两者不得混同。 */
export function buildStagingPath(slug, opts = {}) {
  const repoRoot = opts.repoRoot || DEFAULT_REPO_ROOT
  return path.join(repoRoot, 'pipeline', 'registry', 'build', slug, 'SKILL.md')
}

/** 发布区路径。**只有门禁通过的产物才允许落到这里**（ADR-002 平面隔离）。 */
export function buildPublishedPath(slug, opts = {}) {
  const repoRoot = opts.repoRoot || DEFAULT_REPO_ROOT
  return path.join(repoRoot, 'skills', slug, 'SKILL.md')
}
