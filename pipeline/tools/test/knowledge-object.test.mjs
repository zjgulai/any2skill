/**
 * ticket 02 的验收测试：九种知识对象的契约（schema + 自写子集校验器）
 *
 * 测试口径沿用先行范例的形态：「一个正例包 + 固定负例集 + 跨对象不变量」。
 * 负例一律以「只改一处」的方式从正例派生，确保失败原因可判定。
 *
 * 说明：本文件引用的是 Kb2Agent 的**测试组织形态**（正/负例配对、跨对象不变量），
 * 不引用其运行结果——该仓库从未在本项目被实际运行。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { validate, validateSchemaDocument, SUPPORTED_KEYWORDS } from '../../tools/json-schema-subset.mjs'
import { allTypes, exampleCopy, validExamples } from './fixtures/objects.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', '..', '..', 'pipeline', 'schemas')
const COMPOSED_NOTE = /由 pipeline\/tools\/compose-schemas\.mjs 从 common\.schema\.json/

const loadSchema = async (name) =>
  JSON.parse(await readFile(path.join(SCHEMA_DIR, `${name}.schema.json`), 'utf8'))

const composedTypes = ['Concept', 'Metric', 'MentalModel', 'DecisionModel', 'Heuristic', 'Case', 'Playbook', 'EngineeringRule', 'AntiPattern']

const expectValid = (data, schema, label) => {
  const { valid, errors } = validate(data, schema)
  assert.ok(valid, `${label} 应当通过，实际错误：\n${JSON.stringify(errors, null, 2)}`)
}

const expectInvalid = (data, schema, label, keywordHint) => {
  const { valid, errors } = validate(data, schema)
  assert.ok(!valid, `${label} 应当被拒绝，却通过了`)
  if (keywordHint) {
    assert.ok(
      errors.some((e) => e.keyword === keywordHint),
      `${label} 期望以 ${keywordHint} 为拒绝理由，实际错误：${JSON.stringify(errors.map((e) => e.keyword))}`,
    )
  }
  return errors
}

describe('02 · schema 自检：九种类型齐备且自包含', () => {
  it('正好组装出 9 种类型的 schema', async () => {
    const files = (await readdir(SCHEMA_DIR)).filter((f) => f.endsWith('.schema.json'))
    const composed = files.filter((f) => composedTypes.includes(f.replace('.schema.json', '')))
    assert.equal(composed.length, 9)
    assert.deepEqual(
      composed.map((f) => f.replace('.schema.json', '')).sort(),
      [...composedTypes].sort(),
    )
  })

  it('每份组装产物里的每个 $ref 都必须能解析（解析不到即约束静默失效）', async () => {
    for (const type of composedTypes) {
      const schema = await loadSchema(type)
      const bad = []
      const walk = (n) => {
        if (n === null || typeof n !== 'object') return
        if (Array.isArray(n)) return n.forEach(walk)
        if (typeof n.$ref === 'string') {
          const m = /^#\/\$defs\/(.+)$/.exec(n.$ref)
          if (!m) {
            bad.push(`非文档内引用：${n.$ref}`)
          } else if (!Object.prototype.hasOwnProperty.call(schema.$defs ?? {}, m[1])) {
            bad.push(`指向不存在的定义：${n.$ref}`)
          }
        }
        Object.values(n).forEach(walk)
      }
      walk(schema)
      assert.deepEqual(bad, [], `${type} 存在无法解析的 $ref：${bad.join('; ')}`)
    }
  })

  it('sourceRef.contentHash 的约束确实生效（hash 定义已被传递收集）', async () => {
    const schema = await loadSchema('Concept')
    const bad = exampleCopy('Concept')
    bad.sourceRefs[0].contentHash = 'not-a-hash'
    expectInvalid(bad, schema, 'contentHash 非法', 'pattern')
    const good = exampleCopy('Concept')
    good.sourceRefs[0].contentHash = 'sha256:' + 'f'.repeat(64)
    expectValid(good, schema, 'contentHash 合法')
  })

  it('每份组装产物都无跨文件 $ref，且只用受支持的关键字', async () => {
    for (const type of composedTypes) {
      const schema = await loadSchema(type)
      assert.match(schema.description ?? '', COMPOSED_NOTE, `${type} 缺少组装来源说明`)

      const external = []
      const walk = (n) => {
        if (n === null || typeof n !== 'object') return
        if (Array.isArray(n)) return n.forEach(walk)
        if (typeof n.$ref === 'string' && n.$ref.split('#')[0] !== '') external.push(n.$ref)
        Object.values(n).forEach(walk)
      }
      walk(schema)
      assert.deepEqual(external, [], `${type} 残留跨文件引用`)

      const check = validateSchemaDocument(schema)
      assert.ok(check.valid, `${type} 使用了不受支持的关键字：${check.problems.join('; ')}`)
    }
  })

  it('源头两份 schema 也只使用受支持的关键字', async () => {
    for (const name of ['common', 'knowledge-object']) {
      const check = validateSchemaDocument(await loadSchema(name))
      assert.ok(check.valid, `${name}：${check.problems.join('; ')}`)
    }
  })

  it('自检确实会报错：含未知关键字的结构必须被判为不合规', () => {
    const bad = { type: 'object', patternProperties: { '^x': { type: 'string' } } }
    const check = validateSchemaDocument(bad)
    assert.equal(check.valid, false)
    assert.match(check.problems.join(''), /patternProperties/)
  })

  it('支持关键字表覆盖本项目实际用到的全部关键字', async () => {
    const used = new Set()
    for (const name of ['common', 'knowledge-object']) {
      const walk = (n) => {
        if (n === null || typeof n !== 'object') return
        if (Array.isArray(n)) return n.forEach(walk)
        for (const [k, v] of Object.entries(n)) {
          if (k === 'properties' || k === '$defs') {
            used.add(k)
            Object.values(v).forEach(walk)
          } else if (k === 'items' || k === 'additionalProperties') {
            used.add(k)
            walk(v)
          } else if (k === 'allOf' || k === 'anyOf' || k === 'oneOf') {
            used.add(k)
            v.forEach(walk)
          } else if (k !== 'description' && k !== 'title') {
            used.add(k)
          }
        }
      }
      walk(await loadSchema(name))
    }
    const unsupported = [...used].filter((k) => !SUPPORTED_KEYWORDS.includes(k))
    assert.deepEqual(unsupported, [], `实际使用的关键字未受支持：${unsupported.join(', ')}`)
  })
})

describe('02 · 正例包：九种类型各有一个通过的正例', () => {
  it('夹具覆盖的正好是九种类型', () => {
    assert.deepEqual(allTypes.sort(), [...composedTypes].sort())
  })

  for (const type of composedTypes) {
    it(`${type} 正例通过`, async () => {
      expectValid(validExamples[type], await loadSchema(type), `${type} 正例`)
    })
  }
})

describe('02 · 公共契约：六项必填与 sourceRefs 硬约束', () => {
  const baseFields = ['id', 'objectType', 'revision', 'status', 'createdAt', 'sourceRefs']

  for (const field of baseFields) {
    it(`缺公共字段「${field}」被拒绝（required）`, async () => {
      const obj = exampleCopy('Concept')
      delete obj[field]
      expectInvalid(obj, await loadSchema('Concept'), `缺 ${field}`, 'required')
    })
  }

  it('sourceRefs 为空数组被拒绝（minItems 1）', async () => {
    const obj = exampleCopy('Concept')
    obj.sourceRefs = []
    expectInvalid(obj, await loadSchema('Concept'), 'sourceRefs 为空', 'minItems')
  })

  it('sourceRefs 缺失是最重要的负例：无出处的对象不得通过', async () => {
    const obj = exampleCopy('EngineeringRule')
    delete obj.sourceRefs
    const errors = expectInvalid(obj, await loadSchema('EngineeringRule'), '无 sourceRefs')
    assert.ok(errors.some((e) => e.keyword === 'required' && /sourceRefs/.test(e.message)))
  })

  it('sourceRef 缺 lineStart / lineEnd 被拒绝', async () => {
    for (const field of ['lineStart', 'lineEnd', 'anchor', 'file']) {
      const obj = exampleCopy('Concept')
      delete obj.sourceRefs[0][field]
      expectInvalid(obj, await loadSchema('Concept'), `sourceRef 缺 ${field}`, 'required')
    }
  })

  it('sourceRef.anchor 允许中文字符（不受 identifier 正则约束）', async () => {
    const obj = exampleCopy('Concept')
    obj.sourceRefs[0].anchor = '『工具』#h2-1' // 含中文与全角括号
    expectValid(obj, await loadSchema('Concept'), 'anchor 含中文')
  })

  it('status 取值受限（枚举外的值被拒）', async () => {
    const obj = exampleCopy('Concept')
    obj.status = 'published'
    expectInvalid(obj, await loadSchema('Concept'), 'status=published', 'enum')
  })

  it('status 五值全部被接受', async () => {
    for (const s of ['draft', 'candidate', 'approved', 'superseded', 'blocked']) {
      const obj = exampleCopy('Concept')
      obj.status = s
      expectValid(obj, await loadSchema('Concept'), `status=${s}`)
    }
  })

  it('revision 必须 ≥1', async () => {
    const obj = exampleCopy('Concept')
    obj.revision = 0
    expectInvalid(obj, await loadSchema('Concept'), 'revision=0', 'minimum')
  })
})

describe('02 · identifier 正则', () => {
  it('合法：单段后接至少一个连字符段', async () => {
    const schema = await loadSchema('Concept')
    for (const id of ['CHAPTER4-H2-1-CONCEPT-01', 'A-B', 'X-1-Y']) {
      const obj = exampleCopy('Concept')
      obj.id = id
      expectValid(obj, schema, `id=${id}`)
    }
  })

  it('非法：含小写字母被拒绝', async () => {
    const obj = exampleCopy('Concept')
    obj.id = 'Chapter4-H2-1'
    expectInvalid(obj, await loadSchema('Concept'), '含小写', 'pattern')
  })

  it('非法：单段（无连字符）被拒绝', async () => {
    const obj = exampleCopy('Concept')
    obj.id = 'CHAPTER4'
    expectInvalid(obj, await loadSchema('Concept'), '单段', 'pattern')
  })

  it('非法：以数字开头被拒绝', async () => {
    const obj = exampleCopy('Concept')
    obj.id = '4-CHAPTER'
    expectInvalid(obj, await loadSchema('Concept'), '数字开头', 'pattern')
  })

  it('非法：含下划线被拒绝', async () => {
    const obj = exampleCopy('Concept')
    obj.id = 'CHAPTER_4-A'
    expectInvalid(obj, await loadSchema('Concept'), '含下划线', 'pattern')
  })
})

describe('02 · 三者边界判据的 schema 层落地', () => {
  it('MentalModel 缺 limits 被拒绝', async () => {
    const obj = exampleCopy('MentalModel')
    delete obj.limits
    expectInvalid(obj, await loadSchema('MentalModel'), '缺 limits', 'required')
  })

  it('MentalModel 缺 counterexample 被拒绝', async () => {
    const obj = exampleCopy('MentalModel')
    delete obj.counterexample
    expectInvalid(obj, await loadSchema('MentalModel'), '缺 counterexample', 'required')
  })

  it('Heuristic 的 confidence 超出 0–1 被拒绝', async () => {
    for (const v of [-0.1, 1.1]) {
      const obj = exampleCopy('Heuristic')
      obj.confidence = v
      expectInvalid(obj, await loadSchema('Heuristic'), `confidence=${v}`)
    }
  })

  it('Heuristic 的 confidence 端点 0 与 1 被接受', async () => {
    for (const v of [0, 1]) {
      const obj = exampleCopy('Heuristic')
      obj.confidence = v
      expectValid(obj, await loadSchema('Heuristic'), `confidence=${v}`)
    }
  })

  it('EngineeringRule 不得携带 confidence（硬规则标置信度是语义失真）', async () => {
    const obj = exampleCopy('EngineeringRule')
    obj.confidence = 0.8
    expectInvalid(obj, await loadSchema('EngineeringRule'), 'EngineeringRule 带 confidence', 'additionalProperties')
  })

  it('Heuristic 不得冒充 EngineeringRule（缺 confidence 被拒）', async () => {
    const obj = exampleCopy('Heuristic')
    delete obj.confidence
    expectInvalid(obj, await loadSchema('Heuristic'), 'Heuristic 缺 confidence', 'required')
  })

  it('DecisionModel 的 reviewState 受同一枚举约束', async () => {
    const obj = exampleCopy('DecisionModel')
    obj.reviewState = 'done'
    expectInvalid(obj, await loadSchema('DecisionModel'), 'reviewState=done', 'enum')
  })
})

describe('02 · 类型诚实性与字段封闭性', () => {
  it('objectType 必须是九值枚举之一', async () => {
    const obj = exampleCopy('Concept')
    obj.objectType = 'SkillCandidate'
    expectInvalid(obj, await loadSchema('Concept'), 'objectType=SkillCandidate', 'enum')
  })

  it('未知类型被拒绝：SkillCandidate 不在对象类型集合内', async () => {
    const obj = exampleCopy('Concept')
    obj.objectType = 'SkillCandidate'
    const { valid } = validate(obj, await loadSchema('Concept'))
    assert.equal(valid, false)
  })

  it('每种类型都拒绝多余字段（additionalProperties）', async () => {
    for (const type of composedTypes) {
      const obj = exampleCopy(type)
      obj.unexpectedExtraField = 'x'
      expectInvalid(
        obj,
        await loadSchema(type),
        `${type} 带多余字段`,
        'additionalProperties',
      )
    }
  })

  it('公共契约分支不得反过来拒绝类型字段（allOf 组合必须自洽）', async () => {
    // 若公共分支用 maxProperties/additionalProperties:false 粗暴封闭，它会以「未声明
    // canonicalTerm」为由拒绝自己允许的对象——这一条就是防这个的回归守卫。
    const common = await loadSchema('common')
    for (const type of composedTypes) {
      const flat = exampleCopy(type)
      const { valid, errors } = validate(flat, common)
      assert.ok(
        valid,
        `公共契约单独校验 ${type} 正例时不应因类型字段而失败，实际：${JSON.stringify(errors)}`,
      )
    }
  })

  it('嵌套对象保持开放：sourceRef 可带额外字段（结构可演进）', async () => {
    for (const type of composedTypes) {
      const obj = exampleCopy(type)
      obj.sourceRefs[0].futureField = 'ok'
      expectValid(obj, await loadSchema(type), `${type} 的 sourceRef 带额外字段`)
    }
  })

  it('Case 的 dataClass 保留但未限定取值（上游只规定字段名）', async () => {
    const obj = exampleCopy('Case')
    obj.dataClass = 'synthetic'
    expectValid(obj, await loadSchema('Case'), 'dataClass=synthetic')
  })
})

describe('02 · 负例集：每种类型至少一个必填字段缺失被拒', () => {
  const requiredByType = {
    Concept: 'canonicalTerm',
    Metric: 'formula',
    MentalModel: 'limits',
    DecisionModel: 'unknownPolicy',
    Heuristic: 'recommendation',
    Case: 'outcome',
    Playbook: 'rollback',
    EngineeringRule: 'violation',
    AntiPattern: 'corrective',
  }

  for (const [type, field] of Object.entries(requiredByType)) {
    it(`${type} 缺必填字段「${field}」被拒绝`, async () => {
      const obj = exampleCopy(type)
      delete obj[field]
      expectInvalid(obj, await loadSchema(type), `${type} 缺 ${field}`, 'required')
    })
  }
})

describe('02 · 跨对象不变量', () => {
  it('全部九种正例的 id 都满足同一 identifier 正则', async () => {
    const pattern = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/
    for (const type of composedTypes) {
      assert.match(validExamples[type].id, pattern, `${type} 的 id 不合正则`)
    }
  })

  it('全部九种正例都恰好携带 6 项公共字段', async () => {
    const baseFields = ['id', 'objectType', 'revision', 'status', 'createdAt', 'sourceRefs']
    for (const type of composedTypes) {
      for (const f of baseFields) {
        assert.ok(f in validExamples[type], `${type} 缺公共字段 ${f}`)
      }
    }
  })

  it('AntiPattern 允许 sourceRefs 覆盖多个章节（跨章综合的承载能力）', () => {
    const obj = validExamples.AntiPattern
    assert.ok(obj.sourceRefs.length >= 2, '该正例应体现跨章引用')
    const files = new Set(obj.sourceRefs.map((r) => r.file))
    assert.equal(files.size, 2, '两个引用应来自不同源文件')
  })
})
