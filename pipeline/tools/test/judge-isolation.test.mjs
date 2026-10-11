/**
 * ticket 05 的验收测试（一）：判定者的**结构性隔离证明**
 *
 * 本卡的核心要求是「隔离必须写在代码里，写在文档里等于没写」。本文件用三种方式证明它：
 *
 *   1. **构造式隔离的单元证明**：`buildJudgeInput` 只按 `CLAIM_FIELDS` 取字段。
 *      埋在非主张字段里的哨兵进不了判定者的输入。
 *   2. **端到端哨兵证明**：驱动**真实链路**（真实第 1 层索引 → 真实第 2 层物化 → 真实第 3 层
 *      验证），把哨兵埋在生产者响应里三个必须不回流的位置，断言判定者**实际收到**的请求里
 *      一个都没有。断言的对象是**判定者的请求正文**，不是代码注释。
 *   3. **正向对照**：断言判定者**确实**收到了主张与引文。没有这一条，
 *      「请求里没有哨兵」可能只是「请求是空的」——一个永远为真的测试等于没测。
 *
 * 整份文件**不发出任何真实模型调用、不读任何凭据、不访问网络**：第 2 层与判定者两层传输
 * 都由替身驱动。
 *
 * ## 为什么提示词通道用的是「派生哨兵」而不是字面哨兵
 *
 * ticket 05 要求「在生产者的提示词**或**完整输出中埋入哨兵字符串」。完整输出这一路本文件
 * 用了字面哨兵；提示词这一路做不到，原因要说清楚：
 *
 *   生产者的 system 提示词由 `buildSystemPrompt()` 生成，是一个**常量**，全链路没有任何
 *   注入点可以往里塞一个哨兵。因此改用**派生哨兵**——把生产者实际收到的整段 system 提示词
 *   当作哨兵（它足够长、足够独特），断言它不出现在判定者的任何请求里。等价性成立：
 *   「判定者不含生产者提示词的任何一个字」与「不含埋在提示词里的哨兵」是同一件事，
 *   而派生哨兵比字面哨兵**更强**——它覆盖整段提示词，不只是某一行。
 *   同时用一条正向断言钉死判定者的 system 就是它自己的常量，不是生产者那一份。
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import { EXIT, runPipeline } from '../../run.mjs'
import {
  JUDGE_INPUT_KEYS,
  buildJudgeInput,
  buildJudgePrompts,
  judgePromptFingerprint,
} from '../../tools/judge.mjs'
import { CLAIM_FIELDS } from '../../tools/object-contract.mjs'
import { assertJudgeInputShape } from '../../tools/verifier.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = DEFAULT_REPO_ROOT
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'
const SOURCE_ABS = path.join(REPO, SOURCE_REL)

// ---------------------------------------------------------------------------
// 哨兵：三处「必须不回流」的位置 + 两个正向标记
// ---------------------------------------------------------------------------

/** 埋在生产者响应**顶层**（对象数组之外）。materializeObject 会忽略它，但原文里它是存在的。 */
const S_TOPLEVEL = 'SENTINEL-TOPLEVEL-4c81d2'
/** 埋在生产者响应里对象的**非主张字段**（Concept 的 `aliases`）。字段在对象上，但不该进判定者视野。 */
const S_NONCLAIM = 'SENTINEL-NONCLAIM-7d92bf'
/** 埋在生产者推理正文的位置——用响应原文里的一个独立标记代表「完整输出历史」。 */
const S_RAWTAIL = 'SENTINEL-RAWTAIL-6b03e7'

/** 正向标记：两个对象各自的主张标识，用于证明**逐对象隔离**（判甲时看不到乙）。 */
const CLAIM_ONE = '主张甲-DEFINITION-ONE-aaaa'
const CLAIM_TWO = '主张乙-DEFINITION-TWO-bbbb'

const ALL_SENTINELS = [S_TOPLEVEL, S_NONCLAIM, S_RAWTAIL]

/** 判定者专属路由：与生产者不同 → 用来断言 `sameModelAsProducer` 如实记录。 */
const JUDGE_MODEL = 'judge-test-model'

