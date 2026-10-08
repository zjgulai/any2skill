/**
 * 路由覆盖的**完整性**测试
 *
 * ## 这个文件存在的理由：同一个缺陷犯了两次
 *
 * **第一次**（卡 05）：`main()` 逐个枚举要传给 `runPipeline` 的字段；新增判定者六个开关时
 * 只加了参数解析、忘了加清单，CLI 收下参数然后默默丢掉。修法是 `buildRunInput` 整体透传，
 * 由 `cli-flags.test.mjs` 钉住。
 *
 * **第二次**（批次一）：修了 `flags → input` 那一跳，却没修 `input → resolveLlmConfig` 这一跳。
 * 结果 `--llm-reasoning-effort low` 在**生产者**链上被静默丢弃——一次名义上的「低档对照」
 * 实际全程跑在默认档，20 次真实调用全部白花。而它**看起来完全正常**：
 * 判定者那条链走的是另一份 opts，正确继承了 `low`，于是回执里
 * `judge.reasoningEffort = "low"` 赫然在目，而 `model.configSource.reasoningEffort = null`
 * 就摆在旁边，两个字段按理应当并排出现，却无人对账。
 *
 * ## 因此这里钉的性质
 *
 *   > 每一个**路由类**的 CLI 开关，都必须出现在某张映射表的值里；
 *   > 而出现在「非路由」豁免名单里的每一个开关，都必须是布尔开关。
 *
 * 第二条是防绕过的：将来若有人新增一个字符串型的路由开关、又把它塞进豁免名单，
 * 测试会因为「它不是布尔」而失败，而不是静默放过。
 *
 * 本文件零网络、零凭据、零落盘。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  JUDGE_OVERRIDE_KEYS,
  PRODUCER_OVERRIDE_KEYS,
  buildJudgeOverrides,
  buildProducerOverrides,
  parseArgs,
} from '../../run.mjs'

/**
 * 不以「值」的形式配置路由的开关。
 * 它们要么是纯布尔，要么是控制流，改路由不通过它们。
 */
const NON_ROUTE_FLAGS = new Set([
  'judge', // 布尔：是否启用判定者
  'judgeAll', // 布尔：是否对所有对象都调判定者
  'noJudge', // 布尔：关闭判定者
])

/** 路由类开关的判定：以 llm / judge 开头，且不是豁免名单里的。 */
function routeClassFlags(allFlags) {
  return Object.keys(allFlags)
    .filter((k) => /^(llm|judge)[A-Z]/.test(k))
    .filter((k) => !NON_ROUTE_FLAGS.has(k))
    .sort()
}

/**
 * 只由**程序化调用**方设置、CLI 刻意不提供的入参键。
 *
 * `llmApiKey` 在此列的理由是硬的：**凭据不得出现在命令行上**（会进 shell 历史、进程表、
 * CI 日志）。它只经由 `runPipeline()` 的入参或环境变量/凭据文件进入。
 * 这不是疏忽，是一条要守住的约定——所以它被写在这里并附带反向断言（见下），
 * 而不是默默从检查里漏过去。
 */
const PROGRAMMATIC_ONLY_INPUT_KEYS = new Set(['llmApiKey'])

/** 取一份 parseArgs 的默认 flags（用一条空 argv）。 */
function defaultFlags() {
  return parseArgs(['node', 'run.mjs']).flags
}

describe('路由覆盖 · 每张表的值合起来必须覆盖全部路由类开关', () => {
  it('生产者的路由开关全部被映射', () => {
    const mapped = new Set(Object.values(PRODUCER_OVERRIDE_KEYS))
    const route = routeClassFlags(defaultFlags()).filter((k) => k.startsWith('llm'))
    const missing = route.filter((k) => !mapped.has(k))
    assert.deepEqual(missing, [], `生产者表漏了这些开关：${missing.join(', ')}`)
  })

  it('判定者的路由开关全部被映射', () => {
    const mapped = new Set(Object.values(JUDGE_OVERRIDE_KEYS))
    const route = routeClassFlags(defaultFlags()).filter((k) => k.startsWith('judge'))
    const missing = route.filter((k) => !mapped.has(k))
    assert.deepEqual(missing, [], `判定者表漏了这些开关：${missing.join(', ')}`)
  })

  it('反之，表里不得出现 parseArgs 根本不产出的键（防止映射到不存在的开关）', () => {
    const all = new Set(Object.keys(defaultFlags()))
    for (const [name, table] of [
      ['PRODUCER_OVERRIDE_KEYS', PRODUCER_OVERRIDE_KEYS],
      ['JUDGE_OVERRIDE_KEYS', JUDGE_OVERRIDE_KEYS],
    ]) {
      for (const inputKey of Object.values(table)) {
        if (PROGRAMMATIC_ONLY_INPUT_KEYS.has(inputKey)) continue
        assert.ok(all.has(inputKey), `${name} 映射到了不存在的 flags 键：${inputKey}`)
      }
    }
  })

  // 反向条款：程序化专用名单不得成为藏 CLI 开关的地方。
  it('程序化专用名单里的键，CLI 必须确实不产出（否则它就是个被藏起来的开关）', () => {
    const all = new Set(Object.keys(defaultFlags()))
    for (const k of PROGRAMMATIC_ONLY_INPUT_KEYS) {
      assert.ok(!all.has(k), `${k} 已在程序化专用名单里，但 parseArgs 会产出它——名单失去意义`)
    }
  })

  // 这一条是本文件的防绕过条款：豁免名单里不得出现**取值型**开关。
  //
  // 判据是「缺省不是字符串」而不是「缺省是布尔」：`judge` 是个三态开关
  // （未设 = null / `--judge` = true / `--no-judge` 走另一个键），写成布尔断言会误判。
  // 而路由覆盖的取值**永远是字符串**（模型 id、端点、档位），所以「不是字符串」恰好
  // 就是「不是路由开关」，且将来有人把字符串型开关塞进豁免名单时会失败。
  it('豁免名单里的开关都不得是取值型（缺省不是字符串，显式设置后是布尔）', () => {
    const flags = defaultFlags()
    for (const k of NON_ROUTE_FLAGS) {
      assert.ok(k in flags, `豁免名单里有 parseArgs 不产出的键：${k}`)
      assert.notEqual(
        typeof flags[k],
        'string',
        `${k} 在豁免名单里的缺省却是字符串——它可能是一个被藏起来的路由开关`,
      )
    }
    // 显式打开时必须是布尔，确保它们确实是开关而非取值。
    for (const [arg, key] of [['--judge', 'judge'], ['--judge-all', 'judgeAll'], ['--no-judge', 'noJudge']]) {
      const set = parseArgs(['node', 'run.mjs', arg]).flags
      assert.equal(typeof set[key], 'boolean', `${arg} 应把 ${key} 置为布尔`)
    }
  })
})

