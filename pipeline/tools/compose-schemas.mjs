/**
 * 组装自包含 schema（ticket 02）
 *
 * 为什么需要这一步：自写的 JSON Schema 子集校验器（决策 Q15）只支持**文档内** `$ref`，
 * 而本项目把公共契约放在 common.schema.json、把九种类型放在 knowledge-object.schema.json。
 * 若不先展开跨文件引用，`any2skills:common#/$defs/...` 会在校验时无法解析——而「无法解析」
 * 若被处理成静默跳过，公共契约（含 sourceRefs 必填）就等于没生效。
 *
 * 本脚本把 common 的 $defs 内联进每个产物，产出的 schema 满足两条硬性质：
 *   1. **无跨文件 $ref**（脚本自检）
 *   2. **只使用受支持的 JSON Schema 关键字**（用子集校验器自检，见 validateSchemaDocument）
 *
 * 性质 2 尤其重要：子集校验器会在遇到未知关键字时报错，因此在组装期就把「写了一个不会生效的
 * 关键字」拦下，而不是等到运行时才发现约束没生效。
 *
 * 用法：node pipeline/tools/compose-schemas.mjs
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateSchemaDocument } from './json-schema-subset.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..')
const SCHEMA_DIR = path.join(REPO_ROOT, 'pipeline', 'schemas')

const COMMON = path.join(SCHEMA_DIR, 'common.schema.json')
const KNOWLEDGE_OBJECT = path.join(SCHEMA_DIR, 'knowledge-object.schema.json')

const EXTERNAL_REF = /^([^#]+)(#.*)?$/

async function readJson(p) {
  return JSON.parse(await readFile(p, 'utf8'))
}

/**
 * 把 schema 中所有跨文件 `$ref` 就地替换为被引用文档中的实际节点，
 * 使结果不依赖任何外部文档。
 */
