/**
 * 门禁一 · Skill 侧（确定性，无 LLM）
 *
 * 实现 ADR-006「门禁一」的第 4、5、6 项检查，外加 `sourceRefs` 可解析性——
 * 前者三项在原 ADR 里已写明，后者是本文件补的：原 ADR 的第 3 项针对**知识对象**，
 * 而 skill 的溯源是另一码事（skill 引的是对象的出处，得单独验一遍）。
 *
 * ## 口径边界（先说什么能被它看见，再说它证明什么）
 *
 * 本检查器**只做结构、体积与溯源**。它能说「这个 SKILL.md 合不合规」，
 * **不能**说「这个 skill 有没有用」——那是门禁二（触发盲测）与门禁三（效用 A/B），
 * 尚未构建。因此 `promotionState` 停在 `assembled`，不是 `approved`。
 *
 * ## 与 verifier.mjs 的关系
 *
 * 不复用 `verifier.mjs`：那一份判的是**知识对象**（逐字引文比对是它的主力判据），
 * 本文件判的是**装配产物**，两者的输入类型与失败模式都不一样。共用会迫使
 * `verifier.mjs` 同时承担两种职责，而它的理由码与判据表已经是一份规格的落点。
 * 共用的是**约定**：理由码全大写下划线、回执逐条记录、不通过即拒绝、无豁免。
 */


import { sha256Hex } from './anchor-index.mjs'
import { SKELETON_SECTIONS, SIZE_LIMIT_BYTES } from './skill-builder.mjs'

// 体积阈值定义在 skill-builder（溢出阀渲染时也要用它）；这里转出以保持既有导入面。
export { SIZE_LIMIT_BYTES }
/** frontmatter 硬限，取自 Claude 官方规范（ADR-004 已核实）。 */
export const NAME_MAX_LENGTH = 64
export const DESCRIPTION_MAX_LENGTH = 1024
const NAME_PATTERN = /^[a-z0-9-]+$/
const NAME_FORBIDDEN_SUBSTRINGS = Object.freeze(['anthropic', 'claude'])

export const SKILL_REASON_CODES = Object.freeze([
  'FRONTMATTER_MISSING',
  'FRONTMATTER_MALFORMED',
  'NAME_INVALID',
  'DESCRIPTION_INVALID',
  'SECTION_MISSING',
  'SECTION_OUT_OF_ORDER',
  'SECTION_EMPTY',
  'SECTION_COUNT_OUT_OF_RANGE',
  'SIZE_EXCEEDED',
  'SOURCEREF_UNRESOLVED',
  'SOURCE_VERSION_DRIFT',
])

/**
 * 段条目数：**不入判据**（2026-10-09 修订，见 ADR-021）。
 *
 * 曾经有一处「严格 / 宽松」双口径开关，让调用方能看出「拒绝是否取决于条目数解释」。
 * 那处歧义现已由 ADR-021 定夺，双口径随之作废——留一个不再改变任何结论的开关，
 * 只会让后来者以为它还有用。
 *
 * 现行口径：
 *   - 硬下限只有「非空」，由 `SECTION_EMPTY` 承担；
 *   - 骨架记录的建议值（何时使用 5–8、常见陷阱 6–8）由**装配器**记成缺口并推出风险标记，
 *     按 ADR-006 门禁三路由到功效抽样重点，不在门禁一处拒绝；
 *   - 与条目数无关的那一条仍然查：契约记录的条目数必须与正文实际一致
 *     （防「契约说 6 条、正文写 1 条」）。
 */

/**
 * 解析 frontmatter。只接受 `---` 起止、`key: value` 单行这一种形状——
 * 与本项目其它部分一样，宁可明确失败，不要模糊猜测。
 */
export function parseFrontmatter(markdown) {
  const text = String(markdown || '')
  if (!text.startsWith('---\n')) {
    return { ok: false, detail: 'SKILL.md 未以 `---` 起始' }
  }
  const end = text.indexOf('\n---\n', 3)
  if (end < 0) return { ok: false, detail: 'frontmatter 未闭合' }
  const block = text.slice(4, end)
  const fields = {}
  for (const line of block.split('\n')) {
    if (!line.trim()) continue
    const at = line.indexOf(': ')
    if (at < 0) return { ok: false, detail: `无法解析的 frontmatter 行：${line.slice(0, 40)}` }
    fields[line.slice(0, at).trim()] = line.slice(at + 2).trim()
  }
  return { ok: true, fields, body: text.slice(end + 5) }
}

/**
 * 把正文切成 6 段。返回段标题出现顺序与每段条目数。
 *
 * 条目计数口径：段内以 `- ` 开头、且**不在缩进层级**的行算一条（缩进行是上一条的子行）。
 * 「核心原则」段的条目是加粗行 `**…**`，不是列表，因此对这两类分别计数。
 */
