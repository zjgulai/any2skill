/**
 * 任务技能套件 · 装配器（卡 26，决策见 ADR-031）
 *
 * ## 与旧装配器（skill-builder.mjs）的关系
 *
 * 两个平面**并存**：旧装配器从簇/子树渲染「原书六段」骨架，服务于第一代章节技能；
 * 本模块从**套件清单**（`pipeline/curation/task-skill-suite.v1.json`）渲染任务骨架，
 * 服务于 30→19 重组后的岗位技能。旧路径一字未改（`npm test` 的字节断言即此保证）。
 *
 * ## 三条纪律
 *
 * 1. **每个对象恰好一个主人**：清单声明精确 owned 对象；装载时逐个解析、逐章核对
 *    门禁一回执的通过集——没通过的、找不到的、被 rejected 引用的一律拒绝装配。
 * 2. **来源与编排分离**：正文前五段来自工作流文件（`pipeline/curation/workflows/`，
 *    作者编写的操作说明，显式声明为作者补充）；「依据与边界」来自来源对象（规则与
 *    陷阱原文）与锚点回链（可溯源）。两类内容在文件层面分开，不混写。
 * 3. **确定性渲染**：`renderTaskSkill` 是纯函数，无时间戳、无随机序；两遍渲染逐字节
 *    相同（测试钉住）。
 */

import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'

import { DEFAULT_REPO_ROOT, sourceBookRoot } from './anchor-index.mjs'
import { unwrapObjectsFile } from './skill-builder.mjs'
import { splitSections, itemCountFor } from './verify-skill.mjs'
import { findLatestReceipt, findLatestAntipatternVerdicts, passedObjectIds } from '../build-skill.mjs'

/** 套件清单与工作流的 schema 版本与缺省相对路径。 */
export const TASK_SUITE_SCHEMA_VERSION = 'task-skill-suite/v1'
export const TASK_SKILL_CONTRACT_SCHEMA_VERSION = 'task-skill-contract/v1'
export const SUITE_MANIFEST_REL_PATH = path.join('pipeline', 'curation', 'task-skill-suite.v1.json')
const WORKFLOW_SCHEMA_VERSION = 'task-workflow/v1'

/**
 * 任务骨架。六段与旧骨架**同名不同序**的部分刻意保留「何时使用」与「依据与边界」，
 * 其余为操作型段落（输入/步骤/交付物/检查）——这是与旧骨架的**架构性区别**，
 * 记录于 ADR-031；旧套件归档保留原样，两套骨架不互相迁移。
 */
export const TASK_SKELETON_SECTIONS = Object.freeze([
  { key: 'whenToUse', heading: '## 何时使用', shape: '列表，任务场景/触发条件', itemKind: 'bullet', sources: [] },
  { key: 'inputs', heading: '## 输入与前置条件', shape: '列表，执行前需要就绪的事实与材料', itemKind: 'bullet', sources: [] },
  { key: 'steps', heading: '## 执行步骤', shape: '编号步骤，一步一个主要动作', itemKind: 'numbered', sources: [] },
  { key: 'outputs', heading: '## 交付物', shape: '列表，可检查的产出', itemKind: 'bullet', sources: [] },
  { key: 'checks', heading: '## 检查、停止与回滚', shape: '列表，成功判据、停止条件与回滚处置', itemKind: 'bullet', sources: [] },
  { key: 'evidence', heading: '## 依据与边界', shape: '来源派生的规则与陷阱 + 出处回链 + 作者声明的边界', itemKind: 'bullet', sources: [], readingSection: true },
])

/* ──────────────────────────── 装载 ──────────────────────────── */

const sha = (buf) => `sha256:${createHash('sha256').update(buf).digest('hex')}`

export async function readJson(absPath, what) {
  try {
    return JSON.parse(await readFile(absPath, 'utf8'))
  } catch (err) {
    throw new Error(`${what} 读取失败（${absPath}）：${err.message}`)
  }
}

export async function loadSuiteManifest(repoRoot = DEFAULT_REPO_ROOT, relPath = SUITE_MANIFEST_REL_PATH) {
  const abs = path.join(repoRoot, relPath)
  const raw = await readFile(abs, 'utf8')
  const manifest = JSON.parse(raw)
  if (manifest.schemaVersion !== TASK_SUITE_SCHEMA_VERSION) {
    throw new Error(`套件清单 schemaVersion 不认识：${manifest.schemaVersion}（期望 ${TASK_SUITE_SCHEMA_VERSION}）`)
  }
  return { manifest, abs, sha256: sha(raw) }
}

