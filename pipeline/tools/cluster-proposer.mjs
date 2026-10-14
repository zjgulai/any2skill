/**
 * 环 3 · 语义聚类（ticket 11，决策见 ADR-024）。
 *
 * 把一章**门禁一通过**的知识对象聚成两级：
 *   内容单元（同章 + 同问题空间，ADR-004 的中间层）→ 技能候选（3–8 个单元一个候选）。
 *
 * ## 为什么是「章内 LLM + 章节骨架确定性」
 *
 * ADR-024 决策 1：按章切分（上界 = 源文件数），章内把对象压成「id + 类型 + 一句话 + 锚点」
 * 喂给模型。跨章合并**刻意不做**——ADR-007 把「合并/拆分」定为门禁二（争抢/零命中）的
 * 修正对象，没有样测反馈就预先合并等于用猜测替代观察。
 *
 * ## 三条不变量（与既有环节同源，不是本模块发明的）
 *
 *   1. **不静默丢弃**：模型没提到的对象进 `unassigned`（带理由）、引用了不存在的 id 进
 *      `unresolvedObjectIds`——全都要落进产物。口径同 `theme-proposer.mjs` 的
 *      `unresolvedAnchors`/`emptyThemes`：一个内容问题不得被伪装成一次正常产出。
 *   2. **不做语义修补**：解析共用 `model-json.mjs`；形状不对即抛 `ClusterProposalError`。
 *   3. **身份进指纹**：复用键 = 系统提示词 + 用户提示词 + 模型 id 的哈希（ADR-013/014）。
 *      提示词改一个字、换一个模型，键就不同——旧结果不会被当成新的用。
 *
 * ## 边界
 *
 * 本模块**只提案**：不装配 skill（那是环 4）、不判门禁（那是门禁一/二）。
 * 数字（5–15 对象/单元、3–8 单元/候选、2.2 skill/章）只作事后诊断，不进任何判据（ADR-024 决策 5）。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { DEFAULT_REPO_ROOT, DEFAULT_SOURCE_KEY } from './anchor-index.mjs'
import { chatCompletion } from './llm-client.mjs'
import { extractJsonPayload } from './model-json.mjs'

export const CLUSTERS_SCHEMA_VERSION = 'clusters/v1'
export const SKILL_CANDIDATES_SCHEMA_VERSION = 'skill-candidates/v1'
export const CLUSTERS_REL_PATH = path.join('pipeline', 'knowledge', 'clusters.json')
export const CLUSTERS_PARTIAL_REL_PATH = path.join('pipeline', 'knowledge', 'clusters.partial.json')
export const CANDIDATES_REL_PATH = path.join('pipeline', 'registry', 'skill-candidates.json')

/**
 * 环 3 产物的**按源命名空间**（ticket 19）：缺省键与既有文件名逐字节相同
 * （第一源的冻结/报告/引用一概不动）；其他源追加 `.<sourceKey>` 后缀。
 * `.partial.json` 后缀必须保留在末尾——`.gitignore` 的 `*.partial.json` 靠它生效。
 */
export const clustersRelPath = (sourceKey = DEFAULT_SOURCE_KEY) =>
  sourceKey === DEFAULT_SOURCE_KEY
    ? CLUSTERS_REL_PATH
    : path.join('pipeline', 'knowledge', `clusters.${sourceKey}.json`)
export const clustersPartialRelPath = (sourceKey = DEFAULT_SOURCE_KEY) =>
  sourceKey === DEFAULT_SOURCE_KEY
    ? CLUSTERS_PARTIAL_REL_PATH
    : path.join('pipeline', 'knowledge', `clusters.${sourceKey}.partial.json`)
export const candidatesRelPath = (sourceKey = DEFAULT_SOURCE_KEY) =>
  sourceKey === DEFAULT_SOURCE_KEY
    ? CANDIDATES_REL_PATH
    : path.join('pipeline', 'registry', `skill-candidates.${sourceKey}.json`)
/** 跨章综合产物。它不是「某章第 2 层的对象」，不进聚类输入（与 run-book 的反模式统计同一口径）。 */
export const CROSS_CHAPTER_OBJECTS_FILE = 'antipatterns.objects.json'

