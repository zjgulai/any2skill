/**
 * ticket 03 的验收测试：单对象端到端编译（贯穿第 1/2/3 层的示踪弹）
 *
 * 测外部行为：命令的输入、落盘产物、回执内容、退出码。不断言内部函数结构。
 *
 * 第 2 层由确定性替身驱动，整卡**不发出任何真实模型调用**——这也是本文件能在离线环境跑通的前提。
 * 端到端用例跑真实语料（chapter4.md），因此「引文逐字命中」这条主力判据是在真数据上被执行的。
 *
 * 隔离说明：本文件的端到端用例在仓库自己的临时根（`--repo-root`）下运行，因此**不会**
 * 触碰仓库真实的 pipeline/knowledge 与 pipeline/registry，也不会破坏 ticket 01 已落盘的锚点索引。
 */

import { describe, it, before, beforeEach, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, readFile, readdir, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import { EXIT, PIPELINE_VERSION, computeRunId } from '../../run.mjs'
import { extractQuote, normalizeLines, typeForAnchor } from '../../tools/model-stub.mjs'
import { assertJudgeInputShape, FORBIDDEN_JUDGE_CONTEXT_KEYS } from '../../tools/verifier.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = DEFAULT_REPO_ROOT
const CLI = path.join(REPO, 'pipeline', 'run.mjs')
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'
const SOURCE_ABS = path.join(REPO, SOURCE_REL)
const REJECT_FIXTURE_ABS = path.join(HERE, 'fixtures', 'reject-cases.json')
// 夹具用**绝对路径**传入：测试的仓库根是临时目录，相对路径会落在临时根下。
const REJECT_FIXTURE = REJECT_FIXTURE_ABS

const OBJECTS_REL = 'pipeline/knowledge/chapter4.objects.json'
const ANCHORS_REL = 'pipeline/knowledge/chapter4.anchors.json'
const KNOWLEDGE_REL = 'pipeline/knowledge'
const REGISTRY_REL = 'pipeline/registry'

/**
 * 临时仓库根：把用到的源文件**复制**进去（不用符号链接）。
 *
 * 为什么必须复制而不是软链：第 1 层的路径守卫会 realpath 解析输入，软链会被还原成真实路径、
 * 从而落在临时根之外而被守卫正确拒绝（实测踩到过）。复制使源文件物理位于临时根内，
 * 所有写入也就都被关在临时根里，不会触碰仓库真实的 pipeline/ 平面。
 */
let TMP
before(async () => {
  TMP = await mkdtemp(path.join(os.tmpdir(), 'any2skills-tracer-'))
  const bookDir = path.join(TMP, 'sources', 'ai-agent-book-zh', 'book')
  await mkdir(bookDir, { recursive: true })
  await copyFile(SOURCE_ABS, path.join(bookDir, path.basename(SOURCE_ABS)))
})
after(async () => {
  if (TMP) await rm(TMP, { recursive: true, force: true })
})

const runCli = (args) =>
  spawnSync(process.execPath, [CLI, '--repo-root', TMP, ...args], { cwd: REPO, encoding: 'utf8' })

const readJson = async (rel) => JSON.parse(await readFile(path.join(TMP, rel), 'utf8'))
/** 读仓库内的文件（夹具在仓库里，不在临时根下）。 */
const readRepoJson = async (abs) => JSON.parse(await readFile(abs, 'utf8'))

const clearOutputs = async () => {
  await rm(path.join(TMP, KNOWLEDGE_REL), { recursive: true, force: true })
  await rm(path.join(TMP, REGISTRY_REL), { recursive: true, force: true })
}

/** 回执文件名由 runId 决定；本测试用它证明「同一输入 → 同一文件名」。 */
const receiptFiles = async () =>
  (await readdir(path.join(TMP, REGISTRY_REL)).catch(() => []))
    .filter((f) => f.endsWith('.receipt.json'))
    .sort()

const onlyReceipt = async () => {
  const files = await receiptFiles()
  assert.equal(files.length, 1, `回执目录应有恰好 1 份回执，实际：${files.join(', ') || '空'}`)
  return readJson(path.join(REGISTRY_REL, files[0]))
}

describe('03 · 端到端：一条命令跑完三层', () => {
  before(clearOutputs)
  after(clearOutputs)

  it('全部对象通过时退出码为 0，且对象与回执齐备', async () => {
    const r = runCli([SOURCE_REL])
    assert.equal(r.status, EXIT.PASS, `退出码应为 ${EXIT.PASS}，实测 ${r.status}；stderr=${r.stderr}`)

    const objects = await readJson(OBJECTS_REL)
    assert.ok(Array.isArray(objects) && objects.length > 0, '对象文件应非空')

    const receipt = await onlyReceipt()
    assert.equal(receipt.counts.rejected, 0)
    assert.equal(receipt.counts.passed, receipt.counts.objects)
    assert.equal(receipt.counts.objects, objects.length, '回执计数应与对象文件实际条数一致')
  })

  it('每条对象都强制携带 sourceRefs，且引文在源文件里逐字命中', async () => {
    const objects = await readJson(OBJECTS_REL)
    const sourceLines = normalizeLines(await readFile(SOURCE_ABS, 'utf8'))

    for (const o of objects) {
      assert.ok(Array.isArray(o.sourceRefs) && o.sourceRefs.length > 0, `${o.id} 缺 sourceRefs`)
      const ref = o.sourceRefs[0]
      const region = sourceLines.slice(ref.lineStart - 1, ref.lineEnd).join('\n')
      assert.ok(
        region.includes(o.evidenceQuote),
        `${o.id} 的引文不在其声明区间内逐字命中：${JSON.stringify(o.evidenceQuote.slice(0, 40))}`,
      )
    }
  })

  it('落盘产物集合恰为「对象平面 + 回执平面」，没有第三个平面', async () => {
    const receipt = await onlyReceipt()
    const knowledge = (await readdir(path.join(TMP, KNOWLEDGE_REL))).sort()
    const registry = (await readdir(path.join(TMP, REGISTRY_REL))).sort()

    assert.deepEqual(
      knowledge,
      [path.basename(ANCHORS_REL), path.basename(OBJECTS_REL)].sort(),
      '知识对象平面应只含锚点索引与对象文件',
    )
    assert.equal(registry.length, 1)
    assert.equal(registry[0], `${receipt.runId}.receipt.json`, '回执文件名应与 runId 一致')

    assert.ok(await stat(path.join(TMP, receipt.artifacts.anchors.path)))
    assert.ok(await stat(path.join(TMP, receipt.artifacts.objects.path)))

    // 本命令不得写 skills/ 与 benchmark/（平面隔离，ADR-002 / 规格 D9）
    for (const forbidden of ['skills', 'benchmark']) {
      assert.deepEqual(
        await readdir(path.join(TMP, forbidden)).catch(() => []),
        [],
        `本命令不应写入 ${forbidden}/`,
      )
    }
  })

  it('回执给出逐对象判定明细、运行标识、源文件哈希与三段计数', async () => {
    const receipt = await onlyReceipt()
    assert.match(receipt.runId, /^run-[0-9a-f]{12}$/)
    assert.match(receipt.source.hash, /^sha256:[0-9a-f]{64}$/)
    assert.equal(receipt.source.path, SOURCE_REL)
    assert.equal(receipt.artifacts.anchors.anchorCount, receipt.counts.anchors)
    assert.equal(receipt.artifacts.objects.objectCount, receipt.counts.objects)
    assert.equal(receipt.objectVerdicts.length, receipt.counts.objects)
    for (const v of receipt.objectVerdicts) {
      assert.ok(['pass', 'reject'].includes(v.status))
      if (v.status === 'pass') assert.equal(v.reasonCode, null)
      else assert.ok(v.reasonCode, '被拒对象必须给出理由码')
    }
  })

  it('回执声明「本次未调用任何真实模型」且调用数与 token 均为 0', async () => {
    const receipt = await onlyReceipt()
    assert.equal(receipt.model.provider, 'stub')
    assert.equal(receipt.model.calls, 0)
    assert.deepEqual(receipt.model.tokens, { input: 0, output: 0 })
    assert.match(receipt.model.billing, /未发出任何真实模型调用/)
  })

  it('回执体量可控：不复制对象正文（一行引文都不进回执）', async () => {
    const receipt = await onlyReceipt()
    const body = await readFile(path.join(TMP, REGISTRY_REL, `${receipt.runId}.receipt.json`), 'utf8')
    const objects = await readJson(OBJECTS_REL)
    for (const o of objects) {
      assert.ok(!body.includes(o.evidenceQuote), `回执里复制了对象正文（${o.id} 的引文）`)
    }
    assert.ok(body.length < 200_000, `回执过大：${body.length} 字节`)
  })

  it('同一输入重跑两次：对象文件逐字节相同、回执文件名与内容（除 createdAt）相同', async () => {
    const before_ = await readFile(path.join(TMP, OBJECTS_REL), 'utf8')
    const beforeReceipt = await onlyReceipt()
    const beforeFiles = await receiptFiles()

    const r = runCli([SOURCE_REL])
    assert.equal(r.status, EXIT.PASS)

    const after_ = await readFile(path.join(TMP, OBJECTS_REL), 'utf8')
    assert.equal(after_, before_, '对象文件必须逐字节可复现')

    const afterFiles = await receiptFiles()
    assert.deepEqual(afterFiles, beforeFiles, '同一输入必须落到同一个回执文件名（runId 确定性）')

    const afterReceipt = await readJson(path.join(REGISTRY_REL, afterFiles[0]))
    const strip = (o) => JSON.stringify({ ...o, createdAt: null })
    assert.equal(strip(afterReceipt), strip(beforeReceipt), '回执（除 createdAt 外）必须可复现')
  })

  it('对象 id 由「锚点标识 + 对象序号」确定性生成：重跑不产生新 id', async () => {
    const objects = await readJson(OBJECTS_REL)
    const ids = objects.map((o) => o.id)
    assert.equal(new Set(ids).size, ids.length, 'id 必须唯一')
    for (const o of objects) {
      const anchor = o.sourceRefs[0].anchor
      const expectedPrefix = anchor.replace('#', '-').toUpperCase()
      assert.ok(
        o.id.startsWith(`${expectedPrefix}-`),
        `${o.id} 的 id 未由锚点标识 ${anchor} 确定性推导而来`,
      )
      assert.match(o.id, /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/)
    }
  })

  it('runId 可由源哈希 + 第 2 层实现 + 对象集合复算出来（不是随机数）', async () => {
    const receipt = await onlyReceipt()
    const objects = await readJson(OBJECTS_REL)
    const recomputed = computeRunId({
      sourceHash: receipt.source.hash,
      modelId: receipt.model.modelId,
      objects,
    })
    assert.equal(receipt.runId, recomputed)
    assert.equal(receipt.pipelineVersion, PIPELINE_VERSION)
  })

  it('锚点索引在流水线重跑后仍与第 1 层独立运行的结果一致（第 1 层未被第 2/3 层影响）', async () => {
    const onDisk = await readJson(ANCHORS_REL)
    const fresh = await buildAnchorIndex(SOURCE_ABS, { repoRoot: REPO })
    assert.equal(onDisk.sourceHash, fresh.sourceHash)
    assert.deepEqual(onDisk.anchors, fresh.anchors)
  })
})

describe('03 · 退出码二分类：内容问题与工程问题可区分', () => {
  // 逐用例清空：本套件**故意**在同一个临时根下产出多个不同的 runId（拒绝运行 / 失败运行），
  // 若只在套件开始时清一次，第二个用例就会看到上一个用例的回执，`onlyReceipt` 的「恰好一份」
  // 断言随之失真（实测踩到过）。其他套件全部产出同一个 runId，故不需要逐用例清。
  beforeEach(clearOutputs)
  after(clearOutputs)

  it('有对象被拒 → 退出码 3（区别于运行失败）', async () => {
    const r = runCli([SOURCE_REL, '--objects-fixture', REJECT_FIXTURE])
    assert.equal(r.status, EXIT.OBJECT_REJECTED, `stderr=${r.stderr}`)

    const receipt = await onlyReceipt()
    assert.ok(receipt.counts.rejected > 0)
    assert.equal(receipt.contentProblems, receipt.counts.rejected)
    assert.equal(receipt.engineeringFailure, null, '有对象被拒不是工程问题，两者不得混记')
  })

  it('源文件不存在 → 退出码 4，且回执里记为工程问题、不污染内容计数', async () => {
    const r = runCli(['sources/ai-agent-book-zh/book/does-not-exist.md'])
    assert.equal(r.status, EXIT.RUN_FAILED)
    assert.match(r.stderr, /运行失败/)

    const receipt = await onlyReceipt()
    assert.ok(receipt.engineeringFailure, '运行失败必须落盘为可查的证据')
    assert.equal(receipt.engineeringFailure.kind, 'source-missing')
    assert.equal(receipt.counts.rejected, 0)
    assert.equal(receipt.contentProblems, 0)
  })

  it('锚点索引产不出（源文件无任何标题行）→ 退出码 4，而不是「有对象被拒」', async () => {
    await mkdir(path.join(TMP, 'sources', 'ai-agent-book-zh', 'book'), { recursive: true })
    await writeFile(
      path.join(TMP, 'sources', 'ai-agent-book-zh', 'book', 'no-headings.md'),
      '这是一段没有任何标题行的正文。\n',
      'utf8',
    )
    const r = runCli(['sources/ai-agent-book-zh/book/no-headings.md'])
    assert.equal(r.status, EXIT.RUN_FAILED)
    assert.match(r.stderr, /运行失败/)
  })

  it('第 2 层调用失败 → 退出码 4（夹具的锚点既不在索引内又不给 file 时，替身拒绝产出）', async () => {
    const badFixture = path.join(TMP, 'bad-fixture.json')
    await writeFile(
      badFixture,
      JSON.stringify({ objects: [{ id: 'X-Y-CONCEPT-01', sourceRefs: [{ anchor: 'nope#h9-9' }] }] }),
      'utf8',
    )
    const r = runCli([SOURCE_REL, '--objects-fixture', badFixture])
    assert.equal(r.status, EXIT.RUN_FAILED)
    assert.match(r.stderr, /运行失败（layer2-model-stub）/)
  })

  it('两类非零码不相等（否则 CI 无法区分「抽得不好」与「脚本坏了」）', () => {
    assert.notEqual(EXIT.OBJECT_REJECTED, EXIT.RUN_FAILED)
    assert.notEqual(EXIT.PASS, EXIT.OBJECT_REJECTED)
  })

  it('路径守卫拒绝基准目录：污染隔离以退出码 4 报错，不静默放行', () => {
    const r = runCli(['benchmark/anything.md'])
    assert.equal(r.status, EXIT.RUN_FAILED)
    // 命中基准目录守卫的**专属**诊断，而不是笼统的「不在 sources/ 之内」：
    // 两者的修复动作不同（前者是污染隔离被破坏，后者是路径写错），不得混为一句。
    assert.match(r.stderr, /拒绝读取盲测基准目录/)
  })
})

describe('03 · 注入拒绝：每个确定性判据各有一个坏对象', () => {
  let receipt

  before(clearOutputs)
  before(async () => {
    const r = runCli([SOURCE_REL, '--objects-fixture', REJECT_FIXTURE])
    assert.equal(r.status, EXIT.OBJECT_REJECTED, `stderr=${r.stderr}`)
    receipt = await onlyReceipt()
  })
  after(clearOutputs)

  it('夹具 8 项 → 0 项通过、8 项被拒；按理由码统计的总数与被拒条数复算一致', async () => {
    const fixture = await readRepoJson(REJECT_FIXTURE)
    assert.equal(fixture.objects.length, 8)
    assert.equal(receipt.counts.objects, 8)
    // 夹具的每一项都按设计带缺陷（见夹具内逐项 comment），故通过数为 0。
    // 这里不是「顺带」钉住的：`byCode` 只统计**主理由码**，因此
    // Σ(byCode) === rejected 是一条结构不变式——它同时证明「每个被拒对象恰归一类」。
    assert.equal(receipt.counts.passed, 0)
    assert.equal(receipt.counts.rejected, 8)
    assert.equal(
      Object.values(receipt.reasonCodes.byCode).reduce((a, b) => a + b, 0),
      receipt.counts.rejected,
      '按理由码统计的总数必须等于被拒条数',
    )
  })

  it('六类确定性理由码各有测试钉住其归类', () => {
    assert.deepEqual(receipt.reasonCodes.byCode, {
      REFERENCE_MISSING: 2,
      IDENTIFIER_INVALID: 1,
      SOURCE_VERSION_DRIFT: 1,
      SCHEMA_INVALID: 1,
      REFERENCE_UNRESOLVED: 1,
      QUOTE_MISSING: 1,
      QUOTE_MISMATCH: 1,
    })
  })

  it('引文不逐字命中 → 被拒且理由码为 QUOTE_MISMATCH', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H2-2-QUOTEMISMATCH-CONCEPT-01')
    assert.equal(v.status, 'reject')
    assert.equal(v.reasonCode, 'QUOTE_MISMATCH')
    assert.deepEqual(v.failures.map((f) => f.code), ['QUOTE_MISMATCH'])
  })

  it('缺 sourceRefs → 被拒，且理由码为 REFERENCE_MISSING（无豁免）', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H2-2-REFMISSING-CONCEPT-01')
    assert.equal(v.status, 'reject')
    assert.equal(v.reasonCode, 'REFERENCE_MISSING')
  })

  it('锚点解析不到 → 理由码为 REFERENCE_UNRESOLVED', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H9-9-UNRESOLVED-CONCEPT-01')
    assert.equal(v.status, 'reject')
    assert.deepEqual(v.failures.map((f) => f.code), ['REFERENCE_UNRESOLVED', 'SCHEMA_INVALID'])
  })

  it('锚点内容哈希与索引不一致 → 理由码为 SOURCE_VERSION_DRIFT（与其他类互不混淆）', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H2-2-DRIFT-CONCEPT-01')
    assert.equal(v.reasonCode, 'SOURCE_VERSION_DRIFT')
    assert.deepEqual(v.failures.map((f) => f.code), ['SOURCE_VERSION_DRIFT'])
  })

  it('未携带引文 → 理由码为 QUOTE_MISSING，与「引文不命中」分开归类', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H2-2-QUOTEMISSING-CONCEPT-01')
    assert.equal(v.reasonCode, 'QUOTE_MISSING')
    assert.deepEqual(v.failures.map((f) => f.code), ['QUOTE_MISSING'])
  })

  it('id 不合正则 → 理由码为 IDENTIFIER_INVALID', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'bad-id')
    assert.equal(v.reasonCode, 'IDENTIFIER_INVALID')
  })

  it('对象类型不在封闭集合内 → 理由码为 SCHEMA_INVALID', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H2-2-BADTYPE-CONCEPT-01')
    assert.equal(v.reasonCode, 'SCHEMA_INVALID')
    assert.deepEqual(v.failures.map((f) => f.code), ['SCHEMA_INVALID'])
  })

  it('同一对象同时违反多条时只归一类：主理由码取优先级更高者，全部命中项仍留档', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H2-2-BOTH-CONCEPT-01')
    assert.equal(v.reasonCode, 'REFERENCE_MISSING', '缺 sourceRefs 的优先级高于引文不命中')
    // 三条命中项都留档：该夹具对象的 objectType 是未定义类型，因此还额外命中
    // 「类型不在封闭集合内」——留档而不影响主码，正是本用例要证明的分离。
    assert.deepEqual(v.failures.map((f) => f.code), ['REFERENCE_MISSING', 'SCHEMA_INVALID', 'QUOTE_MISMATCH'])
  })

  it('被拒对象也保留其比对所用的锚点区间，便于判断「对象错」还是「锚点错」', () => {
    const v = receipt.objectVerdicts.find((x) => x.objectId === 'H2-2-DRIFT-CONCEPT-01')
    assert.ok(v.checkedAgainst, '回执应给出逐字比对所用的锚点区间')
    assert.equal(v.checkedAgainst.anchor, 'chapter4#h2-2')
  })

  it('每条拒绝都带理由码，且理由码取值落在封闭词表内', () => {
    for (const v of receipt.objectVerdicts.filter((x) => x.status === 'reject')) {
      assert.ok(v.reasonCode, `${v.objectId} 缺理由码`)
      assert.ok(receipt.reasonCodes.vocabulary.includes(v.reasonCode), `词表外理由码：${v.reasonCode}`)
    }
  })
})