/** 全部知识对象文件（排除跨章合成产物）的 id → {object, fileKey} 索引。 */
export async function loadObjectIndex(repoRoot) {
  const dir = path.join(repoRoot, 'pipeline', 'knowledge')
  const names = (await readdir(dir)).filter((n) => n.endsWith('.objects.json') && !/^antipatterns\./.test(n))
  const index = new Map()
  for (const n of names) {
    const fileKey = n.replace(/\.objects\.json$/, '')
    const doc = unwrapObjectsFile(JSON.parse(await readFile(path.join(dir, n), 'utf8')), n)
    for (const o of doc) {
      if (index.has(o.id)) throw new Error(`对象 id 重复：${o.id}（${fileKey} 与既有索引）`)
      index.set(o.id, { object: o, fileKey })
    }
  }
  return index
}

/**
 * 装载一个成员的来源对象与跨章反模式，逐个核验门禁通过集。
 * 拒绝装配的三种情形都带明确原因：找不到对象 / 该章回执未通过 / 跨章池未判定或未通过。
 */
export async function loadMemberSources(repoRoot, member, objectIndex, { apDocs = null } = {}) {
  const byFile = new Map()
  for (const id of member.primaryObjects) {
    const hit = objectIndex.get(id)
    if (!hit) throw new Error(`${member.slug} 的 owned 对象在知识平面找不到：${id}`)
    if (!byFile.has(hit.fileKey)) byFile.set(hit.fileKey, [])
    byFile.get(hit.fileKey).push(hit.object)
  }
  const objects = []
  for (const [fileKey, objs] of [...byFile.entries()].sort()) {
    const sourceRel = path.join(sourceBookRoot(member.sourceKey), `${fileKey}.md`)
    const found = await findLatestReceipt(sourceRel, { repoRoot })
    if (!found) throw new Error(`${member.slug}：章节 ${fileKey} 缺门禁一回执——拒绝装配（没有回执 ≠ 对象都通过了）。`)
    const passSet = passedObjectIds(found.receipt)
    for (const o of objs) {
      if (!passSet.has(o.id)) {
        throw new Error(`${member.slug}：对象 ${o.id} 未过门禁一（章节 ${fileKey} 的回执不通过它）——拒绝装配。`)
      }
      objects.push({ ...o, __fileKey: fileKey })
    }
  }

  const aps = []
  if ((member.crossChapterObjects ?? []).length > 0) {
    const docs = apDocs ?? (await loadApDocs(repoRoot, member.sourceKey))
    const apById = new Map(docs.objects.map((o) => [o.id, o]))
    const verdicts = await findLatestAntipatternVerdicts({ repoRoot, expectRunId: docs.runId })
    const apPass = new Set((verdicts?.verdicts ?? []).filter((v) => v.status === 'pass').map((v) => v.objectId))
    for (const id of member.crossChapterObjects) {
      const o = apById.get(id)
      if (!o) throw new Error(`${member.slug} 的跨章反模式不在本源池：${id}`)
      if (!apPass.has(id)) {
        throw new Error(`${member.slug}：跨章反模式 ${id} 未判定通过（判定表 ${verdicts?.file ?? '(缺)'}）——拒绝装配。`)
      }
      aps.push(o)
    }
  }
  return { objects, aps }
}

async function loadApDocs(repoRoot, sourceKey) {
  const { crossChapterObjectsFile } = await import('./cluster-proposer.mjs')
  const file = crossChapterObjectsFile(sourceKey)
  const doc = await readJson(path.join(repoRoot, 'pipeline', 'knowledge', file), `跨章反模式池（${file}）`)
  return { runId: doc.runId ?? null, objects: unwrapObjectsFile(doc, file) }
}

/** 全部 sourceRefs（主对象 + 跨章反模式），按 file#anchor 去重，保持首见顺序。 */
function collectSourceRefs(objects, aps) {
  const refs = []
  const seen = new Set()
  for (const o of [...objects, ...aps]) {
    for (const r of o.sourceRefs ?? []) {
      const key = `${r.file}#${r.anchor}`
      if (seen.has(key)) continue
      seen.add(key)
      refs.push({ file: r.file, anchor: r.anchor, title: r.title, lineStart: r.lineStart, lineEnd: r.lineEnd })
    }
  }
  return refs
}

