/**
 * ticket 09 的验收测试：全书运行与污染隔离
 *
 * 全部离线（第 2 层用确定性替身），整卡**零模型调用、零凭据、零网络**。
 * 端到端用例跑真实语料——13 个源文件、336 个锚点，因此「全书」这件事是在真数据上被执行的，
 * 不是在一个三行夹具上演示的。
 *
 * ## 隔离说明
 *
 * 所有写入都发生在各自的临时仓库根（`--repo-root`）下，仓库真实的 `pipeline/knowledge`
 * 与 `pipeline/registry` **不被触碰**。只读地引用仓库里的源正文（复制进临时根）。
 *
 * ## 这个文件里最要紧的两条
 *
 * 1. **串行与并行必须逐字节等价**（ticket 09 的验收项之一）。它同时钉住了
 *    「并发度不进运行身份」——`bookRunId` 若把并发度算进去，两边的身份就会不同，
 *    而「用身份证明等价」也就随之失效。
 * 2. **仪器必须能失败**。断言「账本里没有基准目录的读」之前，先用一次**真的读了**基准目录的
 *    受控运行证明这个断言会抛错——一个永远不会失败的检查不构成证据（它是方法错误，不是结论）。
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from '../../tools/anchor-index.mjs'
import { EXIT } from '../../run.mjs'
import { CLI_FLAGS } from '../../run.mjs'
import { assertIsolation, loadLedger, mergeLedgers, summarizeLedger } from '../../tools/fs-ledger.mjs'
import { aggregateTotals, collectAntipatterns, computeBookRunId, judgeSummaryLine, parseBookArgs } from '../../run-book.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = DEFAULT_REPO_ROOT
const CLI = path.join(REPO, 'pipeline', 'run-book.mjs')
const LEDGER_PRELOAD = path.join(REPO, 'pipeline', 'tools', 'fs-ledger.cjs')
const BOOK_SRC = path.join(REPO, 'sources', 'ai-agent-book-zh', 'book')
const SOURCE_DIR_REL = path.join('sources', 'ai-agent-book-zh', 'book')

const runCli = (root, args) =>
  spawnSync(process.execPath, [CLI, '--repo-root', root, ...args], { cwd: REPO, encoding: 'utf8' })

/** 一个只含 13 个源文件的临时仓库根。 */
async function makeRoot(tag) {
  const dir = await mkdtemp(path.join(os.tmpdir(), `any2skills-book-${tag}-`))
  const book = path.join(dir, SOURCE_DIR_REL)
  await mkdir(book, { recursive: true })
  for (const f of await bookFiles()) await copyFile(path.join(BOOK_SRC, f), path.join(book, f))
  return dir
}

const bookFiles = async () => (await readdir(BOOK_SRC)).filter((f) => f.endsWith('.md')).sort()
const readJson = async (abs) => JSON.parse(await readFile(abs, 'utf8'))
const bookReceiptOf = async (root) => {
  const reg = path.join(root, 'pipeline', 'registry')
  const names = (await readdir(reg)).filter((f) => f.endsWith('.book-receipt.json'))
  assert.equal(names.length, 1, `应恰好有 1 份聚合回执，实际：${names.join(', ') || '空'}`)
  return readJson(path.join(reg, names[0]))
}

let ROOT_SERIAL
let ROOT_PARALLEL
let RECEIPT_SERIAL
let RECEIPT_PARALLEL

before(async () => {
  ROOT_SERIAL = await makeRoot('serial')
  ROOT_PARALLEL = await makeRoot('parallel')
  const a = runCli(ROOT_SERIAL, ['--layer2', 'stub', '--concurrency', '1'])
  assert.equal(a.status, EXIT.PASS, `串行全书运行应退出 0，实测 ${a.status}；stderr=${a.stderr}`)
  const b = runCli(ROOT_PARALLEL, ['--layer2', 'stub', '--concurrency', '4'])
  assert.equal(b.status, EXIT.PASS, `并行全书运行应退出 0，实测 ${b.status}；stderr=${b.stderr}`)
  RECEIPT_SERIAL = await bookReceiptOf(ROOT_SERIAL)
  RECEIPT_PARALLEL = await bookReceiptOf(ROOT_PARALLEL)
})

after(async () => {
  for (const d of [ROOT_SERIAL, ROOT_PARALLEL]) if (d) await rm(d, { recursive: true, force: true })
})

