/**
 * JSON Schema 子集校验器（ticket 02 / 决策 Q15）
 *
 * 为什么不装 ajv：本项目要求「离线可重跑、不引入需要网络安装的运行时依赖」，而实测本机
 * 不存在任何可用的通用校验器（Node 无内建，全局目录无 ajv；Python 侧 jsonschema 亦缺失）。
 * 因此自写一个**显式子集**校验器，并把支持的关键字表列在下面，由测试逐条钉住。
 *
 * 支持的关键字（封闭集合，超出此集合的关键字会被显式报错，绝不静默忽略）：
 *   $schema $id $ref $defs title description
 *   type required properties additionalProperties items minItems maxItems uniqueItems
 *   minProperties maxProperties
 *   enum const oneOf anyOf allOf not
 *   pattern minLength maxLength
 *   minimum maximum exclusiveMinimum exclusiveMaximum
 *
 * 不支持：format / patternProperties / if-then-else / dependencies / additionalItems /
 *        contains / propertyNames / $dynamicRef 等。
 * 「显式报错」是本模块的核心设计：静默忽略未知关键字会让 schema 作者以为约束生效了，
 * 而实际上校验被悄悄放行——这正是本项目最需要避免的失败模式。
 */

export const SUPPORTED_KEYWORDS = Object.freeze([
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'title',
  'description',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'enum',
  'const',
  'oneOf',
  'anyOf',
  'allOf',
  'not',
  'pattern',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
])

const SCHEMA_KEYWORDS = new Set(SUPPORTED_KEYWORDS)

function typeOf(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (Number.isInteger(value)) return 'integer'
  return typeof value
}

/** JSON Schema 的 `type` 语义：integer 亦满足 number。 */
function matchesType(value, type) {
  const actual = typeOf(value)
  if (type === 'number') return actual === 'number' || actual === 'integer'
  return actual === type
}

function jsonPointerEscape(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1')
}