/**
 * 输出上限（含推理 token）。取 24000 而不是最初的 16000：
 * chapter4 试跑（2026-10-12，39 个对象）实测完成量 **12,241**（其中推理 **10,428**，占 85%），
 * 距 16000 只剩 24% 余量——而 chapter7 是它的两倍对象（82 条），推理量会同步增长。
 * 上限卡在推理上时的失败形态与第 2 层相同（响应无可解析 JSON），
 * 综合模块的实测已证明要先看 `finishReason` 再谈归因。上限本身记进每章产物。
 */
export const DEFAULT_CLUSTER_MAX_TOKENS = 24000
export const DEFAULT_CLUSTER_TEMPERATURE = 0

/** 摘要截断长度（字符）。它是**输入压缩**，不影响任何判据——原文始终在对象文件里。 */
export const SUMMARY_MAX_CHARS = 140

export class ClusterProposalError extends Error {
  constructor(message, { rawText = null } = {}) {
    super(message)
    this.name = 'ClusterProposalError'
    this.rawText = rawText
  }
}

/** 聚类输入 = 逐章对象文件，**排除**跨章综合产物（它不是任何一章第 2 层的产出）。 */
export function listClusterInputFiles(fileNames) {
  return fileNames
    .filter((n) => n.endsWith('.objects.json') && n !== CROSS_CHAPTER_OBJECTS_FILE)
    .sort()
}

/* ──────────────────────────── 输入压缩 ──────────────────────────── */

const SUMMARY_FIELD_ORDER = [
  'statement', // EngineeringRule
  'pattern', // AntiPattern
  'recommendation', // Heuristic
  'definition', // Concept
  'reasoning', // MentalModel（trigger 太短，reasoning 才是「它主张什么」）
  'title', // Case / Playbook
  'name', // Metric
]

/**
 * 一句话摘要：按类型偏好取字段，截断到 `SUMMARY_MAX_CHARS`。
 *
 * **这是有损压缩，且只用于喂模型**——对象原文在 `*.objects.json` 里一字不动。
 * ADR-024 把「压缩保真度」列为未决：首次真实运行后若有明显误合，再评估加长摘要。
 */
export function summaryOfObject(obj) {
  const pick = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
  let text = null
  if (obj?.objectType === 'Concept') {
    const term = pick(obj.canonicalTerm)
    const def = pick(obj.definition)
    text = term && def ? `${term}：${def}` : (def ?? term)
  } else if (obj?.objectType === 'Heuristic') {
    const trigger = pick(obj.trigger)
    const rec = pick(obj.recommendation)
    text = trigger && rec ? `${trigger} → ${rec}` : (rec ?? trigger)
  }
  if (text === null) {
    for (const f of SUMMARY_FIELD_ORDER) {
      text = pick(obj?.[f])
      if (text !== null) break
    }
  }
  text = text === null ? '(无摘要字段)' : text.replace(/\s*\n\s*/g, ' ')
  return text.length > SUMMARY_MAX_CHARS ? `${text.slice(0, SUMMARY_MAX_CHARS)}…` : text
}

/** 对象声明的锚点（去重、保序）。 */
export function anchorsOfObject(obj) {
  const seen = new Set()
  const out = []
  for (const r of obj?.sourceRefs ?? []) {
    if (typeof r?.anchor !== 'string' || r.anchor === '' || seen.has(r.anchor)) continue
    seen.add(r.anchor)
    out.push(r.anchor)
  }
  return out
}

/* ──────────────────────────── 提示词 ──────────────────────────── */

/**
 * 系统提示词。硬性要求逐条对应一个具体的失败模式：
 *   1. id 必须逐字复制——杜撰 id 只会到装配时才以「解析不到」爆出来，而那时已付过钱；
 *   2. 每个对象恰好归一个单元——漏掉的对象会在链路上**静默消失**，是本模块最要挡的事；
 *   3. 每个单元至少属于一个候选——只在单元不入候选时才会发生，产物里必须看得见；
 *   4. 依据必须写出来——ADR-007 的硬约束（划分可复核）落在 rationale 上。
 */
