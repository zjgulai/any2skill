/**
 * ticket 07 的验收测试：单整章批量提取
 *
 * 整份文件**不发出任何真实模型调用、不读凭据、不访问网络**：第 2 层走注入的 chat 替身，
 * 判定者因「注入传输但未注入判定者传输」而被显式关闭（回执会写明门禁只完成一半）。
 *
 * 本卡的核心不是「一个章节能跑完」——那在卡 04 就成立了。核心是三条**缝隙**：
 *
 *   1. **调用了、但没有产出**。原验收测的是「有没有对该锚点发出调用」，而真实失效模式
 *      是调用了却返回空。它从缝隙里穿过去，且流水线对此零信号（见 `coverage` 的注释）。
 *   2. **零产出信号只在部分路径上存在**。复用路径与重判路径的 `perAnchor` 是空数组，
 *      那是「回头查这批对象」时最常走的两条路。判据落在「对象 × 索引」上才修得掉。
 *   3. **超预算锚点没有切分**。切法必须落在结构边界上，且**不得**被第 3 层看见——
 *      切分是喂给模型的窗口，不是对象出处的口径。
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import { EXIT, PIPELINE_VERSION, runPipeline } from '../../run.mjs'
import { OBJECT_TYPES, verifyObjects } from '../../tools/verifier.mjs'
import { parseAnchorToken } from '../../tools/object-contract.mjs'
import {
  DEFAULT_MAX_ANCHOR_BYTES,
  extractAnchor,
  promptFingerprint,
  splitAnchorIntoSlices,
} from '../../tools/layer2-extractor.mjs'
import { createUsageLedger } from '../../tools/llm-client.mjs'

const REPO = DEFAULT_REPO_ROOT
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'
const SOURCE_ABS = path.join(REPO, SOURCE_REL)

let IDX

before(async () => {
  IDX = await buildAnchorIndex(SOURCE_ABS, { repoRoot: REPO })
})

// ---------------------------------------------------------------------------
// 注入的 chat 替身（与 layer2-real.test.mjs 同口径：按请求里的正文现算引文）
// ---------------------------------------------------------------------------

const calls = { chat: 0 }

const fakeConfigEnv = () => ({
  ANY2SKILLS_LLM_API_KEY: 'sk-test-not-real',
  ANY2SKILLS_LLM_MODEL: 'test-model',
  ANY2SKILLS_LLM_BASE_URL: 'https://api.example.invalid',
  ANY2SKILLS_LLM_PROVIDER: 'test',
})

/** 解析注入请求：拿到锚点、锚点行号区间、切片信息与本片正文。 */
function parseRequest(user) {
  const anchor = /锚点：(\S+?)（第 (\d+)–(\d+) 行/.exec(user)
  assert.ok(anchor, '用户提示词必须带锚点定位')
  const slice = /切片：第 (\d+) 片，共 (\d+) 片/.exec(user)
  assert.ok(slice, '用户提示词必须写明切片位置（整节时是 1/1）')
  const body = /\n---\n([\s\S]*)\n---\n?$/.exec(user)?.[1]
  assert.ok(typeof body === 'string' && body.length > 0, '用户提示词必须带正文')
  const quote = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'))
  return {
    anchor: anchor[1],
    lineStart: Number(anchor[2]),
    lineEnd: Number(anchor[3]),
    sliceIndex: Number(slice[1]) - 1,
    sliceCount: Number(slice[2]),
    body,
    quote,
  }
}

const concept = (quote, canonicalTerm = '工具描述') => ({
  objectType: 'Concept',
  evidenceQuote: quote,
  canonicalTerm,
  aliases: [],
  definition: '…',
  examples: ['…'],
})

/**
 * 可编排的替身。
 * @param {Function} recordsFor `(req) => records[]`，缺省每个调用产出一个 Concept。
 */
function makeChatImpl(recordsFor = (req) => [concept(req.quote)], { inputTokens = 10, outputTokens = 5, failOn = null } = {}) {
  return async (config, { user, ledger }) => {
    calls.chat += 1
    if (failOn !== null && calls.chat === failOn) throw new Error(`注入的中断（第 ${failOn} 次调用）`)
    if (ledger) {
      ledger.calls += 1
      ledger.tokens.input += inputTokens
      ledger.tokens.output += outputTokens
    }
    const req = parseRequest(user)
    return {
      text: JSON.stringify({ objects: recordsFor(req) }),
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
      calls: 1,
    }
  }
}

/** 建一个隔离仓库：只有内容源，没有历史产物。 */
async function makeRepo({ sourceRel = SOURCE_REL, sourceAbs = SOURCE_ABS } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-ch07-'))
  const dest = path.join(root, sourceRel)
  await mkdir(path.dirname(dest), { recursive: true })
  await copyFile(sourceAbs, dest)
  return root
}

