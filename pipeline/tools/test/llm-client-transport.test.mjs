/**
 * llm-client · 传输层失败的处置（回归锚点）
 *
 * 2026-10-12 门禁二真实运行三次栽在同一处：`fetch` 成功、响应头已到，
 * 但**读响应体**时连接中断（undici 报 `terminated`）——旧实现那一行不在任何
 * try/catch 里，于是裸抛、不重试、不包装。三次运行各丢一次调用（partial 接住了，
 * 零重复付费，但每轮都要人工续跑）。
 *
 * 本文件钉住修复后的两条：**读体失败与 fetch 失败同策**——
 *   1. 可重试（attempt < maxAttempts 时重发，账本 retries 可见）；
 *   2. 耗尽后抛 LlmCallError，错误串说明「传输层故障、不是模型输出问题」。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { chatCompletion, createUsageLedger, LlmCallError, resolveLlmConfig } from '../llm-client.mjs'

const BASE_ENV = Object.freeze({
  ANY2SKILLS_LLM_API_KEY: 'test-key-not-a-real-secret',
  ANY2SKILLS_LLM_MODEL: 'test-model',
  ANY2SKILLS_LLM_BASE_URL: 'https://example.invalid',
})

const configOf = () => resolveLlmConfig({ env: BASE_ENV, overrides: {} })

const okBody = () => ({
  ok: true,
  status: 200,
  async text() {
    return JSON.stringify({
      choices: [{ message: { content: 'ok' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
  },
})

describe('传输层 · 读响应体中断（terminated）与 fetch 失败同策', () => {
  it('第一次读体抛 terminated → 重试成功，账本 retries 可见、failedCalls 记了一笔', async () => {
    let calls = 0
    const fetchImpl = async () => {
      calls += 1
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          async text() {
            throw new Error('terminated')
          },
        }
      }
      return okBody()
    }
    const ledger = createUsageLedger()
    const res = await chatCompletion(await configOf(), { system: 's', user: 'u', fetchImpl, ledger, maxAttempts: 2 })
    assert.equal(res.text.includes('ok'), true)
    assert.equal(calls, 2, '读体失败必须触发重发')
    assert.ok(ledger.retries >= 1, '重试要进账本')
    assert.ok(ledger.failedCalls >= 1, '失败的一次调用要进账本（不得当作没发生）')
  })

  it('重试耗尽 → LlmCallError，串里说明是传输层、非模型输出', async () => {
    const config = await configOf()
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async text() {
        throw new Error('terminated')
      },
    })
    await assert.rejects(
      () => chatCompletion(config, { system: 's', user: 'u', fetchImpl, maxAttempts: 2 }),
      (err) =>
        err instanceof LlmCallError &&
        /读取模型响应体失败/.test(err.message) &&
        /传输层故障/.test(err.message) &&
        /terminated/.test(err.message),
    )
  })

  it('fetch 本身失败：同一套包装（对照，防两条路径漂移）', async () => {
    const config = await configOf()
    const fetchImpl = async () => {
      throw new Error('ECONNRESET')
    }
    await assert.rejects(
      () => chatCompletion(config, { system: 's', user: 'u', fetchImpl, maxAttempts: 1 }),
      (err) => err instanceof LlmCallError && /模型调用传输失败/.test(err.message) && /ECONNRESET/.test(err.message),
    )
  })
})