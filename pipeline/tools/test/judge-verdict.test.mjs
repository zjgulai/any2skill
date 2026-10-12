/**
 * ticket 05 的验收测试（二）：判定者的**判定语义与拒绝路径**
 *
 * 覆盖 ADR-010 的三条决策：
 *   - 决策 2：只有「支撑」算通过；不充分与不支撑**都拒**，但**分码**（修法不同）
 *   - 决策 3：默认短路；`judgeAll` 全量并产出交叉表
 *   - 决策 4：判定者理由码在优先级末位（引文类故障优先归因）
 *
 * ## 关于「判定者能发现错误」这条验收项的边界
 *
 * ticket 05 要求注入「引文逐字命中、但内容与主张不相关」的 fixture，断言被判为不支撑并拒绝。
 * 本文件钉的是**管道**：给定判定者判为不支撑，对象就必须被拒、且理由码归属正确。
 * **判定者在语义上是否真的能看出「引文不支撑主张」，本文件证明不了**——那需要一次真实模型调用。
 * 因此这条不写成「判定者能发现错误」（那是没有证据的声明），而写成「判定者判为不支撑时对象被拒（管道）」，
 * 其实测证据由一次真实链路运行单独产出，见 `docs/tickets/05-verifier-independence.md` 的构建记录。
 *
 * 整份文件**不发出任何真实模型调用、不读任何凭据、不访问网络**。
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import { REASON_CODES, REASON_PRECEDENCE, verifyObjects } from '../../tools/verifier.mjs'
import {
  JUDGE_PROMPT_VERSION,
  VERDICT_TO_REASON_CODE,
  VERDICTS,
  judgePromptFingerprint,
  parseJudgeVerdict,
  JudgeError,
} from '../../tools/judge.mjs'

const REPO = DEFAULT_REPO_ROOT
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'
const SOURCE_ABS = path.join(REPO, SOURCE_REL)

/** 主张里带这个标记 → 判定替身给出指定的判定值。 */
const marker = (v) => `CASE-${v.toUpperCase()}`

let TMP
let IDX
let REGION
let QUOTE
let SOURCE_REF

before(async () => {
  TMP = await mkdtemp(path.join(os.tmpdir(), 'any2skills-judge-verdict-'))
  const bookDir = path.join(TMP, 'sources', 'ai-agent-book-zh', 'book')
  await mkdir(bookDir, { recursive: true })
  await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
  const localAbs = path.join(bookDir, 'chapter4.md')
  IDX = await buildAnchorIndex(localAbs, { repoRoot: TMP })

  const a = IDX.anchors.find((x) => x.lineStart > 1) ?? IDX.anchors[0]
  const raw = await readFile(localAbs, 'utf8')
  const all = raw.split(/\r\n|\n|\r/).map((l) => l.replace(/[ \t]+$/, ''))
  REGION = all.slice(a.lineStart - 1, a.lineEnd).join('\n')
  QUOTE = REGION.split('\n').map((l) => l.trim()).find((l) => l !== '' && !l.startsWith('#'))
  SOURCE_REF = {
    file: IDX.sourceFile,
    anchor: a.anchor,
    title: a.title,
    lineStart: a.lineStart,
    lineEnd: a.lineEnd,
    contentHash: a.contentHash,
  }
})

after(async () => {
  if (TMP) await rm(TMP, { recursive: true, force: true })
})

/** 造一个合法 Concept。`definition` 决定判定替身给什么判定值。 */
function concept(n, { definition = '一条正常的主张', quote = QUOTE } = {}) {
  return {
    id: `JUDGE-TEST-H2-1-CONCEPT-${String(n).padStart(2, '0')}`,
    objectType: 'Concept',
    revision: 1,
    status: 'candidate',
    createdAt: '2026-10-08T00:00:00.000Z',
    sourceRefs: [{ ...SOURCE_REF }],
    canonicalTerm: '测试概念',
    aliases: [],
    definition,
    examples: ['示例'],
    evidenceQuote: quote,
  }
}

/** 判定者替身：按主张里的标记给出对应判定值；没有标记则一律「支撑」。 */
function makeJudge({ captured } = {}) {
  return async ({ config, input, ordinal }) => {
    captured?.push({ ordinal, input })
    const def = JSON.stringify(input.claim)
    const hit = VERDICTS.find((v) => def.includes(marker(v)))
    const verdict = hit ?? 'supported'
    return {
      verdict,
      reason: `替身判定：${verdict}`,
      judgeInstanceId: `${config.modelId}/fake#${ordinal}`,
      modelId: config.modelId,
    }
  }
}