const runReal = async ({ repoRoot, ...rest }) =>
  runPipeline({
    source: SOURCE_REL,
    repoRoot,
    layer2: 'deepseek',
    env: fakeConfigEnv(),
    chatImpl: makeChatImpl(),
    maxAttempts: 1,
    ...rest,
  })

// ---------------------------------------------------------------------------
// 切分：只切在结构边界上
// ---------------------------------------------------------------------------

/** 用给定的行数组造一个锚点条目（lineStart/lineEnd 为 1-based 闭区间）。 */
const anchorOf = (lines) => ({
  anchor: 'fake#h2-1',
  file: 'sources/ai-agent-book-zh/book/fake.md',
  level: 2,
  title: '测试小节',
  lineStart: 1,
  lineEnd: lines.length,
  contentHash: 'sha256:test',
  contentBytes: Buffer.byteLength(lines.join('\n'), 'utf8'),
})

describe('07 · 切分只落在结构边界上（不按字节硬切，不切进代码围栏）', () => {
  it('未超预算 → 恰好一片，且区间与锚点逐字相同', () => {
    const lines = ['## 小节', '', '一段话。', '', '另一段话。']
    const slices = splitAnchorIntoSlices(anchorOf(lines), lines, { maxAnchorBytes: 1000 })
    assert.equal(slices.length, 1)
    assert.equal(slices[0].sliceCount, 1)
    assert.equal(slices[0].lineStart, 1)
    assert.equal(slices[0].lineEnd, lines.length)
    assert.equal(slices[0].oversized, false)
  })

  it('超预算 → 每一片都结束在空行上，且每片（除超大单段外）都不超预算', () => {
    // 每段 4 行、段间空行；预算刚好放得下两段左右。
    const para = (i) => [`第 ${i} 段第一行，填充到足够长以撑起字节数。`, `第 ${i} 段第二行。`, `第 ${i} 段第三行。`, `第 ${i} 段第四行。`]
    const lines = ['## 小节']
    for (let i = 1; i <= 6; i += 1) lines.push('', ...para(i))
    const budget = Buffer.byteLength(['', ...para(1), '', ...para(2)].join('\n'), 'utf8') + 10

    const slices = splitAnchorIntoSlices(anchorOf(lines), lines, { maxAnchorBytes: budget })
    assert.ok(slices.length > 1, `应当切分，实际 ${slices.length} 片`)

    // 每一片都覆盖到空行（片尾那一行必须是空行），第一片从锚点首行开始，末片到锚点末行结束。
    assert.equal(slices[0].lineStart, 1)
    assert.equal(slices[slices.length - 1].lineEnd, lines.length)
    for (let i = 0; i < slices.length - 1; i += 1) {
      assert.equal(lines[slices[i].lineEnd - 1].trim(), '', `第 ${i} 片的片尾不是空行`)
      assert.equal(slices[i + 1].lineStart, slices[i].lineEnd + 1, '片与片之间不得有空隙或重叠')
    }
    for (const s of slices) assert.equal(s.oversized, false, `不应有超大单段：${JSON.stringify(s)}`)
    // 片数下界：内容总量 / 预算 向上取整（保证没被浪费成一小片一小片）
    const total = Buffer.byteLength(lines.join('\n'), 'utf8')
    assert.ok(slices.length <= Math.ceil(total / budget) + 1, '切分不应显著多于下界的片数')
  })

  it('代码围栏内的空行**不作**切点——一个代码块不得被劈成两半', () => {
    const code = ['```text', '第一行代码', '', '``` 这不是闭栏', '', '最后一行代码', '```']
    const para = (i) => [`第 ${i} 段。`]
    const lines = ['## 小节', '', ...para(1), '', ...code, '', ...para(2)]
    const fenceStart = lines.indexOf('```text') + 1
    const fenceEnd = lines.lastIndexOf('```') + 1

    // 预算小到必须切分，但不能切在围栏内
    const slices = splitAnchorIntoSlices(anchorOf(lines), lines, { maxAnchorBytes: 40 })
    assert.ok(slices.length > 1)
    const containsFenceStart = slices.findIndex((s) => s.lineStart <= fenceStart && fenceStart <= s.lineEnd)
    const containsFenceEnd = slices.findIndex((s) => s.lineStart <= fenceEnd && fenceEnd <= s.lineEnd)
    assert.equal(containsFenceStart, containsFenceEnd, '围栏的开栏与闭栏必须在同一片里')
  })

  it('单个段落自身超预算 → 整段交出并标 oversized，**不硬切**', () => {
    const huge = `超长单段：${'填充'.repeat(200)}`
    const lines = ['## 小节', '', '短段落一。', '', huge, '', '短段落二。']
    const slices = splitAnchorIntoSlices(anchorOf(lines), lines, { maxAnchorBytes: 200 })
    const oversized = slices.filter((s) => s.oversized)
    assert.equal(oversized.length, 1, '必须且只能有一个超大单段')
    // 超大那片必须**完整包含**那一行，且没有被从中间截断
    const s = oversized[0]
    const body = lines.slice(s.lineStart - 1, s.lineEnd).join('\n')
    assert.ok(body.includes(huge), '超大段落必须整段交出，不得截断')
  })

  it('切分的行号是**全文绝对行号**，且与锚点区间同口径', () => {
    const lines = [
      '# 前言',
      '无关内容。',
      '',
      '## 小节',
      '第一段内容。'.repeat(3),
      '',
      '第二段内容。'.repeat(3),
    ]
    const entry = {
      ...anchorOf(lines),
      lineStart: 4,
      lineEnd: 7,
      contentBytes: Buffer.byteLength(lines.slice(3).join('\n'), 'utf8'),
    }
    // 预算取「首段放得下、整节放不下」之间：首段 64 字节，整节 119 字节。
    const slices = splitAnchorIntoSlices(entry, lines, { maxAnchorBytes: 70 })
    assert.equal(slices.length, 2)
    assert.equal(slices[0].lineStart, 4, '首片必须从锚点首行（第 4 行）开始，而不是第 1 行')
    assert.equal(slices[1].lineStart, 7, '第二片必须接着上片的片尾，不得从文件第 1 行重新数')
    assert.equal(slices[slices.length - 1].lineEnd, 7)
    for (const s of slices) {
      assert.ok(s.lineStart >= 4 && s.lineEnd <= 7, `切片越出锚点区间：${JSON.stringify(s)}`)
    }
  })
})