describe('03 · 第 3 层是独立阶段：不接收生产者上下文', () => {
  it('判定者的入参里出现生产者上下文字段即报错（隔离写进代码而非约定）', () => {
    // ⚠️ 本节断言由 ticket 05 修订。原文如此：卡 03 断言的是**桩**——
    //    `judge(base).verdict === 'not-implemented'`，以及 `judge()` 拒绝生产者上下文字段。
    //    卡 05 把桩换成了真实判定者，`judge()` 这个接口不复存在，因此：
    //      - 「不接收生产者上下文」这条**保留**，改为断言其现行载体 `assertJudgeInputShape`；
    //      - `not-implemented` 这条**删除**（它断言的是「还没做」，卡 05 做完后它必然为假）。
    //    删掉一条断言不等于放宽要求：卡 05 另建了更严的白名单守卫与三条实测隔离证明，
    //    见 `judge-isolation.test.mjs`。
    const base = { claim: { definition: '主张' }, quote: '引文', anchorText: '锚点正文' }
    assert.equal(assertJudgeInputShape(base), base, '合法的三键输入应原样通过')

    for (const forbidden of FORBIDDEN_JUDGE_CONTEXT_KEYS) {
      assert.throws(
        () => assertJudgeInputShape({ ...base, [forbidden]: 'x' }),
        /判定者输入含生产者上下文字段/,
        `未拦住 ${forbidden}`,
      )
    }
  })

  it('判定者输入的守卫是白名单：任何第三个键之外的键都报错，缺键也报错', () => {
    // 黑名单只能拦住我们**想得到**的泄漏。将来给对象加一个字段、或把整个对象塞进某处，
    // 黑名单不会响——白名单才会。这条断言钉的正是「视野不得被静默扩大」。
    const base = { claim: {}, quote: 'q', anchorText: 'a' }
    assert.throws(
      () => assertJudgeInputShape({ ...base, producerHint: 'x' }),
      /允许集合之外的键/,
      '白名单外的键必须报错（黑名单拦不住未知字段）',
    )
    assert.throws(
      () => assertJudgeInputShape({ ...base, disclaimer: 'x' }),
      /允许集合之外的键/,
    )
    for (const k of ['claim', 'quote', 'anchorText']) {
      const short = { ...base }
      delete short[k]
      assert.throws(() => assertJudgeInputShape(short), /缺少必需的键/, `缺 ${k} 时应报错`)
    }
  })

  it('第 3 层入口的签名只接受「对象 + 第 1 层产物」，没有可传生产者上下文的位置', async () => {
    const src = await readFile(path.join(REPO, 'pipeline', 'tools', 'verifier.mjs'), 'utf8')
    const signature = /export async function verifyObjects\(([\s\S]*?)\)\s*\{/.exec(src)
    assert.ok(signature, '未找到 verifyObjects 的签名')
    assert.match(signature[1], /objects/)
    assert.match(signature[1], /index/)
    for (const forbidden of FORBIDDEN_JUDGE_CONTEXT_KEYS) {
      assert.ok(!signature[1].includes(forbidden), `verifyObjects 签名里出现了 ${forbidden}`)
    }
  })

  it('第 3 层模块不含任何 LLM 调用、网络访问或随机性', async () => {
    const src = await readFile(path.join(REPO, 'pipeline', 'tools', 'verifier.mjs'), 'utf8')
    for (const pattern of ['fetch(', 'http.request', 'node:http', 'node:https', 'Math.random', 'Date.now']) {
      assert.ok(!src.includes(pattern), `第 3 层不应出现 ${pattern}`)
    }
  })

  it('判定者的**调用实现**不进本模块：它是注入进来的，不是 import 进来的', async () => {
    // ticket 05 补强。仅断言「源码里没有 fetch(」是不够的——只要有人写一行
    // `import { judgeObject } from './judge.mjs'`，本模块就重新获得了网络能力，
    // 而上面那条断言**照样通过**。这条断言堵的正是那个缺口：确定性判据可脱离 LLM 复跑
    // 必须是一个文件级的性质，而不是一句注释。
    //
    // 必须先剥注释：verifier.mjs 的注释里**确实**提到 `judgeObject`（用来解释为什么
    // 它不 import 它）。直接对全文做正则会把说明文字误判成代码——这正是
    // 「说明性文字不得破坏可审计性」那条纪律在测试里的同形问题。
    const raw = await readFile(path.join(REPO, 'pipeline', 'tools', 'verifier.mjs'), 'utf8')
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1')

    const bindings = [...code.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)]
    const allBindings = bindings.map((m) => m[1]).join(' ')
    const allFroms = bindings.map((m) => m[2]).join(' ')

    assert.ok(!/\bjudgeObject\b/.test(allBindings), 'verifier.mjs 不得 import 判定者的调用实现')
    assert.ok(!/\bchatCompletion\b/.test(allBindings), 'verifier.mjs 不得 import 聊天客户端')
    assert.ok(!/llm-client/.test(allFroms), 'verifier.mjs 不得 import 任何模型客户端模块')
    assert.match(raw, /opts\.judgeFn/, '判定者应由 opts.judgeFn 注入')
  })

  it('回执如实记录判定者本次**未**运行及其原因，不假装已通过', async () => {
    const r = runCli([SOURCE_REL])
    assert.equal(r.status, EXIT.PASS)
    const receipt = await onlyReceipt()
    // 替身路径下判定者必然关闭（零凭据零网络），且回执必须写明原因，而不是留一个空字段。
    assert.equal(receipt.judge.implemented, true, '卡 05 之后判定者已实现')
    assert.equal(receipt.judge.enabled, false)
    assert.match(receipt.judge.reason, /替身/)
    // 「通过」的含义随门禁完成度而变——这一条必须落在回执里，不能只写在注释里。
    assert.match(receipt.verificationGate, /deterministic-only/)
    assert.match(receipt.judge.note, /只代表过了确定性判据/)
  })
})