const fakeConfigEnv = () => ({
  ANY2SKILLS_LLM_API_KEY: 'sk-test-not-real',
  ANY2SKILLS_LLM_MODEL: 'producer-test-model',
  ANY2SKILLS_LLM_BASE_URL: 'https://api.example.invalid',
  ANY2SKILLS_LLM_PROVIDER: 'test',
  ANY2SKILLS_JUDGE_MODEL: JUDGE_MODEL,
  ANY2SKILLS_JUDGE_BASE_URL: 'https://judge.example.invalid',
})

/** 生产者替身：每个锚点产出两个 Concept，并把哨兵埋在三个不该回流的位置。 */
function makeProducerChat(captured) {
  return async (config, { system, user, ledger }) => {
    captured.producer.push({ system, user })
    if (ledger) {
      ledger.calls += 1
      ledger.tokens.input += 10
      ledger.tokens.output += 5
    }
    const anchor = /锚点：(\S+?)（第 (\d+)–(\d+) 行/.exec(user)
    assert.ok(anchor, '生产者用户提示词必须带锚点定位')
    const body = /\n---\n([\s\S]*)\n---\n?$/.exec(user)?.[1]
    assert.ok(typeof body === 'string' && body.length > 0, '生产者用户提示词必须带正文')
    const quote = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('#'))

    // 哨兵三处：顶层字段、非主张字段、响应原文尾部。
    // 注意 response 的**文本本身**就是「生产者的完整输出」，它整段都会落进 layer2-raw。
    const text =
      JSON.stringify({
        objects: [
          {
            objectType: 'Concept',
            evidenceQuote: quote,
            canonicalTerm: '概念甲',
            aliases: [S_NONCLAIM],
            definition: CLAIM_ONE,
            examples: ['示例甲'],
          },
          {
            objectType: 'Concept',
            evidenceQuote: quote,
            canonicalTerm: '概念乙',
            aliases: ['别名乙'],
            definition: CLAIM_TWO,
            examples: ['示例乙'],
          },
        ],
        [S_TOPLEVEL]: '顶层字段：materializeObject 会忽略它，但它在生产者输出原文里',
      }) + `\n/* ${S_RAWTAIL} */`

    return {
      text,
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      calls: 1,
    }
  }
}

/** 判定者替身：记录**判定者实际收到的请求**——本文件的断言对象就是它。 */
function makeJudgeChat(captured) {
  return async (config, { system, user, ledger }) => {
    captured.judge.push({ system, user, modelId: config.modelId })
    if (ledger) {
      ledger.calls += 1
      ledger.tokens.input += 3
      ledger.tokens.output += 2
    }
    return {
      text: JSON.stringify({ verdict: 'supported', reason: '引文直接给出了该定义' }),
      usage: { prompt_tokens: 3, completion_tokens: 2 },
      calls: 1,
    }
  }
}

// ---------------------------------------------------------------------------
// 1 · 构造式隔离的单元证明
// ---------------------------------------------------------------------------