const judgeConfig = { modelId: 'judge-test-model', baseUrl: 'https://judge.example.invalid' }

function verify(objects, opts = {}) {
  return verifyObjects(objects, IDX, {
    repoRoot: TMP,
    judgeFn: makeJudge(),
    judgeConfig,
    ...opts,
  })
}

// ---------------------------------------------------------------------------

describe('05 · 三值语义：只有「支撑」算通过', () => {
  it('支撑 → 通过', async () => {
    const { verdicts, summary } = await verify([concept(1)])
    assert.equal(verdicts[0].status, 'pass')
    assert.equal(verdicts[0].judge.verdict, 'supported')
    assert.equal(verdicts[0].judge.reasonCode, null, '支撑不产生拒绝理由码')
    assert.equal(summary.passed, 1)
  })

  it('不支撑 → 拒绝，理由码 JUDGE_NOT_SUPPORTED', async () => {
    const { verdicts } = await verify([concept(1, { definition: marker('unsupported') })])
    assert.equal(verdicts[0].status, 'reject')
    assert.equal(verdicts[0].reasonCode, 'JUDGE_NOT_SUPPORTED')
    assert.match(verdicts[0].failures[0].detail, /判定者判为 unsupported/)
  })

  it('不充分 → **也**拒绝，但用独立理由码 JUDGE_INSUFFICIENT（ADR-010 决策 2）', async () => {
    // 这是本卡最容易做错的一处：只对「不支撑」拒绝、把「不充分」放行，
    // 等于把门禁松紧交给模型的措辞习惯——而灰色地带恰恰最常落在「有点相关但不完全支持」。
    const { verdicts, summary } = await verify([concept(1, { definition: marker('insufficient') })])
    assert.equal(verdicts[0].status, 'reject')
    assert.equal(verdicts[0].reasonCode, 'JUDGE_INSUFFICIENT')
    assert.equal(summary.byReasonCode.JUDGE_INSUFFICIENT, 1)
    assert.equal(summary.byReasonCode.JUDGE_NOT_SUPPORTED, undefined)
  })

  it('不支撑与不充分不共用理由码——两者修法不同，混码会让归因失效', () => {
    assert.equal(VERDICT_TO_REASON_CODE.supported, null)
    assert.equal(VERDICT_TO_REASON_CODE.unsupported, 'JUDGE_NOT_SUPPORTED')
    assert.equal(VERDICT_TO_REASON_CODE.insufficient, 'JUDGE_INSUFFICIENT')
    assert.notEqual(VERDICT_TO_REASON_CODE.unsupported, VERDICT_TO_REASON_CODE.insufficient)
    for (const code of Object.values(VERDICT_TO_REASON_CODE)) {
      if (code !== null) assert.ok(REASON_CODES.includes(code), `${code} 必须在封闭词表内`)
    }
  })

  it('判定者判定值与映射表一一对应，没有第四种', () => {
    assert.deepEqual(Object.keys(VERDICT_TO_REASON_CODE).sort(), [...VERDICTS].sort())
  })
})