/* ──────────────────────────── 渲染（纯函数）──────────────────────────── */

const oneLine = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()

/**
 * 把对象摊成「来源规则」条目，按类型取主文本：
 *   - EngineeringRule → statement；
 *   - Heuristic → trigger（有 recommendation 时以「——建议」接续）；
 *   - DecisionModel → 分支合成「当 <condition>：<action>」；
 *   - MentalModel → trigger；Case → 「案例：<title>——<outcome>」。
 * Concept 与 AntiPattern 不走本函数：前者留在契约里做溯源（正文面向执行，术语表会稀释
 * 步骤），后者归「来源陷阱」。**不虚构**：所有文本都是对象字段的原文拼接，只做压缩。
 */
function ruleEntriesOf(objects) {
  const out = []
  for (const o of objects) {
    let text = ''
    switch (o.objectType) {
      case 'EngineeringRule':
        text = oneLine(o.statement ?? '')
        break
      case 'Heuristic':
        text = oneLine(o.trigger ?? '')
        if (text && o.recommendation) text += `——建议：${oneLine(o.recommendation)}`
        break
      case 'DecisionModel':
        text = (o.branches ?? []).map((b) => `当${oneLine(b.condition)}：${oneLine(b.action)}`).join('；')
        break
      case 'MentalModel':
        text = oneLine(o.trigger ?? '')
        break
      case 'Case':
        text = o.title ? `案例：${oneLine(o.title)}${o.outcome ? `——${oneLine(o.outcome)}` : ''}` : ''
        break
      default:
        text = ''
    }
    if (text) out.push({ id: o.id, text })
  }
  return out
}

/** 陷阱条目 = 章内 AntiPattern 主对象 + 跨章反模式（按 id 去重，章内在先）。 */
function pitfallEntriesOf(objects, aps) {
  const all = [...objects.filter((o) => o.objectType === 'AntiPattern'), ...aps]
  const seen = new Set()
  const out = []
  for (const a of all) {
    if (!a.pattern || seen.has(a.id)) continue
    seen.add(a.id)
    out.push({ id: a.id, pattern: oneLine(a.pattern), harm: a.harm ? oneLine(a.harm) : null, corrective: a.corrective ? oneLine(a.corrective) : null })
  }
  return out
}

/**
 * 渲染一份任务技能正文。**纯函数**：同输入两遍逐字节相同（无时间戳、无环境读取）。
 * `readingMode`：`full` 逐锚点列出（缺省）；`compact` 按文件聚合（体积兜底，见 ADR-031
 * 的溢出阀：只压缩呈现粒度，不丢锚点——每处锚点的行号仍全部在列）。
 */