export function buildClusterSystemPrompt() {
  return [
    '你是「内容单元聚类器」。输入是**一章**已经过机器验证的知识对象清单，',
    '每行格式：对象 id | 类型 | 一句话摘要 | 出处锚点。目录里没有正文。',
    '',
    '你的任务分两步：',
    '1. 把对象聚成**内容单元**：回答同一类问题、属于同一问题空间的对象聚在一起',
    '   （一个单元通常 5–15 个对象，这是建议值，不是配额）。',
    '2. 把内容单元聚成**技能候选**：一个候选由 3–8 个单元组成（同样只是建议值），',
    '   面向同一批使用场景——即「什么任务会需要读这份内容」。',
    '',
    '硬性要求：',
    '1. **对象 id 必须逐字复制自输入**，不得杜撰、不得改动大小写或数字。',
    '   引用一个不存在的 id 会让它在链路上被当成不存在。',
    '2. **每个对象必须恰好出现在一个内容单元里。** 宁可把不合适的对象单独成一个单元、',
    '   并在 rationale 里说明，也不要漏掉它——漏掉的对象不会有人替它补上。',
    '   同一个对象也不得出现在两个单元里。',
    '3. **每个内容单元至少要属于一个候选。** 单元不入候选意味着它的对象进不了任何 skill。',
    '4. **每个单元与每个候选都要给 rationale**：因何聚在一起（共同的判断依据/问题），',
    '   这是划分可复核的唯一凭据。',
    '5. 候选的 trigger 写「什么场景该用它」（一两句），它不是单元名的复述。',
    '6. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"units": [',
    '     {"name": "<短名，4–12 字>", "objectIds": ["<逐字复制的 id>", "…"],',
    '      "rationale": "<这些对象因何属于同一问题空间>"}',
    '   ],',
    '    "skills": [',
    '     {"name": "<候选短名>", "trigger": "<什么场景该用它>",',
    '      "unitIndexes": [0, 1], "rationale": "<这些单元因何面向同一批场景>"}',
    '   ]}',
  ].join('\n')
}

/** 用户提示词：本章对象清单。每行 `id | 类型 | 摘要 | 锚点`。 */
export function buildClusterUserPrompt({ fileKey, chapterTitle, rows }) {
  const lines = rows.map((r) => `${r.id} | ${r.objectType} | ${r.summary} | ${r.anchors.join(',') || '—'}`)
  return [
    `本章：${fileKey}${chapterTitle ? `（${chapterTitle}）` : ''}，共 ${rows.length} 个已通过验证的知识对象。`,
    '对象清单如下（格式：id | 类型 | 一句话摘要 | 出处锚点）：',
    '',
    ...lines,
  ].join('\n')
}

/** 提示词指纹。与第 2 层/主题提案同构：提示词是实现的一部分，必须与 modelId 同级进产物。 */
export function clusterPromptFingerprint() {
  const sample = buildClusterUserPrompt({
    fileKey: '<fileKey>',
    chapterTitle: '<title>',
    rows: [{ id: '<id>', objectType: '<type>', summary: '<summary>', anchors: ['<anchor>'] }],
  })
  const digest = createHash('sha256')
    .update(`${buildClusterSystemPrompt()}\n\u0000\n${sample}`)
    .digest('hex')
    .slice(0, 12)
  return `prompt-${digest}`
}

/**
 * 单章输入身份（复用键）。
 *
 * 直接哈希**该章真正要发出的两条提示词**与模型 id——不是某个「等价」的摘要。
 * 这样「键相同」与「输入相同」是同一句话，不存在需要人去论证的等价性。
 * 模型 id 必须参与：换模型就是换输入（ADR-013/014 的既有立场）；
 * 章标题参与是因为它真的出现在提示词里——输入变了而键没变，缓存就会撒一次谎。
 */
export function chapterInputHash({ fileKey, chapterTitle = null, rows, modelId }) {
  const digest = createHash('sha256')
    .update(
      `${buildClusterSystemPrompt()}\n\u0000\n${buildClusterUserPrompt({ fileKey, chapterTitle, rows })}\n\u0000\nmodel:${modelId ?? 'default'}`,
    )
    .digest('hex')
  return `sha256:${digest}`
}

/* ──────────────────────────── 解析与校核 ──────────────────────────── */

