/**
 * 推理档位旋钮的性质测试（ADR-009 的定档前置）
 *
 * ADR-009 把「第 2 层推理档位」的定档推到「卡 09 开工前」，同期明文禁止在此之前
 * 给 `llm-client.mjs` 加对应参数。本轮（批次一）解除阻塞后加了这个旋钮，
 * 本文件钉住它的三条关键性质——**都不需要真发模型调用**：

 * 1. **「不表态」与「表态了」必须可区分。** 未设置档位时，请求体里**不得出现**
 *    `reasoning_effort` 键；设置后必须原样出现。若缺省时也塞一个具体档位，
 *    回执就会把「我们从没定过档」显示成「我们选了某个档」。
 * 2. **非法值必须抛错，不得静默回落。** 静默忽略一个拼错的档位，等于让一次
 *    「以为降档了」的对照跑出「其实没降」的结果——而这正是本旋钮的用途所在。
 * 3. **两层各自可拨、缺省继承。** ADR-009 要求定档时「必须同时评估生产者与判定者两层」；
 *    两层若不能分离地拨档，这个评估就无法做。
 *
 * 本文件零网络、零凭据、零落盘。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import {
  LlmConfigError,
  REASONING_EFFORTS,
  chatCompletion,
  normalizeReasoningEffort,
  resolveJudgeLlmConfig,
  resolveLlmConfig,
} from '../llm-client.mjs'
import { describeJudgeRoute } from '../judge.mjs'

/** 一套最小的合法环境，使 resolveLlmConfig 不必去读真实的凭据文件。 */
const BASE_ENV = Object.freeze({
  ANY2SKILLS_LLM_API_KEY: 'test-key-not-a-real-secret',
  ANY2SKILLS_LLM_MODEL: 'test-model',
  ANY2SKILLS_LLM_BASE_URL: 'https://example.invalid',
})

/** 捕获 chatCompletion 真正发出的请求体。returns { calls, body() } */
function capturingFetch() {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) })
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      },
    }
  }
  return { calls, fetchImpl }
}

describe('推理档位 · 请求体：不表态与表态必须可区分', () => {
  it('未设置档位 → 请求体里**没有** reasoning_effort 键（而非某个默认值）', async () => {
    const config = await resolveLlmConfig({ env: { ...BASE_ENV }, overrides: {} })
    assert.equal(config.reasoningEffort, null, '缺省必须是 null，不是某个具体档')

    const { calls, fetchImpl } = capturingFetch()
    await chatCompletion(config, { system: 's', user: 'u', fetchImpl })
    assert.equal(calls.length, 1)
    assert.ok(
      !Object.prototype.hasOwnProperty.call(calls[0].body, 'reasoning_effort'),
      `缺省时请求体不得出现 reasoning_effort，实际键：${Object.keys(calls[0].body).join(',')}`,
    )
  })

  it('显式设置低档 → 请求体里原样出现 low', async () => {
    const config = await resolveLlmConfig({
      env: { ...BASE_ENV },
      overrides: { reasoningEffort: 'low' },
    })
    assert.equal(config.reasoningEffort, 'low')
    assert.equal(config.reasoningEffortSource, 'override(reasoningEffort)')

    const { calls, fetchImpl } = capturingFetch()
    await chatCompletion(config, { system: 's', user: 'u', fetchImpl })
    assert.equal(calls[0].body.reasoning_effort, 'low')
  })

  it('三个合法档位逐一都能到达请求体', async () => {
    for (const effort of REASONING_EFFORTS) {
      const config = await resolveLlmConfig({
        env: { ...BASE_ENV },
        overrides: { reasoningEffort: effort },
      })
      const { calls, fetchImpl } = capturingFetch()
      await chatCompletion(config, { system: 's', user: 'u', fetchImpl })
      assert.equal(calls[0].body.reasoning_effort, effort, `档位 ${effort} 未到达请求体`)
    }
  })

  it('单次请求的档位覆盖路由上的档位（用于同一次运行内做对照）', async () => {
    const config = await resolveLlmConfig({
      env: { ...BASE_ENV },
      overrides: { reasoningEffort: 'high' },
    })
    const { calls, fetchImpl } = capturingFetch()
    await chatCompletion(config, { system: 's', user: 'u', reasoningEffort: 'low', fetchImpl })
    assert.equal(calls[0].body.reasoning_effort, 'low')
  })

  it('环境变量可设置档位，且显式覆盖优先于环境变量', async () => {
    const fromEnv = await resolveLlmConfig({
      env: { ...BASE_ENV, ANY2SKILLS_LLM_REASONING_EFFORT: 'max' },
      overrides: {},
    })
    assert.equal(fromEnv.reasoningEffort, 'max')
    assert.equal(fromEnv.reasoningEffortSource, 'env:ANY2SKILLS_LLM_REASONING_EFFORT')

    const overridden = await resolveLlmConfig({
      env: { ...BASE_ENV, ANY2SKILLS_LLM_REASONING_EFFORT: 'max' },
      overrides: { reasoningEffort: 'low' },
    })
    assert.equal(overridden.reasoningEffort, 'low')
  })
})

