/**
 * 第 3 层 · 机器验证层（ticket 03 建确定性判据；ticket 05 接入判定者判据）
 *
 * 职责：兜住第 2 层的非确定性。不通过即拒绝该对象，逐条给出机器可读的理由码。
 *
 * 两条结构性约束（不是文档约定，是代码结构）：
 *
 *   1. **本模块的入口只接受「对象 + 第 1 层锚点索引 + 锚点正文」，不接受任何生产者上下文**
 *      （没有提示词、没有推理过程、没有第 2 层调用句柄）。`verifyObjects` 的入参形状就是这一
 *      约束的代码化表达——它拿不到它不该拿的东西。
 *   2. **判定者是一次**注入**进来的独立调用**（`opts.judgeFn`，实现在 `judge.mjs`），
 *      与生产者不共享任何状态、不共享账本。本模块**自己不发起任何网络调用**，
 *      因此「确定性判据可脱离 LLM 单独复跑」是这个文件的一项性质，不是一句承诺。
 *
 * 本文件不含任何 LLM 调用、网络访问与随机性；确定性判据必须逐字节可复现。
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validate } from './json-schema-subset.mjs'
import { DEFAULT_REPO_ROOT } from './anchor-index.mjs'
import { OBJECT_TYPES } from './object-contract.mjs'
// 只 import 判定者的**纯函数**部分（输入构造、判定值到理由码的映射）。判定者的实际调用
// （`judgeObject`）不在此 import——它由 `opts.judgeFn` 注入，使本模块保持「无网络原语」，
// 由 single-object-tracer.test.mjs 的源码级断言钉住。
import { JUDGE_INPUT_KEYS, VERDICT_TO_REASON_CODE, buildJudgeInput } from './judge.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', 'schemas')

/** 九种对象类型。集合封闭，与 knowledge-object.schema.json 的枚举一致。真源在 object-contract。 */
export { OBJECT_TYPES }

/** 对象 id 的既有正则（约束来源：规格 D5）。 */
export const IDENTIFIER_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/

/**
 * 拒绝理由码（**封闭集合**）。
 *
 * 设计要点：一个对象只归**一类**码，因此码的粒度必须与「修复责任方」对齐，否则统计拒绝分布时
 * 会把两类问题混在一起（规格 D7 的意图）。六类中前五类即规格 D7 要求可区分的五类，
 * 第六类是 D7 未覆盖的一条歧义，本层显式拆出：
 *
 *   REFERENCE_MISSING       无 sourceRefs（缺失或空数组）。**无豁免**。
 *   IDENTIFIER_INVALID      对象 id 不合既有正则。修复方：第 2 层输出契约。
 *   SOURCE_VERSION_DRIFT    所依赖的锚点内容哈希已变（较新或较旧）。修复方：重跑第 1 或第 2 层。
 *   SCHEMA_INVALID          不合该类型的 schema。修复方：第 2 层提示词 / 输出契约。
 *   REFERENCE_UNRESOLVED    sourceRefs 解析不到第 1 层锚点（锚点未知，或行号区间与索引不符）。
 *                           修复方：第 1 层锚点索引（或第 2 层引用了不存在的锚点）。
 *   QUOTE_MISSING           未携带 evidenceQuote。D7 未规定此项——本层的取舍，见 README 说明。
 *   QUOTE_MISMATCH          引文未命中锚点区间。判定时已忽略 markdown 强调标记与空白差异
 *                           （见 QUOTE_NORMALIZATION）；被拒意味着**不止是排版差异**。
 *                           修复方：第 2 层（最可能是归纳时改写了原文）。
 *                           两种情形共用本码，靠 `at` 区分：顶层的 `evidenceQuote` 未命中
 *                           （`at` 缺省），或某条 `sourceRefs[i].quote` 未命中**它自己那一条**
 *                           出处的区间（`at = sourceRefs/i`，ticket 06 加的逐条引文判据）。
 *                           不拆成两个码的理由：两者的修复方与修复动作完全相同，
 *                           拆开会把一个缺陷记成两笔（ticket 08 要求「同一拒绝只归一类」）。
 *   JUDGE_NOT_SUPPORTED     判定者判为**不支撑**（引文与主张无关或相矛盾）。
 *   JUDGE_INSUFFICIENT      判定者判为**不充分**（引文相关但不足以支持主张）。
 *                           后两条均由 ticket 05 产出。ADR-010 决策 2：只有「支撑」算通过，
 *                           两者都**必须拒绝**——但分码，因为修法不同（改写 vs 换证据）。
 */