/** 从响应文本里取出 JSON 对象。解析共用 `model-json.mjs`（不做语义修补，见该模块）。 */
export function parseClusterProposal(text) {
  const raw = String(text ?? '')
  const result = extractJsonPayload(raw)
  if (result.ok) return result.value
  throw new ClusterProposalError(`聚类响应不是可解析的 JSON：${result.diagnostic}`, { rawText: raw })
}

/**
 * 校核提案并派生两级记录。
 *
 * 派生规则（都在这里一次性算清，下游不重算）：
 *   - `unitId` / `skillId` 由本模块派生（`<fileKey>-u<n>` / `<fileKey>-s<n>`），
 *     采用**位置序号**——与跨章对象的 id 同一约定（README 已写明：位置序号不是内容身份）；
 *   - 单元的 `anchors` = 成员对象锚点的并集（保序去重）；
 *   - 覆盖率四件套：`unassigned`（模型漏掉的对象）、`duplicates`（被归进多个单元）、
 *     `unresolvedObjectIds`（模型引用了不存在的 id）、`unitsWithoutSkill`（没进任何候选的单元）。
 */
export function validateClusterProposal(proposal, { fileKey, rows }) {
  const unitsRaw = Array.isArray(proposal?.units) ? proposal.units : null
  const skillsRaw = Array.isArray(proposal?.skills) ? proposal.skills : null
  if (unitsRaw === null) {
    throw new ClusterProposalError(
      `聚类提案里没有 units 数组（顶层键：${
        proposal && typeof proposal === 'object' ? Object.keys(proposal).join(', ') || '无' : typeof proposal
      }）`,
    )
  }
  if (skillsRaw === null) {
    throw new ClusterProposalError('聚类提案里没有 skills 数组')
  }

  const byId = new Map(rows.map((r) => [r.id, r]))
  const assignedTo = new Map() // objectId → [unitIndex…]
  const unresolvedObjectIds = []
  const units = []

  unitsRaw.forEach((raw, i) => {
    const unitId = `${fileKey}-u${i + 1}`
    const cited = Array.isArray(raw?.objectIds) ? raw.objectIds : []
    const memberIds = []
    const seen = new Set()
    for (const token of cited) {
      if (typeof token !== 'string' || token === '') continue
      if (!byId.has(token)) {
        unresolvedObjectIds.push({ objectId: token, citedBy: unitId })
        continue
      }
      if (seen.has(token)) continue
      seen.add(token)
      memberIds.push(token)
      if (!assignedTo.has(token)) assignedTo.set(token, [])
      assignedTo.get(token).push(unitId)
    }
    const anchors = []
    const anchorSeen = new Set()
    for (const id of memberIds) {
      for (const a of byId.get(id).anchors) {
        if (anchorSeen.has(a)) continue
        anchorSeen.add(a)
        anchors.push(a)
      }
    }
    units.push({
      unitId,
      name: typeof raw?.name === 'string' ? raw.name.trim() : '',
      objectIds: memberIds,
      anchors,
      rationale: typeof raw?.rationale === 'string' ? raw.rationale.trim() : '',
    })
  })

  const duplicates = []
  const unassigned = []
  for (const r of rows) {
    const at = assignedTo.get(r.id)
    if (!at || at.length === 0) {
      unassigned.push({ objectId: r.id, reason: '模型未把它归入任何内容单元' })
    } else if (at.length > 1) {
      // 保留第一次出现的归属；后面的归属逐条记录，不静默丢。
      duplicates.push({ objectId: r.id, units: at, kept: at[0] })
    }
  }

  const skills = []
  const unitsInSkills = new Set()
  skillsRaw.forEach((raw, i) => {
    const skillId = `${fileKey}-s${i + 1}`
    const cited = Array.isArray(raw?.unitIndexes) ? raw.unitIndexes : []
    const unitIds = []
    for (const idx of cited) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= units.length) {
        throw new ClusterProposalError(
          `候选 ${skillId} 的 unitIndexes 越界：${JSON.stringify(idx)}（本次提案共 ${units.length} 个单元）`,
        )
      }
      const uid = units[idx].unitId
      if (unitIds.includes(uid)) continue
      unitIds.push(uid)
      unitsInSkills.add(uid)
    }
    const objectIds = []
    const objectSeen = new Set()
    for (const uid of unitIds) {
      for (const oid of units.find((u) => u.unitId === uid).objectIds) {
        if (objectSeen.has(oid)) continue
        objectSeen.add(oid)
        objectIds.push(oid)
      }
    }
    skills.push({
      skillId,
      name: typeof raw?.name === 'string' ? raw.name.trim() : '',
      trigger: typeof raw?.trigger === 'string' ? raw.trigger.trim() : '',
      unitIds,
      objectIds,
      rationale: typeof raw?.rationale === 'string' ? raw.rationale.trim() : '',
    })
  })

  const unitsWithoutSkill = units.filter((u) => !unitsInSkills.has(u.unitId)).map((u) => u.unitId)

  return {
    units,
    skills,
    coverage: {
      gatePassed: rows.length,
      assigned: rows.length - unassigned.length,
      unassigned,
      duplicates,
      unresolvedObjectIds,
      unitsWithoutSkill,
    },
  }
}