export function splitSections(body) {
  const lines = String(body || '').split('\n')
  const sections = []
  let current = null
  for (const line of lines) {
    const m = /^(#{2,3})\s+(.*)$/.exec(line)
    if (m && m[1] === '##') {
      current = { heading: `## ${m[2].trim()}`, lines: [] }
      sections.push(current)
      continue
    }
    if (current) current.lines.push(line)
  }
  for (const s of sections) {
    const texts = s.lines.map((l) => l.trim()).filter(Boolean)
    // 只有**顶格**的 `- ` 行算条目；缩进行是上一条的子行（如「常见陷阱」的「后果/纠正」）。
    s.bullets = s.lines.filter((l) => /^- /.test(l)).length
    // 加粗小节头行（核心原则 / 实践模式的那种写法）。
    s.bolds = texts.filter((l) => /^\*\*[^*]+\*\*$/.test(l)).length
    // 顶格编号行（任务骨架的「执行步骤」）。**不并入通配口径**——旧骨架的任何段落
    // 都不按编号行计数，并入会改变既有段落的既有读数（卡 26 只做加法）。
    s.numbered = s.lines.filter((l) => /^\d+\.\s/.test(l)).length
    // 通配兜底：种类不明的段落取两者较大值。**具体段落按骨架声明的 itemKind 计**——
    // 实践模式的示例列表项会盖过概念数，用 max 会误报（见 ADR-025）。
    s.itemCount = Math.max(s.bullets, s.bolds)
    s.isEmpty = texts.length === 0
  }
  return sections
}

/**
 * 段落条目数：按骨架声明的条目种类计（`SKELETON_SECTIONS[].itemKind`，见 ADR-025）。
 * 认不出种类的段落退回通配口径，保持旧行为。
 */
export function itemCountFor(section, spec) {
  if (spec?.itemKind === 'bold') return section.bolds ?? 0
  if (spec?.itemKind === 'bullet') return section.bullets ?? 0
  if (spec?.itemKind === 'numbered') return section.numbered ?? 0
  return section.itemCount ?? 0
}

/** 门禁一 · skill 侧。`opts.repoRoot` 可覆盖仓库根（测试用）。 */
export async function verifySkill(input) {
  const {
    markdown,
    contract,
    anchorIndexes = [],
    repoRoot,
    sectionCountsExpected = null,
    // 骨架可换（卡 26 任务套件）：缺省仍是原书六段，旧调用方逐字节兼容。
    skeleton = SKELETON_SECTIONS,
  } = input

  const failures = []
  const push = (code, detail, at) => failures.push({ code, detail, at })

  // ── 1. 体积 ──────────────────────────────────────────────────────────────
  const bytes = Buffer.byteLength(String(markdown || ''), 'utf8')

  // ── 2. frontmatter ───────────────────────────────────────────────────────
  const fm = parseFrontmatter(markdown)
  if (!fm.ok) {
    push('FRONTMATTER_MALFORMED', fm.detail, 'frontmatter')
  } else {
    const extra = Object.keys(fm.fields).filter((k) => k !== 'name' && k !== 'description')
    if (extra.length) {
      push('FRONTMATTER_MALFORMED', `frontmatter 只允许 name 与 description，多出：${extra.join(', ')}`, 'frontmatter')
    }
    const name = fm.fields.name || ''
    if (!name) {
      push('NAME_INVALID', 'name 为空', 'frontmatter.name')
    } else {
      if (name.length > NAME_MAX_LENGTH) push('NAME_INVALID', `name 长度 ${name.length} > ${NAME_MAX_LENGTH}`, 'frontmatter.name')
      if (!NAME_PATTERN.test(name)) push('NAME_INVALID', `name 只允许小写字母/数字/连字符：${name}`, 'frontmatter.name')
      for (const bad of NAME_FORBIDDEN_SUBSTRINGS) {
        if (name.includes(bad)) push('NAME_INVALID', `name 不得包含 ${bad}`, 'frontmatter.name')
      }
    }
    const desc = fm.fields.description || ''
    if (!desc) {
      push('DESCRIPTION_INVALID', 'description 为空', 'frontmatter.description')
    } else if (desc.length > DESCRIPTION_MAX_LENGTH) {
      push('DESCRIPTION_INVALID', `description 长度 ${desc.length} > ${DESCRIPTION_MAX_LENGTH}`, 'frontmatter.description')
    }
  }

  // ── 3. 骨架段（缺省原书六段；任务套件传自己的骨架）────────────────────────
  const sections = splitSections(fm.ok ? fm.body : '')
  const expected = skeleton.map((s) => s.heading)
  const actual = sections.map((s) => s.heading)
  const byHeading = new Map(sections.map((s) => [s.heading, s]))

  for (const heading of expected) {
    if (!byHeading.has(heading)) push('SECTION_MISSING', `缺少骨架段：${heading}`, heading)
  }
  const presentOrder = expected.filter((h) => byHeading.has(h))
  const actualOrder = actual.filter((h) => expected.includes(h))
  if (presentOrder.join('|') !== actualOrder.join('|')) {
    push('SECTION_OUT_OF_ORDER', `段顺序与骨架不一致：实际 ${actualOrder.join(' → ')}`, 'sections')
  }
  const unknown = actual.filter((h) => !expected.includes(h))
  if (unknown.length) {
    push('SECTION_OUT_OF_ORDER', `出现骨架之外的段：${unknown.join(', ')}`, 'sections')
  }

  for (const spec of skeleton) {
    const sec = byHeading.get(spec.heading)
    if (!sec) continue
    if (sec.isEmpty) {
      push('SECTION_EMPTY', `段为空：${spec.heading}（骨架形状：${spec.shape}）`, spec.heading)
      continue
    }
    // 这一条与条目数无关，故仍在判据内：契约记录数与正文实际数必须一致，
    // 否则「契约说 6 条、正文写 1 条」这类不一致永远不会被发现。
    const actualItems = itemCountFor(sec, spec)
    if (sectionCountsExpected && sectionCountsExpected[spec.key] != null && sectionCountsExpected[spec.key] !== actualItems) {
      push(
        'SECTION_COUNT_OUT_OF_RANGE',
        `契约记录的条目数（${sectionCountsExpected[spec.key]}）与正文实际（${actualItems}）不一致：${spec.heading}`,
        spec.heading,
      )
    }
  }

  if (bytes > SIZE_LIMIT_BYTES) {
    push('SIZE_EXCEEDED', `体积 ${bytes} 字节 > ${SIZE_LIMIT_BYTES}`, 'size')
  }

  // ── 4. 溯源可解析 ────────────────────────────────────────────────────────
  const refs = (contract && contract.sourceRefs) || []
  if (!refs.length) {
    push('SOURCEREF_UNRESOLVED', '契约未携带任何 sourceRefs——无溯源的 skill 不得发布', 'contract.sourceRefs')
  }
  const indexes = Array.isArray(anchorIndexes) ? anchorIndexes : [anchorIndexes]
  for (const ref of refs) {
    let found = null
    for (const idx of indexes) {
      if (!idx) continue
      const hit = (idx.anchors || []).find((a) => a.anchor === ref.anchor)
      if (hit) {
        found = hit
        break
      }
    }
    if (!found) {
      push('SOURCEREF_UNRESOLVED', `锚点不可解析：${ref.anchor}`, `contract.sourceRefs/${ref.anchor}`)
      continue
    }
    if (found.contentHash && ref.contentHash && found.contentHash !== ref.contentHash) {
      push(
        'SOURCE_VERSION_DRIFT',
        `所依赖源版本已变更：${ref.anchor}`,
        `contract.sourceRefs/${ref.anchor}`,
      )
    }
  }

  // 正文回链必须与 sourceRefs 一致（ADR-004：深度阅读段回链 book/chapterN.md）。
  // 回链所在的段按骨架指认：旧骨架是「## 深度阅读」，任务骨架是「## 依据与边界」
  // （`readingSection: true` 标记）。
  const readingSpec = skeleton.find((s) => s.key === 'reading' || s.readingSection === true)
  const readingSec = readingSpec ? byHeading.get(readingSpec.heading) : null
  if (readingSec) {
    const bodyFiles = new Set()
    for (const line of readingSec.lines) {
      const m = /`([^`]+)`/.exec(line)
      if (m) bodyFiles.add(m[1])
    }
    const refFiles = new Set(refs.map((r) => r.file))
    for (const f of refFiles) {
      if (!bodyFiles.has(f)) {
        push('SOURCEREF_UNRESOLVED', `深度阅读段未回链出处文件：${f}`, '## 深度阅读')
      }
    }
  }

  const bytesSha = `sha256:${sha256Hex(String(markdown || ''))}`
  return {
    passed: failures.length === 0,
    failures,
    reasonCodes: [...new Set(failures.map((f) => f.code))],
    checks: {
      bytes,
      sizeLimitBytes: SIZE_LIMIT_BYTES,
      sectionItemCounts: Object.fromEntries(
        sections.map((s) => [s.heading, itemCountFor(s, SKELETON_SECTIONS.find((x) => x.heading === s.heading))]),
      ),
      sourceRefCount: refs.length,
    },
    markdownHash: bytesSha,
  }
}