describe('05 · 拒绝路径的归属：引文类故障不得报成判定者类', () => {
  it('引文完全不在锚点内 → 拒绝，理由是引文类而非判定者类（ADR-010 决策 4）', async () => {
    // 这条是卡 05 验收里「拒绝路径可达」的本来要求：两种缺陷的修复方不同，
    // 把「出处对不上」报成「判定者不认」会让人去改错的地方。
    const { verdicts } = await verify([
      concept(1, { quote: '这段文字在源文件里绝对不存在-2f9c1d' }),
    ])
    assert.equal(verdicts[0].status, 'reject')
    assert.equal(verdicts[0].reasonCode, 'QUOTE_MISMATCH')
    assert.ok(!String(verdicts[0].reasonCode).startsWith('JUDGE_'), '不得报成判定者类理由码')
  })

  it('引文缺失 → QUOTE_MISSING，仍然优先于判定者类', async () => {
    const obj = concept(1)
    delete obj.evidenceQuote
    const { verdicts } = await verify([obj])
    assert.equal(verdicts[0].reasonCode, 'QUOTE_MISSING')
  })

  it('判定者理由码排在优先级末尾', () => {
    const judgeCodes = REASON_PRECEDENCE.filter((c) => c.startsWith('JUDGE_'))
    const tail = REASON_PRECEDENCE.slice(-judgeCodes.length)
    assert.deepEqual(tail, judgeCodes, '判定者理由码必须是优先级末位')
    assert.equal(REASON_PRECEDENCE[REASON_PRECEDENCE.length - 1].startsWith('JUDGE_'), true)
  })

  it('同时触犯引文类与判定者类时，主理由码归引文类（判定者在末位）', async () => {
    // 需要 --judge-all 才会让「已被确定性判据拒绝」的对象也进判定者，
    // 于是这个对象同时拥有 QUOTE_MISMATCH 与判定者的判定。
    const { verdicts } = await verify(
      [concept(1, { quote: '不存在-2f9c1d', definition: marker('unsupported') })],
      { judgeAll: true },
    )
    assert.equal(verdicts[0].reasonCode, 'QUOTE_MISMATCH', '引文类必须压过判定者类')
    const codes = verdicts[0].failures.map((f) => f.code)
    assert.ok(codes.includes('JUDGE_NOT_SUPPORTED'), '全部命中项仍应保留在 failures 里')
  })
})

describe('05 · 调用范围：默认短路与 --judge-all 交叉表', () => {
  const objects = () => [
    concept(1),
    concept(2, { definition: marker('unsupported') }),
    concept(3, { quote: '不存在-2f9c1d' }),
  ]

  it('默认短路：已被确定性判据拒绝的对象不送判定者，且标注 not-called', async () => {
    const captured = []
    const { verdicts, summary } = await verify(objects(), { judgeFn: makeJudge({ captured }) })

    assert.equal(captured.length, 2, '只有两个对象通过确定性判据，判定者应只被调 2 次')
    const skipped = verdicts.find((v) => v.objectId.endsWith('03'))
    assert.equal(skipped.judge.status, 'not-called')
    assert.match(skipped.judge.note, /短路/)
    assert.equal(summary.judge.calls, 2)
    assert.equal(summary.judge.notCalled, 1)
    assert.equal(summary.judge.all, false)
  })

  it('短路不得被误读成「判定者看过并同意」——没判与判过必须可区分', async () => {
    const { verdicts } = await verify(objects())
    const skipped = verdicts.find((v) => v.objectId.endsWith('03'))
    assert.equal(skipped.judge.verdict, undefined, '未判的对象不该有判定值')
    const judged = verdicts.find((v) => v.objectId.endsWith('01'))
    assert.equal(judged.judge.verdict, 'supported')
    assert.notEqual(skipped.judge.status, judged.judge.status)
  })

  it('judgeAll：所有对象都送判定，产出两组判据的交叉表', async () => {
    const captured = []
    const { verdicts, summary } = await verify(objects(), {
      judgeFn: makeJudge({ captured }),
      judgeAll: true,
    })
    assert.equal(captured.length, 3, '全量模式下三个对象都要送判定')
    assert.equal(summary.judge.all, true)
    assert.equal(summary.judge.notCalled, 0)
    assert.ok(Object.keys(summary.crossTab).length > 0, '全量模式应产出交叉表')
    // 三个对象：① 双过 ② 确定性过、判定者拒 ③ 确定性拒、判定者过
    assert.equal(summary.passed, 1)
    assert.equal(summary.rejected, 2)
    assert.equal(verdicts.find((v) => v.objectId.endsWith('03')).status, 'reject')
  })

  it('类型不在封闭集合内时记为 not-called，而不是抛错把它打成工程失败', async () => {
    const bad = concept(1)
    bad.objectType = 'NotAType'
    // 必须用 judgeAll：默认短路会先在「已被确定性判据拒绝」那一支拦住它，
    // 于是根本走不到「类型非法 → 无法构造主张字段」这一支——那样这条用例测的是别的东西。
    const { verdicts } = await verify([bad], { judgeAll: true })
    assert.equal(verdicts[0].status, 'reject')
    assert.equal(verdicts[0].reasonCode, 'SCHEMA_INVALID')
    assert.equal(verdicts[0].judge.status, 'not-called')
    assert.match(verdicts[0].judge.note, /封闭集合/)
  })

  it('短路分支优先于类型分支：默认模式下，非法类型的对象也归因到「已被确定性判据拒绝」', async () => {
    const bad = concept(1)
    bad.objectType = 'NotAType'
    const { verdicts } = await verify([bad])
    assert.equal(verdicts[0].status, 'reject')
    assert.equal(verdicts[0].judge.status, 'not-called')
    assert.match(verdicts[0].judge.note, /短路/)
  })

  it('未启用判定者时，对象仍按确定性判据判定，且明细写明「未启用」', async () => {
    const { verdicts, summary } = await verify([concept(1)], { judgeFn: null, judgeConfig: null })
    assert.equal(verdicts[0].status, 'pass')
    assert.equal(verdicts[0].judge.status, 'not-called')
    assert.match(verdicts[0].judge.note, /未启用/)
    assert.equal(summary.judge.enabled, false)
  })
})

