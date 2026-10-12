/**
 * 主题提案（ticket 06）——把「按章节顺序」换成「按主题」的那一步。
 *
 * ## 这一步为什么必须存在
 *
 * 卡 06 的立项理由是一条实测：全书「常见陷阱」字面 **0 命中**，显式失败小节仅 **13 处**
 * 且高度集中在 chapter10，而目标量级是 22 个 skill × 6–8 条 ≈ **130–176 条**。
 * 差了一个数量级——**不是抽得不够努力，是原文里不存在**。既然不存在，就必须综合；
 * 而要综合，先得知道「按什么题目综合」。章节不是那个题目：同一个坑会在第 5 章讲做法、
 * 第 7 章讲失效、第 10 章讲规避，三处各说一半，按章节跑三次得到的是三个半条。
 *
 * ## 为什么由模型提案、而不是人手写一份清单，也不是阈值聚类
 *
 * 「什么算同一主题」是本卡**明确不预设阈值**的量（见卡 06 的实施纪律）。三个候选里：
 *
 *   - **阈值聚类**：等于凭空设一个数字，会反过来逼着实现者去凑阈值。
 *   - **人工清单**：只能覆盖我事先想到的主题，而我没列进去的跨章线索会整条消失——
 *     漏掉的恰恰是本卡存在的理由。
 *   - **模型提案 + 清单落盘**：主题边界来自一次可复核的判断，判断的结果是一份**文件**，
 *     可以打开、可以改、可以重跑后对比。不引入任何阈值。
 *
 * 落盘不是副产品，是这个方案的**承重件**：没有那份清单，「按主题组织」就只是一句
 * 无法审计的说法；有了它，回执可以引用一个 `catalogHash` 与一个主题清单，
 * 事后任何人能回答「这次的 34 条反模式是建立在哪些主题上的」。
 *
 * ## 边界
 *
 * 本模块**只提案，不产出知识对象**。它不读全书正文（只读锚点目录的标题与首行摘录），
 * 也不做任何判据。综合调用在 `antipattern-synthesis.mjs`。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'

import { DEFAULT_REPO_ROOT } from './anchor-index.mjs'
import { chatCompletion, createUsageLedger } from './llm-client.mjs'
import { extractJsonPayload } from './model-json.mjs'

export const THEME_MANIFEST_SCHEMA_VERSION = 'themes/v1'
export const THEMES_REL_PATH = path.join('pipeline', 'knowledge', 'themes.json')

/** 主题标识：`T` + 两位以上数字。对象标识会由它派生，故必须是纯 ASCII 片段。 */
export const THEME_ID_PATTERN = /^T\d{2,}$/

export class ThemeProposalError extends Error {
  constructor(message, { rawText = null } = {}) {
    super(message)
    this.name = 'ThemeProposalError'
    this.rawText = rawText
  }
}

/**
 * 输出上限（**含推理 token**）。
 *
 * 取 32000 而不是沿用第 2 层的 16000：本步的输入是全书 336 个锚点的目录，
 * 模型要先在推理里把 38,000 字符的目录归纳一遍**再**写 JSON——而第 2 层的实测
 * 已经证明单次思考可以吃掉 8,000 token 且正文一个字没出。上限卡在推理上时，
 * 失败形态是「响应里没有可解析的 JSON」，看起来像解析器的错，实际是预算不够。
 */
export const DEFAULT_PROPOSAL_MAX_TOKENS = 32000
export const DEFAULT_PROPOSAL_TEMPERATURE = 0

/**
 * 系统提示词。
 *
 * 三条硬性要求都是踩过或预判过的失败模式：
 *   1. **锚点标识必须逐字来自目录**——杜撰一个像模像样的 `chapter5#h3-9` 是最容易发生、
 *      也最难在产出端发现的错误：它到第 3 层才会以「引用解析不到」的形式爆出来，
 *      而那时已经为综合调用付过钱了。
 *   2. **一个主题要收全书相关锚点，不是某一章的节**——这正是本卡要挡的「按章节组织」。
 *   3. **只输出 JSON 对象**——沿用第 2 层的输出约定，解析器不共享（见 `parseThemeProposal`）。
 */
