/**
 * 第 2 层 · 模型替身（ticket 03）
 *
 * 职责：以**确定性替身**承担第 2 层的接口位置，使第 1、3 层能在「零模型调用、零凭据、零网络」
 * 的前提下被严格断言。本模块**绝不发起任何网络请求**，也不读取任何凭据。
 *
 * 与真实第 2 层的关系：
 *   - 相同：输入是「第 1 层产出 + 源文件路径」，输出是「对象数组」，每个对象强制携带
 *     sourceRefs 与逐字 evidenceQuote 占位；失败时抛错，由调用方判为「运行失败」。
 *   - 不同：类型判定不做语义理解，只按**可观测的结构特征**（标题层级 + 该层级内序号）取固定映射。
 *     真实第 2 层用 LLM 判断「这段正文承载哪个类型的知识」，本替身不判断。
 *
 * 类型映射（固定，非随机；改这里即改替身的行为）：
 *   h1 → Concept          一级标题：整章的主题概念
 *   h2 → EngineeringRule  二级标题：成节的原则性表述
 *   h3 → Playbook / Heuristic（按该层级内序号奇偶交替）
 *   h4 → Case / DecisionModel（按该层级内序号奇偶交替）
 *
 * 引文来源（决定本替身能否被第 3 层验证通过）：见 extractQuote 的注释。
 */

import { readFile } from 'node:fs/promises'

import { sha256Hex } from './anchor-index.mjs'
import { objectIdFor, parseAnchorToken } from './object-contract.mjs'

// 标识生成与锚点解析的真源在 object-contract.mjs；此处转出，保持本模块原有的公开面。
export { objectIdFor, parseAnchorToken }

/** 替身标识。回执据此声明「本次未调用任何真实模型」。 */
export const STUB_MODEL_ID = 'stub/deterministic-v1'

/**
 * 对象 createdAt 的固定时刻：本替身是确定性的，若用 Date.now() 则同一输入两次运行产出不同
 * 对象，ticket 03「重跑两次产出相同 id／相同文件」的验收项将无法成立。
 */
const FIXED_CREATED_AT = '2026-10-08T00:00:00.000Z'

/** 逐字引文的最长字符数（超出则截断，截断后仍是原文子串）。 */
const QUOTE_MAX_CHARS = 120

/** 替身自身的失败（输入不具备可产出性）。属「运行失败」，非「对象被拒」。 */
export class StubModelError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StubModelError'
  }
}

/** 源码归一化：与 anchor-index.mjs 的 buildAnchorIndex 保持同一口径（否则哈希与引文会对不上）。 */
export function normalizeLines(raw) {
  return raw.split(/\r\n|\n|\r/).map((l) => l.replace(/[ \t]+$/, ''))
}

export function anchorContent(lines, lineStart, lineEnd) {
  return lines.slice(lineStart - 1, lineEnd).join('\n')
}

/** 按标题层级与「该层级内序号」取固定类型。序号取自锚点标识，不依赖额外的 ordinal 字段。 */
export function typeForAnchor(level, ordinal) {
  if (level === 1) return 'Concept'
  if (level === 2) return 'EngineeringRule'
  if (level === 3) return ordinal % 2 === 1 ? 'Playbook' : 'Heuristic'
  if (level === 4) return ordinal % 2 === 1 ? 'Case' : 'DecisionModel'
  throw new StubModelError(`标题层级 h${level} 未定义类型映射（替身只覆盖 h1–h4）。`)
}

/**
 * 从锚点区间里取一段**保证是原文子串**的引文。
 *
 * 为什么这样取：第 3 层的主力判据是「引文在锚点区间内逐字命中」。若替身自己编写引文，
 * 第 3 层测到的只是「替身写得准不准」；从原文切片取则保证判据在真实语料上被真正执行，
 * 截断与去尾空白都按字符取子串，不会破坏「子串」这一性质。
 *
 * @returns {string|null} 无可引用正文时返回 null（该锚点不产出对象）
 */
