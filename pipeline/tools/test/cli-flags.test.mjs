/**
 * 命令行参数的**透传性质**测试
 *
 * 这个文件存在的理由是一个真实缺陷：ticket 05 给判定者新增了六个开关，参数解析加了、
 * 但 `main()` 里那份**逐个枚举**字段的清单忘了加——CLI 收下参数然后默默丢掉，
 * `--judge` 看起来被接受、实际什么都没发生（实测踩到：一次重扫跑了 0 次模型调用）。
 *
 * 离线测试当时全绿，因为它们都直接调 `runPipeline()`，**绕过了 CLI 这一层**。
 * 所以这里钉的不是「那六个开关能用」，而是**那条被违反的性质**：
 *
 *   > `parseArgs` 产出的每一个键，都必须原样出现在传给 `runPipeline` 的入参里。
 *
 * 这条性质成立时，将来任何人新增参数都**不可能**再犯同一个错——因为没有任何清单要维护。
 *
 * 本文件不发任何模型调用、不读凭据、不访问网络。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { buildRunInput, parseArgs } from '../../run.mjs'

/** 跑一遍完整参数解析，返回 flags 与入参。 */
function roundTrip(argv) {
  const { flags, positional } = parseArgs(['node', 'run.mjs', ...argv])
  const input = buildRunInput(flags, { target: positional[0], repoRoot: '/tmp/any2skills-test-root' })
  return { flags, positional, input }
}

/** 覆盖当前**全部**开关的一条 argv。新增开关时请加到这条里。 */
const ALL_FLAGS_ARGV = [
  'sources/ai-agent-book-zh/book/chapter4.md',
  '--json',
  '--rerun',
  '--no-resume',
  '--repo-root',
  '/tmp/ai2s',
  '--objects-fixture',
  '/tmp/ai2s/fixture.json',
  '--layer2',
  'deepseek',
  '--llm-model',
  'producer-model',
  '--llm-base-url',
  'https://api.example.invalid',
  '--llm-provider',
  'test',
  '--llm-reasoning-effort',
  'low',
  '--judge',
  '--judge-all',
  '--judge-model',
  'judge-model',
  '--judge-base-url',
  'https://judge.example.invalid',
  '--judge-provider',
  'test-judge',
  '--judge-reasoning-effort',
  'high',
  '--max-objects-per-anchor',
  '3',
  '--max-tokens',
  '9000',
]

/** `buildRunInput` 有意改写的键，**穷尽清单**（与 run.mjs 的文档注释逐条对应）。 */
const INTENTIONALLY_REWRITTEN = Object.freeze(['source', 'repoRoot', 'objectsFixture'])