describe('09 · 全书运行：13 个文件全部处理，一个都不静默跳过', () => {
  it('聚合回执的逐文件行与源目录清单**逐条对齐**', async () => {
    const expected = (await bookFiles()).map((f) => f.replace(/\.md$/, ''))
    assert.deepEqual(
      RECEIPT_SERIAL.files.map((f) => f.fileKey),
      expected,
      '聚合回执的文件清单必须与源目录逐条相同——多一个、少一个、错序都算失败',
    )
    // 「有没有被静默跳过」不能只看条数：条目数与对象数都要落在回执里，且逐文件回执齐备。
    for (const f of RECEIPT_SERIAL.files) {
      assert.ok(f.runId, `${f.fileKey} 没有运行标识（等于没跑）`)
      assert.equal(f.noReceipt, false, `${f.fileKey} 没有回执`)
      assert.ok(f.counts.objects > 0, `${f.fileKey} 产出 0 个对象`)
    }
  })

  it('每个源文件都产出了自己的对象文件（不是把全书写进一个文件）', async () => {
    for (const f of RECEIPT_SERIAL.files) {
      const p = path.join(ROOT_SERIAL, 'pipeline', 'knowledge', `${f.fileKey}.objects.json`)
      const objects = JSON.parse(await readFile(p, 'utf8'))
      assert.ok(Array.isArray(objects) && objects.length === f.counts.objects, `${f.fileKey} 对象文件条数与回执不一致`)
      for (const o of objects) {
        assert.equal(o.sourceRefs[0].anchor.split('#')[0], f.fileKey, `${o.id} 的锚点不属于它所在的文件`)
      }
    }
  })

  it('全书规模口径：13 文件 / 336 锚点（实测值，写死以便语料变化时被测出来）', () => {
    assert.equal(RECEIPT_SERIAL.totals.files, 13)
    assert.equal(RECEIPT_SERIAL.totals.anchors, 336)
    assert.equal(RECEIPT_SERIAL.totals.filesWithoutReceipt, 0)
    assert.equal(RECEIPT_SERIAL.totals.filesFailed, 0)
  })

  it('零产出锚点以**清单**形式给出（不是只给一个数）', async () => {
    for (const f of RECEIPT_SERIAL.files) {
      assert.ok(Array.isArray(f.coverage.withoutObjects.anchors), `${f.fileKey} 缺零产出锚点清单`)
      assert.equal(
        f.coverage.withoutObjects.count,
        f.coverage.withoutObjects.anchors.length,
        `${f.fileKey} 零产出锚点的计数与清单长度不一致`,
      )
    }
    const total = RECEIPT_SERIAL.files.reduce((s, f) => s + f.coverage.withoutObjects.count, 0)
    assert.equal(RECEIPT_SERIAL.totals.anchorsWithoutObjects, total)
  })

  it('聚合计数可从逐文件行**复算**（含理由码总数 = 被拒条数）', () => {
    const sum = (pick) => RECEIPT_SERIAL.files.reduce((s, f) => s + pick(f), 0)
    assert.equal(RECEIPT_SERIAL.totals.objects, sum((f) => f.counts.objects))
    assert.equal(RECEIPT_SERIAL.totals.passed, sum((f) => f.counts.passed))
    assert.equal(RECEIPT_SERIAL.totals.rejected, sum((f) => f.counts.rejected))
    const byCode = {}
    for (const f of RECEIPT_SERIAL.files) for (const [k, v] of Object.entries(f.reasonCodes ?? {})) byCode[k] = (byCode[k] ?? 0) + v
    assert.deepEqual(RECEIPT_SERIAL.totals.reasonCodesByCode, byCode)
    const codeTotal = Object.values(byCode).reduce((a, b) => a + b, 0)
    assert.equal(codeTotal, RECEIPT_SERIAL.totals.rejected, '每个被拒对象恰归一类：理由码总数必须等于被拒条数')
  })
})