/* ──────────────────────────── 单章提案 ──────────────────────────── */

/**
 * 跑一章的聚类。**不做复用判断、不写盘**——复用与落盘由调用方（CLI）负责，
 * 这样本函数在测试里可以直接用注入的 `chat` 替身跑。
 */
export async function proposeChapterClusters({
  config,
  fileKey,
  chapterTitle = null,
  objects,
  chat,
  fetchImpl,
  ledger,
  maxTokens = DEFAULT_CLUSTER_MAX_TOKENS,
  temperature = DEFAULT_CLUSTER_TEMPERATURE,
  maxAttempts,
  retryDelayMs,
  createdAt,
}) {
  const chatFn = chat ?? chatCompletion
  const rows = objects.map((o) => ({
    id: o.id,
    objectType: o.objectType,
    summary: summaryOfObject(o),
    anchors: anchorsOfObject(o),
  }))
  const modelId = config?.modelId ?? null
  const inputHash = chapterInputHash({ fileKey, chapterTitle, rows, modelId })

  const res = await chatFn(config, {
    system: buildClusterSystemPrompt(),
    user: buildClusterUserPrompt({ fileKey, chapterTitle, rows }),
    maxTokens,
    temperature,
    fetchImpl,
    ledger,
    maxAttempts,
    retryDelayMs,
  })

  const parsed = parseClusterProposal(res.text)
  const checked = validateClusterProposal(parsed, { fileKey, rows })

  return {
    fileKey,
    inputHash,
    status: 'proposed',
    createdAt: createdAt ?? new Date().toISOString(),
    modelId: res.modelId ?? modelId,
    units: checked.units,
    skills: checked.skills,
    coverage: checked.coverage,
    usage: res.usage ?? null,
    finishReason: res.finishReason ?? null,
    reasoningChars: res.reasoningChars ?? 0,
    maxTokens,
  }
}

/* ──────────────────────────── 候选与诊断 ──────────────────────────── */

/** 单元 → 候选（SkillCandidate）形状。字段名照 MVP 计划 §4.2，不加私有别名。 */
export function candidatesFromChapters(chapters) {
  const candidates = []
  for (const ch of chapters) {
    for (const s of ch.skills) {
      candidates.push({
        skillId: s.skillId,
        sourceObjects: s.objectIds,
        trigger: s.trigger,
        chapterRefs: [ch.fileKey],
        // 状态机未建（门禁二/三属环 5，ADR-024 未决 3）：v1 的初值就是「候选」本身。
        promotionState: 'candidate',
        name: s.name,
        units: s.unitIds,
        anchors: ch.units.filter((u) => s.unitIds.includes(u.unitId)).flatMap((u) => u.anchors),
        rationale: s.rationale,
      })
    }
  }
  return candidates
}

/**
 * 跨章综合物的处置（ADR-007 的既有约定，ADR-024 决策 3：v1 只算结论落盘）。
 *
 * 可算的一半：**是否属于任何单章**——凭对象自己的 `sourceRefs` 数去重后的章节数。
 * 不可算的一半：**「≥3 个独立场景」**——场景要门禁二才存在，此处如实标为未验证，
 * 不假装算过。判定：跨 ≥2 章 → 待门禁二验证的独立候选；单章 → 分发进相关 skill 的陷阱段。
 */