describe('05 · 主张 = 断言 + 适用范围', () => {
  // 背景（实测反证）：`CHAPTER4-H4-2-HEURISTIC-02` 被判定者判「不充分」，理由说主张未加
  // 「文本内容占主体的 PDF 文档等」这个限定——而那个限定**就在对象上**，只是在 `trigger`，
  // 而当时的主张字段表只取了 `recommendation`。判定者看到的因此是一条无界的推荐。
  // 不完整是我们造成的：抽掉范围再判，等于用一个自己造出来的不完整主张去否定对象。
  const SCOPE_FIELDS = Object.freeze({
    Metric: 'window',
    MentalModel: 'trigger',
    Heuristic: 'trigger',
    EngineeringRule: 'appliesWhen',
  })

  it('范围限定类字段一律进主张（逐类型列举，四条都要在）', async () => {
    const { CLAIM_FIELDS } = await import('../../tools/object-contract.mjs')
    for (const [type, field] of Object.entries(SCOPE_FIELDS)) {
      assert.ok(
        CLAIM_FIELDS[type].includes(field),
        `${type} 的主张缺范围字段 ${field}——抽掉范围会把有界对象读成无界断言`,
      )
    }
  })

  it('断言与指代类字段仍然在（纳入范围不得挤掉原有字段）', async () => {
    const { CLAIM_FIELDS } = await import('../../tools/object-contract.mjs')
    const must = {
      Concept: ['canonicalTerm', 'definition'],
      Metric: ['name', 'formula'],
      MentalModel: ['reasoning'],
      DecisionModel: ['branches', 'outputs'],
      Heuristic: ['recommendation'],
      Case: ['title', 'outcome'],
      Playbook: ['title', 'steps'],
      EngineeringRule: ['statement'],
      AntiPattern: ['pattern', 'harm'],
    }
    for (const [type, fields] of Object.entries(must)) {
      for (const f of fields) {
        assert.ok(CLAIM_FIELDS[type].includes(f), `${type} 的主张丢了 ${f}`)
      }
    }
  })

  it('明确不进主张的字段：叙述、展开、前置条件都不是适用范围', async () => {
    const { CLAIM_FIELDS } = await import('../../tools/object-contract.mjs')
    // 逐条列出「为什么不进」，免得后来者把它们当成漏掉的适用范围又加回来：
    //   context        一段叙述（背景交代），不是限定
    //   inputs         声明输入是什么，分支条件本身已在 branches 里
    //   prerequisites  描述执行前提，不描述「这套流程在什么情况下成立」
    //   examples/aliases/evidence  断言的展开，并进去会让主张变大（判定变严，反向的错）
    const excluded = {
      Case: ['context', 'facts', 'decisions', 'evidenceRefs', 'limitations', 'dataClass'],
      DecisionModel: ['inputs', 'unknownPolicy', 'stopConditions', 'reviewState'],
      Playbook: ['prerequisites', 'checks', 'rollback', 'approval'],
      Concept: ['aliases', 'examples'],
      AntiPattern: ['corrective', 'evidence'],
      EngineeringRule: ['rationale', 'violation'],
      Heuristic: ['confidence', 'exceptions'],
      MentalModel: ['inputs', 'limits', 'counterexample'],
      Metric: ['inputs', 'unit', 'failureModes'],
    }
    for (const [type, fields] of Object.entries(excluded)) {
      for (const f of fields) {
        assert.ok(!CLAIM_FIELDS[type].includes(f), `${type}.${f} 不该进主张——见本用例注释`)
      }
    }
  })

  it('带范围的主张确实传递给判定者：限定词出现在判定者收到的输入里', async () => {
    const captured = []
    const obj = concept(1)
    obj.objectType = 'Heuristic'
    delete obj.canonicalTerm
    delete obj.aliases
    delete obj.definition
    delete obj.examples
    Object.assign(obj, {
      trigger: '当需要处理文本内容占主体的 PDF 文档等时',
      recommendation: '选择提取为文本的方法',
      confidence: 0.7,
      exceptions: [],
    })
    await verify([obj], { judgeFn: makeJudge({ captured }) })
    assert.equal(captured.length, 1)
    const seen = JSON.stringify(captured[0].input.claim)
    assert.match(seen, /PDF 文档等/, '限定词必须进判定者输入')
    assert.match(seen, /选择提取为文本/, '断言必须进判定者输入')
    assert.ok(!seen.includes('confidence'), 'confidence 不是主张，不该进')
  })
})