export function renderTaskSkill({ member, workflow, objects, aps, readingMode = 'full' }) {
  const refs = collectSourceRefs(objects, aps)
  const L = []
  L.push('---')
  L.push(`name: ${member.slug}`)
  L.push(`description: ${oneLine(workflow.description)}`)
  L.push('---')
  L.push('')
  L.push(`# ${workflow.title}`)
  L.push('')

  L.push(TASK_SKELETON_SECTIONS[0].heading)
  L.push('')
  for (const x of workflow.whenToUse) L.push(`- ${oneLine(x)}`)
  L.push('')

  L.push(TASK_SKELETON_SECTIONS[1].heading)
  L.push('')
  for (const x of workflow.inputs) L.push(`- ${oneLine(x)}`)
  L.push('')

  L.push(TASK_SKELETON_SECTIONS[2].heading)
  L.push('')
  workflow.steps.forEach((x, i) => L.push(`${i + 1}. ${oneLine(x)}`))
  L.push('')

  L.push(TASK_SKELETON_SECTIONS[3].heading)
  L.push('')
  for (const x of workflow.outputs) L.push(`- ${oneLine(x)}`)
  L.push('')

  L.push(TASK_SKELETON_SECTIONS[4].heading)
  L.push('')
  for (const x of workflow.checks) L.push(`- ${oneLine(x)}`)
  for (const x of workflow.stopConditions) L.push(`- 停止条件：${oneLine(x)}`)
  L.push(`- 回滚：${workflow.rollback.disposition === 'not-applicable' ? '不适用' : '已定义'}。${oneLine(workflow.rollback.note)}`)
  L.push('')

  L.push(TASK_SKELETON_SECTIONS[5].heading)
  L.push('')
  L.push('**来源规则**')
  L.push('')
  for (const r of ruleEntriesOf(objects)) L.push(`- ${r.text}`)
  L.push('')
  const pitfalls = pitfallEntriesOf(objects, aps)
  if (pitfalls.length > 0) {
    L.push('**来源陷阱**')
    L.push('')
    for (const p of pitfalls) {
      L.push(`- ${p.pattern}`)
      if (p.harm) L.push(`  - 后果：${p.harm}`)
      if (p.corrective) L.push(`  - 纠正：${p.corrective}`)
    }
    L.push('')
  }
  L.push('**适用边界**')
  L.push('')
  for (const x of workflow.boundaries) L.push(`- ${oneLine(x)}`)
  L.push('')
  L.push('**出处**')
  L.push('')
  if (readingMode === 'compact') {
    const byFile = new Map()
    for (const r of refs) {
      if (!byFile.has(r.file)) byFile.set(r.file, [])
      byFile.get(r.file).push(r)
    }
    for (const [file, rs] of byFile) {
      const ranges = rs.map((r) => `${r.lineStart}–${r.lineEnd}`).join('、')
      L.push(`- \`${file}\` · 共 ${rs.length} 处锚点（第 ${ranges} 行）。`)
    }
  } else {
    for (const r of refs) L.push(`- \`${r.file}\` · ${oneLine(r.title)}（第 ${r.lineStart}–${r.lineEnd} 行）`)
  }
  L.push('')
  return L.join('\n')
}

/** 统计各段条目数（与 verify-skill 的计数口径同源，直接复用同一对函数）。 */
export function countsOf(markdown) {
  const body = markdown.slice(markdown.indexOf('\n---\n', 3) + 5)
  const sections = splitSections(body)
  const byHeading = new Map(sections.map((s) => [s.heading, s]))
  const counts = {}
  for (const spec of TASK_SKELETON_SECTIONS) {
    const sec = byHeading.get(spec.heading)
    counts[spec.key] = sec ? itemCountFor(sec, spec) : 0
  }
  return counts
}

/** 工作流加载 + 形状校验（缺一即拒绝，避免渲染出空段）。 */
export async function loadWorkflow(repoRoot, member) {
  const abs = path.join(repoRoot, member.workflowFile)
  const raw = await readFile(abs, 'utf8')
  const wf = JSON.parse(raw)
  if (wf.schemaVersion !== WORKFLOW_SCHEMA_VERSION) {
    throw new Error(`${member.slug} 工作流 schemaVersion 不认识：${wf.schemaVersion}`)
  }
  // 草稿与可发布物的硬边界（卡 29）：编排器生成的草案带 draft:true——拒绝构建，
  // 直到编辑按核对单收敛并去掉草稿标记。防止「草案直接发布」这类静默降格。
  if (wf.draft === true) {
    throw new Error(`${member.slug} 的工作流仍是草稿（draft:true）——先按编辑核对单完成策展再构建。`)
  }
  if (wf.slug !== member.slug) throw new Error(`${member.slug} 工作流的 slug 不匹配：${wf.slug}`)
  for (const field of ['description', 'whenToUse', 'inputs', 'steps', 'outputs', 'checks', 'stopConditions', 'rollback', 'boundaries']) {
    if (wf[field] === undefined) throw new Error(`${member.slug} 工作流缺字段：${field}`)
  }
  const arr = (f) => {
    if (!Array.isArray(wf[f]) || wf[f].length === 0) throw new Error(`${member.slug} 工作流字段必须是非空数组：${f}`)
    return wf[f]
  }
  for (const f of ['whenToUse', 'inputs', 'steps', 'outputs', 'checks', 'stopConditions', 'boundaries']) arr(f)
  if (typeof wf.description !== 'string' || wf.description.trim() === '') throw new Error(`${member.slug} 工作流 description 为空`)
  if (!wf.rollback || typeof wf.rollback !== 'object' || !wf.rollback.disposition) throw new Error(`${member.slug} 工作流缺 rollback.disposition`)
  return { workflow: wf, sha256: sha(raw), file: member.workflowFile }
}