describe('03 · 第 2 层替身：确定性与「引文必为原文子串」', () => {
  it('extractQuote 的产出必然是锚点区间文本的子串（含超长行被截断的情形）', async () => {
    const index = await buildAnchorIndex(SOURCE_ABS, { repoRoot: REPO })
    const lines = normalizeLines(await readFile(SOURCE_ABS, 'utf8'))
    let truncated = 0
    for (const a of index.anchors) {
      const q = extractQuote(lines, a.lineStart, a.lineEnd)
      if (q === null) continue
      const region = lines.slice(a.lineStart - 1, a.lineEnd).join('\n')
      assert.ok(region.includes(q), `${a.anchor} 的引文不是原文子串`)
      if ([...q].length === 120) truncated += 1
    }
    assert.ok(truncated > 0, '本题材应存在被截断的长行，否则该分支未被真正执行')
  })

  it('类型映射按锚点层级与序号固定，不含随机性；未定义层级显式报错', () => {
    assert.equal(typeForAnchor(1, 1), 'Concept')
    assert.equal(typeForAnchor(2, 3), 'EngineeringRule')
    assert.equal(typeForAnchor(3, 1), 'Playbook')
    assert.equal(typeForAnchor(3, 2), 'Heuristic')
    assert.equal(typeForAnchor(4, 1), 'Case')
    assert.equal(typeForAnchor(4, 2), 'DecisionModel')
    assert.throws(() => typeForAnchor(5, 1), /未定义类型映射/)
  })

  it('端到端产出的对象覆盖多种类型，且每条都带 sourceRefs 与引文', async () => {
    const r = runCli([SOURCE_REL])
    assert.equal(r.status, EXIT.PASS)
    const objects = await readJson(OBJECTS_REL)
    const types = new Set(objects.map((o) => o.objectType))
    assert.ok(types.size >= 5, `应覆盖多种类型，实际只有：${[...types].join(', ')}`)
    for (const o of objects) {
      assert.ok(o.sourceRefs.length >= 1)
      assert.ok(typeof o.evidenceQuote === 'string' && o.evidenceQuote.length > 0)
    }
  })
})