describe('05 · 判定者响应的契约与失败归类', () => {
  it('解析器容忍代码块包裹与前后夹带的文字', () => {
    assert.deepEqual(parseJudgeVerdict('{"verdict":"supported","reason":"r"}'), {
      verdict: 'supported',
      reason: 'r',
    })
    assert.deepEqual(parseJudgeVerdict('```json\n{"verdict":"insufficient","reason":"r"}\n```').verdict, 'insufficient')
    assert.deepEqual(
      parseJudgeVerdict('我的判定如下：{"verdict":"unsupported","reason":"r"} 以上。').verdict,
      'unsupported',
    )
  })

  it('契约外的判定值**报错**，不静默当成通过也不静默当成拒绝', () => {
    // 静默降级最危险的方向是「当成通过」——门禁会悄悄失效。
    // 报错则让「判定者没按约定回答」成为可归因的工程失败。
    assert.throws(() => parseJudgeVerdict('{"verdict":"maybe","reason":"r"}'), JudgeError)
    assert.throws(() => parseJudgeVerdict('{"reason":"r"}'), JudgeError)
    assert.throws(() => parseJudgeVerdict('完全不是 JSON'), JudgeError)
    assert.throws(() => parseJudgeVerdict('[1,2,3]'), JudgeError)
  })

  // 回归（ADR-023）：判定者的输入**就是锚点原文**，含代码块的概率与第 2 层同样高。
  // 旧解析器的未锚定围栏正则会命中字符串**内部**的代码围栏，把一个本该正常裁决的
  // 响应判成「解析失败」——而解析失败与真判否在回执里是两种东西，人工复核时却同样
  // 容易被跳过，所以这个方向必须钉住。
  it('reason 里含代码围栏时不得被剥壳剥坏（判定者视野是锚点原文，含代码块很常见）', () => {
    const raw = JSON.stringify({
      verdict: 'supported',
      reason: '引文确实支撑主张：\n\n```text\n文件原始字节 → 工具返回 → 模型上下文\n```\n\n以上链路与主张一致。',
    })
    const v = parseJudgeVerdict(raw)
    assert.equal(v.verdict, 'supported')
    assert.ok(v.reason.includes('```'), '代码围栏必须原样保留')
    assert.ok(v.reason.includes('\n'), '换行必须原样保留')
  })

  it('判定者判据的指纹随提示词版本变化（改了判据必须能看出来）', () => {
    assert.equal(JUDGE_PROMPT_VERSION, 'judge-prompt/v2')
    assert.equal(judgePromptFingerprint(), judgePromptFingerprint(), '同一版本必须稳定')
    assert.match(judgePromptFingerprint(), /^judge-[0-9a-f]{12}$/)
  })

  it('判定者返回契约外的值时，整次验证作为工程失败抛出，不产生「通过」', async () => {
    await assert.rejects(
      () =>
        verifyObjects([concept(1)], IDX, {
          repoRoot: TMP,
          judgeConfig,
          judgeFn: async () => ({ verdict: 'totally-fine', reason: 'x', judgeInstanceId: 'j#1' }),
        }),
      /契约外的判定值/,
    )
  })
})