function inlineExternalRefs(node, docsById, stack = []) {
  if (node === null || typeof node !== 'object') return node
  if (stack.includes(node)) {
    throw new Error('检测到 schema 递归引用环；请先在 schema 内用文档内 $ref 表达递归。')
  }
  if (Array.isArray(node)) return node.map((item) => inlineExternalRefs(item, docsById, stack))

  if (typeof node.$ref === 'string') {
    const m = EXTERNAL_REF.exec(node.$ref)
    const docId = m?.[1]
    if (docId && docId !== '') {
      const targetDoc = docsById.get(docId)
      if (!targetDoc) throw new Error(`无法解析的 $id 引用：${node.$ref}`)
      const pointer = m[2] ?? ''
      let target = targetDoc
      if (pointer && pointer !== '#') {
        const tokens = pointer.replace(/^#\/?/, '').split('/').filter(Boolean)
        for (const raw of tokens) {
          const token = raw.replace(/~1/g, '/').replace(/~0/g, '~')
          if (target === undefined || target === null) {
            throw new Error(`$ref 指针无法解析：${node.$ref}（在 ${token} 处断链）`)
          }
          target = target[token]
        }
      }
      return inlineExternalRefs(structuredClone(target), docsById, [...stack, node])
    }
  }

  const out = {}
  for (const [key, value] of Object.entries(node)) {
    out[key] = inlineExternalRefs(value, docsById, [...stack, node])
  }
  return out
}

/** 收集 schema 中残留的跨文件 $ref（用于自检）。 */
function collectExternalRefs(node, found = []) {
  if (node === null || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    node.forEach((i) => collectExternalRefs(i, found))
    return found
  }
  if (typeof node.$ref === 'string' && EXTERNAL_REF.exec(node.$ref)?.[1]) found.push(node.$ref)
  Object.values(node).forEach((v) => collectExternalRefs(v, found))
  return found
}

async function composeSchemas({ write = true } = {}) {
  const common = await readJson(COMMON)
  const objectTypes = await readJson(KNOWLEDGE_OBJECT)

  const docsById = new Map([
    [common.$id, common],
    [objectTypes.$id, objectTypes],
  ])

  const baseDef = common.$defs.baseObjectProperties

  /** 类型契约里引用到的辅助定义（文档内 #/$defs/... 形式）。内联后这些引用必须仍能解析。 */
  function collectReferencedDefs(node, found = new Set()) {
    if (node === null || typeof node !== 'object') return found
    if (Array.isArray(node)) {
      node.forEach((i) => collectReferencedDefs(i, found))
      return found
    }
    if (typeof node.$ref === 'string') {
      const m = /^#\/\$defs\/(.+)$/.exec(node.$ref)
      if (m) found.add(m[1])
    }
    Object.values(node).forEach((v) => collectReferencedDefs(v, found))
    return found
  }

  /**
   * 合并公共契约与类型契约，得到**单一**封闭对象 schema。
   *
   * 为什么不并列成 allOf 的两个分支：`additionalProperties` 在校验时只看到
   * **本处理层次**的 properties。若把类型分支设为 additionalProperties:false，它会以
   * 「未声明 id / sourceRefs / evidenceGrade」为由拒绝基类字段；若反过来把基类分支设为
   * 封闭，它又会拒绝类型字段。两侧都会自我拒绝，故必须合并成一层。
   *
   * required 取并集；properties 取合并（类型字段优先，避免同名覆盖基类时静默丢失约束）。
   */
  function mergeContracts(base, typeSchema) {
    const properties = { ...base.properties, ...typeSchema.properties }
    const required = [...new Set([...(base.required ?? []), ...(typeSchema.required ?? [])])]
    const merged = {
      type: 'object',
      required,
      properties,
      additionalProperties: typeSchema.additionalProperties ?? false,
    }
    if (typeSchema.description) merged.description = typeSchema.description
    return merged
  }

  const out = {}
  let counter = 0
  for (const [typeName, typeSchema] of Object.entries(objectTypes.$defs)) {
    if (!/^[A-Z]/.test(typeName)) continue // 跳过 slug / quote / bodyText 等辅助定义
    counter += 1
    const merged = mergeContracts(
      structuredClone(baseDef),
      structuredClone(typeSchema),
    )

    // 把合并结果与类型契约引用到的辅助定义，一并作为产物的文档内 $defs。
    // 必须取**传递闭包**：sourceRef 自己引用了 hash，若只扫一层，hash 就不会被带进来，
    // 于是 sourceRef.contentHash 的 $ref 解析不到——而解析不到就意味着那条约束静默消失。
    //   - baseObjectProperties：公共字段契约本身
    //   - 类型契约引用的 quote / bodyText / slug / hash 等（含其自身再引用的定义）
    const rootDefs = { baseObjectProperties: structuredClone(baseDef) }
    const queue = [...collectReferencedDefs(merged)]
    const seen = new Set()
    while (queue.length > 0) {
      const name = queue.shift()
      if (seen.has(name)) continue
      seen.add(name)
      const def = objectTypes.$defs[name] ?? common.$defs[name]
      if (def === undefined) {
        throw new Error(`${typeName}：引用了不存在的辅助定义 #/$defs/${name}`)
      }
      rootDefs[name] = structuredClone(def)
      for (const nested of collectReferencedDefs(def)) {
        if (!seen.has(nested)) queue.push(nested)
      }
    }

    const composed = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: `any2skills:object:${typeName}`,
      title: `${typeName} 知识对象（自包含）`,
      description:
        `由 pipeline/tools/compose-schemas.mjs 从 common.schema.json 与 ` +
        `knowledge-object.schema.json 组装；请勿手工编辑本文件。` +
        `公共契约与类型契约已合并为单一封闭对象，避免 allOf 与 additionalProperties 的相互拒绝。`,
      allOf: [
        // 分支 1：公共契约（不封闭，只负责基类字段的存在性与类型）
        { $ref: '#/$defs/baseObjectProperties' },
        // 分支 2：合并后的封闭对象（负责全部字段——基类 + 类型——及其封闭性）
        merged,
      ],
      $defs: rootDefs,
    }
    const inlined = inlineExternalRefs(composed, docsById)

    const leftover = collectExternalRefs(inlined)
    if (leftover.length > 0) {
      throw new Error(`${typeName}：仍残留跨文件 $ref ${leftover.join(', ')}`)
    }
    const schemaCheck = validateSchemaDocument(inlined)
    if (!schemaCheck.valid) {
      throw new Error(`${typeName}：使用了不受支持的关键字\n  - ${schemaCheck.problems.join('\n  - ')}`)
    }

    out[typeName] = inlined
    if (write) {
      await writeFile(
        path.join(SCHEMA_DIR, `${typeName}.schema.json`),
        JSON.stringify(inlined, null, 2) + '\n',
        'utf8',
      )
    }
  }

  if (counter !== 9) {
    throw new Error(`期望组装 9 种对象类型，实际 ${counter} 种`)
  }
  return out
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const composed = await composeSchemas()
  for (const name of Object.keys(composed)) {
    process.stdout.write(`已组装 pipeline/schemas/${name}.schema.json\n`)
  }
  process.stdout.write(`共 ${Object.keys(composed).length} 种对象类型，全部无跨文件引用且关键字受支持。\n`)
}