export const REASON_CODES = Object.freeze([
  'REFERENCE_MISSING',
  'IDENTIFIER_INVALID',
  'SOURCE_VERSION_DRIFT',
  'SCHEMA_INVALID',
  'REFERENCE_UNRESOLVED',
  'QUOTE_MISSING',
  'QUOTE_MISMATCH',
  'JUDGE_NOT_SUPPORTED',
  'JUDGE_INSUFFICIENT',
])

/**
 * 判定优先级：对象可能同时违反多条，只取**第一条**命中者作为主理由码，
 * 但 `failures` 会保留全部命中项（主码用于统计，明细用于诊断）。
 *
 * 排序依据是**修复责任方的分族**，族内再按修复动作的依赖顺序：
 *
 *   出处族（对象「指向哪儿、它是谁」——修复方可能是第 1 层或第 2 层的溯源契约）
 *     有出处 → 标识合法 → 出处指得到 → 出处版本没漂
 *   字段族（对象「填得对不对」——修复方是第 2 层的对象契约）
 *     字段合 schema → 有引文 → 引文命中
 *   判定者族（引文「够不够支撑主张」——修复方是输入组织方式或锚点切分）
 *     判定者不支撑 / 判定者不充分
 *
 * 为什么判定者族整体排在最后（ADR-010 决策 4）：判定者的判定以「引文存在且可定位」为前提。
 * 引文没命中锚点时，判定者根本没有可判的对象；若把判定者码排在前面，会把「出处对不上」
 * 误报成「判定者不认」，而两者的修复方不同。
 *
 * 两个判定者码的相对次序**无实际作用**——同一次判定的三值输出互斥，不会同时命中。
 * 并列于此只为让词表完整、顺序确定。
 */
export const REASON_PRECEDENCE = Object.freeze([
  'REFERENCE_MISSING',
  'IDENTIFIER_INVALID',
  'REFERENCE_UNRESOLVED',
  'SOURCE_VERSION_DRIFT',
  'SCHEMA_INVALID',
  'QUOTE_MISSING',
  'QUOTE_MISMATCH',
  'JUDGE_NOT_SUPPORTED',
  'JUDGE_INSUFFICIENT',
])

/** 每类码的修复责任方，写进回执，使回执不依赖外部文档即可被解读。 */
export const REASON_OWNER = Object.freeze({
  REFERENCE_MISSING: '第 2 层输出契约（对象必须携带 sourceRefs，无豁免）',
  IDENTIFIER_INVALID: '第 2 层输出契约（对象 id 生成规则）',
  SOURCE_VERSION_DRIFT: '重跑第 1 层或第 2 层（依赖的源版本已变更）',
  SCHEMA_INVALID: '第 2 层提示词 / 输出契约',
  REFERENCE_UNRESOLVED: '第 1 层锚点索引（或第 2 层引用了不存在的锚点）',
  QUOTE_MISSING: '第 2 层输出契约（对象必须携带逐字引文）',
  QUOTE_MISMATCH: '第 2 层（最可能是归纳时改写了原文；已排除纯排版差异）',
  JUDGE_NOT_SUPPORTED: '第 2 层输入组织方式（引文与主张无关或相矛盾——引文选错了）',
  JUDGE_INSUFFICIENT: '锚点切分（证据不足，锚点太小装不下主张）或第 2 层（主张写得比证据宽）',
})

const schemaCache = new Map()

/** 载入某类型的组装产物 schema（自包含，可直接交给校验器）。 */
export async function loadObjectSchema(objectType, opts = {}) {
  const dir = opts.schemaDir ?? SCHEMA_DIR
  if (!OBJECT_TYPES.includes(objectType)) {
    throw new Error(`未知对象类型：${objectType}（集合封闭，见 OBJECT_TYPES）`)
  }
  const key = path.join(dir, objectType)
  if (!schemaCache.has(key)) {
    schemaCache.set(
      key,
      readFile(path.join(dir, `${objectType}.schema.json`), 'utf8').then((raw) => JSON.parse(raw)),
    )
  }
  return schemaCache.get(key)
}

/** 归一化文本：统一 LF 并去行尾空白。与第 1 层的哈希口径一致。 */
export function normalizeText(text) {
  return text
    .split(/\r\n|\n|\r/)
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
}

/** 本判据在比较引文时忽略的东西——写进回执，使「放宽了什么」不必翻代码才知道。 */
export const QUOTE_NORMALIZATION = 'markdown-emphasis+whitespace'

