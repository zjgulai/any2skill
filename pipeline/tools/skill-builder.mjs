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

import { readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'

import { DEFAULT_REPO_ROOT } from './anchor-index.mjs'

/**
 * 6 段骨架。名称与顺序逐字取自 ADR-004 对原书 22 个 skill 的实测契约，
 * **不得改动**（22/22 命中率是本项目唯一有实证背书的骨架）。
 *
 * ## 条目数：建议值，不是判据（2026-10-09 修订，见 ADR-021）
 *
 * `advisoryMin` / `advisoryMax` 取自 ADR-004 对骨架形状的**记录**（何时使用 5–8 条、
 * 常见陷阱 6–8 条），它们是**建议值**：低于它们会被记成缺口并**标记为高风险**，
 * 但**不导致门禁拒绝**。
 *
 * 曾经它们是硬判据——那是本文件当初的解释，而 ADR-004 的「必须遵守的约束」一节
 * 从未把它们列为硬约束（只列了 frontmatter 硬限、6 段顺序与名称、深度阅读回链）。
 * 实测把这个解释推翻了：chapter4 每个二级锚点簇最多凑到 2 条反模式，**整章 39 个对象
 * 也只有 5 条**——6–8 这个数字来自原书作者的人工写作（每章约 2.2 个 skill，
 * 且他可跨章取用），不是自动提取能达到的量。
 *
 * 硬下限只有一个：`SECTION_HARD_LOWER_BOUND`，即「非空」，由门禁的 `SECTION_EMPTY` 承担。
 * **不另设数字阈值**——除原书的人工样本外，没有任何独立证据支持某个具体下限，
 * 硬填一个数字只是为了让它看起来严谨。
 */
export const SECTION_HARD_LOWER_BOUND = 1

/**
 * 体积阈值（字节）。
 *
 * **2026-10-13 修订（ADR-028）**：由 12,288 改为 **16,568**——即原书 22 个 skill 的实测
 * **最大值**（比对报告实测：原书 5/22 超过 12KB，中位 10.9KB、最大 16,568B）。
 * 旧值的依据是「原书中位偏上」，但那是一个**比信息源自身实践更严**的推估；
 * 重切后的 6 个合并候选在溢出阀已尽力的情况下仍被 12KB 拒绝，而它们比原书最大的
 * 那个 skill 还小——阈值该对齐的是对照物的事实，不是我们的构图偏好。
 * 定义在本模块是因为**溢出阀（渲染时）也要用它**；`verify-skill.mjs` 从这里导入并转出。
 */
export const SIZE_LIMIT_BYTES = 16568

/**
 * 每段的「条目」是哪一种行——**这是判据的一部分，不是排版细节**。
 *
 * 门禁一有一条与条目数无关的检查：契约记录的条目数必须与正文实际一致
 * （防「契约说 6 条、正文写 1 条」）。要执行它，双方必须对「一条」的定义一致。
 *
 * 2026-10-12 环 3 端到端暴露的实测：`## 实践模式` 的条目是**加粗小节头**
 * （每个概念一个），示例 `- ` 列表项是它的**子行**；而校验器旧口径取
 * `max(顶格列表项, 加粗行)`，概念带多个示例时列表项会盖过概念数——
 * chapter4-s1 实测契约 3 / 顶格列表项 10 / 加粗行 3，被误报为
 * `SECTION_COUNT_OUT_OF_RANGE`。已发布的 chapter4-tool-design-principles 只是
 * 恰好每个概念只有一个示例才没踩到。故这里把每段的条目种类写明，校验器按它计数。
 * 见 [`ADR-025`](../../docs/adr/ADR-025-section-item-kind.md)。
 */
export const SKELETON_SECTIONS = Object.freeze([
  {
    key: 'whenToUse',
    heading: '## 何时使用',
    shape: '列表，5–8 条用户场景/触发条件',
    itemKind: 'bullet',
    advisoryMin: 5,
    advisoryMax: 8,
    sources: ['EngineeringRule.appliesWhen', 'Heuristic.trigger'],
  },
  {
    key: 'principles',
    heading: '## 核心原则',
    shape: '加粗小标题 + 解释；列书的判断规则',
    itemKind: 'bold',
    advisoryMin: 1,
    advisoryMax: null,
    sources: ['EngineeringRule.statement', 'EngineeringRule.rationale'],
  },
  {
    key: 'patterns',
    heading: '## 实践模式',
    shape: '主体；可再分 ### 1..N 编号子节，含表格',
    itemKind: 'bold',
    advisoryMin: 1,
    advisoryMax: null,
    sources: ['Concept.canonicalTerm', 'Concept.definition', 'Concept.examples'],
  },
  {
    key: 'pitfalls',
    heading: '## 常见陷阱',
    shape: '列表，6–8 条反模式',
    itemKind: 'bullet',
    advisoryMin: 6,
    advisoryMax: 8,
    sources: ['AntiPattern.pattern', 'AntiPattern.harm', 'AntiPattern.corrective'],
  },
  {
    key: 'code',
    heading: '## 配套代码',
    shape: '仓库相对路径 + 每个目录一句话说明',
    itemKind: 'bullet',
    advisoryMin: 1,
    advisoryMax: null,
    sources: [],
  },
  {
    key: 'reading',
    heading: '## 深度阅读',
    shape: '`book/chapterN.md` + 书中小节名',
    itemKind: 'bullet',
    advisoryMin: 1,
    advisoryMax: null,
    sources: ['sourceRefs[].file', 'sourceRefs[].title'],
  },
])

/**
 * 风险标记。**不导致门禁拒绝**，按 ADR-006 门禁三的定义（「高风险定义为门禁二出现误触发、
 * 或 `AntiPattern` 覆盖率低的 skill」）路由到功效抽样重点。
 *
 * 这条路由不是新造的：ADR-006 早已写下那个定义，只是从未有人把它接上——
 * 覆盖率不足此前被门禁一硬拒掉了，于是「高风险标记」这一环永远收不到东西。
 */
export const RISK_FLAGS = Object.freeze({
  PITFALL_COVERAGE_LOW: 'PITFALL_COVERAGE_BELOW_ADVISORY',
})

/** 缺口理由码。命名与 verifier 的理由码同风格：全大写下划线，语义自明。 */
export const GAP_CODES = Object.freeze({
  NO_SOURCE: 'SECTION_NO_SOURCE',
  EMPTY: 'SECTION_EMPTY',
  BELOW_ADVISORY: 'SECTION_ITEM_COUNT_BELOW_ADVISORY',
  ABOVE_ADVISORY: 'SECTION_ITEM_COUNT_ABOVE_ADVISORY',
  SEMANTICS: 'SECTION_FIELD_SEMANTICS_MISMATCH',
  SUSPECT_TRIGGER: 'SECTION_ITEM_SUSPECT_NOT_TRIGGER',
  CONTRACT_UNSUPPORTED: 'CONTRACT_FIELD_UNSUPPORTED',
  GRANULARITY: 'SECTION_SOURCE_GRANULARITY_COARSE',
})

/**
 * 从镜像下来的配套代码目录里取「路径 + 一句话说明」。
 *
 * 这一段的来源**不是知识对象**，而是代码树本身——对象模型里没有任何字段承载它。
 * 这正是一次真实的信息源扩充：2026-10-09 把上游 `chapter4/` 镜像进
 * `sources/ai-agent-book-zh/code/`（口径见该目录下的 MIRROR-MANIFEST.md），
 * 这段才第一次有东西可填。
 *
 * 「一句话说明」取各目录 `README.md` 的**首个正文段落原文**，不做改写、不做摘要。
 * 之所以能这么做：实测这 6 个 README 的首段本来就是一句话的定位描述。
 * 若某个目录没有 README，该目录不进入本段，并记一条缺口——不编。
 */
export function collectCodePointers(codeRoot, opts = {}) {
  const pointers = []
  if (!codeRoot) return pointers
  // 骨架要求的是**仓库相对路径**，故必须显式给出相对前缀；
  // 缺省回落到传入的绝对路径，但那会让 SKILL.md 里出现本机路径——调用方应始终传。
  const relPrefix = opts.relPrefix || codeRoot
  let entries
  try {
    entries = readdirSync(codeRoot, { withFileTypes: true })
  } catch {
    return pointers
  }
  for (const e of entries.filter((x) => x.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(codeRoot, e.name)
    let files = []
    try {
      files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md')).sort()
    } catch {
      continue
    }
    if (!files.length) continue
    const readme = files.find((f) => f.toLowerCase() === 'readme.md') || files[0]
    let summary = ''
    try {
      summary = firstParagraph(readFileSync(path.join(dir, readme), 'utf8'))
    } catch {
      summary = ''
    }
    pointers.push({
      dir: e.name,
      path: path.posix.join(relPrefix.split(path.sep).join('/'), e.name),
      readme: path.join(codeRoot, e.name, readme),
      summary,
    })
  }
  return pointers
}

/**
 * 取 markdown 的首个正文段落（跳过标题与空行），并剥掉行内标记。
 * 只做「取原文 + 去标记」，不做改写、不做摘要——这一段的可信度全靠「是原话」。
 */
export function firstParagraph(markdown) {
  const lines = String(markdown || '').split('\n')
  const buf = []
  let started = false
  for (const raw of lines) {
    const line = raw.trim()
    if (!started) {
      if (!line || line.startsWith('#')) continue
      started = true
    }
    if (!line) break
    buf.push(line)
  }
  return buf
    .join(' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

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
  // 来源是镜像下来的代码树，不是知识对象。空的时候**留空**——曾经的缺口码
  // SECTION_NO_SOURCE 仍然按「一个条目都没有」触发，故这里不额外编内容。
  const codeItems = (Array.isArray(input.codePointers) ? input.codePointers : [])
    .filter((c) => c && c.path)
    .map((c) => ({ path: c.path, summary: c.summary || null, dir: c.dir }))

  // ── 深度阅读 ────────────────────────────────────────────────────────────
  //
  // 两个来源：**簇内锚点**（本 skill 的组织骨架）+ **跨章反模式声明的出处**。
  //
  // 后者是必须的而不是装饰：`verify-skill.mjs` 要求契约里每一个 `sourceRefs[].file` 都在本段
  // 回链，而跨章反模式的出处按定义落在别的章节（ADR-016 把跨章池定为独立一等输入）。
  // 第一版只列簇内锚点，于是「跨章反模式第一次真的进 skill」这一刻，门禁必然报
  // `SOURCEREF_UNRESOLVED`——这条缺口不是本次新来的，是此前 `crossChapterKept` 恒为 0 把它盖住了。
  //
  // 行号一律取**锚点索引**，不取对象自带的行号（与全仓同口径：对象改了行号不能顺带改这里）。
  // 索引里查不到的出处**跳过**、不臆造行号——那种出处由门禁的 `SOURCEREF_UNRESOLVED` 抓，
  // 在这里静默编一个区间只会把「出处错」变成「看起来对」。
  //
  // 只补**跨章反模式**的出处、不补簇内对象的次要出处：后者与本簇同章，其文件已被簇内锚点回链覆盖，
  // 补进来只会让阅读清单无谓膨胀。
  const readingSeen = new Set()
  const reading = []
  for (const a of cluster.anchors) {
    const key = `${a.file}#${a.anchor}`
    if (readingSeen.has(key)) continue
    readingSeen.add(key)
    reading.push({ file: a.file, anchor: a.anchor, title: a.title, lineStart: a.lineStart, lineEnd: a.lineEnd })
  }
  const readingLookup = new Map()
  for (const idx of Array.isArray(input.anchorIndexes) ? input.anchorIndexes : []) {
    for (const a of idx?.anchors ?? []) readingLookup.set(`${a.file}#${a.anchor}`, a)
  }
  for (const ap of antipatterns) {
    for (const r of ap.sourceRefs || []) {
      const key = `${r.file}#${r.anchor}`
      if (readingSeen.has(key)) continue
      const hit = readingLookup.get(key)
      if (!hit) continue
      readingSeen.add(key)
      reading.push({
        file: hit.file,
        anchor: hit.anchor,
        title: hit.title,
        lineStart: hit.lineStart,
        lineEnd: hit.lineEnd,
      })
    }
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

    if (spec.sources.length === 0 && items.length === 0) {
      gaps.push({
        code: GAP_CODES.NO_SOURCE,
        section: spec.key,
        heading: spec.heading,
        detail: `本段在信息源中没有对应字段。骨架的形状是「${spec.shape}」，而对象模型没有任何字段承载它。`,
        advisory: spec.advisoryMin,
        actual: items.length,
      })
      continue
    }
    if (items.length < SECTION_HARD_LOWER_BOUND) {
      // 唯一的硬下限：非空。低于它 → 门禁的 SECTION_EMPTY 会拒。
      gaps.push({
        code: GAP_CODES.EMPTY,
        section: spec.key,
        heading: spec.heading,
        detail: `本段一个条目都凑不出（字段来源：${spec.sources.join(' / ')}）。`,
        advisory: spec.advisoryMin,
        actual: 0,
      })
      continue
    }
    // 以下两条是**建议值**比较，只记缺口，不导致门禁拒绝（见 SKELETON_SECTIONS 的文件头）。
    if (spec.advisoryMin != null && items.length < spec.advisoryMin) {
      gaps.push({
        code: GAP_CODES.BELOW_ADVISORY,
        section: spec.key,
        heading: spec.heading,
        detail:
          `条目数 ${items.length} 低于骨架的建议值（${spec.shape}）。` +
          '**建议值不是判据**——原书那 6–8 条出自人工写作，自动提取达不到该量级（实测整章仅 5 条）。' +
          '本项按 ADR-006 门禁三「AntiPattern 覆盖率低的 skill 属高风险」路由到功效抽样重点，不在门禁一处拒绝。',
        advisory: spec.advisoryMin,
        actual: items.length,
      })
    }
    if (spec.advisoryMax != null && items.length > spec.advisoryMax) {
      gaps.push({
        code: GAP_CODES.ABOVE_ADVISORY,
        section: spec.key,
        heading: spec.heading,
        detail: `条目数 ${items.length} 高于骨架的建议值（${spec.shape}）。建议值不是判据，本条只作记录。`,
        advisory: spec.advisoryMax,
        actual: items.length,
      })
    }
  }

  // 「实践模式」的语义不符：Concept 提供的是**定义与示例**，而骨架要求的是**可操作的模式**。
  // 条目数够（没触发 BELOW_ADVISORY），但装出来的东西不是这一段要的东西——这类缺口靠计数查不出来。
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

  // 「配套代码」段填上了，但**粒度是章级而非簇级**：对象模型里没有任何字段表达
  // 「这个锚点对应哪个代码目录」，所以只能把本章的代码目录全列上。
  // 这不是缺陷披露，是把「它凭什么列这些」讲清楚——否则读者会以为做过映射。
  if (codeItems.length > 0) {
    gaps.push({
      code: GAP_CODES.GRANULARITY,
      section: 'code',
      heading: '## 配套代码',
      detail:
        `本段列的是**本章全部** ${codeItems.length} 个代码目录，不是本簇专属。` +
        '理由：对象模型没有「锚点 → 代码目录」的映射字段，章级列举是当前唯一可确定派生的口径。',
      required: null,
      actual: codeItems.length,
      coarse: true,
    })
  }

  // ── 正文装配 ────────────────────────────────────────────────────────────
  // ── 正文装配 ────────────────────────────────────────────────────────────
  //
  // 渲染是 `patternMode` 的两态函数：`full` = 常规；`pointer` = 溢出态
  // （实践模式完整内容已移入 references/，SKILL.md 只留加粗小节头与指针）。
  // 两态共用同一段代码，避免「溢出版骨架」与常规版悄悄漂移。
  const description = buildDescription({ cluster, whenToUse, principles })
  const render = (patternMode) => {
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
    L.push('**' + p.term + '**')
    L.push('')
    if (patternMode === 'pointer') {
      // 指针态：保留加粗小节头（条目数口径 itemKind=bold 不变），细节移入 references/。
      L.push('- 完整内容见 ' + String.fromCharCode(96) + 'references/practice-patterns.md' + String.fromCharCode(96) + '。')
      L.push('')
      continue
    }
    if (p.definition) {
      L.push(p.definition)
      L.push('')
    }
    for (const ex of p.examples) L.push('- ' + ex)
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
    for (const c of codeItems) {
      L.push(c.summary ? `- \`${c.path}/\` —— ${c.summary}` : `- \`${c.path}/\``)
    }
    L.push('')

    L.push(SKELETON_SECTIONS[5].heading)
    L.push('')
    for (const r of reading) {
      L.push(`- \`${r.file}\` · ${r.title}（第 ${r.lineStart}–${r.lineEnd} 行）`)
    }
    L.push('')

    return L.join('\n')
  }

  // ADR-004 决策 2 的溢出阀（规格早已写定、2026-10-13 首次实现）：超出体积阈值时把
  // 「实践模式」整段完整内容移入 references/practice-patterns.md，SKILL.md 保留骨架与指针。
  // 指针态仍超限则保持原样——交给门禁如实拒绝，不在这里造更多花样。
  let markdown = render('full')
  const references = []
  let overflow = null
  if (Buffer.byteLength(markdown, 'utf8') > SIZE_LIMIT_BYTES && patterns.length > 0) {
    const full = render('full')
    const fullPatternsBody = full
      .split(SKELETON_SECTIONS[2].heading)[1]
      .split(SKELETON_SECTIONS[3].heading)[0]
      .trim()
    const refContent = [
      '# 实践模式（完整版）',
      '',
      '本文件是 SKILL.md「实践模式」段的完整内容。装配时整段体积超出阈值，按 ADR-004 决策 2',
      '溢出至此；SKILL.md 保留 6 段骨架与该段的加粗小节头 + 指针。内容来源与 SKILL.md 同批对象。',
      '',
      fullPatternsBody,
      '',
    ].join('\n')
    markdown = render('pointer')
    references.push({ path: 'references/practice-patterns.md', content: refContent })
    overflow = {
      applied: true,
      rule: '实践模式完整内容移入 references/，SKILL.md 保留加粗小节头与指针（ADR-004 决策 2）',
      target: 'references/practice-patterns.md',
      bytesFull: Buffer.byteLength(full, 'utf8'),
      bytesAfter: Buffer.byteLength(markdown, 'utf8'),
      stillOverLimit: Buffer.byteLength(markdown, 'utf8') > SIZE_LIMIT_BYTES,
    }
  }

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

  // skillId 兜底：显式传入优先（环 3 的簇模式传真实候选 id）；否则从根锚点派生。
  // 旧实现写死了 `CHAPTER4-${split('#')[1]}`——两个毛病：前缀与章节无关（别的章会盖错名），
  // 且根锚点不含 `#`（簇模式的 skillId 形如 `chapter4-s1`）时 split 取到 undefined 直接崩。
  const [anchorChapter, anchorFragment] = String(cluster.rootAnchor).split('#')
  const fallbackSkillId = `${anchorChapter.toUpperCase()}-${(anchorFragment ?? 'CLUSTER').toUpperCase()}-SKILL-01`

  const contract = {
    schemaVersion: 'skill-contract/v1',
    skillId: input.skillId || fallbackSkillId,
    name: slug,
    description,
    // 溢出阀的机器可读面（ADR-004 决策 2）：references 文件带哈希，overflow 记口径。
    references: references.map((r) => ({
      path: r.path,
      bytes: Buffer.byteLength(r.content, 'utf8'),
      sha256: `sha256:${createHash('sha256').update(r.content).digest('hex')}`,
    })),
    overflow: overflow ?? { applied: false },
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
    riskFlags: buildRiskFlags(gaps),
  }

  return { markdown, references, overflow, contract, gaps, sectionCounts, description, riskFlags: contract.riskFlags }
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

/**
 * 由缺口推出风险标记。**不参与门禁判定**——它的去处是 ADR-006 门禁三的抽样重点：
 * 「高风险定义为门禁二出现误触发、或 `AntiPattern` 覆盖率低的 skill」。
 *
 * 这里只做一件事：把「常见陷阱段条目数低于建议值」翻译成那个定义里说的
 * 「`AntiPattern` 覆盖率低」。ADR-006 早就写下了这条定义，但此前覆盖率不足
 * 被门禁一硬拒掉了，于是高风险标记这一环永远收不到东西——两处 ADR 从未接上。
 */
export function buildRiskFlags(gaps) {
  const flags = []
  const lowPitfall = (gaps || []).find((g) => g.section === 'pitfalls' && g.code === GAP_CODES.BELOW_ADVISORY)
  if (lowPitfall) {
    flags.push({
      flag: RISK_FLAGS.PITFALL_COVERAGE_LOW,
      detail: `anti-pattern 覆盖不足：常见陷阱段 ${lowPitfall.actual} 条，建议值 ${lowPitfall.advisory} 条。`,
      routing: '按 ADR-006 门禁三，本 skill 属高风险，抽样时优先覆盖。',
    })
  }
  return flags
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