export function buildProposalSystemPrompt() {
  return [
    '你是「主题归纳器」。输入是一本中文技术书的**全书锚点目录**：每一行是一个锚点，',
    '含出处标识（如 chapter5#h2-2）、层级、标题，以及该节正文的首行摘录。',
    '',
    '目录里**没有正文**。你的任务**不是**总结这本书，而是提出一组**主题**——',
    '即本书反复讨论的「可复用的做法或概念」，并把全书中与每个主题相关的锚点归到它名下。',
    '',
    '硬性要求：',
    '1. **主题不等于章节的一节。** 一个主题是横跨全书的一个概念或一种做法；',
    '   同一个概念在第 5 章讲做法、在第 7 章讲失效、在第 10 章讲规避时，这三处的锚点',
    '   都该归到同一个主题下。**不要按章节切分主题**，也不要让主题与某一章的标题一一对应。',
    '2. **每个主题的锚点必须是全书范围内与之相关的全部锚点**，而不是其中几个。宁可少提几个主题，',
    '   也不要把某个主题的锚点收漏——漏掉的锚点在后续综合时不会有人替它补上。',
    '3. 若某个主题确实只在一章里出现，**允许**保留，但必须在 rationale 里说明',
    '   为什么它是一个独立主题、而不是某章的一节。',
    '4. **锚点标识必须逐字复制自目录**，形如 `chapter7#h3-4`。不得杜撰、不得改动数字、',
    '   不得引用目录里没有的锚点。引用一个不存在的锚点会让整条链路在做完昂贵的综合调用后',
    '   才发现出处是假的。',
    '5. 主题 id 用 `T01`、`T02`…（两位数字，按你给出的顺序递增）。',
    '6. 只输出一个 JSON 对象，不要解释文字，不要 markdown 代码围栏：',
    '   {"themes": [',
    '     {"id": "T01", "name": "<短名，4–12 字>", "statement": "<这个主题讲的是什么，一两句>",',
    '      "anchors": ["chapter5#h2-2", "chapter7#h3-4", "chapter10#h2-6"],',
    '      "rationale": "<为什么这些锚点属于同一主题，以及（若只在一章出现）为什么独立成题>"}',
    '   ]}',
  ].join('\n')
}

/**
 * 用户提示词：目录本体。
 *
 * 目录按 `file` 分块给出，每行 `锚点 | 标题 | 首行摘录`。分块**只是为了读得下去**——
 * 336 行平铺会让模型丢失「哪一行的出处是什么」。它不构成「按章节组织」：
 * 组织方式体现在模型的**产出**上（一个主题跨多章收锚点），而不是输入的排版上。
 */
export function buildProposalUserPrompt({ catalog }) {
  const byFile = new Map()
  for (const a of catalog.anchors) {
    if (!byFile.has(a.fileKey)) byFile.set(a.fileKey, [])
    byFile.get(a.fileKey).push(a)
  }

  const blocks = []
  for (const f of catalog.files) {
    const rows = (byFile.get(f.fileKey) ?? []).map((a) => {
      const indent = '  '.repeat(Math.max(0, a.level - 1))
      const excerpt = a.excerpt === '' ? '（本节无正文摘录）' : a.excerpt
      return `${a.anchor} | ${indent}${a.title} | ${excerpt}`
    })
    blocks.push(`【${f.fileKey}】${f.file}（${f.anchorCount} 个锚点）\n${rows.join('\n')}`)
  }

  return [
    `全书共 ${catalog.files.length} 个源文件、${catalog.anchors.length} 个锚点。`,
    '目录如下（格式：锚点标识 | 标题 | 首行摘录）：',
    '',
    blocks.join('\n\n'),
  ].join('\n')
}

/** 提示词指纹。与第 2 层同构：提示词是本步实现的一部分，必须与 modelId 同级进回执。 */
export function proposalPromptFingerprint() {
  const fingerprintOf = (system, user) =>
    createHash('sha256').update(`${system}\n\u0000\n${user}`).update('\n').digest('hex').slice(0, 12)
  return `prompt-${fingerprintOf(
    buildProposalSystemPrompt(),
    buildProposalUserPrompt({
      catalog: { files: [{ fileKey: '<f>', file: '<f>', anchorCount: 0 }], anchors: [] },
    }),
  )}`
}

/** 从响应文本里取出 JSON 对象。解析共用 `model-json.mjs`（不做语义修补，见该模块）。 */
export function parseThemeProposal(text) {
  const raw = String(text ?? '')
  const result = extractJsonPayload(raw)
  if (result.ok) return result.value
  throw new ThemeProposalError(`主题提案响应不是可解析的 JSON：${result.diagnostic}`, { rawText: raw })
}

/**
 * 校核提案。
 *
 * 两条纪律：
 *   1. **解析不到的锚点不静默丢弃**，逐条记进 `unresolvedAnchors` 并保留它属于哪个主题。
 *      静默丢弃会让「模型杜撰了三个锚点」表现为「这个主题恰好只有两个锚点」——
 *      一个内容问题被伪装成一次正常产出。
 *   2. **一个主题解析后为空要说出来**（`emptyThemes`），不能让它变成一条没有输入的综合调用。
 *
 * @returns {{themes:object[], unresolvedAnchors:object[], emptyThemes:string[], duplicateThemes:string[]}}
 */