describe('CLI · flags 必须整体透传给 runPipeline', () => {
  it('parseArgs 产出的每一个键都在入参里，且取值不变', () => {
    const { flags, input } = roundTrip(ALL_FLAGS_ARGV)
    const missing = Object.keys(flags).filter((k) => !(k in input))
    assert.deepEqual(missing, [], `这些 flags 没有传到 runPipeline（会被静默丢弃）：${missing.join(', ')}`)
    for (const k of Object.keys(flags)) {
      if (INTENTIONALLY_REWRITTEN.includes(k)) continue // 见下一条，逐项断言
      assert.deepEqual(input[k], flags[k], `flags.${k} 在透传过程中被改动了`)
    }
  })

  it('清单之外**不得**有任何改写', () => {
    // 这条防的是「悄悄多加一处改写」：改写会让某个开关看起来能传、实际被覆盖。
    // 注意断言的是**子集**而不是「恰好三个」——清单里的三项未必每一条 argv 都会触发改写
    // （例如没传 --objects-fixture 时就没有东西可改写）。要断言的是「没有清单外的改写」，
    // 而不是「每次都改写三处」。
    const { flags, input } = roundTrip(ALL_FLAGS_ARGV)
    const changed = Object.keys(flags).filter((k) => {
      try {
        return JSON.stringify(input[k]) !== JSON.stringify(flags[k])
      } catch {
        return true
      }
    })
    const unexpected = changed.filter((k) => !INTENTIONALLY_REWRITTEN.includes(k))
    assert.deepEqual(unexpected, [], `出现了清单外的改写——新增改写必须同时改文档与测试`)
  })

  it('清单里的三处**逐条**验证其行为（免得清单写了却没生效）', () => {
    // 1. source：位置参数落到字段
    const a = roundTrip(['chapter4.md'])
    assert.equal(a.flags.source, undefined)
    assert.equal(a.input.source, 'chapter4.md')

    // 2. repoRoot：以调用方传入的（已归一化）为准，覆盖 flags 里的原值
    const b = roundTrip(['chapter4.md', '--repo-root', '/tmp/not-normalized'])
    assert.equal(b.flags.repoRoot, '/tmp/not-normalized')
    assert.equal(b.input.repoRoot, '/tmp/any2skills-test-root')

    // 3. objectsFixture：空串归成 null（下游用 === null 判断「有没有夹具」）
    assert.equal(roundTrip(['chapter4.md', '--objects-fixture', '']).input.objectsFixture, null)
    assert.equal(
      roundTrip(['chapter4.md', '--objects-fixture', '/x.json']).input.objectsFixture,
      '/x.json',
    )
  })

  it('判定者的六个开关逐条可达（这正是当初被丢掉的那一批）', () => {
    const { input } = roundTrip(ALL_FLAGS_ARGV)
    assert.equal(input.judge, true, '--judge 必须传到 runPipeline')
    assert.equal(input.judgeAll, true, '--judge-all 必须传到 runPipeline')
    assert.equal(input.judgeModel, 'judge-model')
    assert.equal(input.judgeBaseUrl, 'https://judge.example.invalid')
    assert.equal(input.judgeProvider, 'test-judge')
    assert.equal(input.noJudge, false)
  })

  it('--no-judge 与 --judge 各自可达（两者互斥的判定留给 runPipeline）', () => {
    assert.equal(roundTrip(['x.md', '--no-judge']).input.noJudge, true)
    assert.equal(roundTrip(['x.md', '--no-judge']).input.judge, null)
    assert.equal(roundTrip(['x.md', '--judge']).input.judge, true)
  })

  it('只有三处**有意**改写，且改写理由写在这里', () => {
    const { flags, input } = roundTrip(['chapter4.md'])
    assert.equal(input.source, 'chapter4.md', '位置参数必须落到 source 字段')
    assert.equal(input.repoRoot, '/tmp/any2skills-test-root', 'repoRoot 必须已归一化为绝对路径')
    assert.equal(flags.objectsFixture, null)
    assert.equal(input.objectsFixture, null, '未指定夹具时为 null（而不是空串）')
    // 空串也必须归成 null：下游用 `=== null` 判断「有没有夹具」。
    const empty = roundTrip(['chapter4.md', '--objects-fixture', '']).input
    assert.equal(empty.objectsFixture, null, '空串夹具必须归成 null')
  })

  it('未知参数必须报错，不得静默忽略', () => {
    // 静默忽略未知参数是「参数看起来生效了其实没有」的另一条通路，
    // 与本文件钉的那条性质是同一个失败模式。
    assert.throws(() => parseArgs(['node', 'run.mjs', 'x.md', '--judge-nothing']), /未知参数/)
  })

  it('缺取值的参数必须报错', () => {
    assert.throws(() => parseArgs(['node', 'run.mjs', 'x.md', '--judge-model']), /缺少取值/)
    assert.throws(() => parseArgs(['node', 'run.mjs', 'x.md', '--judge-model', '--judge-all']), /缺少取值/)
  })

  it('默认值明确：不传 --layer2 就是替身，不传 --rerun 就是复用', () => {
    const { input } = roundTrip(['chapter4.md'])
    assert.equal(input.layer2, 'stub')
    assert.equal(input.rerun, false)
    assert.equal(input.resume, true)
    assert.equal(input.judge, null, '不传 --judge 时是 null（「没表态」），不是 false')
    assert.equal(input.noJudge, false)
  })
})