describe('05 · 判定者输入的构造式隔离（单元）', () => {
  it('输入恰好是三个允许键，一个不多一个不少', () => {
    const out = buildJudgeInput({
      objectType: 'Concept',
      object: { id: 'X-1', evidenceQuote: '引', canonicalTerm: '甲', definition: '定', aliases: ['哨兵'] },
      anchors: [{ anchor: 'chapterX#h1-1', text: '正文' }],
    })
    assert.deepEqual(Object.keys(out).sort(), [...JUDGE_INPUT_KEYS].sort())
  })

  it('非主张字段进不了输入——这是「删字段式隔离」做不到的事', () => {
    // 删除式隔离会「先把整个对象放进去、再把敏感字段摘掉」，于是将来新增的字段
    // 默认是**可见**的。构造式隔离反过来：默认不可见，只有被列进 CLAIM_FIELDS 的才可见。
    const object = {
      id: 'X-1',
      evidenceQuote: '引',
      canonicalTerm: '甲',
      definition: '定',
      aliases: [S_NONCLAIM],
      examples: [S_TOPLEVEL],
      sourceRefs: [{ anchor: S_RAWTAIL }],
    }
    const out = buildJudgeInput({ objectType: 'Concept', object, anchors: [{ anchor: 'a', text: '正文' }] })
    const serialized = JSON.stringify(out)

    assert.ok(!serialized.includes(S_NONCLAIM), 'aliases 不是主张字段，不该进输入')
    assert.ok(!serialized.includes(S_TOPLEVEL), 'examples 不是主张字段，不该进输入')
    assert.ok(!serialized.includes(S_RAWTAIL), 'sourceRefs 不是主张字段，不该进输入')
    assert.ok(!serialized.includes('X-1'), 'id 不是主张字段，不该进输入')
    // 正向：主张字段确实在
    assert.equal(out.claim.canonicalTerm, '甲')
    assert.equal(out.claim.definition, '定')
  })

  it('九种类型的主张字段都取到，且每个都在该类型的必填字段内', () => {
    for (const [type, fields] of Object.entries(CLAIM_FIELDS)) {
      const object = { evidenceQuote: '引' }
      for (const f of fields) object[f] = `值-${f}`
      object.__notAClaimField = '不该进'
      const input = buildJudgeInput({ objectType: type, object, anchors: [{ anchor: 'a', text: '正文' }] })

      assert.deepEqual(Object.keys(input.claim).sort(), [...fields].sort(), `${type} 的主张字段不对`)
      assert.ok(!JSON.stringify(input).includes('不该进'), `${type} 混入了非主张字段`)
    }
  })

  it('判定者输入里出现生产者上下文字段或任何额外键，都当场报错', () => {
    const ok = { claim: {}, quote: 'q', anchors: [{ anchor: 'a', text: 'a' }] }
    assert.doesNotThrow(() => assertJudgeInputShape(ok))
    assert.throws(() => assertJudgeInputShape({ ...ok, producerReasoning: 'x' }), /生产者上下文字段/)
    assert.throws(() => assertJudgeInputShape({ ...ok, whatever: 'x' }), /允许集合之外的键/)
  })

  it('提示词里只有判定者自己的常量，没有生产者的任何东西', () => {
    const { system } = buildJudgePrompts({ claim: { definition: '定' }, quote: '引', anchors: [{ anchor: 'a', text: '正文' }] })
    // 判定者的 system 是常量：同一个输入两次构造，system 必须逐字相同。
    const again = buildJudgePrompts({ claim: {}, quote: 'x', anchors: [{ anchor: 'a', text: 'y' }] })
    assert.equal(system, again.system, '判定者的 system 提示词必须是常量')
  })
})

// ---------------------------------------------------------------------------
// 2 · 端到端哨兵证明（真实链路 + 双替身传输）
// ---------------------------------------------------------------------------