export function validateThemeProposal(proposal, catalog) {
  const list = Array.isArray(proposal?.themes) ? proposal.themes : null
  if (list === null) {
    throw new ThemeProposalError(
      `主题提案里没有 themes 数组（顶层键：${
        proposal && typeof proposal === 'object' ? Object.keys(proposal).join(', ') || '无' : typeof proposal
      }）`,
    )
  }

  const byId = new Map(catalog.anchors.map((a) => [a.anchor, a]))
  const themes = []
  const unresolvedAnchors = []
  const emptyThemes = []
  const seenIds = new Set()
  const duplicateThemes = []

  for (const raw of list) {
    const id = typeof raw?.id === 'string' ? raw.id.trim() : ''
    if (!THEME_ID_PATTERN.test(id)) {
      throw new ThemeProposalError(
        `主题 id 不合 ${THEME_ID_PATTERN.source}：${JSON.stringify(raw?.id ?? null)}——` +
          '它会被派生进对象标识，故必须在提案阶段就拒绝，而不是等到落盘时炸。',
      )
    }
    if (seenIds.has(id)) duplicateThemes.push(id)
    seenIds.add(id)

    // 保留模型给出的锚点顺序：那是**模型对主题的组织**。按文件重排会把它换成章节顺序，
    // 正好丢掉本卡要的那件东西。
    const resolved = []
    const citedUnresolved = []
    const seen = new Set()
    const cited = Array.isArray(raw?.anchors) ? raw.anchors : []
    for (const token of cited) {
      if (typeof token !== 'string' || token === '') continue
      if (seen.has(token)) continue
      seen.add(token)
      const entry = byId.get(token)
      if (!entry) {
        citedUnresolved.push(token)
        unresolvedAnchors.push({ themeId: id, anchor: token })
        continue
      }
      resolved.push({
        file: entry.file,
        fileKey: entry.fileKey,
        anchor: entry.anchor,
        level: entry.level,
        title: entry.title,
        lineStart: entry.lineStart,
        lineEnd: entry.lineEnd,
        contentBytes: entry.contentBytes,
      })
    }

    if (resolved.length === 0) emptyThemes.push(id)

    themes.push({
      id,
      name: typeof raw?.name === 'string' ? raw.name.trim() : '',
      statement: typeof raw?.statement === 'string' ? raw.statement.trim() : '',
      rationale: typeof raw?.rationale === 'string' ? raw.rationale.trim() : '',
      anchors: resolved,
      // 派生量，不进提案、由本模块算出：这样「一个主题跨几章」不会有两个来源。
      chapterKeys: [...new Set(resolved.map((a) => a.fileKey))],
      unresolvedAnchors: citedUnresolved,
      citedAnchorCount: cited.length,
    })
  }

  return { themes, unresolvedAnchors, emptyThemes, duplicateThemes }
}

/**
 * 跑一次主题提案。
 *
 * @returns {Promise<{manifest:object, usage:object|null}>}
 */
export async function proposeThemes({
  config,
  catalog,
  chat,
  fetchImpl,
  ledger,
  createdAt,
  maxTokens = DEFAULT_PROPOSAL_MAX_TOKENS,
  temperature = DEFAULT_PROPOSAL_TEMPERATURE,
  maxAttempts,
  retryDelayMs,
}) {
  const chatFn = chat ?? chatCompletion
  const system = buildProposalSystemPrompt()
  const user = buildProposalUserPrompt({ catalog })

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

  const parsed = parseThemeProposal(res.text)
  const checked = validateThemeProposal(parsed, catalog)

  const manifest = {
    schemaVersion: THEME_MANIFEST_SCHEMA_VERSION,
    createdAt: createdAt ?? new Date().toISOString(),
    catalogHash: catalog.catalogHash,
    catalog: {
      fileCount: catalog.files.length,
      anchorCount: catalog.anchors.length,
      files: catalog.files.map((f) => ({ file: f.file, fileKey: f.fileKey, anchorCount: f.anchorCount })),
    },
    promptFingerprint: proposalPromptFingerprint(),
    model: { modelId: res.modelId ?? config.modelId ?? null },
    themes: checked.themes,
    unresolvedAnchors: checked.unresolvedAnchors,
    emptyThemes: checked.emptyThemes,
    duplicateThemes: checked.duplicateThemes,
    usage: res.usage ?? null,
    finishReason: res.finishReason ?? null,
    reasoningChars: res.reasoningChars ?? 0,
  }

  return { manifest, usage: res.usage ?? null, ledger }
}

/** 落盘主题清单。 */
export async function writeThemeManifest(manifest, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  const outPath = path.join(repoRoot, opts.relPath ?? THEMES_REL_PATH)
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return outPath
}