describe('路由覆盖 · 取值必须逐键原样透传', () => {
  it('生产者：每个映射键都能把取值送到底', () => {
    const probe = {}
    for (const inputKey of Object.values(PRODUCER_OVERRIDE_KEYS)) {
      probe[inputKey] = `probe-${inputKey}`
    }
    const out = buildProducerOverrides(probe)
    for (const [overrideKey, inputKey] of Object.entries(PRODUCER_OVERRIDE_KEYS)) {
      assert.equal(out[overrideKey], `probe-${inputKey}`, `${inputKey} → ${overrideKey} 未透传`)
    }
  })

  it('判定者：每个映射键都能把取值送到底', () => {
    const probe = {}
    for (const inputKey of Object.values(JUDGE_OVERRIDE_KEYS)) {
      probe[inputKey] = `probe-${inputKey}`
    }
    const out = buildJudgeOverrides(probe)
    for (const [overrideKey, inputKey] of Object.entries(JUDGE_OVERRIDE_KEYS)) {
      assert.equal(out[overrideKey], `probe-${inputKey}`, `${inputKey} → ${overrideKey} 未透传`)
    }
  })

  it('缺省（键不存在/null/空串）时**不得**产出该键——否则回执会谎报来源', () => {
    // 差别是实的，而且是一个真实缺陷：`resolveLlmConfig` 判定来源时读的是
    // 「override 键在不在、是不是非空串」。若无条件填 null，它会认为调用方显式传了 null，
    // 于是回执写 `override(reasoningEffort)`——**而根本没人拨过档**。
    // 值是对的（null → 不发字段），来源是假的；而来源字段存在的全部意义就是这个。
    for (const [name, build, keys] of [
      ['生产者', buildProducerOverrides, Object.keys(PRODUCER_OVERRIDE_KEYS)],
      ['判定者', buildJudgeOverrides, Object.keys(JUDGE_OVERRIDE_KEYS)],
    ]) {
      for (const input of [{}, { llmReasoningEffort: null, judgeReasoningEffort: null }, { llmReasoningEffort: '' }]) {
        const out = build(input)
        for (const k of keys) {
          assert.ok(
            !(k in out),
            `${name}：缺省时不得产出键 ${k}（实际为 ${JSON.stringify(out[k])}）`,
          )
        }
      }
    }
  })

  it('真实链路：未拨档时 configSource 必须报 null，而不是 override(...)', async () => {
    // 这一条直接跑 resolveLlmConfig，钉的是「来源标注符合事实」而不是「键存不存在」。
    const { resolveLlmConfig } = await import('../llm-client.mjs')
    const env = {
      ANY2SKILLS_LLM_API_KEY: 'test-key-not-a-real-secret',
      ANY2SKILLS_LLM_MODEL: 'test-model',
      ANY2SKILLS_LLM_BASE_URL: 'https://example.invalid',
    }
    const nothing = await resolveLlmConfig({ env, overrides: buildProducerOverrides({}) })
    assert.equal(nothing.reasoningEffort, null)
    assert.equal(nothing.reasoningEffortSource, null, '没人拨档，来源就必须是 null')

    const dialed = await resolveLlmConfig({ env, overrides: buildProducerOverrides({ llmReasoningEffort: 'low' }) })
    assert.equal(dialed.reasoningEffort, 'low')
    assert.equal(dialed.reasoningEffortSource, 'override(reasoningEffort)')
  })
})