describe('推理档位 · 非法值必须抛错，不得静默回落', () => {
  it('拼错的档位取值被拒绝（这是「以为降档了、其实没降」的唯一防线）', () => {
    assert.throws(() => normalizeReasoningEffort('minimum'), LlmConfigError)
    assert.throws(() => normalizeReasoningEffort('HIGHER'), LlmConfigError)
    assert.throws(() => normalizeReasoningEffort('0'), LlmConfigError)
  })

  it('非法值从 resolveLlmConfig 一路抛出，不会被吞成 null', async () => {
    await assert.rejects(
      () => resolveLlmConfig({ env: { ...BASE_ENV }, overrides: { reasoningEffort: 'turbo' } }),
      LlmConfigError,
    )
  })

  it('空串与 null 归一为「不表态」，不是非法值', () => {
    assert.equal(normalizeReasoningEffort(''), null)
    assert.equal(normalizeReasoningEffort('   '), null)
    assert.equal(normalizeReasoningEffort(null), null)
    assert.equal(normalizeReasoningEffort(undefined), null)
  })

  it('大小写与空白被归一，不代表放宽取值范围', () => {
    assert.equal(normalizeReasoningEffort(' LOW '), 'low')
    assert.equal(normalizeReasoningEffort('High'), 'high')
  })
})

describe('推理档位 · 生产者与判定者两层各自可拨', () => {
  it('判定者缺省继承生产者的档位', async () => {
    const judge = await resolveJudgeLlmConfig({
      env: { ...BASE_ENV },
      overrides: { reasoningEffort: 'low' },
      judgeOverrides: {},
    })
    assert.equal(judge.reasoningEffort, 'low')
    assert.equal(judge.producerReasoningEffort, 'low')
  })

  it('判定者档位可单点覆盖，而不改变生产者档位', async () => {
    const judge = await resolveJudgeLlmConfig({
      env: { ...BASE_ENV },
      overrides: { reasoningEffort: 'low' },
      judgeOverrides: { reasoningEffort: 'high' },
    })
    assert.equal(judge.reasoningEffort, 'high')
    assert.equal(judge.producerReasoningEffort, 'low', '判据层拨档不得回写生产者层')
  })

  it('两层都未表态时，两层都是 null（而不是「都等于默认档」）', async () => {
    const judge = await resolveJudgeLlmConfig({
      env: { ...BASE_ENV },
      overrides: {},
      judgeOverrides: {},
    })
    assert.equal(judge.reasoningEffort, null)
    assert.equal(judge.producerReasoningEffort, null)
  })

  it('判定者档位的非法值同样抛错', async () => {
    await assert.rejects(
      () =>
        resolveJudgeLlmConfig({
          env: { ...BASE_ENV },
          overrides: {},
          judgeOverrides: { reasoningEffort: 'nope' },
        }),
      LlmConfigError,
    )
  })
})

describe('推理档位 · 必须在回执里看得见', () => {
  it('定档前：回执的判定者路由显示 null，而不是伪装成某个档', async () => {
    const judge = await resolveJudgeLlmConfig({
      env: { ...BASE_ENV },
      overrides: {},
      judgeOverrides: {},
    })
    const route = describeJudgeRoute(judge)
    assert.equal(route.reasoningEffort, null)
    assert.equal(route.configSource.reasoningEffort, null)
  })

  it('定档后：回执并排记录两层各自的档位与来源', async () => {
    const judge = await resolveJudgeLlmConfig({
      env: { ...BASE_ENV },
      overrides: { reasoningEffort: 'low' },
      judgeOverrides: { reasoningEffort: 'high' },
    })
    const route = describeJudgeRoute(judge)
    assert.equal(route.reasoningEffort, 'high', '判定者层')
    assert.equal(route.configSource.reasoningEffort, 'override(judgeReasoningEffort)')
  })
})