export function crossChapterDisposition(antipatternObjects) {
  const aps = (Array.isArray(antipatternObjects) ? antipatternObjects : []).filter(
    (o) => o?.objectType === 'AntiPattern',
  )
  return aps.map((o) => {
    const chapters = [...new Set((o.sourceRefs ?? []).map((r) => String(r?.anchor ?? '').split('#')[0]).filter(Boolean))].sort()
    const chapterBound = chapters.length < 2
    return {
      objectId: o.id,
      chapters,
      chapterCount: chapters.length,
      decision: chapterBound ? 'distribute-to-pitfalls' : 'independent-candidate-pending-gate2',
      basis: chapterBound
        ? `出处只落在一章（${chapters.join(', ') || '无'}）——按 ADR-007 约定分发进相关 skill 的「常见陷阱」段`
        : `出处跨 ${chapters.length} 章（${chapters.join(', ')}）——不属于任何单章`,
      unverifiedCondition: chapterBound ? null : '「能被 ≥3 个独立场景触发」需要门禁二（环 5）才能验证；在此之前不发布',
    }
  })
}

/**
 * 诊断量（ADR-024 决策 5：**不进判据**）。
 *
 * 2.2 skill/章 是 ADR-007 定的事后对照基准，来源是原书 22 skill / 10 章——
 * 本仓有 13 个源文件（含前言/后记/思考题答案），对照只在**章**这一口径上做，
 * 且只报数字与偏差，不触发任何动作。
 */
export function diagnosticsOf(chapters, candidates) {
  const byFile = chapters.map((ch) => ({
    fileKey: ch.fileKey,
    units: ch.units.length,
    skills: ch.skills.length,
    objects: ch.coverage.gatePassed,
    unassigned: ch.coverage.unassigned.length,
    unresolved: ch.coverage.unresolvedObjectIds.length,
  }))
  const unitSizes = chapters.flatMap((ch) => ch.units.map((u) => u.objectIds.length))
  const unitsPerSkill = chapters.flatMap((ch) => ch.skills.map((s) => s.unitIds.length))
  const stat = (xs) => {
    if (xs.length === 0) return { min: null, median: null, max: null, n: 0 }
    const s = [...xs].sort((a, b) => a - b)
    return { min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1), n: s.length }
  }
  const chapterOnly = byFile.filter((b) => /^chapter\d+$/.test(b.fileKey))
  return {
    byFile,
    candidateCount: candidates.length,
    unitSize: stat(unitSizes),
    unitsPerSkill: stat(unitsPerSkill),
    reference: {
      skillsPerChapter: 2.2,
      scope: '原书 22 个 skill / 10 章（ADR-007 实测）',
      observedChapters: chapterOnly.length,
      observedSkills: chapterOnly.reduce((s, b) => s + b.skills, 0),
      note: '仅诊断，不设目标（ADR-007：数量是结果不是配额；ADR-021：形状数字不是判据）',
    },
  }
}

/* ──────────────────────────── 落盘 ──────────────────────────── */

export async function readPartialClusters(repoRoot, { sourceKey = DEFAULT_SOURCE_KEY } = {}) {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, clustersPartialRelPath(sourceKey)), 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

export async function writePartialClusters(partial, repoRoot, { sourceKey = DEFAULT_SOURCE_KEY } = {}) {
  const outPath = path.join(repoRoot, clustersPartialRelPath(sourceKey))
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(partial, null, 2)}\n`, 'utf8')
  return outPath
}

export async function writeClusters(clustersDoc, repoRoot, { sourceKey = DEFAULT_SOURCE_KEY } = {}) {
  const outPath = path.join(repoRoot, clustersRelPath(sourceKey))
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(clustersDoc, null, 2)}\n`, 'utf8')
  return outPath
}

export async function writeSkillCandidates(candidatesDoc, repoRoot, { sourceKey = DEFAULT_SOURCE_KEY } = {}) {
  const outPath = path.join(repoRoot, candidatesRelPath(sourceKey))
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(candidatesDoc, null, 2)}\n`, 'utf8')
  return outPath
}

export { DEFAULT_REPO_ROOT }