/**
 * 引文比对用的归一化：去掉 markdown 强调标记、折叠空白。
 *
 * 为什么必须做这一步（实测，不是推测）：第 2 层复制引文时会**去掉 `**` 强调标记**
 * ——它复述的是渲染后的文本，而不是 markdown 源。实测两轮 chapter4 的全部 9 条
 * `QUOTE_MISMATCH`，逐字符比对后差异**只有 `**`**（相似度 0.90–0.98），
 * 去掉标记后 9 条全部命中，**没有一条是改写或编造**。
 * 若维持字节相等，被判死的对象里 16% 是死于排版标记而非知识问题——这正是规格 D7
 * 说的 R6「验证过严、误杀有效对象」。放宽这一层不损失判据的本意：
 * 它要挡的是「出处对不上」，不是「引号两边的星号在不在」。
 *
 * 刻意**不动下划线**：正文里的 `web_search`、`read_file` 是真标识符，剥掉下划线会把
 * 不同的东西变成相同的东西——那是把判据放松到危险的方向。
 */
export function normalizeForQuoteComparison(text) {
  return String(text ?? '')
    .replace(/\*\*(.+?)\*\*/gs, '$1')
    .replace(/__(.+?)__/gs, '$1')
    .replace(/\*([^*\n]+?)\*/gs, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 源文件路径 → 正文行数组（供逐字比对；第 3 层只读源正文，不读第 2 层的任何中间状态）。 */
export async function loadSourceLines(fileAbsPath) {
  const raw = await readFile(fileAbsPath, 'utf8')
  return normalizeText(raw).split('\n')
}

/**
 * 锚点索引 → 查找表（ticket 06 起支持多份）。
 *
 * 键为 `file::anchor`，所以不同文件的同名锚点不会互相覆盖——这一条在多文件之前
 * 就已经成立（键里一直带着 `file`），改多份只是去掉了「一次只能传一份」这个隐含前提。
 *
 * 重复键**报错而不是覆盖**：覆盖会让「解析到的是哪一份」取决于索引的传入顺序，
 * 而调用方看到的只是「都解析到了」。两份索引对同一锚点给出不同条目，本身就是要修的接线缺陷。
 */
export function anchorLookup(indexOrIndices) {
  const indices = Array.isArray(indexOrIndices) ? indexOrIndices : [indexOrIndices]
  const map = new Map()
  for (const index of indices) {
    for (const a of index.anchors) {
      const key = `${a.file}::${a.anchor}`
      const prior = map.get(key)
      if (prior !== undefined) {
        // 分两种情形给不同的消息，因为它们的修法不同：把同一份索引传了两遍，
        // 与两份索引对同一个锚点各说各话。只判「键在不在」会把后者也说成前者——
        // 实测踩到：测试里一个「内容相同的子集索引」被报成「给了不同条目」。
        const identical = JSON.stringify(prior) === JSON.stringify(a)
        throw new Error(
          `${identical ? '同一个锚点被两份索引重复给了两次' : '两份索引对同一个锚点给了不同条目'}：${key}——` +
            '多份索引必须各自对应不同的源文件。同一份文件给了两遍时，' +
            '「解析到的是哪一份」取决于索引的传入顺序，而调用方只会看到「都解析到了」。',
        )
      }
      map.set(key, a)
    }
  }
  return map
}

/**
 * 确定性判据（无 LLM）。逐对象执行，返回主理由码与全部命中项。
 *
 * @param {object} obj 待验证对象
 * @param {{lookup: Map, linesByFile: Map<string,string[]>, sourceTextAll: string,
 *          sourceTextAllScope: 'whole-source'|'all-sources', schema: object|null,
 *          objectTypeValid: boolean, anchorResolved: boolean, anchorText: string}} ctx
 *        `linesByFile` 是 ticket 06 加的：跨章对象的一条 sourceRef 指向一个文件、下一条指向另一个，
 *        因此「按行号取正文」必须**按文件**取。原先的单一 `lines` 隐含「对象只属于一个文件」，
 *        那个前提在本卡之后不再成立。
 */
export function checkDeterministic(obj, ctx) {
  const failures = []
  /** 逐条 sourceRef 自带引文的比对结果（ticket 06）。空数组 = 该对象没有任何逐条引文。 */
  const refQuoteComparisons = []

  // ① sourceRefs 非空：无豁免。单独先判，因为缺它时对象连「可溯源」都不成立，
  //    后续以引用为前提的判据无从谈起。
  const refs = obj?.sourceRefs
  if (!Array.isArray(refs) || refs.length === 0) {
    failures.push({
      code: 'REFERENCE_MISSING',
      detail: Array.isArray(refs) ? 'sourceRefs 为空数组' : 'sourceRefs 缺失或不是数组',
    })
  }

  // ② id 合既有正则
  if (typeof obj?.id !== 'string' || !IDENTIFIER_PATTERN.test(obj.id)) {
    failures.push({
      code: 'IDENTIFIER_INVALID',
      detail: `id 不符合 /${IDENTIFIER_PATTERN.source}/：${JSON.stringify(obj?.id ?? null)}`,
    })
  }

  // ③ 逐条 sourceRef 解析 + 源版本哈希一致
  if (Array.isArray(refs)) {
    refs.forEach((ref, i) => {
      const at = `sourceRefs/${i}`
      if (!ref || typeof ref !== 'object') {
        failures.push({ code: 'REFERENCE_UNRESOLVED', detail: `${at} 不是对象`, at })
        return
      }
      const entry = ctx.lookup.get(`${ref.file}::${ref.anchor}`)
      if (!entry) {
        failures.push({
          code: 'REFERENCE_UNRESOLVED',
          detail: `${at} 解析不到锚点：file=${JSON.stringify(ref.file)} anchor=${JSON.stringify(ref.anchor)}`,
          at,
        })
        return
      }

      if (ref.lineStart !== entry.lineStart || ref.lineEnd !== entry.lineEnd) {
        failures.push({
          code: 'REFERENCE_UNRESOLVED',
          detail:
            `${at} 的行号区间与第 1 层索引不一致：` +
            `对象声明 ${ref.lineStart}-${ref.lineEnd}，索引为 ${entry.lineStart}-${entry.lineEnd}`,
          at,
        })
      }

      // 只比「对象记录了哈希」的情形：未记录不算过期，但记录错了就是所依赖的源版本已变。
      if (ref.contentHash !== undefined && ref.contentHash !== entry.contentHash) {
        failures.push({
          code: 'SOURCE_VERSION_DRIFT',
          detail: `${at} 记录的 contentHash 与第 1 层索引不一致（锚点内容已在该对象产出后被改动，或对象基于旧版本产出）`,
          at,
        })
      }

      // 逐条出处的**自带引文**（ticket 06）。
      //
      // 为什么必须逐条验、而不是只验第一条：一条跨章反模式引用「第 5 章 + 第 7 章」时，
      // 只用 `sourceRefs[0]` 比对等于**对第二、三条引文完全不设防**——对象看起来照样通过，
      // 而它声称的第二处支撑没有任何人核对过。这正是卡 06 说的「抄取冒充综合」在数据层的形态：
      // 多写几条出处不花成本，所以「引用了几章」若不逐条验证，就只是一个自述。
      //
      // 它顺带把跨章对象的判定者输入也钉住了：每条 sourceRef 的引文都必须**在该条出处自己的
      // 区间内**找得到，因此第 3 层给判定者的锚点原文与对象声称的出处必然一致。
      //
      // 理由码不新增：它与顶层引文未命中是**同一族**问题（修复方都是第 2 层「归纳时改写了原文」），
      // 差别只在「哪一条出处」。用 `at` 区分，避免为同一类缺陷再造一个码——
      // 理由是 ticket 08 要求「同一拒绝只归一类」，码表越细，统计越容易被拆散。
      if (typeof ref.quote === 'string' && ref.quote !== '') {
        const refLines = ctx.linesByFile.get(ref.file)
        if (refLines === undefined) {
          // 索引里有这条锚点、却拿不到它所在的源文件正文：这是**调用方的问题**
          // （没把该文件的行传进来），不是「引文对不上」。判成后者会让一个接线缺陷
          // 表现为一条内容拒绝，而两者的修复方完全不同。
          throw new Error(
            `第 3 层缺少 ${ref.file} 的正文，无法逐字比对 ${at} 的逐条引文——` +
              '调用方必须为索引里出现的每个源文件都提供行。',
          )
        }
        const refText = refLines.slice(entry.lineStart - 1, entry.lineEnd).join('\n')
        const refStrict = refText.includes(normalizeText(ref.quote))
        const refNormalized =
          refStrict ||
          normalizeForQuoteComparison(refText).includes(normalizeForQuoteComparison(ref.quote))
        refQuoteComparisons.push({
          at,
          anchor: entry.anchor,
          strict: refStrict,
          normalized: refNormalized,
          acceptedBy: refStrict ? 'strict' : refNormalized ? 'normalization' : null,
          scope: 'own-anchor-region',
        })
        if (!refStrict && !refNormalized) {
          failures.push({
            code: 'QUOTE_MISMATCH',
            at,
            detail:
              `${at}（${entry.anchor}）自带的引文未在该条出处自己的锚点区间内命中：` +
              `${JSON.stringify(String(ref.quote).slice(0, 60))}` +
              `（已按 ${QUOTE_NORMALIZATION} 归一化后仍不命中——即不止是排版差异）`,
          })
        }
      }
    })
  }

  // ④ 类型 schema。
  //    类型不在封闭集合内时没有可加载的 schema——此时**必须显式拒绝**，不能因为我们
  //    「不知道该用哪个 schema」就静默放行：字段集合的封闭性正是靠逐类型的 schema 承担的，
  //    跳过校验等于让未定义类型绕过全部字段判据。
  if (ctx.objectTypeValid === false) {
    failures.push({
      code: 'SCHEMA_INVALID',
      detail:
        `objectType 不在封闭集合内：${JSON.stringify(obj?.objectType ?? null)}` +
        `（合法取值：${OBJECT_TYPES.join(' / ')}）`,
    })
  } else if (ctx.schema) {
    const { valid, errors } = validate(obj, ctx.schema)
    if (!valid) {
      failures.push({
        code: 'SCHEMA_INVALID',
        detail: errors
          .slice(0, 5)
          .map((e) => `${e.instancePath || '/'} ${e.keyword}: ${e.message}`)
          .join(' | '),
      })
    }
  }

  // ⑤ 逐字引文：字段缺失与内容不命中是两件事，分开归类（修复动作不同）。
  let quoteComparison = null
  if (!Object.prototype.hasOwnProperty.call(obj ?? {}, 'evidenceQuote')) {
    failures.push({ code: 'QUOTE_MISSING', detail: '未携带 evidenceQuote 字段' })
  } else {
    const quote = obj.evidenceQuote
    // 比对范围分两档，且**必须如实声明用了哪一档**：
    //   有可解析锚点 → 该锚点区间。此时「引文不在此区间内」是一个成立的断言。
    //   无可解析锚点 → 退回整份源文。这不是放宽，而是拒绝的范围必须与证据的范围一致：
    //     对象没给出能解析的出处时，「引文不在你声称的区间内」无从成立，能成立的只有
    //     「引文在源文里根本不存在」。若此时仍按空区间比对，会把「出处错」重复计成
    //     「引文错」，一个缺陷记成两笔。
    const scoped = ctx.anchorResolved === true
    const haystack = (scoped ? ctx.anchorText : ctx.sourceTextAll) ?? ''

    const quoteIsString = typeof quote === 'string' && quote !== ''
    const strict = quoteIsString && haystack.includes(normalizeText(quote))
    const normalized = quoteIsString && normalizeForQuoteComparison(haystack).includes(normalizeForQuoteComparison(quote))
    quoteComparison = {
      strict,
      normalized,
      acceptedBy: strict ? 'strict' : normalized ? 'normalization' : null,
      normalization: QUOTE_NORMALIZATION,
      scope: scoped ? 'anchor-region' : ctx.sourceTextAllScope,
    }

    if (!strict && !normalized) {
      const scopeNote = scoped
        ? `所引锚点区间（${[...haystack].length} 字符）`
        : `全部已载入的源文（${ctx.sourceTextAllScope}，该对象未给出可解析的锚点，故按全量比对）`
      failures.push({
        code: 'QUOTE_MISMATCH',
        detail:
          `引文未在${scopeNote}内命中：${JSON.stringify(String(quote).slice(0, 60))}` +
          `（已按 ${QUOTE_NORMALIZATION} 归一化后仍不命中——即不止是排版差异）`,
      })
    }
  }

  const primary = REASON_PRECEDENCE.find((code) => failures.some((f) => f.code === code)) ?? null
  return { ok: failures.length === 0, primaryCode: primary, failures, quoteComparison, refQuoteComparisons }
}

/**
 * 判定者的入参里**禁止出现**的字段名（生产者上下文）。
 *
 * 这张表是「隔离写进代码而非约定」的第一道守卫，由 ticket 03 建立、ticket 05 沿用。
 * ticket 05 又加了第二道更强的守卫（`assertJudgeInputShape` 的「多余键即报错」），见其注释。
 */
export const FORBIDDEN_JUDGE_CONTEXT_KEYS = Object.freeze([
  'producerPrompt',
  'producerReasoning',
  'producerMessages',
  'layer2Trace',
  'layer2Handle',
])

/**
 * 判定者输入的**结构性守卫**（ticket 05）。
 *
 * 它拦两件不同的事，缺一不可：
 *
 *   1. **出现了生产者上下文字段** → 报错。这是规格 D6 的明文要求。
 *   2. **出现了三个允许键之外的任何键** → 报错。这条比第 1 条重要得多，因为
 *      `FORBIDDEN_JUDGE_CONTEXT_KEYS` 是**黑名单**：它只能拦住我们**想得到**的泄漏，
 *      而将来有人给对象加一个 `producerHint` 之类的字段、或把整个对象塞进某处，
 *      黑名单不会响。白名单（`JUDGE_INPUT_KEYS`）才拦得住「视野被静默扩大」。
 *
 * 缺键同样报错：判定者少拿到一样东西时，它的判定**看起来仍然正常**，只是依据不足——
 * 这正是最不该被静默放行的失败模式。
 *
 * 生产者侧不调用本函数；它是判定者入口的自检，每次真实判定都会跑一遍。
 */
export function assertJudgeInputShape(input) {
  const keys = Object.keys(input ?? {})

  const leaked = keys.filter((k) => FORBIDDEN_JUDGE_CONTEXT_KEYS.includes(k))
  if (leaked.length > 0) {
    throw new Error(
      `判定者输入含生产者上下文字段：${leaked.join(', ')}——这会破坏 D6 的独立性要求。`,
    )
  }

  const extra = keys.filter((k) => !JUDGE_INPUT_KEYS.includes(k))
  if (extra.length > 0) {
    throw new Error(
      `判定者输入出现允许集合之外的键：${extra.join(', ')}——判定者的视野只能由 JUDGE_INPUT_KEYS ` +
        `（${JUDGE_INPUT_KEYS.join(' / ')}）构成，多给一样都不行。`,
    )
  }

  const missing = JUDGE_INPUT_KEYS.filter((k) => !keys.includes(k))
  if (missing.length > 0) {
    throw new Error(
      `判定者输入缺少必需的键：${missing.join(', ')}——判定者依据不足时会照样给出判定，` +
        '这类失败不会被它的输出暴露，因此必须在入口拦住。',
    )
  }

  return input
}

/**
 * 第 3 层入口。**入参只有对象、索引与 repoRoot**；没有生产者上下文可传。
 *
 * 判定者是**注入**进来的（`opts.judgeFn`），本模块自己不发起任何网络调用——这条由
 * `single-object-tracer.test.mjs` 以源码级断言钉住：`verifier.mjs` 不得出现网络原语，
 * 也不得 import 判定者的调用实现。这样「第 3 层的确定性判据可脱离 LLM 复跑」不是一句承诺，
 * 而是一个文件级的性质。
 *
 * @param {object[]} objects 第 2 层产出
 * @param {object|object[]} indexOrIndices 第 1 层产出。**单个索引或多份索引**都接受
 *        （ticket 06：跨章对象的 sourceRefs 横跨多个源文件，只传一份会让另一半出处
 *        解析不到而被拒——那不是内容问题，是我们没给它比对范围）。
 *        多份时所有索引共用一个查找表，且每个文件的行都必须载入。
 * @param {{repoRoot?:string, judgeFn?:Function, judgeConfig?:object, judgeLedger?:object,
 *          judgeAll?:boolean}} [opts]
 *        `judgeAll`（ADR-010 决策 3）：默认只对**已通过确定性判据**的对象调判定者；
 *        置 true 则所有对象都送判定，产出两组判据的交叉表。
 */
export async function verifyObjects(objects, indexOrIndices, opts = {}) {
  const repoRoot = opts.repoRoot ?? DEFAULT_REPO_ROOT
  // 单索引与多索引共用一条代码路径（ticket 06 改成多文件）。**不写两遍**：
  // 两条路径的判据一旦分叉，「同一对象在单章运行与全书运行下结论不同」就会成为可能，
  // 而那种差异最难归因——它看起来像是内容变了。
  const indices = Array.isArray(indexOrIndices) ? indexOrIndices : [indexOrIndices]
  if (indices.length === 0) throw new Error('verifyObjects 至少要拿到一份锚点索引')

  const lookup = anchorLookup(indices)
  const linesByFile = new Map()
  for (const index of indices) {
    // 与 `anchorLookup` 的重复键守卫**覆盖不同的输入**，因此两条都要留：
    // 查找表只能看见「锚点键重叠」的重复，而两份索引若指向同一文件却带着**不同锚点**
    // （典型：一份是改过标题、锚点编号已变的过期索引），键不重叠，查找表不会响。
    // 少了这一条，那种过期索引会被当成「另一份文件」而静默混入比对范围。
    if (linesByFile.has(index.sourceFile)) {
      throw new Error(`锚点索引重复给到了同一个源文件：${index.sourceFile}`)
    }
    linesByFile.set(index.sourceFile, await loadSourceLines(path.join(repoRoot, index.sourceFile)))
  }
  // 全量源文：当对象未给出可解析锚点时，逐字比对的兜底范围（见 checkDeterministic ⑤）。
  // 单索引时它就是那一份文件，与改动前的行为逐字相同；多索引时它是全部已载入源文，
  // 口径记在 `sourceTextAllScope` 里，写进回执，使「按什么范围比的」不必翻代码。
  const sourceTextAllScope = indices.length === 1 ? 'whole-source' : 'all-sources'
  const sourceTextAll = [...linesByFile.values()].map((l) => l.join('\n')).join('\n')

  const judgeFn = typeof opts.judgeFn === 'function' ? opts.judgeFn : null
  const judgeConfig = opts.judgeConfig ?? null
  const judgeAll = opts.judgeAll === true
  const judgeLedger = opts.judgeLedger ?? null
  const judgeEnabled = judgeFn !== null && judgeConfig !== null

  /** 判定者自己的调用序号（与对象序号无关）：回执据此回答「判定者被调了几次」。 */
  let judgeCallCount = 0

  const verdicts = []
  for (let i = 0; i < objects.length; i += 1) {
    const obj = objects[i]
    const objectTypeValid = OBJECT_TYPES.includes(obj?.objectType)
    const objectType = objectTypeValid ? obj.objectType : null
    const schema = objectType ? await loadObjectSchema(objectType, opts) : null

    // 逐字比对的对照文本 = 对象声明的第一个可解析锚点的**索引区间文本**（不采信对象自带的行号）。
    // 用索引而非对象声明的区间，是为了让「对象改了行号」不能顺带把引文比对也一起改掉。
    let anchorText = ''
    let checkedAgainst = null
    if (Array.isArray(obj?.sourceRefs) && obj.sourceRefs.length > 0) {
      const ref = obj.sourceRefs[0]
      const entry = ref ? lookup.get(`${ref.file}::${ref.anchor}`) : undefined
      const lines = entry ? linesByFile.get(entry.file) : undefined
      if (entry && lines !== undefined) {
        anchorText = lines.slice(entry.lineStart - 1, entry.lineEnd).join('\n')
        checkedAgainst = { file: entry.file, anchor: entry.anchor, lineStart: entry.lineStart, lineEnd: entry.lineEnd }
      }
    }

    const det = checkDeterministic(obj, {
      lookup,
      linesByFile,
      sourceTextAll,
      sourceTextAllScope,
      schema,
      objectTypeValid,
      anchorResolved: checkedAgainst !== null,
      anchorText,
    })

    // ---- 判定者阶段（独立调用、独立上下文） ----
    const failures = [...det.failures]
    let judgeRecord = null
    if (!det.ok && !judgeAll) {
      // 短路：不把判定者的调用花在已被确定性判据判死的对象上。
      judgeRecord = {
        status: 'not-called',
        note: '已被确定性判据拒绝，未送判定者（ADR-010 决策 3：默认短路）',
      }
    } else if (!objectTypeValid) {
      // 类型不在封闭集合内时**没有可用的主张字段表**，构造不出判定者输入。
      // 此处显式记明「没判」，而不是让 buildClaim 抛错把整次运行打成工程失败——
      // 类型非法属内容问题，已有 SCHEMA_INVALID 归因。
      judgeRecord = {
        status: 'not-called',
        note: `objectType 不在封闭集合内（${JSON.stringify(obj?.objectType ?? null)}），无法构造主张字段`,
      }
    } else if (!judgeEnabled) {
      judgeRecord = { status: 'not-called', note: '本次运行未启用判定者' }
    } else {
      judgeCallCount += 1
      const input = assertJudgeInputShape(
        buildJudgeInput({ objectType, object: obj, anchorText }),
      )
      const out = await judgeFn({
        config: judgeConfig,
        input,
        ordinal: judgeCallCount,
        ledger: judgeLedger,
      })
      const codeForVerdict = VERDICT_TO_REASON_CODE[out.verdict]
      if (codeForVerdict === undefined) {
        throw new Error(`判定者返回了契约外的判定值：${JSON.stringify(out.verdict ?? null)}`)
      }
      judgeRecord = {
        status: codeForVerdict === null ? 'pass' : 'reject',
        verdict: out.verdict,
        reasonCode: codeForVerdict,
        reason: out.reason ?? '',
        instanceId: out.judgeInstanceId ?? null,
        modelId: out.modelId ?? judgeConfig.modelId,
        // 判定者**实际收到**的三个键。留痕的意义：隔离出问题时，回执本身就是证据，
        // 不必回到代码去复现当时传了什么。
        inputKeys: Object.keys(input),
      }
      if (codeForVerdict !== null) {
        failures.push({
          code: codeForVerdict,
          detail: `判定者判为 ${out.verdict}：${out.reason || '（未给出理由）'}`,
        })
      }
    }

    const judgeRejected = judgeRecord?.status === 'reject'
    const ok = det.ok && !judgeRejected
    const primary = REASON_PRECEDENCE.find((code) => failures.some((f) => f.code === code)) ?? null

    verdicts.push({
      objectId: typeof obj?.id === 'string' ? obj.id : null,
      objectType,
      ordinal: i,
      status: ok ? 'pass' : 'reject',
      reasonCode: ok ? null : primary,
      failures,
      checkedAgainst,
      // 两组判据各自的结果**分开记**。合并成一个 status 就答不了「这条被拒，是谁拒的」，
      // 而 ADR-010 决策 3 的交叉表（两组判据对不对得上）正是从这个字段读出来的。
      // 注意 `det.ok` 是**独立于判定者**的结论：判定者只否决幸存者，不会推翻确定性判据。
      deterministic: { ok: det.ok, reasonCode: det.primaryCode },
      // 引文是怎么被判过的：strict 命中，还是靠归一化（即仅差 markdown 强调标记/空白）。
      // 留在回执里，审计者才能把「内容逐字一致、只是标记不同」与「真的只差一个字符也没放过」
      // 区分开——放宽了判据就必须让人看得见放宽在哪。
      quoteComparison: det.quoteComparison,
      // 逐条出处的自带引文各自的结果（ticket 06）。空数组有两个不同的含义，
      // 因此**不合并**进上面那一项：该对象没有逐条引文（单锚点对象）是正常的；
      // 有逐条引文却一条都没记下来才是异常——后者由 detail 里的 `at` 体现。
      refQuoteComparisons: det.refQuoteComparisons,
      judge: judgeRecord,
    })
  }

  const byReasonCode = {}
  for (const code of REASON_CODES) {
    const n = verdicts.filter((v) => v.status === 'reject' && v.reasonCode === code).length
    if (n > 0) byReasonCode[code] = n
  }

  // 两组判据的交叉表（ADR-010 决策 3）。两轴：确定性判据的通过/拒绝 × 判定者的判定值。
  // 缺省短路模式下，确定性拒绝的对象全落在「× not-called」一格，交叉表因此退化成两行——
  // 要拿到完整的 2×3 表必须用 judgeAll。
  const crossTab = {}
  for (const v of verdicts) {
    const axisA = v.deterministic.ok ? 'deterministic-pass' : 'deterministic-reject'
    const axisB = v.judge?.verdict ?? v.judge?.status ?? 'unknown'
    const key = `${axisA} × ${axisB}`
    crossTab[key] = (crossTab[key] ?? 0) + 1
  }

  return {
    verdicts,
    summary: {
      total: verdicts.length,
      passed: verdicts.filter((v) => v.status === 'pass').length,
      rejected: verdicts.filter((v) => v.status === 'reject').length,
      byReasonCode,
      judge: {
        enabled: judgeEnabled,
        all: judgeAll,
        calls: judgeCallCount,
        verdicts: verdicts.reduce((acc, v) => {
          const verdict = v.judge?.verdict
          if (typeof verdict === 'string') acc[verdict] = (acc[verdict] ?? 0) + 1
          return acc
        }, {}),
        notCalled: verdicts.filter((v) => v.judge?.status === 'not-called').length,
      },
      crossTab,
    },
  }
}
