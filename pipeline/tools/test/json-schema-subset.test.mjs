/**
 * 自写 JSON Schema 子集校验器的测试（决策 Q15 要求「自行举证」）
 *
 * 每个受支持的关键字都有正例与负例；并有一条反向守卫：未知关键字必须报错而不能被静默忽略。
 * 之所以把这条放在最前面，是因为「静默忽略」正是自写校验器最危险的失败模式——
 * schema 作者以为约束生效了，实际校验被悄悄放行。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

import { validate, validateSchemaDocument, SUPPORTED_KEYWORDS } from '../json-schema-subset.mjs'

const ok = (data, schema, label = '') => {
  const r = validate(data, schema)
  assert.ok(r.valid, `${label} 应通过，实际错误：${JSON.stringify(r.errors)}`)
}
const no = (data, schema, keyword, label = '') => {
  const r = validate(data, schema)
  assert.ok(!r.valid, `${label} 应被拒绝，却通过了`)
  if (keyword) {
    assert.ok(
      r.errors.some((e) => e.keyword === keyword),
      `${label} 期望 ${keyword}，实际 ${JSON.stringify(r.errors.map((e) => e.keyword))}`,
    )
  }
  return r.errors
}

describe('子集校验器 · 静默忽略守卫', () => {
  it('未知关键字必须报错（而不是被忽略）', () => {
    const r = validateSchemaDocument({ type: 'string', format: 'date-time' })
    assert.equal(r.valid, false)
    assert.match(r.problems.join(''), /format/)
  })

  it('未知关键字报错时给出可定位的路径', () => {
    const r = validateSchemaDocument({
      type: 'object',
      properties: { inner: { type: 'string', patternProperties: {} } },
    })
    assert.equal(r.valid, false)
    assert.match(r.problems.join(''), /properties\/inner/)
  })

  it('受支持的关键字表是封闭集合且含本项目实际使用的关键字', () => {
    for (const k of ['$ref', 'allOf', 'oneOf', 'additionalProperties', 'minItems', 'pattern', 'maxProperties', 'description']) {
      assert.ok(SUPPORTED_KEYWORDS.includes(k), `缺少关键字 ${k}`)
    }
  })
})

describe('子集校验器 · type', () => {
  it('基本类型判定', () => {
    ok('x', { type: 'string' })
    no(1, { type: 'string' }, 'type')
    ok(null, { type: 'null' })
    ok([], { type: 'array' })
    ok({}, { type: 'object' })
    ok(true, { type: 'boolean' })
  })

  it('integer 与 number 的语义：整数同时满足 number', () => {
    ok(3, { type: 'integer' })
    no(3.5, { type: 'integer' }, 'type')
    ok(3, { type: 'number' })
    ok(3.5, { type: 'number' })
  })

  it('type 为数组时任一匹配即通过', () => {
    ok('x', { type: ['string', 'null'] })
    ok(null, { type: ['string', 'null'] })
    no(1, { type: ['string', 'null'] }, 'type')
  })
})

describe('子集校验器 · required / properties / additionalProperties', () => {
  it('required 缺字段被拒', () => {
    no({}, { type: 'object', required: ['a'] }, 'required')
    ok({ a: 1 }, { type: 'object', required: ['a'] })
  })

  it('additionalProperties: false 拒绝未知字段', () => {
    const s = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }
    ok({ a: 'x' }, s)
    no({ a: 'x', b: 1 }, s, 'additionalProperties')
  })

  it('additionalProperties 为对象 schema 时按下标逐值校验（含 maxProperties 的规范语义）', () => {
    const s = { type: 'object', additionalProperties: { type: 'object', maxProperties: 0 } }
    // 实测语义（插桩确认，勿凭直觉改断言）：
    //   maxProperties: 0 对空对象是 0 > 0 = false ⇒ **通过**。
    //   所以它只挡得住「值非空对象 / 值类型不符」的额外属性，并不等于「不允许任何额外属性」。
    //   本项目组装后的 schema 因此不用这个机制做字段封闭——那由各类型分支的
    //   additionalProperties:false 承担。本用例只证明该关键字按规范语义工作。
    ok({}, s, '无额外属性')
    ok({ extra: {} }, s, '额外属性值为空对象（maxProperties:0 放行）')
    no({ extra: { a: 1 } }, s, 'maxProperties', '额外属性值为非空对象')
    no({ extra: 'x' }, s, 'type', '额外属性值为字符串')
    no({ extra: [] }, s, 'type', '额外属性值为数组')
  })

  it('嵌套错误的 instancePath 指向出错的属性', () => {
    const s = {
      type: 'object',
      properties: { a: { type: 'object', properties: { b: { type: 'string' } } } },
    }
    const errs = no({ a: { b: 1 } }, s, 'type')
    assert.ok(errs.some((e) => e.instancePath === '/a/b'), JSON.stringify(errs))
  })
})

describe('子集校验器 · 数组', () => {
  it('items / minItems / maxItems', () => {
    const s = { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 2 }
    ok(['a'], s)
    ok(['a', 'b'], s)
    no([], s, 'minItems')
    no(['a', 'b', 'c'], s, 'maxItems')
    no(['a', 1], s, 'type')
  })

  it('uniqueItems 按结构化比较判重', () => {
    const s = { type: 'array', uniqueItems: true }
    ok([{ a: 1 }, { a: 2 }], s)
    no([{ a: 1 }, { a: 1 }], s, 'uniqueItems')
    no([1, 1], s, 'uniqueItems')
  })
})

describe('子集校验器 · const / enum', () => {
  it('const 深度比较', () => {
    ok({ a: 1 }, { const: { a: 1 } })
    no({ a: 2 }, { const: { a: 1 } }, 'const')
  })

  it('enum 命中任一值即通过', () => {
    ok('b', { enum: ['a', 'b'] })
    no('c', { enum: ['a', 'b'] }, 'enum')
  })
})

describe('子集校验器 · 字符串与数值边界', () => {
  it('pattern 用 Unicode 模式匹配', () => {
    ok('AB-C', { type: 'string', pattern: '^[A-Z]+-[A-Z]+$' })
    no('ab-c', { type: 'string', pattern: '^[A-Z]+-[A-Z]+$' }, 'pattern')
  })

  it('minLength / maxLength 按码点计数（中文算一个字）', () => {
    ok('中文', { type: 'string', minLength: 2 })
    no('中', { type: 'string', minLength: 2 }, 'minLength')
    no('中文', { type: 'string', maxLength: 1 }, 'maxLength')
  })

  it('minimum / maximum / 排他边界', () => {
    ok(5, { type: 'integer', minimum: 5 })
    no(4, { type: 'integer', minimum: 5 }, 'minimum')
    ok(5, { type: 'integer', maximum: 5 })
    no(6, { type: 'integer', maximum: 5 }, 'maximum')
    no(5, { type: 'integer', exclusiveMinimum: 5 }, 'exclusiveMinimum')
    no(5, { type: 'integer', exclusiveMaximum: 5 }, 'exclusiveMaximum')
  })
})

describe('子集校验器 · 组合', () => {
  it('allOf 全部分支都须通过', () => {
    const s = {
      allOf: [
        { type: 'object', required: ['a'] },
        { type: 'object', required: ['b'] },
      ],
    }
    ok({ a: 1, b: 2 }, s)
    no({ a: 1 }, s, 'required')
  })

  it('oneOf 要求恰好一个分支匹配', () => {
    const s = { oneOf: [{ type: 'string' }, { type: 'number' }] }
    ok('x', s)
    ok(1, s)
    no(true, s, 'oneOf')
    // 两个分支同时匹配（integer 既是 number 也满足 number 的放宽）时也须报错
    no(1, { oneOf: [{ type: 'number' }, { type: 'integer' }] }, 'oneOf', '双分支匹配')
  })

  it('anyOf 任一分支匹配即通过', () => {
    const s = { anyOf: [{ type: 'string' }, { type: 'number' }] }
    ok('x', s)
    ok(1, s)
    no(true, s, 'anyOf')
  })

  it('not 拒绝命中其 schema 的值', () => {
    ok('x', { not: { type: 'number' } })
    no(1, { not: { type: 'number' } }, 'not')
  })
})

describe('子集校验器 · $ref 与 $defs', () => {
  const root = {
    $defs: { positiveInt: { type: 'integer', minimum: 1 } },
    type: 'object',
    properties: { n: { $ref: '#/$defs/positiveInt' } },
  }

  it('文档内 $ref 被解析并生效', () => {
    ok({ n: 3 }, root)
    no({ n: 0 }, root, 'minimum')
  })

  it('无法解析的 $ref 必须报错，不得静默放行', () => {
    const errs = no({ n: 3 }, { properties: { n: { $ref: '#/$defs/nope' } } }, '$ref')
    assert.match(errs[0].message, /无法解析/)
  })

  it('外部 $id 形式的 $ref 在校验器中无法解析（故 schema 必须先组装内联）', () => {
    const errs = no({ n: 3 }, { properties: { n: { $ref: 'any2skills:common#/$defs/identifier' } } }, '$ref')
    assert.ok(errs.length > 0)
  })
})

describe('子集校验器 · boolean schema', () => {
  it('true 放行、false 拒绝', () => {
    ok('anything', true)
    no('anything', false, 'false')
  })
})