function resolveJsonPointer(root, pointer) {
  if (pointer === '' || pointer === '#') return root
  const fragment = pointer.startsWith('#') ? pointer.slice(1) : pointer
  if (fragment === '') return root
  if (!fragment.startsWith('/')) throw new Error(`不支持的 $ref 形式：${pointer}`)
  return fragment
    .slice(1)
    .split('/')
    .map((t) => t.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((acc, token) => {
      if (acc === undefined || acc === null) throw new Error(`$ref 无法解析：${pointer}`)
      return acc[token]
    }, root)
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

function deepEqual(a, b) {
  return stableStringify(a) === stableStringify(b)
}

/**
 * 校验 data 是否符合 schema。
 *
 * @param {unknown} data
 * @param {object} schema 根 schema（`$ref` 一律相对该文档解析）
 * @param {string} [instancePath] 内部递归用，调用方无需传
 * @returns {{valid: boolean, errors: {instancePath: string, schemaPath: string, keyword: string, message: string}[]}}
 */
export function validate(data, schema, instancePath = '') {
  const errors = []
  run(data, schema, schema, instancePath, '', errors)
  return { valid: errors.length === 0, errors }
}

/** 校验 schema 本身是否只用了受支持的关键字。 */
export function validateSchemaDocument(schema) {
  const problems = []
  const seen = new WeakSet()

  const walk = (node, at) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}/${i}`))
      return
    }
    for (const key of Object.keys(node)) {
      if (!SCHEMA_KEYWORDS.has(key)) {
        problems.push(
          `${at || '<root>'}：不支持的 JSON Schema 关键字「${key}」——` +
            `本校验器只支持显式子集，未知关键字必须报错而不是被静默忽略。`,
        )
        continue
      }
      if (key === '$defs' || key === 'properties') {
        for (const [name, sub] of Object.entries(node[key] ?? {})) {
          walk(sub, `${at}/${key}/${jsonPointerEscape(name)}`)
        }
      } else if (key === 'items' || key === 'not' || key === 'additionalProperties') {
        walk(node[key], `${at}/${key}`)
      } else if (key === 'oneOf' || key === 'anyOf' || key === 'allOf') {
        ;(node[key] ?? []).forEach((sub, i) => walk(sub, `${at}/${key}/${i}`))
      }
    }
  }

  walk(schema, '')
  return { valid: problems.length === 0, problems }
}

function run(data, schema, root, instancePath, schemaPath, errors) {
  if (schema === true) return
  if (schema === false) {
    errors.push({ instancePath, schemaPath: schemaPath || '/', keyword: 'false', message: '该位置被 schema 禁止（false schema）' })
    return
  }
  if (schema === null || typeof schema !== 'object') return

  // ---- $ref：解析后继续校验（本项目的 schema 不在 $ref 旁并列其他关键字） ----
  if (typeof schema.$ref === 'string') {
    let target
    try {
      target = resolveJsonPointer(root, schema.$ref)
    } catch (err) {
      errors.push({
        instancePath,
        schemaPath: schemaPath || '/$ref',
        keyword: '$ref',
        message: err.message,
      })
      return
    }
    run(data, target, root, instancePath, `${schemaPath}/$ref→${schema.$ref}`, errors)
    return
  }

  const fail = (keyword, message) =>
    errors.push({ instancePath, schemaPath: `${schemaPath}/${keyword}`, keyword, message })

  // ---- type ----
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => matchesType(data, t))) {
      fail('type', `期望类型 ${types.join(' | ')}，实际为 ${typeOf(data)}`)
    }
  }

  // ---- const / enum ----
  if (schema.const !== undefined && !deepEqual(data, schema.const)) {
    fail('const', `必须等于 ${JSON.stringify(schema.const)}，实际为 ${JSON.stringify(data)}`)
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((v) => deepEqual(data, v))) {
    fail('enum', `必须是 ${schema.enum.map((v) => JSON.stringify(v)).join(' | ')} 之一，实际为 ${JSON.stringify(data)}`)
  }

  // ---- 字符串 ----
  if (typeof data === 'string') {
    if (schema.minLength !== undefined && [...data].length < schema.minLength) {
      fail('minLength', `长度须 ≥ ${schema.minLength}，实际 ${[...data].length}`)
    }
    if (schema.maxLength !== undefined && [...data].length > schema.maxLength) {
      fail('maxLength', `长度须 ≤ ${schema.maxLength}，实际 ${[...data].length}`)
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(data)) {
      fail('pattern', `不匹配正则 /${schema.pattern}/：${JSON.stringify(data)}`)
    }
  }

  // ---- 数值 ----
  if (typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) fail('minimum', `须 ≥ ${schema.minimum}，实际 ${data}`)
    if (schema.maximum !== undefined && data > schema.maximum) fail('maximum', `须 ≤ ${schema.maximum}，实际 ${data}`)
    if (schema.exclusiveMinimum !== undefined && data <= schema.exclusiveMinimum)
      fail('exclusiveMinimum', `须 > ${schema.exclusiveMinimum}，实际 ${data}`)
    if (schema.exclusiveMaximum !== undefined && data >= schema.exclusiveMaximum)
      fail('exclusiveMaximum', `须 < ${schema.exclusiveMaximum}，实际 ${data}`)
  }

  // ---- 数组 ----
  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems)
      fail('minItems', `至少 ${schema.minItems} 项，实际 ${data.length}`)
    if (schema.maxItems !== undefined && data.length > schema.maxItems)
      fail('maxItems', `至多 ${schema.maxItems} 项，实际 ${data.length}`)
    if (schema.uniqueItems === true) {
      const seen = new Set()
      data.forEach((item, i) => {
        const key = stableStringify(item)
        if (seen.has(key)) fail('uniqueItems', `第 ${i} 项与前项重复：${key.slice(0, 80)}`)
        seen.add(key)
      })
    }
    if (schema.items !== undefined) {
      data.forEach((item, i) => run(item, schema.items, root, `${instancePath}/${i}`, `${schemaPath}/items`, errors))
    }
  }

  // ---- 对象 ----
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const ownKeys = Object.keys(data)
    if (schema.minProperties !== undefined && ownKeys.length < schema.minProperties) {
      fail('minProperties', `属性数须 ≥ ${schema.minProperties}，实际 ${ownKeys.length}`)
    }
    if (schema.maxProperties !== undefined && ownKeys.length > schema.maxProperties) {
      fail('maxProperties', `属性数须 ≤ ${schema.maxProperties}，实际 ${ownKeys.length}`)
    }
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          fail('required', `缺少必填字段「${key}」`)
        }
      }
    }
    const props = schema.properties ?? {}
    for (const [key, sub] of Object.entries(props)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        run(data[key], sub, root, `${instancePath}/${jsonPointerEscape(key)}`, `${schemaPath}/properties/${jsonPointerEscape(key)}`, errors)
      }
    }
    if (schema.additionalProperties !== undefined && schema.additionalProperties !== true) {
      for (const key of Object.keys(data)) {
        if (Object.prototype.hasOwnProperty.call(props, key)) continue
        if (schema.additionalProperties === false) {
          fail('additionalProperties', `不允许未知字段「${key}」（字段集合封闭）`)
        } else {
          run(data[key], schema.additionalProperties, root, `${instancePath}/${jsonPointerEscape(key)}`, `${schemaPath}/additionalProperties`, errors)
        }
      }
    }
  }

  // ---- 组合 ----
  if (Array.isArray(schema.allOf)) {
    schema.allOf.forEach((sub, i) => run(data, sub, root, instancePath, `${schemaPath}/allOf/${i}`, errors))
  }
  if (Array.isArray(schema.anyOf)) {
    const results = schema.anyOf.map((sub) => {
      const e = []
      run(data, sub, root, instancePath, `${schemaPath}/anyOf`, e)
      return e
    })
    if (!results.some((e) => e.length === 0)) {
      fail('anyOf', `不满足 anyOf 的任一分支（共 ${schema.anyOf.length} 个分支）`)
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((sub) => {
      const e = []
      run(data, sub, root, instancePath, `${schemaPath}/oneOf`, e)
      return e.length === 0
    }).length
    if (matches !== 1) fail('oneOf', `oneOf 须恰有 1 个分支匹配，实际 ${matches} 个`)
  }
  if (schema.not !== undefined) {
    const e = []
    run(data, schema.not, root, instancePath, `${schemaPath}/not`, e)
    if (e.length === 0) fail('not', '命中了 not 所禁止的 schema')
  }
}