describe('05 · 判定者隔离的端到端哨兵证明（真实链路）', () => {
  let TMP
  let captured
  let receipt
  let index

  before(async () => {
    TMP = await mkdtemp(path.join(os.tmpdir(), 'any2skills-judge-iso-'))
    const bookDir = path.join(TMP, 'sources', 'ai-agent-book-zh', 'book')
    await mkdir(bookDir, { recursive: true })
    await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
    index = await buildAnchorIndex(path.join(bookDir, 'chapter4.md'), { repoRoot: TMP })

    captured = { producer: [], judge: [] }
    const out = await runPipeline({
      source: SOURCE_REL,
      repoRoot: TMP,
      layer2: 'deepseek',
      rerun: true,
      env: fakeConfigEnv(),
      chatImpl: makeProducerChat(captured),
      judgeChatImpl: makeJudgeChat(captured),
      maxAttempts: 1,
    })
    assert.equal(out.exitCode, EXIT.PASS, '本次应全部通过')
    receipt = out.receipt
  })

  after(async () => {
    if (TMP) await rm(TMP, { recursive: true, force: true })
  })

  it('前置：两层的传输都真的被驱动了（否则后面的「不含哨兵」毫无意义）', () => {
    assert.equal(captured.producer.length, index.anchorCount, '每锚点一次第 2 层调用')
    assert.ok(captured.judge.length > 0, '判定者必须真的被调用过')
    // 短路口径：锚点数 × 每锚点 2 个对象，全部通过确定性判据 → 每个对象都该被判定。
    assert.equal(captured.judge.length, index.anchorCount * 2, '每个幸存对象一次判定调用')
  })

  it('判定者收到的请求里，三处哨兵一个都没有', () => {
    const everything = captured.judge.map((c) => `${c.system}\n${c.user}`).join('\n')
    for (const s of ALL_SENTINELS) {
      assert.ok(!everything.includes(s), `判定者的请求里出现了哨兵 ${s}——隔离被破坏了`)
    }
  })

  it('判定者收到的请求里没有生产者提示词的任何一个字（派生哨兵）', () => {
    const producerSystem = captured.producer[0].system
    assert.ok(producerSystem.length > 200, '生产者 system 提示词应足够长，才配当作派生哨兵')
    for (const c of captured.judge) {
      assert.ok(!c.user.includes(producerSystem), '判定者请求里出现了生产者 system 提示词')
      assert.notEqual(c.system, producerSystem, '判定者不得复用生产者的 system 提示词')
    }
    // 更严的一条：生产者 system 的**任意一个足够长的片段**也不得出现在判定者请求里。
    const probe = producerSystem.slice(0, 120)
    for (const c of captured.judge) {
      assert.ok(!c.system.includes(probe) && !c.user.includes(probe), '生产者提示词片段出现在判定者请求里')
    }
  })

  it('逐对象隔离：判甲时看不到乙的主张（「其他对象的产出」不得进输入）', () => {
    const aboutOne = captured.judge.filter((c) => c.user.includes(CLAIM_ONE))
    const aboutTwo = captured.judge.filter((c) => c.user.includes(CLAIM_TWO))

    assert.equal(aboutOne.length, index.anchorCount, '每个锚点的对象甲各被判定一次')
    assert.equal(aboutTwo.length, index.anchorCount, '每个锚点的对象乙各被判定一次')
    for (const c of aboutOne) {
      assert.ok(!c.user.includes(CLAIM_TWO), '判定对象甲时，乙的主张不得出现在输入里')
    }
    for (const c of aboutTwo) {
      assert.ok(!c.user.includes(CLAIM_ONE), '判定对象乙时，甲的主张不得出现在输入里')
    }
  })

  it('正向对照：判定者确实收到了主张、引文与锚点原文三样', () => {
    for (const c of captured.judge) {
      assert.match(c.user, /【主张】/, '判定者必须收到主张')
      assert.match(c.user, /【主引文】/, '判定者必须收到引文')
      assert.match(c.user, /【锚点原文】/, '判定者必须收到锚点原文')
    }
    // 引文与锚点原文必须真的落在请求里（不只是标签在）。
    const first = captured.judge[0]
    assert.match(first.user, /主张甲-DEFINITION-ONE-aaaa/)
    assert.ok(first.user.length > 300, '判定者收到的请求不该是空壳')
  })

  it('对象声明几条支撑，判定者就收到几段锚点原文（judge-prompt/v2 的视野放宽）', () => {
    // 这条断言钉的是 v2 改动的**生效条件**：不是「提示词里写了多发几段」，而是
    // 「对象声明 N 条锚点时，请求里就有 N 段、各自带出处标识」。少了这条，
    // 提示词说一套、请求发另一套也不会有人发现。
    // 本夹具为单锚点对象（chapter4），因此这里同时钉住「单锚点仍渲染一段」这一回归红线。
    for (const c of captured.judge) {
      const rendered = c.user.split('〔第 ').length - 1
      assert.ok(rendered >= 1, '判定者至少应收到一段锚点原文')
      assert.match(c.user, /主锚点/, '第一段必须标出主锚点，判定者需要知道哪一段对应主引文')
    }
    const first = captured.judge[0]
    const declared = receipt.objectVerdicts[0].judgedAnchors.length
    assert.equal(
      first.user.split('〔第 ').length - 1,
      declared,
      '请求里的段数必须等于回执记下的 judgedAnchors 条数',
    )
  })

  it('回执记下判定者实际看到的全部锚点区间，且主锚点语义仍是 sourceRefs[0]', () => {
    for (const v of receipt.objectVerdicts) {
      assert.ok(Array.isArray(v.judgedAnchors), '每个对象都必须记下判定者看到的锚点区间')
      assert.ok(v.judgedAnchors.length >= 1)
      // `checkedAgainst` 与 `judgedAnchors[0]` 必须指向同一段：v2 放宽的是视野范围，
      // 不是「主锚点怎么算」。两者分叉会让回执里的两个字段互相矛盾。
      assert.deepEqual(v.judgedAnchors[0], v.checkedAgainst, '主锚点必须与 checkedAgainst 一致')
      for (const a of v.judgedAnchors) {
        assert.equal(typeof a.anchor, 'string')
        assert.equal(typeof a.lineStart, 'number')
        assert.equal(typeof a.lineEnd, 'number')
      }
    }
  })

  it('回执逐对象记录判定者实例标识与它**实际收到**的三个键', () => {
    const ids = new Set()
    for (const v of receipt.objectVerdicts) {
      assert.equal(v.judge.status, 'pass')
      assert.ok(v.judge.instanceId, '每个对象都必须记录判定者实例标识')
      assert.deepEqual(v.judge.inputKeys, [...JUDGE_INPUT_KEYS], '回执应记下判定者实际收到的键')
      ids.add(v.judge.instanceId)
    }
    assert.equal(ids.size, receipt.objectVerdicts.length, '每次判定的实例标识必须互不相同')
    for (const id of ids) assert.ok(id.includes(judgePromptFingerprint()), '实例标识应含判定者判据指纹')
  })

  it('回执记录判定者路由，并把「是否与生产者同模型」写明', () => {
    assert.equal(receipt.judge.enabled, true)
    assert.equal(receipt.judge.modelId, JUDGE_MODEL)
    // ADR-010 决策 1：同模型自审是明确接受的代价，前提是**它可见**。
    assert.equal(receipt.judge.sameModelAsProducer, false)
    assert.equal(receipt.judge.producerModelId, 'producer-test-model')
    assert.match(receipt.verificationGate, /gate-1-full/)
    assert.equal(receipt.judge.scope, 'deterministic-survivors-only')
  })

  it('判定者的用量与第 2 层**分开记账**（合并成一个数字就答不了「判定者花了多少」）', () => {
    assert.equal(receipt.model.calls, index.anchorCount)
    assert.equal(receipt.judge.calls, index.anchorCount * 2)
    assert.notEqual(receipt.model.calls, receipt.judge.calls, '两组用量必须能分别读出')
    assert.ok(receipt.judge.tokens.input > 0 && receipt.judge.tokens.output > 0)
  })
})