export function extractQuote(lines, lineStart, lineEnd) {
  for (let i = lineStart; i <= lineEnd && i <= lines.length; i += 1) {
    const raw = lines[i - 1] ?? ''
    if (raw.trim() === '') continue
    if (/^#{1,6}[ \t]/.test(raw)) continue
    if (/^\s*`{3,}/.test(raw)) continue

    let s = raw.trim()
    // 去掉列表标记与强调标记，使引文仍为连续子串。
    s = s.replace(/^([-*+]\s+|\d+[.)]\s+)/, '')
    s = s.replace(/^\*{1,2}(?=\S)/, '')
    if (s !== '' && [...s].length <= QUOTE_MAX_CHARS) {
      if (raw.includes(s)) return s
    }

    const chars = [...raw]
    if (chars.length === 0) continue
    const cut = raw.slice(0, Math.min(QUOTE_MAX_CHARS, raw.length))
    if (cut.trim() === '') continue
    if (raw.includes(cut)) return cut
  }
  return null
}

/** 各类型的正文载荷。字段集合必须与该类型 schema 的 required 完全一致。 */
function payloadFor(type, { quote, title, chapterRef, sourceRef }) {
  const q = (prefix) => `${prefix}（替身载荷，出处：${chapterRef}）`
  switch (type) {
    case 'Concept':
      return {
        canonicalTerm: title,
        aliases: [q('别名')],
        definition: q('定义'),
        examples: [q('示例')],
        evidenceQuote: quote,
      }
    case 'EngineeringRule':
      return {
        statement: q('陈述'),
        rationale: q('理由'),
        appliesWhen: q('适用条件'),
        violation: q('违反后果'),
        chapterRef,
        evidenceQuote: quote,
      }
    case 'Playbook':
      return {
        title,
        prerequisites: [q('前置条件')],
        steps: [{ order: 1, action: q('步骤') }],
        checks: [q('检查项')],
        rollback: q('回退方式'),
        approval: 'none',
        evidenceQuote: quote,
      }
    case 'Heuristic':
      return {
        trigger: q('触发条件'),
        recommendation: q('建议'),
        confidence: 0.5,
        exceptions: [q('例外')],
        evidenceQuote: quote,
      }
    case 'Case':
      return {
        title,
        context: q('背景'),
        facts: [q('事实')],
        decisions: [q('决策')],
        outcome: q('结果'),
        // evidenceRefs 是**对象内部的证据指针**，与顶层 sourceRefs 是两件事：
        // 前者指出「这份案例的事实依据在哪」，后者是强制携带的出处。故这里不能留空数组。
        evidenceRefs: [{ ...sourceRef }],
        limitations: [q('局限')],
        dataClass: 'public',
        evidenceQuote: quote,
      }
    case 'DecisionModel':
      return {
        inputs: [q('输入')],
        branches: [{ condition: q('条件'), action: q('动作') }],
        outputs: [q('输出')],
        unknownPolicy: q('未知处理'),
        stopConditions: [q('停止条件')],
        reviewState: 'candidate',
        evidenceQuote: quote,
      }
    default:
      return { statement: q('陈述'), chapterRef, evidenceQuote: quote }
  }
}

/**
 * 按锚点索引确定性地产出对象。
 *
 * @param {object} index 第 1 层产出的锚点索引
 * @param {{sourceFile: string, maxObjectsPerAnchor?: number}} opts
 * @returns {Promise<object[]>}
 */
export async function stubGenerateObjects(index, opts = {}) {
  const sourceFile = opts.sourceFile
  if (!sourceFile) throw new StubModelError('缺少 sourceFile。')

  const lines = normalizeLines(await readFile(sourceFile, 'utf8'))
  const objects = []

  for (const a of index.anchors) {
    const quote = extractQuote(lines, a.lineStart, a.lineEnd)
    if (quote === null) continue // 该锚点无正文可引 → 不产出对象

    const content = anchorContent(lines, a.lineStart, a.lineEnd)
    if (!content.includes(quote)) {
      throw new StubModelError(
        `替身产出的引文不是原文子串（${a.anchor}）——这是替身的缺陷，不是内容问题：${JSON.stringify(quote.slice(0, 40))}`,
      )
    }

    const { level, ordinal } = parseAnchorToken(a.anchor)
    const type = typeForAnchor(level, ordinal)
    const chapterRef = a.anchor.replace('#', '-')
    // 序号按锚点独立计数：本卡每锚点恰产出 1 个对象，故恒为 01。
    const seq = objects.filter((o) => o.sourceRefs[0].anchor === a.anchor).length + 1
    const sourceRef = {
      file: index.sourceFile,
      anchor: a.anchor,
      title: a.title,
      lineStart: a.lineStart,
      lineEnd: a.lineEnd,
      contentHash: a.contentHash,
    }

    objects.push({
      id: objectIdFor(chapterRef, type, seq),
      objectType: type,
      revision: 1,
      status: 'candidate',
      createdAt: FIXED_CREATED_AT,
      evidenceGrade: 'E1-observed',
      freshness: { state: 'fresh', asOf: FIXED_CREATED_AT },
      sourceRefs: [sourceRef],
      ...payloadFor(type, { quote, title: a.title, chapterRef, sourceRef }),
    })
  }

  return objects
}

/**
 * 从外部夹具载入对象，用于注入「应被第 3 层拒绝」的对象（ticket 03 的两项注入测试）。
 *
 * 夹具里的人工内容会被替换为替身内容，但以下三点**原样保留**——它们正是待注入的缺陷：
 *   `id` / `sourceRefs` / `evidenceQuote`
 * 空字符串 `""` 视为「显式提供了非法值」，同样保留（用于注入空引文）。
 */
export function loadFixtureObjects(fixture, index) {
  if (!Array.isArray(fixture.objects)) {
    throw new StubModelError('对象夹具必须是 { "objects": [...] } 形式。')
  }
  const byAnchor = new Map(index.anchors.map((a) => [a.anchor, a]))

  return fixture.objects.map((f, i) => {
    if (typeof f !== 'object' || f === null) {
      throw new StubModelError(`夹具第 ${i} 项不是对象。`)
    }
    const { id, sourceRefs, evidenceQuote, comment, ...payload } = f

    const enrichedRefs =
      sourceRefs === undefined
        ? undefined // 保留「缺失」，让第 3 层以 REFERENCE_MISSING 拒绝
        : (Array.isArray(sourceRefs) ? sourceRefs : []).map((r) => {
            const anchor = r && typeof r.anchor === 'string' ? r.anchor : ''
            const a = byAnchor.get(anchor)
            if (!a) {
              // 锚点不在第 1 层索引内：这正是「锚点不可解析」这一类缺陷，
              // 但夹具必须自己给出 file，否则对象连形状都不完整、会被 schema 判据先拦下。
              if (typeof r?.file !== 'string' || r.file === '') {
                throw new StubModelError(
                  `夹具引用的锚点 ${JSON.stringify(anchor)} 不在第 1 层索引内，` +
                    `且该项未提供 file——注入「锚点不可解析」时须自带 file。`,
                )
              }
              return { ...r }
            }
            // 命中索引：定位数据一律以索引为准（行号/标题/哈希），使对象不能靠自报行号绕过比对。
            const out = { ...r, file: a.file, title: a.title, lineStart: a.lineStart, lineEnd: a.lineEnd }
            if (out.contentHash === undefined) out.contentHash = a.contentHash
            return out
          })

    const obj = {
      id: typeof id === 'string' ? id : `FIXTURE-${i + 1}-CONCEPT-01`,
      objectType: typeof f.objectType === 'string' ? f.objectType : 'Concept',
      revision: 1,
      status: 'candidate',
      createdAt: FIXED_CREATED_AT,
      evidenceGrade: 'E1-observed',
      freshness: { state: 'fresh', asOf: FIXED_CREATED_AT },
      ...payload,
    }
    if (enrichedRefs !== undefined) obj.sourceRefs = enrichedRefs
    if (evidenceQuote !== undefined) obj.evidenceQuote = evidenceQuote
    return obj
  })
}

/** 由对象集合推导运行指纹（回执文件名用它，保证「同一输入 → 同一文件名」）。 */
export function objectSetFingerprint(objects) {
  const ids = objects.map((o) => String(o?.id ?? '')).sort()
  return sha256Hex(ids.join('\n')).slice(0, 12)
}