// ---------------------------------------------------------------------------
// 整章覆盖 + 零产出锚点
// ---------------------------------------------------------------------------

describe('07 · 整章覆盖：没有整节被静默跳过', () => {
  let root
  after(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('chapter4 整章跑完：已处理锚点数 = 索引锚点数，9 个二级锚点全部有产出', async () => {
    root = await makeRepo()
    calls.chat = 0
    const { receipt } = await runReal({ repoRoot: root })

    // ① 机械断言：处理数 = 索引数（这一条挡的是「整章只跑了一部分却声称跑完」）
    assert.equal(receipt.coverage.indexAnchors, IDX.anchorCount)
    assert.equal(
      receipt.layer2.perAnchor.length,
      IDX.anchorCount,
      `已处理锚点数必须等于索引锚点数（${receipt.layer2.perAnchor.length} vs ${IDX.anchorCount}）`,
    )
    assert.equal(receipt.counts.anchors, IDX.anchorCount, '回执的锚点数来自索引，不是来自产出')

    // ② 9 个二级锚点逐个核对：它们不在这份回执的「零产出」清单里
    const h2 = IDX.anchors.filter((a) => a.level === 2).map((a) => a.anchor)
    assert.equal(h2.length, 9, `chapter4 应有 9 个二级锚点，实际 ${h2.length}`)
    assert.deepEqual(receipt.coverage.withoutObjects.anchors, [], '本章不应有零产出锚点')
    const covered = new Set(
      receipt.layer2.perAnchor.filter((a) => a.objectCount > 0).map((a) => a.anchor),
    )
    for (const a of h2) assert.ok(covered.has(a), `二级锚点 ${a} 未被覆盖到`)

    // ③ 覆盖数三个字段彼此自洽
    assert.equal(receipt.coverage.coveredAnchors + receipt.coverage.withoutObjects.count, IDX.anchorCount)
    assert.deepEqual(receipt.coverage.unresolvedReferenceAnchors, [])
  })

  it('「被处理但产出 0 个对象」的锚点出现在回执的**固定字段**里，不用翻 perAnchor', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      // 复现 ticket 07 记录的真实失效模式：`chapter4#h2-8`（本章小结）某几次运行里直接为空。
      const { receipt } = await runReal({
        repoRoot: isolated,
        chatImpl: makeChatImpl((req) => (req.anchor === 'chapter4#h2-8' ? [] : [concept(req.quote)])),
      })

      assert.equal(receipt.coverage.withoutObjects.count, 1)
      assert.deepEqual(receipt.coverage.withoutObjects.anchors, ['chapter4#h2-8'])
      assert.equal(receipt.coverage.coveredAnchors, IDX.anchorCount - 1)
      assert.equal(receipt.coverage.perLevel.h2.without, 1, '按层级也要能看出漏在哪一层')
      // 「被处理」不是猜的：本次真的为每个锚点发过调用，因此这个字段有值且等于索引锚点数
      assert.equal(receipt.coverage.processedKnown, true)
      assert.equal(receipt.coverage.processedAnchors, IDX.anchorCount)
      assert.match(receipt.coverage.reading, /被处理但产出 0 个对象/)

      // 该锚点**确实被调用过**（这是「被处理但产出 0」而不是「没处理」的关键区别）
      const entry = receipt.layer2.perAnchor.find((a) => a.anchor === 'chapter4#h2-8')
      assert.ok(entry, '零产出锚点仍必须出现在逐锚点明细里')
      assert.equal(entry.objectCount, 0)
      assert.deepEqual(entry.objectIds, [])
      // 它也确实发出过调用（用量的逐锚点明细里数得到）
      assert.equal(receipt.layer2.usage.byAnchor.find((a) => a.anchor === 'chapter4#h2-8').calls, 1)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('替身路径：「被处理」取不到时明说取不到，不把「没被指向」写成「被处理但零产出」', async () => {
    const isolated = await makeRepo()
    try {
      // 替身路径不按锚点调用（零凭据、零网络），因此 processedAnchors 必须为 null、processedKnown 为 false
      const stub = await runPipeline({ source: SOURCE_REL, repoRoot: isolated })
      assert.equal(stub.receipt.coverage.processedKnown, false)
      assert.equal(stub.receipt.coverage.processedAnchors, null)
      assert.match(stub.receipt.coverage.reading, /无法区分/)
      assert.equal(stub.receipt.coverage.coveredAnchors, IDX.anchorCount, '替身每锚点一个对象')
      assert.equal(stub.receipt.layer2.usage.byAnchorNote !== null, true, '用量为 0 必须说明是「没有调用」')
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('该数字在**复用路径**上同样存在（实测该路径的 perAnchor 曾是空数组，等于信号整体消失）', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      await runReal({
        repoRoot: isolated,
        chatImpl: makeChatImpl((req) => (req.anchor === 'chapter4#h2-8' ? [] : [concept(req.quote)])),
      })
      const firstCalls = calls.chat
      assert.ok(firstCalls > 0)

      // 第二次：不传 --rerun → 复用冻结产物，零调用
      calls.chat = 0
      const replay = await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        layer2: 'deepseek',
        env: fakeConfigEnv(),
      })
      assert.equal(calls.chat, 0, '复用路径不得发出任何调用')
      assert.equal(replay.reused, true)
      assert.ok(replay.receipt.coverage, '复用路径的回执必须同样带 coverage')
      assert.equal(replay.receipt.coverage.withoutObjects.count, 1)
      assert.deepEqual(replay.receipt.coverage.withoutObjects.anchors, ['chapter4#h2-8'])
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('该数字在**重判路径**上同样存在（该路径此前把 perAnchor 丢成空数组）', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      await runReal({
        repoRoot: isolated,
        chatImpl: makeChatImpl((req) => (req.anchor === 'chapter4#h2-8' ? [] : [concept(req.quote)])),
      })

      // 伪造「判据升级」：把回执改名 + 版本号改小，使本次运行找不到同版本回执而走重判。
      const registryDir = path.join(isolated, 'pipeline', 'registry')
      const files = (await readdir(registryDir)).filter((f) => f.endsWith('.receipt.json'))
      assert.equal(files.length, 1)
      const producerPath = path.join(registryDir, files[0])
      const producer = JSON.parse(await readFile(producerPath, 'utf8'))
      producer.pipelineVersion = 1
      await writeFile(path.join(registryDir, 'run-legacyv1.receipt.json'), JSON.stringify(producer, null, 2), 'utf8')
      await rm(producerPath, { force: true })

      calls.chat = 0
      const out = await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        layer2: 'deepseek',
        env: fakeConfigEnv(),
        chatImpl: makeChatImpl(),
        maxAttempts: 1,
      })
      assert.equal(calls.chat, 0, '重判不得发出任何模型调用')
      assert.equal(out.receipt.pipelineVersion, PIPELINE_VERSION)
      assert.ok(out.receipt.coverage, '重判路径的回执必须带 coverage')
      assert.equal(out.receipt.coverage.withoutObjects.count, 1)
      assert.deepEqual(out.receipt.coverage.withoutObjects.anchors, ['chapter4#h2-8'])
      // 逐锚点明细也必须活着（此前重判把它丢成 []）
      assert.equal(out.receipt.layer2.perAnchor.length, IDX.anchorCount)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 类型分布 + 按章用量
// ---------------------------------------------------------------------------

describe('07 · 类型分布与按章用量写进回执', () => {
  it('类型分布：九类全给（含 0），且合计等于对象总数', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      // 让不同类型的锚点产出不同的类型，以证明这一栏真的按产出统计
      const types = ['Concept', 'Heuristic', 'EngineeringRule']
      let n = 0
      const { receipt } = await runReal({
        repoRoot: isolated,
        chatImpl: makeChatImpl((req) => {
          const t = types[n % types.length]
          n += 1
          return [typeRecord(t, req.quote)]
        }),
      })

      const dist = receipt.counts.objectTypes
      assert.deepEqual(
        Object.keys(dist).sort(),
        [...OBJECT_TYPES].sort(),
        '九种类型必须全部出现——缺一个键与「这一类产出为 0」是两条不同的信息',
      )
      const sum = Object.values(dist).reduce((a, b) => a + b, 0)
      assert.equal(sum, receipt.counts.objects, '类型分布合计必须等于对象总数')
      assert.ok(dist.Concept > 0 && dist.Heuristic > 0 && dist.EngineeringRule > 0)
      assert.equal(dist.Playbook, 0, '没产出过的类型也要给 0，不能缺席')
      // 九种类型都出现过 → 覆盖到九类
      assert.equal(Object.keys(dist).length, 9)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('第 2 层用量按章可统计：逐锚点求和 = 总量 = 客户端账本（对账为真）', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      const { receipt } = await runReal({ repoRoot: isolated })

      const u = receipt.layer2.usage
      assert.equal(u.byAnchor.length, IDX.anchorCount)
      const sumCalls = u.byAnchor.reduce((n, a) => n + a.calls, 0)
      const sumIn = u.byAnchor.reduce((n, a) => n + (a.tokens?.input ?? 0), 0)
      const sumOut = u.byAnchor.reduce((n, a) => n + (a.tokens?.output ?? 0), 0)

      assert.equal(u.calls, sumCalls, '逐锚点调用数求和必须等于总量')
      assert.deepEqual(u.tokens, { input: sumIn, output: sumOut })
      assert.equal(u.calls, calls.chat)
      assert.equal(u.calls, receipt.model.calls)
      assert.deepEqual(u.tokens, receipt.model.tokens)
      assert.deepEqual(u.anchorsWithoutUsage, [])
      assert.equal(u.reconciliation.matches, true, '无重试时应能对上账')
      assert.equal(u.reconciliation.ledgerSuccessfulCalls, receipt.model.calls - receipt.model.failedCalls)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 切分不得破坏溯源
// ---------------------------------------------------------------------------

describe('07 · 切分不破坏溯源：对象仍解析到第 1 层的父锚点', () => {
  it('小预算触发切分后，每个对象仍带父锚点的区间与内容哈希，且全部通过第 3 层', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      const { receipt, exitCode } = await runReal({ repoRoot: isolated, maxAnchorBytes: 2000 })

      // 确实切了
      assert.ok(receipt.layer2.splits.length > 0, '2000 字节预算下必有锚点被切分')
      const splitAnchors = new Set(receipt.layer2.splits.map((s) => s.anchor))
      for (const s of receipt.layer2.splits) {
        assert.equal(s.slices.length, s.sliceCount)
        assert.equal(s.slices[0].lineStart, IDX.anchors.find((a) => a.anchor === s.anchor).lineStart)
        assert.equal(s.slices[s.slices.length - 1].lineEnd, IDX.anchors.find((a) => a.anchor === s.anchor).lineEnd)
      }

      // 切片的出处**必须**仍是父锚点：逐条与索引比对
      const objects = JSON.parse(
        await readFile(path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8'),
      )
      const byAnchor = new Map(IDX.anchors.map((a) => [a.anchor, a]))
      let fromSplitAnchors = 0
      for (const o of objects) {
        assert.equal(o.sourceRefs.length, 1, `对象 ${o.id} 应只有一条出处`)
        const ref = o.sourceRefs[0]
        const entry = byAnchor.get(ref.anchor)
        assert.ok(entry, `对象 ${o.id} 的出处 ${ref.anchor} 不在索引里`)
        assert.equal(ref.contentHash, entry.contentHash, `对象 ${o.id} 的内容哈希与父锚点不符`)
        assert.equal(ref.lineStart, entry.lineStart, `对象 ${o.id} 的区间起点必须仍是父锚点的起点`)
        assert.equal(ref.lineEnd, entry.lineEnd, `对象 ${o.id} 的区间终点必须仍是父锚点的终点`)
        if (splitAnchors.has(ref.anchor)) fromSplitAnchors += 1
      }
      assert.ok(fromSplitAnchors > 0, '应当有对象来自被切分的锚点')

      // 第 3 层独立复跑一遍：全部通过（含出处判据与引文判据）
      const verification = await verifyObjects(objects, IDX, { repoRoot: isolated })
      assert.equal(verification.summary.rejected, 0, JSON.stringify(verification.summary.byReasonCode))
      assert.equal(verification.summary.passed, objects.length)
      assert.equal(exitCode, EXIT.PASS)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('模型确实被告知自己在看第几片（不是被静默喂了半节）', () => {
    const seen = []
    const impl = makeChatImpl((req) => {
      seen.push(req)
      return [concept(req.quote)]
    })
    return (async () => {
      const isolated = await makeRepo()
      try {
        await runReal({ repoRoot: isolated, maxAnchorBytes: 2000, chatImpl: impl })
        assert.ok(seen.length > IDX.anchorCount, '切分后调用次数应多于锚点数')
        assert.ok(seen.every((r) => Number.isInteger(r.sliceIndex) && r.sliceCount >= 1))
        const split = seen.filter((r) => r.sliceCount > 1)
        assert.ok(split.length > 0)
        assert.ok(split.some((r) => r.sliceIndex > 0), '应当有非首片的调用')
        assert.ok(seen.some((r) => r.sliceCount === 1), '未被切分的锚点仍应声明 1/1')
      } finally {
        await rm(isolated, { recursive: true, force: true })
      }
    })()
  })

  it('对象 id 与切法无关：同一锚点的同一个序号 → 同一 id', async () => {
    const a = await makeRepo()
    const b = await makeRepo()
    try {
      calls.chat = 0
      const whole = await runReal({ repoRoot: a })
      calls.chat = 0
      const sliced = await runReal({ repoRoot: b, maxAnchorBytes: 2000 })

      const read = async (root) =>
        JSON.parse(await readFile(path.join(root, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8'))
      const firstOf = (objs) => {
        const m = new Map()
        for (const o of objs) {
          const anchor = o.sourceRefs[0].anchor
          if (!m.has(anchor)) m.set(anchor, o.id)
        }
        return m
      }
      const wholeFirst = firstOf(await read(a))
      const slicedFirst = firstOf(await read(b))
      assert.equal(wholeFirst.size, IDX.anchorCount)
      for (const [anchor, id] of wholeFirst) {
        assert.equal(slicedFirst.get(anchor), id, `锚点 ${anchor} 的首个对象 id 随切法变了`)
      }
      // 且该 id 确实是「锚点 + 类型 + 该锚点内序号」的形式
      for (const [anchor, id] of wholeFirst) {
        const { level, ordinal } = parseAnchorToken(anchor)
        const seg = `CHAPTER4-H${level}-${ordinal}`
        assert.ok(id.startsWith(`${seg}-`), `${id} 应以 ${seg}- 开头`)
        assert.ok(/-0[1-9]$/.test(id), `${id} 应以两位序号结尾`)
      }
    } finally {
      await rm(a, { recursive: true, force: true })
      await rm(b, { recursive: true, force: true })
    }
  })

  it('同一配置连跑两次（--rerun）→ id 集合逐字相同', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      const first = await runReal({ repoRoot: isolated })
      calls.chat = 0
      const second = await runReal({ repoRoot: isolated, rerun: true })
      const ids = (r) => r.receipt.objectVerdicts.map((v) => v.objectId).sort()
      assert.deepEqual(ids(second), ids(first), '同一锚点 + 同一序号必须产出同一 id')
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 增量落盘与断点续跑
// ---------------------------------------------------------------------------

describe('07 · 中间产物可增量落盘，中断后重跑复用而不重算', () => {
  it('中断重跑：不重复产出既有对象，只跑剩下的锚点', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      const failAt = 6
      await assert.rejects(
        runReal({ repoRoot: isolated, chatImpl: makeChatImpl(undefined, { failOn: failAt }) }),
        /注入的中断/,
      )
      const afterCrash = calls.chat
      assert.equal(afterCrash, failAt)

      // 半成品必须留在盘上（否则已付费的产出就白丢了）
      const partialObjects = path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.partial.json')
      const partialRaw = path.join(isolated, 'pipeline', 'registry', 'chapter4.layer2-raw.partial.json')
      const crashed = JSON.parse(await readFile(partialObjects, 'utf8'))
      const crashedRaw = JSON.parse(await readFile(partialRaw, 'utf8'))
      assert.equal(crashedRaw.status, 'partial')
      assert.equal(crashedRaw.completedAnchors, failAt - 1, '崩在第 6 次调用前 → 已收尾 5 个锚点')
      assert.equal(crashed.length, failAt - 1)

      // 续跑
      calls.chat = 0
      const { receipt } = await runReal({ repoRoot: isolated })
      assert.equal(calls.chat, IDX.anchorCount - (failAt - 1), '续跑只应跑剩下的锚点')
      assert.equal(receipt.layer2.resumedFrom.completedAnchorsBefore, failAt - 1)

      // 关键断言：**没有重复产出**——id 既不重复，总数也正好是「每锚点一个对象」
      const objects = JSON.parse(
        await readFile(path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8'),
      )
      const ids = objects.map((o) => o.id)
      assert.equal(new Set(ids).size, ids.length, `出现了重复的 id：${ids.filter((x, i) => ids.indexOf(x) !== i)}`)
      assert.equal(ids.length, IDX.anchorCount)
      assert.equal(receipt.counts.objects, IDX.anchorCount)

      // 跑完后不得残留半成品
      const leftovers = (await readdir(path.join(isolated, 'pipeline', 'knowledge'))).filter((f) =>
        f.endsWith('.partial.json'),
      )
      assert.deepEqual(leftovers, [])
      assert.equal(receipt.coverage.coveredAnchors, IDX.anchorCount)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('停在**片中间**：续跑只补剩下的片，不重跑已付费的片', async () => {
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      const budget = 2500
      // 找到「第一个会被切成 ≥2 片的锚点」在整章里的第几次调用，崩在它的**第二片**上。
      const lines = (await readFile(SOURCE_ABS, 'utf8')).split(/\r\n|\n|\r/).map((l) => l.replace(/[ \t]+$/, ''))
      const idx = await buildAnchorIndex(SOURCE_ABS, { repoRoot: REPO })
      let callNo = 0
      let target = null
      for (const a of idx.anchors) {
        const slices = splitAnchorIntoSlices(a, lines, { maxAnchorBytes: budget })
        if (slices.length >= 2) {
          target = { anchor: a.anchor, sliceCount: slices.length, firstSliceCall: callNo + 1 }
          callNo += 1 // 崩在第二片 → 第一片完成后就中断
          break
        }
        callNo += 1
      }
      assert.ok(target, '应当存在会被切分的锚点')

      const failAt = target.firstSliceCall + 1
      await assert.rejects(
        runReal({ repoRoot: isolated, maxAnchorBytes: budget, chatImpl: makeChatImpl(undefined, { failOn: failAt }) }),
        /注入的中断/,
      )

      const raw = JSON.parse(
        await readFile(path.join(isolated, 'pipeline', 'registry', 'chapter4.layer2-raw.partial.json'), 'utf8'),
      )
      assert.deepEqual(
        raw.inFlight,
        { anchor: target.anchor, slicesDone: 1, sliceCount: target.sliceCount },
        '半成品必须记下「哪个锚点跑到第几片」',
      )
      assert.equal(raw.completedAnchors, target.firstSliceCall - 1)
      assert.equal(raw.maxAnchorBytes, budget, '预算必须写进半成品：片数是源文 + 预算的函数')

      // 续跑：该锚点只剩 sliceCount - 1 片要跑，而不是整节重来。
      // 期望值必须按**片数**算，不能按锚点数算——目标之后的每个锚点自己也可能是切分的。
      const slicesPer = idx.anchors.map((a) => splitAnchorIntoSlices(a, lines, { maxAnchorBytes: budget }).length)
      const targetPos = idx.anchors.findIndex((a) => a.anchor === target.anchor)
      const expectedRemaining =
        slicesPer.slice(targetPos + 1).reduce((n, v) => n + v, 0) + (slicesPer[targetPos] - 1)

      calls.chat = 0
      const { receipt } = await runReal({ repoRoot: isolated, maxAnchorBytes: budget })
      assert.equal(
        calls.chat,
        expectedRemaining,
        '续跑必须从第 2 片接着跑：既不把该锚点整节重跑，也不重跑已完成的锚点',
      )
      // 逐项说明这个数是怎么来的（供读测试的人复核，而不是只信一个等号）：
      //   expectedRemaining = 目标之后各锚点的片数之和 + 目标锚点剩下的 (sliceCount − 1) 片
      //   = 整章总片数 − 崩掉那次已经完成的调用数
      assert.equal(expectedRemaining, slicesPer.reduce((n, v) => n + v, 0) - target.firstSliceCall)
      assert.equal(receipt.layer2.resumedFrom.inFlightBefore.slicesDone, 1)
      // 该锚点在最终产出里恰好多出一片的对象数，且 id 不重复
      const objects = JSON.parse(
        await readFile(path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8'),
      )
      const ids = objects.map((o) => o.id)
      assert.equal(new Set(ids).size, ids.length, '续跑不得重复产出既有对象')
      const perAnchorCount = ids.filter((id) => id.startsWith(target.anchor.replace('#', '-').toUpperCase() + '-')).length
      assert.equal(perAnchorCount, target.sliceCount, '被切分的锚点应有「每片一个对象」')
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('半成品是空数组/被截断时不被当成进度（宁可重跑，不可续错）', async () => {
    const isolated = await makeRepo()
    try {
      const knowledge = path.join(isolated, 'pipeline', 'knowledge')
      const registry = path.join(isolated, 'pipeline', 'registry')
      await mkdir(knowledge, { recursive: true })
      await mkdir(registry, { recursive: true })

      // 造一个「inFlight 指向的不是下一个锚点」的半成品
      await writeFile(path.join(knowledge, 'chapter4.objects.partial.json'), '[]', 'utf8')
      await writeFile(
        path.join(registry, 'chapter4.layer2-raw.partial.json'),
        JSON.stringify({
          sourceHash: (await buildAnchorIndex(SOURCE_ABS, { repoRoot: REPO })).sourceHash,
          completedAnchors: 0,
          totalAnchors: IDX.anchorCount,
          usageSoFar: { calls: 0, tokens: { input: 0, output: 0 } },
          inFlight: { anchor: 'chapter4#h2-9', slicesDone: 1, sliceCount: 1 },
          anchors: [],
        }),
        'utf8',
      )

      calls.chat = 0
      const { receipt } = await runReal({ repoRoot: isolated })
      assert.equal(receipt.layer2.resumedFrom, null, 'inFlight 指向的不是下一个锚点 → 必须丢弃半成品')
      assert.equal(calls.chat, IDX.anchorCount, '丢弃半成品就要从头跑完整章')
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// 预算与提示词指纹
// ---------------------------------------------------------------------------

describe('07 · 预算是显式旋钮，且缺省不切分', () => {
  it('缺省预算下 chapter4 的 20 个锚点一片都不切', async () => {
    const lines = (await readFile(SOURCE_ABS, 'utf8')).split(/\r\n|\n|\r/).map((l) => l.replace(/[ \t]+$/, ''))
    for (const a of IDX.anchors) {
      assert.ok(a.contentBytes <= DEFAULT_MAX_ANCHOR_BYTES, `${a.anchor} 超过缺省预算`)
      assert.equal(splitAnchorIntoSlices(a, lines, { maxAnchorBytes: DEFAULT_MAX_ANCHOR_BYTES }).length, 1)
    }
    const isolated = await makeRepo()
    try {
      calls.chat = 0
      const { receipt } = await runReal({ repoRoot: isolated })
      assert.deepEqual(receipt.layer2.splits, [], '缺省下 splits 必须是空数组（这本身就是一条可核对的结论）')
      assert.equal(calls.chat, IDX.anchorCount)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('提示词指纹覆盖两种形态：切分形态变了，指纹必须变', () => {
    const fp = promptFingerprint({})
    assert.match(fp, /^prompt-[0-9a-f]{12}$/)
    assert.equal(fp, promptFingerprint({}), '同参数必须稳定')
    assert.notEqual(fp, promptFingerprint({ maxObjectsPerAnchor: 3 }), '参数变了指纹必须变')
  })
})

// ---------------------------------------------------------------------------
// 第 2 层单元级：片内序号跨片累计
// ---------------------------------------------------------------------------

describe('07 · 片内序号跨片累计，因此 id 不因切法漂移', () => {
  it('同一锚点切成 N 片时，序号是跨片的连续计数', async () => {
    const isolated = await makeRepo()
    try {
      const lines = (await readFile(path.join(isolated, SOURCE_REL), 'utf8'))
        .split(/\r\n|\n|\r/)
        .map((l) => l.replace(/[ \t]+$/, ''))
      const idx = await buildAnchorIndex(path.join(isolated, SOURCE_REL), { repoRoot: isolated })
      // 找一个会被切分的锚点
      const entry = idx.anchors.find((a) => splitAnchorIntoSlices(a, lines, { maxAnchorBytes: 2500 }).length >= 2)
      assert.ok(entry)

      const chat = makeChatImpl((req) => [concept(req.quote, `术语${req.sliceIndex}`)])
      const outcome = await extractAnchor({
        config: { modelId: 'm', baseUrl: 'https://x.invalid', apiKey: 'k' },
        anchorEntry: entry,
        sourceFile: idx.sourceFile,
        lines,
        chat,
        ledger: createUsageLedger(),
        createdAt: '2026-01-01T00:00:00.000Z',
        maxAnchorBytes: 2500,
      })

      assert.ok(outcome.sliceCount >= 2)
      assert.equal(outcome.objects.length, outcome.sliceCount, '每片一个对象')
      const seqs = outcome.objects.map((o) => Number(o.id.slice(-2)))
      assert.deepEqual(seqs, Array.from({ length: outcome.sliceCount }, (_, i) => i + 1), '序号必须跨片连续')
      // 出处仍然是父锚点
      for (const o of outcome.objects) {
        assert.equal(o.sourceRefs[0].anchor, entry.anchor)
        assert.equal(o.sourceRefs[0].contentHash, entry.contentHash)
      }
      // 逐片用量求和 = 总用量；调用数 = 片数
      assert.equal(outcome.usageTotals.calls, outcome.sliceCount)
      assert.equal(outcome.usageTotals.tokens.input, 10 * outcome.sliceCount)
      assert.equal(outcome.usageTotals.tokens.output, 5 * outcome.sliceCount)
      // 多片时 rawText 不拼接（一次调用的原文不能被拼成一个字符串）
      assert.equal(outcome.rawText, null)
      assert.equal(outcome.sliceRecords.length, outcome.sliceCount)
      assert.ok(outcome.sliceRecords.every((s) => typeof s.rawText === 'string' && s.rawText.length > 0))
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

/** 造一条指定类型的合法记录（字段形状必须与 schema 一致，否则会被第 3 层拒）。 */
function typeRecord(type, quote) {
  switch (type) {
    case 'Heuristic':
      return {
        objectType: 'Heuristic',
        evidenceQuote: quote,
        trigger: '当面对一个需要判断的场合时',
        recommendation: '按该准则处理',
        confidence: 0.6,
        exceptions: [],
      }
    case 'EngineeringRule':
      return {
        objectType: 'EngineeringRule',
        evidenceQuote: quote,
        statement: '必须满足该条件',
        rationale: '否则会失败',
        appliesWhen: '在受控条件下',
        violation: '违反时不可复现',
      }
    default:
      return concept(quote)
  }
}