// ---------------------------------------------------------------------------
// 3 · 启用范围：重判路径默认不启用判定者，但 --judge 可以只重扫判定者
// ---------------------------------------------------------------------------

describe('05 · 判定者的启用范围与重判路径', () => {
  let DIR
  let counters

  /** 把现行回执「降级」成旧版本，复现「判据已变」的状态（与卡 04 的重判测试同一手法）。 */
  async function demoteReceipt(tag) {
    const registryDir = path.join(DIR, 'pipeline', 'registry')
    // 逐轮下来 registry 里会同时存在被降级的历史回执与现行回执，因此按**名字**取现行的那份，
    // 不能靠「目录里只有一份」这个会被自己的历史打破的前提。
    const current = (await readdir(registryDir)).filter(
      (f) => f.endsWith('.receipt.json') && !f.startsWith('run-legacy-'),
    )
    assert.equal(current.length, 1, `应恰有一份现行回执，实际 ${current.length}：${current.join(', ')}`)
    const cur = path.join(registryDir, current[0])
    const receipt = JSON.parse(await readFile(cur, 'utf8'))
    receipt.pipelineVersion = 1
    await writeFile(path.join(registryDir, `run-legacy-${tag}.receipt.json`), JSON.stringify(receipt, null, 2), 'utf8')
    await rm(cur, { force: true })
  }

  before(async () => {
    DIR = await mkdtemp(path.join(os.tmpdir(), 'any2skills-judge-scope-'))
    const bookDir = path.join(DIR, 'sources', 'ai-agent-book-zh', 'book')
    await mkdir(bookDir, { recursive: true })
    await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
  })

  after(async () => {
    if (DIR) await rm(DIR, { recursive: true, force: true })
  })

  it('首次生产跑：第 2 层与判定者都启用，两者用量分别可读', async () => {
    counters = { producer: 0, judge: 0 }
    const producer = makeProducerChat({ producer: [], judge: [] })
    const judge = makeJudgeChat({ producer: [], judge: [] })

    const out = await runPipeline({
      source: SOURCE_REL,
      repoRoot: DIR,
      layer2: 'deepseek',
      env: fakeConfigEnv(),
      chatImpl: async (...a) => (counters.producer += 1, producer(...a)),
      judgeChatImpl: async (...a) => (counters.judge += 1, judge(...a)),
      maxAttempts: 1,
    })
    assert.equal(out.receipt.judge.enabled, true)
    assert.ok(counters.judge > 0)
    assert.equal(counters.producer, counters.judge / 2, '第 2 层每锚点一次，判定者每对象一次')
  })

  it('重判路径**默认不启用**判定者，且回执写明门禁只完成一半', async () => {
    await demoteReceipt('default')
    counters = { producer: 0, judge: 0 }
    const out = await runPipeline({
      source: SOURCE_REL,
      repoRoot: DIR,
      layer2: 'deepseek',
      rerun: false,
      env: fakeConfigEnv(),
      chatImpl: async () => assert.fail('重判不得调用第 2 层'),
      judgeChatImpl: async () => assert.fail('重判默认不得调用判定者'),
      maxAttempts: 1,
    })
    assert.equal(out.receipt.judge.enabled, false)
    assert.match(out.receipt.judge.reason, /重判路径/)
    assert.match(out.receipt.verificationGate, /deterministic-only/)
  })

  it('传 --judge：只重扫判定者，**不重跑第 2 层**', async () => {
    // 这条能力的存在理由：卡 05 本身就是一次判据升级（新增了一组判据）。
    // 若重判永远用不上判定者，「升级判据后对着同一批对象重判」就永远缺一半，
    // 只能靠 --rerun 连第 2 层一起重跑，白花一遍提取的钱。
    await demoteReceipt('judge')
    let judgeCalls = 0
    const out = await runPipeline({
      source: SOURCE_REL,
      repoRoot: DIR,
      layer2: 'deepseek',
      rerun: false,
      judge: true,
      env: fakeConfigEnv(),
      chatImpl: async () => assert.fail('--judge 只重扫判定者，不得重跑第 2 层'),
      judgeChatImpl: async (...a) => (judgeCalls += 1, makeJudgeChat({ producer: [], judge: [] })(...a)),
      maxAttempts: 1,
    })
    assert.ok(judgeCalls > 0, '判定者必须真的被调用')
    assert.equal(out.receipt.judge.enabled, true)
    assert.match(out.receipt.verificationGate, /gate-1-full/)
    // 第 2 层的用量沿用产出者的实测值——重扫判定者不该把「提取花了多少次调用」改写成 0。
    assert.ok(out.receipt.model.calls > 0, '第 2 层用量应沿用产出者的实测值，而不是 0')
  })

  it('--no-judge 在正常生产跑上也生效，且理由如实写明', async () => {
    const out = await runPipeline({
      source: SOURCE_REL,
      repoRoot: DIR,
      layer2: 'deepseek',
      rerun: true,
      noJudge: true,
      env: fakeConfigEnv(),
      chatImpl: makeProducerChat({ producer: [], judge: [] }),
      judgeChatImpl: async () => assert.fail('--no-judge 时判定者不得被调用'),
      maxAttempts: 1,
    })
    assert.equal(out.receipt.judge.enabled, false)
    assert.match(out.receipt.judge.reason, /--no-judge/)
    assert.match(out.receipt.verificationGate, /deterministic-only/)
  })

  it('注入第 2 层传输却未注入判定者传输 → 判定者关闭，**绝不偷偷走真网**', async () => {
    // 实测踩到过：本卡接线后，卡 04 的测试第一次跑就冲到了 DNS 解析才暴露——
    // 它注入了 chatImpl（声明「这次不碰真网」），判定者却静默回落到真实 chatCompletion。
    // 从一次本应离线的运行里发出真实计费请求，是比测试失败严重得多的后果。
    const out = await runPipeline({
      source: SOURCE_REL,
      repoRoot: DIR,
      layer2: 'deepseek',
      rerun: true,
      env: fakeConfigEnv(),
      chatImpl: makeProducerChat({ producer: [], judge: [] }),
      // 故意不传 judgeChatImpl
      maxAttempts: 1,
    })
    assert.equal(out.receipt.judge.enabled, false)
    assert.match(out.receipt.judge.reason, /judgeChatImpl/)
  })

  it('一份**没扫过判定者**的回执不得挡住后来的 --judge（实测踩到的第二个缺陷）', async () => {
    // 缺陷经过：回放判据此前只看「版本 + 对象」，于是 `--judge` 被静默吞掉——
    // 一份只跑了确定性判据的回执被原样返回，用户拿到「33 通过」而他要的判定者从未运行。
    // 显式指令被吞掉比报错更糟：它看起来成功了。
    const seq = await mkdtemp(path.join(os.tmpdir(), 'any2skills-judge-replay-'))
    // 捕获 stderr：本用例要断言的是「覆盖这件事被说出来了」，而不仅仅是被覆盖了。
    const capturedStderr = []
    const originalStderr = process.stderr.write
    process.stderr.write = (chunk, ...rest) => {
      capturedStderr.push(String(chunk))
      return originalStderr.call(process.stderr, chunk, ...rest)
    }
    try {
      const bookDir = path.join(seq, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))

      // 第一次：正常生产跑，但显式关掉判定者 → 留下一份 deterministic-only 的现行回执
      const first = await runPipeline({
        source: SOURCE_REL,
        repoRoot: seq,
        layer2: 'deepseek',
        rerun: true,
        noJudge: true,
        env: fakeConfigEnv(),
        chatImpl: makeProducerChat({ producer: [], judge: [] }),
        maxAttempts: 1,
      })
      assert.match(first.receipt.verificationGate, /deterministic-only/)

      // 第二次：同一批对象、同一版本，只传 --judge。**不得回放**那份没扫过判定者的回执。
      let judgeCalls = 0
      const second = await runPipeline({
        source: SOURCE_REL,
        repoRoot: seq,
        layer2: 'deepseek',
        judge: true,
        env: fakeConfigEnv(),
        chatImpl: async () => assert.fail('--judge 不得重跑第 2 层'),
        judgeChatImpl: async (...a) => (judgeCalls += 1, makeJudgeChat({ producer: [], judge: [] })(...a)),
        maxAttempts: 1,
      })
      assert.ok(judgeCalls > 0, '--judge 必须真的调用判定者，而不是回放旧回执')
      assert.equal(second.reused, undefined, '本次不得走回放路径')
      assert.equal(second.receipt.judge.enabled, true)
      assert.match(second.receipt.verificationGate, /gate-1-full/)

      // 门禁完成度进 runId（ADR-014）→ 两份回执**各有其名、并存**。
      // 要求两份并存而不是覆盖：它们记的 counts 不同（确定性-only 判它通过的，全覆盖可能判不通过），
      // 各自代表「同一批对象在两组判据下的结论」，不是同一个结论的两种写法。
      const registryDir = path.join(seq, 'pipeline', 'registry')
      const receipts = (await readdir(registryDir)).filter((f) => f.endsWith('.receipt.json'))
      assert.equal(receipts.length, 2, '两份门禁不同的回执必须并存')
      const gates = await Promise.all(
        receipts.map(async (f) => JSON.parse(await readFile(path.join(registryDir, f), 'utf8')).verificationGate),
      )
      assert.equal(gates.filter((g) => /gate-1-full/.test(g)).length, 1, '应恰有一份 full')
      assert.equal(
        gates.filter((g) => /deterministic-only/.test(g)).length,
        1,
        '应恰有一份 deterministic-only',
      )
      assert.match(capturedStderr.join(''), /两份并存/, '并存这件事应当被说出来')
    } finally {
      process.stderr.write = originalStderr
      await rm(seq, { recursive: true, force: true })
    }
  })

  it('门禁完成度一致时仍然回放（本次改动不得把整条回放路径废掉）', async () => {
    const out = await runPipeline({
      source: SOURCE_REL,
      repoRoot: DIR,
      layer2: 'deepseek',
      env: fakeConfigEnv(),
      chatImpl: async () => assert.fail('回放路径不得调用第 2 层'),
      judgeChatImpl: async () => assert.fail('回放路径不得调用判定者'),
      maxAttempts: 1,
    })
    assert.equal(out.reused, true, '同一版本、同一对象、同完成度 → 应回放既有回执')
  })
})