describe('09 · 污染隔离：机制在代码里，且可复跑', () => {
  it('13 个子进程的账本齐备（缺一份就判缺，不按「没记录」算过）', () => {
    const iso = RECEIPT_SERIAL.isolation.children
    assert.equal(iso.expectedProcesses, 13)
    assert.equal(iso.ledger.ledgerFiles, iso.expectedProcesses, `子进程账本应有 13 份，实际 ${iso.ledger.ledgerFiles} 份`)
    assert.deepEqual(iso.missing, [])
    assert.equal(iso.complete, true)
  })

  it('基准目录：内容访问 0 条（读 0 / 写 0），且账本里看得见「只问路径」的那几次', () => {
    const bench = RECEIPT_SERIAL.isolation.children.ledger.benchmark
    assert.equal(bench.reads, 0, `不得读取基准目录，实测读了：${bench.paths.join(', ')}`)
    assert.equal(bench.writes, 0, `不得写基准目录，实测写了：${bench.paths.join(', ')}`)
    // 「0 条内容访问」不等于「完全没碰过」：卡 01 的路径守卫必须 realpath 基准目录自己才能
    // 判定「这个输入是否落在里面」。把这件事显式记下来，免得下一个人把 meta 的 0 也当成 0。
    assert.ok(bench.meta > 0, '守卫对基准目录的 realpath 调用应当被记录下来（否则就是仪器没生效）')
    assert.deepEqual(bench.metaOps, ['realpathSync'])
  })

  it('skills/ 全程未被写入；benchmark/ 目录在临时根下根本不存在', async () => {
    assert.deepEqual(RECEIPT_SERIAL.isolation.children.ledger.skillsWrites, [])
    await assert.rejects(() => stat(path.join(ROOT_SERIAL, 'skills')), /ENOENT/)
    await assert.rejects(() => stat(path.join(ROOT_SERIAL, 'benchmark')), /ENOENT/)
  })

  it('隔离检查是**可复跑项**，不是一次性人工目测', () => {
    const r = runCli(ROOT_SERIAL, ['--verify-isolation', `pipeline/registry/${RECEIPT_SERIAL.bookRunId}.book-receipt.json`])
    assert.equal(r.status, EXIT.PASS, `复核应通过，实测 ${r.status}；stderr=${r.stderr}`)
    assert.match(r.stdout, /污染隔离检查通过/)
    // 复核读的是**最终**账本（含编排进程那份，它比回执晚一步落盘），因此数量应比回执里的多一份：
    // 13 个子进程 + 1 个编排进程 = 14 份。断言**锚定完整数字**——`/4 份账本/` 会以子串形式
    // 匹配到「14 份账本」，一个永远不会失败的模式不构成证据。
    assert.match(r.stdout, /：14 份账本/, `应合并 13 个子进程 + 1 个编排进程，实测 stdout=${r.stdout}`)
  })

  it('**仪器能失败**：真去读基准目录时，这个断言必须抛错', async () => {
    // 负向对照。没有它，「零命中」这句话无法与「仪器坏了」区分开。
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-book-neg-'))
    try {
      await mkdir(path.join(root, 'benchmark'), { recursive: true })
      await writeFile(path.join(root, 'benchmark', 'probe.md'), '# 对照物\n', 'utf8')
      const probe = path.join(root, 'probe.mjs')
      await writeFile(probe, `import { readFile, readdir } from 'node:fs/promises'\nawait readdir(new URL('./benchmark/', import.meta.url))\nawait readFile(new URL('./benchmark/probe.md', import.meta.url), 'utf8')\n`, 'utf8')
      const ledgerPath = path.join(root, 'ledger.json')
      const r = spawnSync(process.execPath, ['--require', LEDGER_PRELOAD, probe], {
        env: { ...process.env, DSH_FS_LEDGER: ledgerPath },
        encoding: 'utf8',
      })
      assert.equal(r.status, 0, `受控运行应成功；stderr=${r.stderr}`)
      const merged = mergeLedgers([await loadLedger(ledgerPath)])
      const summary = summarizeLedger(merged, { repoRoot: root })
      assert.equal(summary.benchmark.reads, 2, '应记录到 2 次内容访问（列目录 + 读文件）')
      assert.throws(() => assertIsolation(summary, { label: '负向对照' }), /检测到对盲测基准目录的\*\*内容\*\*访问/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('关掉账本时**拒绝**给出隔离结论：非零退出、回执里写明未验证，复核也失败', async () => {
    const root = await makeRoot('noledger')
    try {
      const r = runCli(root, ['--layer2', 'stub', '--no-ledger'])
      // 退出的**不是**「流水线坏了」，而是「这次运行不构成一次可验收的全书运行」。
      // 报错而非只记一笔的理由与用户手册里的「假绿灯」同源：一条会因为少了审计而变绿的运行，
      // 早晚会被当成通过。
      assert.equal(r.status, EXIT.RUN_FAILED, `--no-ledger 应非零退出；stdout=${r.stdout}`)
      assert.match(r.stderr, /账本\*\*缺席\*\*/)
      // 但证据仍然留着：判定在回执落盘**之后**做，最需要取证的那一次运行不能什么都不留下。
      const receipt = await bookReceiptOf(root)
      assert.equal(receipt.isolation.children.complete, false)
      assert.equal(receipt.isolation.children.ledger.ledgerFiles, 0)
      assert.equal(receipt.files.length, 13, '流水线本身仍然跑完了 13 个文件')
      assert.equal(receipt.exitCode, EXIT.PASS, '对象层面全过——非零退出只由「缺审计」这一条引起')
      const v = runCli(root, ['--verify-isolation', `pipeline/registry/${receipt.bookRunId}.book-receipt.json`])
      assert.equal(v.status, EXIT.RUN_FAILED, '账本缺席时复核必须失败')
      assert.match(v.stderr, /账本\*\*缺席\*\*/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('路径守卫仍然挡在入口（隔离不是只靠事后账本）', async () => {
    const root = await makeRoot('guard')
    try {
      await mkdir(path.join(root, 'benchmark'), { recursive: true })
      await writeFile(path.join(root, 'benchmark', 'probe.md'), '# 对照物\n', 'utf8')
      const r = spawnSync(process.execPath, [path.join(REPO, 'pipeline', 'run.mjs'), 'benchmark/probe.md', '--repo-root', root], {
        cwd: REPO,
        encoding: 'utf8',
      })
      assert.equal(r.status, EXIT.RUN_FAILED)
      assert.match(r.stderr, /拒绝读取盲测基准目录/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('09 · 串行与并行：等价，且并发度不进运行身份', () => {
  it('同一输入下，串行与并行的 bookRunId 相同', () => {
    assert.equal(RECEIPT_SERIAL.bookRunId, RECEIPT_PARALLEL.bookRunId)
    assert.notEqual(RECEIPT_SERIAL.inputs.concurrency, RECEIPT_PARALLEL.inputs.concurrency, '两个根确实用了不同并发度')
  })

  it('逐文件 runId 与对象集**逐字节**相同', async () => {
    const a = RECEIPT_SERIAL.files.map((f) => f.runId).join(',')
    const b = RECEIPT_PARALLEL.files.map((f) => f.runId).join(',')
    assert.equal(a, b, '逐文件运行身份必须一致')
    for (const f of RECEIPT_SERIAL.files) {
      const pa = path.join(ROOT_SERIAL, 'pipeline', 'knowledge', `${f.fileKey}.objects.json`)
      const pb = path.join(ROOT_PARALLEL, 'pipeline', 'knowledge', `${f.fileKey}.objects.json`)
      assert.deepEqual(await readFile(pa), await readFile(pb), `${f.fileKey} 的对象集在两种并发下不同`)
    }
  })

  it('聚合计数逐格相同', () => {
    assert.deepEqual(RECEIPT_SERIAL.totals, RECEIPT_PARALLEL.totals)
  })

  it('同一输入重复运行：身份不变，且旧回执先归档（不静默覆盖）', async () => {
    const before = await bookReceiptOf(ROOT_SERIAL)
    const r = runCli(ROOT_SERIAL, ['--layer2', 'stub', '--concurrency', '2'])
    assert.equal(r.status, EXIT.PASS, r.stderr)
    const after2 = await bookReceiptOf(ROOT_SERIAL)
    assert.equal(after2.bookRunId, before.bookRunId, '同输入必须给出同一个身份')
    const archived = (await readdir(path.join(ROOT_SERIAL, 'pipeline', 'registry', 'history'))).filter((f) => f.endsWith('.json'))
    assert.equal(archived.length, 1, `应归档 1 份旧回执，实际 ${archived.length}`)
    assert.match(archived[0], /book-receipt/)
  })
})

describe('09 · 按文件维度查询与参数透传', () => {
  it('--from 打印全部行；--from --file 只打印那一个文件', async () => {
    const rel = `pipeline/registry/${RECEIPT_SERIAL.bookRunId}.book-receipt.json`
    const all = runCli(ROOT_SERIAL, ['--from', rel])
    assert.equal(all.status, EXIT.PASS, all.stderr)
    assert.equal(all.stdout.split('\n').filter((l) => /^[a-z0-9-]+\s+退出/.test(l)).length, 13)

    const one = runCli(ROOT_SERIAL, ['--from', rel, '--file', 'chapter2'])
    assert.equal(one.status, EXIT.PASS, one.stderr)
    const rows = one.stdout.split('\n').filter((l) => /^[a-z0-9-]+\s+退出/.test(l))
    assert.equal(rows.length, 1)
    assert.match(rows[0], /^chapter2/)

    const bad = runCli(ROOT_SERIAL, ['--from', rel, '--file', 'chapter99'])
    assert.equal(bad.status, EXIT.RUN_FAILED)
    assert.match(bad.stderr, /没有这个文件/)
  })

  it('run.mjs 的**每一个**开关都能原样透传（含取值），未知开关必须报错', () => {
    // 本命令自己消费、因此**不进**透传清单的开关（穷尽清单，与 run-book 的 main 逐条对应）：
    //   --json     本命令自己有一个（回执打到 stdout）；子进程恒以 --json 启动以便解析
    //   --repo-root 本命令自己的仓库根；子进程的仓库根由本命令显式给出
    // 清单之外**不得**再有任何开关被本命令吃掉——吃掉的开关在子进程那份里就等于没生效。
    const CONSUMED_BY_RUN_BOOK = Object.freeze(['--json', '--repo-root'])
    const valueFlag = Object.entries(CLI_FLAGS).find(([, v]) => v.kind === 'value')
    assert.ok(valueFlag, '开关表里应当至少有取值型开关')

    const forwarded = []
    for (const [flag, spec] of Object.entries(CLI_FLAGS)) {
      const argv = ['node', 'run-book.mjs', flag, ...(spec.kind === 'value' ? ['VALUE'] : [])]
      const { passthrough } = parseBookArgs(argv)
      if (CONSUMED_BY_RUN_BOOK.includes(flag)) {
        assert.ok(!passthrough.includes(flag), `${flag} 由本命令消费，不应出现在透传里`)
        continue
      }
      forwarded.push(flag)
      assert.ok(passthrough.includes(flag), `${flag} 没有被透传`)
      if (spec.kind === 'value') {
        assert.equal(passthrough[passthrough.indexOf(flag) + 1], 'VALUE', `${flag} 的取值没有被透传`)
      }
    }
    // 反向：被消费的清单不能多写——多写一个就等于悄悄吃掉了 run.mjs 的开关。
    assert.deepEqual(
      Object.keys(CLI_FLAGS).filter((f) => !forwarded.includes(f)),
      CONSUMED_BY_RUN_BOOK,
      '「被本命令消费」的开关清单与实际不符',
    )

    assert.throws(() => parseBookArgs(['node', 'run-book.mjs', '--not-a-flag']), /未知参数/)
    assert.throws(() => parseBookArgs(['node', 'run-book.mjs', 'chapter1.md']), /未知的位置参数/)
    assert.throws(() => parseBookArgs(['node', 'run-book.mjs', '--concurrency', '0']), /1\.\.8/)
  })

  it('bookRunId 只由声明式输入决定：内容相同 → 身份相同；内容变了 → 身份变', () => {
    const base = { sources: [{ path: 'a.md', sha256: 'sha256:1' }], layer2: 'stub', modelId: null, judgeApplied: true }
    assert.equal(computeBookRunId(base), computeBookRunId({ ...base }))
    assert.notEqual(computeBookRunId(base), computeBookRunId({ ...base, layer2: 'deepseek' }))
    assert.notEqual(computeBookRunId(base), computeBookRunId({ ...base, modelId: 'm' }))
    assert.notEqual(computeBookRunId(base), computeBookRunId({ ...base, judgeApplied: false }))
    assert.notEqual(computeBookRunId(base), computeBookRunId({ ...base, sources: [{ path: 'a.md', sha256: 'sha256:2' }] }))
  })
})

describe('09 · 判定者与反模式统计的口径（2026-10-12 修复批钉住）', () => {
  it('回执声明的是 v2 schema（judge 块口径变更的那一版）', () => {
    assert.equal(RECEIPT_SERIAL.schemaVersion, 'book-receipt/v2')
  })

  it('stub 全书的身份说 deterministic-only：`--layer2 stub` 下判定者无从调用，不得写 judgeApplied:true', () => {
    // 旧实现按「透传里有没有 --no-judge」判：stub 路径会写出 inputs.judgeApplied:true
    // 与 bookRunId 的 gate:full——而本次运行根本没有、也不可能有判定者调用（ADR-014 禁止该口径）。
    assert.equal(RECEIPT_SERIAL.inputs.judgeApplied, false)
    assert.equal(RECEIPT_SERIAL.totals.judge.enabled, false)
    assert.equal(RECEIPT_SERIAL.totals.judge.filesJudged, 0)
    assert.equal(RECEIPT_SERIAL.totals.judge.calls, 0)
  })

  it('混合回放：「至少一个文件跑了判定者」与「每个文件都跑了」是两个问题，不得互相冒充', () => {
    const row = (fileKey, judge) => ({
      fileKey,
      exitCode: 0,
      counts: { objects: 1, passed: 1, rejected: 0 },
      coverage: {},
      model: {},
      reasonCodes: {},
      objectTypes: {},
      judge,
    })
    const totals = aggregateTotals([
      row('a', { enabled: true, calls: 20, tokens: { input: 100, output: 50 }, summary: null }),
      row('b', { enabled: false, calls: 0, tokens: null }),
    ])
    assert.equal(totals.judge.enabled, true, '至少一个文件跑了判定者 → enabled 必须为 true（真实回放场景里这条曾被印成「未启用」）')
    assert.equal(totals.judge.allFilesJudged, false)
    assert.equal(totals.judge.filesJudged, 1)
    assert.equal(totals.judge.calls, 20)

    const replayOnly = aggregateTotals([
      row('a', { enabled: false, calls: 0, tokens: null }),
      row('b', { enabled: false, calls: 0, tokens: null }),
    ])
    assert.equal(replayOnly.judge.enabled, false)
    assert.equal(replayOnly.judge.calls, 0)
    assert.equal(judgeSummaryLine(replayOnly.judge, 2), '判定者 未启用')
  })

  it('报告行口径：calls>0 时不得出现「未启用」', () => {
    const line = judgeSummaryLine({ calls: 560, filesJudged: 12, inputTokens: 791253, outputTokens: 157763 }, 13)
    assert.match(line, /560 次/)
    assert.match(line, /12\/13 个文件/)
    assert.doesNotMatch(line, /未启用/)
  })

  it('跨章合成的对象集**不混进**「章内」统计，且单独成块', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-antipattern-'))
    try {
      const knowledge = path.join(root, 'pipeline', 'knowledge')
      await mkdir(knowledge, { recursive: true })
      const ap = (id, anchors) => ({
        id,
        objectType: 'AntiPattern',
        statement: '占位',
        sourceRefs: anchors.map((a) => ({ anchor: a, quote: 'q' })),
      })
      await writeFile(path.join(knowledge, 'chapter1.objects.json'), JSON.stringify([ap('AP-1', ['chapter1#h2-1'])]))
      await writeFile(path.join(knowledge, 'chapter2.objects.json'), JSON.stringify([ap('AP-2', ['chapter2#h2-2'])]))
      await writeFile(
        path.join(knowledge, 'antipatterns.objects.json'),
        JSON.stringify({ runId: 'run-synth', objects: [ap('AP-SYNTH-T01-01', ['chapter1#h2-1', 'chapter2#h2-2'])] }),
      )
      const r = await collectAntipatterns(root)
      assert.equal(r.fromLayer2.total, 2, '章内统计只能是 2 条逐章提取，合成产物不得混入（实测：混入会把 44 报成 58）')
      assert.equal(r.fromLayer2.crossChapter, 0, '逐章提取按定义单锚点，跨章恒为 0')
      assert.equal(r.perFile.some((f) => f.file === 'antipatterns.objects.json'), false, 'perFile 里不得有合成文件')
      assert.equal(r.crossChapter.status, 'present')
      assert.equal(r.crossChapter.total, 1)
      assert.equal(r.crossChapter.crossChapter, 1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
