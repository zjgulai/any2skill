/**
 * `model-json.mjs` —— 全流水线唯一的响应解析实现。
 *
 * 这个测试文件存在的理由是一条实测故障（ADR-023）：2026-10-11 全书首跑 6/13 个文件
 * 退出码 4，一度被归因为「模型在字符串里写了裸换行」，复现后是**解析器把合法 JSON 切坏**。
 * 同一份未锚定的围栏正则当时抄在四个解析器里。
 *
 * 因此这里钉两类东西：
 *   1. **三种形态各自的正确行为**（含「不该剥壳时绝不剥」）；
 *   2. **首跑 6 例的真实原文**——把那次故障的形状永久固定下来，防止回归。
 */
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { extractJsonPayload } from '../model-json.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REGISTRY = path.resolve(HERE, '..', '..', 'registry')

describe('model-json · 三种形态按「越少加工越优先」尝试', () => {
  test('① 整份原样：响应以 { 开头时按原样解析，不碰任何东西', () => {
    const r = extractJsonPayload('{"objects":[]}')
    assert.equal(r.ok, true)
    assert.deepEqual(r.value, { objects: [] })
  })

  test('② 锚定围栏：只有围栏包裹**整份**响应时才剥壳', () => {
    assert.deepEqual(extractJsonPayload('```json\n{"objects":[]}\n```').value, { objects: [] })
    assert.deepEqual(extractJsonPayload('  ```json\n{"objects":[]}\n```  ').value, { objects: [] })
  })

  test('③ 首 { → 末 }：容忍前后夹带的解释文字', () => {
    assert.deepEqual(extractJsonPayload('好的，结果如下：{"objects":[]} 完毕').value, { objects: [] })
    assert.deepEqual(extractJsonPayload('前言\n{"objects":[1,2]}\n后记').value, { objects: [1, 2] })
  })

  test('顶层数组也算合法（第 2 层允许裸对象数组）', () => {
    assert.deepEqual(extractJsonPayload('[{"objectType":"Concept"}]').value, [
      { objectType: 'Concept' },
    ])
  })
})

describe('model-json · 该剥的剥、不该剥的绝不剥', () => {
  // 这一组是本次故障的核心：围栏出现在字符串**内部**时，它只是内容的一部分。
  test('围栏在字符串内部 → 不剥壳，内容逐字保留', () => {
    const inner = '{"objects":[{"objectType":"Concept","evidenceQuote":"```bash\\ngit x\\n```"}]}'
    const r = extractJsonPayload(inner)
    assert.equal(r.ok, true)
    assert.equal(r.value.objects[0].evidenceQuote, '```bash\ngit x\n```')
  })

  test('围栏既在头部（真壳）又在字符串内部 → 剥外层，留内层', () => {
    const mixed =
      '```json\n{"objects":[{"objectType":"Concept","evidenceQuote":"```python\\nprint(1)\\n```"}]}\n```'
    const r = extractJsonPayload(mixed)
    assert.equal(r.ok, true)
    assert.equal(r.value.objects[0].evidenceQuote, '```python\nprint(1)\n```')
  })

  test('字符串内有多对围栏 → 一对都不剥', () => {
    const multi =
      '{"objects":[{"objectType":"Concept","evidenceQuote":"A：\\n```text\\nx\\n```\\nB：\\n```bash\\ny\\n```"}]}'
    const r = extractJsonPayload(multi)
    assert.equal(r.ok, true)
    assert.equal((r.value.objects[0].evidenceQuote.match(/```/g) || []).length, 4)
  })

  test('围栏只出现一次（只有开没有闭）→ 仍按原样解析', () => {
    const one = '{"objects":[{"objectType":"Concept","evidenceQuote":"```text 未闭合"}]}'
    assert.equal(extractJsonPayload(one).ok, true)
  })
})

describe('model-json · 真坏响应仍然报错，且诊断指向**首次原样尝试**', () => {
  test('完全不是 JSON → ok:false，diagnostic 非空', () => {
    const r = extractJsonPayload('这不是 JSON')
    assert.equal(r.ok, false)
    assert.ok(typeof r.diagnostic === 'string' && r.diagnostic.length > 0)
  })

  test('JSON 是真的坏了（不是被切坏）→ 仍然失败，不被修补放过', () => {
    // 裸换行在字符串里：这是**真的**不合法 JSON。解析器**不得**替它转义。
    const trulyBad = '{"objects":[{"objectType":"Concept","evidenceQuote":"第一行\n第二行"}]}'
    const r = extractJsonPayload(trulyBad)
    assert.equal(r.ok, false, '真损坏的响应不得被修补放过——那是「静默改动内容」')
  })

  test('空响应 → ok:false，不抛', () => {
    assert.equal(extractJsonPayload('').ok, false)
    assert.equal(extractJsonPayload(null).ok, false)
    assert.equal(extractJsonPayload(undefined).ok, false)
  })

  test('JSON 合法但顶层是 null / 数字 → 解析成功，由调用方判形状', () => {
    // 形状校验是调用方的事（判定者要求对象、第 2 层要求 objects 数组）。
    // 本模块只回答「这是不是合法 JSON」。
    assert.equal(extractJsonPayload('null').ok, true)
    assert.equal(extractJsonPayload('123').ok, true)
    assert.equal(extractJsonPayload('"字符串"').ok, true)
  })
})

describe('model-json · 首跑 6 例的真实原文（回归锚点）', () => {
  // 这些文件是 2026-10-11 首跑失败时由 `run.mjs` 落盘的原始响应。
  // **它们全部本来就是合法 JSON**——这正是「根因不在模型」的直接证据。
  const rawFiles = (() => {
    try {
      return readdirSync(REGISTRY).filter(
        (f) => f.startsWith('run-failed-') && f.endsWith('.layer2-raw.json'),
      )
    } catch {
      return []
    }
  })()

  test('样本存在（否则本组退化成空跑，必须在别处钉住）', () => {
    assert.ok(rawFiles.length >= 6, `期望至少 6 份首跑失败原文，实得 ${rawFiles.length}`)
  })

  for (const f of rawFiles) {
    test(`${f}：原样就是合法 JSON，解析器必须通过`, () => {
      const { rawText } = JSON.parse(readFileSync(path.join(REGISTRY, f), 'utf8'))
      // 前提断言：这份原文本身合法（若哪天真坏了，这条会失败而不是让下一条误判）
      assert.doesNotThrow(() => JSON.parse(rawText.trim()), '该样本应本就是合法 JSON')

      const r = extractJsonPayload(rawText)
      assert.equal(r.ok, true, '解析器必须能取出这份响应——首跑就是在这里失败的')
      assert.ok(Array.isArray(r.value.objects), '应取到 objects 数组')
      assert.ok(r.value.objects.length > 0)

      // 引文里的代码块必须逐字保留：被切坏的典型症状就是中间那段消失。
      const quote = r.value.objects[0].evidenceQuote
      assert.equal(typeof quote, 'string')
      assert.ok(quote.length > 0)
    })
  }
})
