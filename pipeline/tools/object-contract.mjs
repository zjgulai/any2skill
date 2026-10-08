/**
 * 对象契约的**单一真源**（ticket 04 抽出；此前分散在 model-stub 与 verifier 里）
 *
 * 为什么要抽出来：类型集合与各类型必填字段同时被三方使用——第 2 层要按它组织提示词、
 * 第 2 层替身要按它造对象、第 3 层要按它选 schema。三处各写一份，就必然出现
 * 「提示词说必填 A、schema 其实要 B」这类无人察觉的漂移。
 *
 * `TYPE_REQUIRED_FIELDS` 是对 `pipeline/schemas/*.schema.json` 的**摘录**，
 * 由 `object-contract.test.mjs` 与组装后的 schema 逐字比对——因此它不会悄悄过期。
 */

/** 九种对象类型。集合封闭，与 knowledge-object.schema.json 的枚举一致。 */
export const OBJECT_TYPES = Object.freeze([
  'Concept',
  'Metric',
  'MentalModel',
  'DecisionModel',
  'Heuristic',
  'Case',
  'Playbook',
  'EngineeringRule',
  'AntiPattern',
])

/** 公共必填字段（六项，对齐 baseObject 契约）。 */
export const BASE_REQUIRED_FIELDS = Object.freeze([
  'id',
  'objectType',
  'revision',
  'status',
  'createdAt',
  'sourceRefs',
])

/**
 * 各类型的**类型专属**必填字段（不含公共六项）。
 * 摘录自 pipeline/schemas/<Type>.schema.json 的组装产物；证据字段 `evidenceQuote`
 * 不在 schema 的 required 里，但本流水线把它作为硬要求单列于 `PIPELINE_REQUIRED_FIELDS`。
 */
export const TYPE_REQUIRED_FIELDS = Object.freeze({
  Concept: Object.freeze(['canonicalTerm', 'aliases', 'definition', 'examples']),
  Metric: Object.freeze(['name', 'formula', 'inputs', 'unit', 'window', 'failureModes']),
  MentalModel: Object.freeze(['trigger', 'inputs', 'reasoning', 'limits', 'counterexample']),
  DecisionModel: Object.freeze([
    'inputs',
    'branches',
    'outputs',
    'unknownPolicy',
    'stopConditions',
    'reviewState',
  ]),
  Heuristic: Object.freeze(['trigger', 'recommendation', 'confidence', 'exceptions']),
  Case: Object.freeze([
    'title',
    'context',
    'facts',
    'decisions',
    'outcome',
    'evidenceRefs',
    'limitations',
    'dataClass',
  ]),
  Playbook: Object.freeze(['title', 'prerequisites', 'steps', 'checks', 'rollback', 'approval']),
  EngineeringRule: Object.freeze(['statement', 'rationale', 'appliesWhen', 'violation', 'chapterRef']),
  AntiPattern: Object.freeze(['pattern', 'harm', 'corrective', 'evidence', 'chapterRef']),
})

/** 本流水线在 schema 之外额外硬要求的字段（第 3 层的逐字比对判据依赖它）。 */
export const PIPELINE_REQUIRED_FIELDS = Object.freeze(['evidenceQuote'])

/**
 * 各类型的**主张字段**：该对象「到底主张了什么」由哪几个字段承载（ticket 05 的判定者用它）。
 *
 * 为什么必须逐类型列举，而不是把整个对象交给判定者：
 * 规格 D6 要求判定者「只接收引文与该锚点区间的文本」并判定「该引文是否支撑该对象的主张」。
 * 把整个对象递给判定者会同时越界两处——它会把 `id` / `sourceRefs` / `createdAt`
 * 这类与主张无关的元数据一并读入，且对象新增字段时会**静默扩大**判定者的视野。
 * 因此判定者的输入是**构造**出来的：只按本表取字段，其余一律不进。
 *
 * ## 取字段的两条判据（顺序即本表内的书写顺序）
 *
 * **一、范围限定类字段进。** 任何「把断言收窄到某个适用面」的字段都属于主张本身——
 * 抽掉它，一个有界的对象会被读成一个**无界**的断言，从而被误判为过度断言。
 * 实测反证：`CHAPTER4-H4-2-HEURISTIC-02` 的限定词在 `trigger` 里，而当时的本表只取了
 * `recommendation`，于是判定者看到一条无界推荐并（正确地）判它不被引文支撑——
 * 不完整是我们造成的，不是对象的问题。
 *   `Metric.window` / `MentalModel.trigger` / `Heuristic.trigger` / `EngineeringRule.appliesWhen`
 *
 * **二、断言与指代类字段进。** 事实陈述本身（`statement` / `pattern` / `reasoning` /
 * `recommendation` / `formula` / `definition` / `outcome`）是断言，必须进；标识与标题
 * （`canonicalTerm` / `name` / `title`）本身不断言什么，但离开它断言**指代不明**
 * （「引文支持『这个定义』」无从判断），故一并进。
 *
 * **三、明确的「不进」清单**（每一项都是踩过的坑）：
 *   - `examples` / `aliases` / `evidence`：断言的**展开**，不是断言本身。把它们并入主张
 *     会让主张**变大**、判定变严——与判据一正好相反，是同一类错误的镜像。
 *   - `Case.context`：一段**叙述**，不是限定。它是背景交代，不构成适用范围。
 *   - `DecisionModel.inputs`：声明**输入是什么**，不是划定适用面——分支条件本身已在
 *     `branches` 里，再并入 `inputs` 只会平添断言。
 *   - `Playbook.prerequisites`：前置条件描述**执行前提**，不描述「这套流程在什么情况下成立」。
 *   - `limits` / `counterexample` / `exceptions` / `rollback` / `violation` / `harm` 之外的边界字段：
 *     它们是边界的**展开说明**。
 *
 * 由此表与 `TYPE_REQUIRED_FIELDS` 的关系：本表的每个字段都必须是该类型的必填字段
 * （由 `object-contract.test.mjs` 断言）。反过来不成立——不是每个必填字段都是主张。
 */
export const CLAIM_FIELDS = Object.freeze({
  Concept: Object.freeze(['canonicalTerm', 'definition']),
  Metric: Object.freeze(['window', 'name', 'formula']),
  MentalModel: Object.freeze(['trigger', 'reasoning']),
  DecisionModel: Object.freeze(['branches', 'outputs']),
  Heuristic: Object.freeze(['trigger', 'recommendation']),
  Case: Object.freeze(['title', 'outcome']),
  Playbook: Object.freeze(['title', 'steps']),
  EngineeringRule: Object.freeze(['appliesWhen', 'statement']),
  AntiPattern: Object.freeze(['pattern', 'harm']),
})

/**
 * 各类型字段的**形状**（供第 2 层提示词使用）。
 *
 * 为什么需要它：实测第 2 层首轮产出的 9 条拒绝里，6 条是纯形状错误——
 * `AntiPattern.evidence` 写成了字符串、`EngineeringRule.appliesWhen`/`violation` 写成了数组、
 * `Concept.examples` 给了空数组。这些与知识无关，纯粹是契约没在提示词里说清，
 * 而每一条都要一次模型调用才换得回来。
 *
 * 记法与 `TYPE_REQUIRED_FIELDS` 一样是**摘录**，由测试与组装后的 schema 逐字比对：
 * 字符串字段必须是 `string`，数组字段必须给出 `minItems`（1 表示不得为空）。
 */
export const TYPE_FIELD_SHAPES = Object.freeze({
  Concept: Object.freeze({
    canonicalTerm: { kind: 'string' },
    aliases: { kind: 'array' },
    definition: { kind: 'string' },
    examples: { kind: 'array', minItems: 1 },
  }),
  Metric: Object.freeze({
    name: { kind: 'string' },
    formula: { kind: 'string' },
    inputs: { kind: 'array', minItems: 1 },
    unit: { kind: 'string' },
    window: { kind: 'string' },
    failureModes: { kind: 'array' },
  }),
  MentalModel: Object.freeze({
    trigger: { kind: 'string' },
    inputs: { kind: 'array' },
    reasoning: { kind: 'string' },
    limits: { kind: 'string' },
    counterexample: { kind: 'string' },
  }),
  DecisionModel: Object.freeze({
    inputs: { kind: 'array', minItems: 1 },
    branches: { kind: 'array', minItems: 1, itemShape: '{ "condition": "…", "action": "…" }' },
    outputs: { kind: 'array', minItems: 1 },
    unknownPolicy: { kind: 'string' },
    stopConditions: { kind: 'array', minItems: 1 },
    reviewState: { kind: 'string', enum: ['draft', 'candidate', 'approved', 'superseded', 'blocked'] },
  }),
  Heuristic: Object.freeze({
    trigger: { kind: 'string' },
    recommendation: { kind: 'string' },
    confidence: { kind: 'number', minimum: 0, maximum: 1 },
    exceptions: { kind: 'array' },
  }),
  Case: Object.freeze({
    title: { kind: 'string' },
    context: { kind: 'string' },
    facts: { kind: 'array', minItems: 1 },
    decisions: { kind: 'array', minItems: 1 },
    outcome: { kind: 'string' },
    evidenceRefs: { kind: 'array', minItems: 1, derived: true },
    limitations: { kind: 'array', minItems: 1 },
    dataClass: { kind: 'string' },
  }),
  Playbook: Object.freeze({
    title: { kind: 'string' },
    prerequisites: { kind: 'array' },
    steps: { kind: 'array', minItems: 1, itemShape: '{ "order": 1, "action": "…" }' },
    checks: { kind: 'array' },
    rollback: { kind: 'string' },
    approval: { kind: 'string' },
  }),
  EngineeringRule: Object.freeze({
    statement: { kind: 'string' },
    rationale: { kind: 'string' },
    appliesWhen: { kind: 'string' },
    violation: { kind: 'string' },
    chapterRef: { kind: 'string', derived: true },
  }),
  AntiPattern: Object.freeze({
    pattern: { kind: 'string' },
    harm: { kind: 'string' },
    corrective: { kind: 'string' },
    evidence: { kind: 'array', minItems: 1 },
    chapterRef: { kind: 'string', derived: true },
  }),
})

/** 把某个类型的字段形状渲染成提示词里的一行。 */
export function describeFieldShapes(type) {
  const shapes = TYPE_FIELD_SHAPES[type]
  return TYPE_REQUIRED_FIELDS[type]
    .map((field) => {
      const s = shapes[field]
      if (!s) throw new Error(`字段形状表缺 ${type}.${field}`)
      if (s.derived === true) return `${field}(由流水线填入，你不要给)`
      const enumNote = Array.isArray(s.enum) ? `，取值必须是 ${s.enum.join(' / ')}` : ''
      if (s.kind === 'string') return `${field}(字符串${enumNote})`
      if (s.kind === 'array') {
        const min = s.minItems === undefined ? '可为空' : `至少 ${s.minItems} 项`
        return `${field}(数组，${min}${s.itemShape ? `，元素形如 ${s.itemShape}` : ''})`
      }
      if (s.kind === 'number') return `${field}(数字，${s.minimum}–${s.maximum})`
      throw new Error(`未知字段形状：${type}.${field} → ${JSON.stringify(s)}`)
    })
    .join(' / ')
}

/** 三者边界判据（ADR-003 / 规格 D5）。第 2 层的提示词必须逐字携带它。 */
export const TYPE_BOUNDARY_CRITERIA = Object.freeze([
  '可证伪且无概率 → EngineeringRule',
  '有置信度（0–1）或例外 → Heuristic',
  '多分支选择且需输入输出契约 → DecisionModel',
])

/** `chapter4#h3-1` → 3 与 1。锚点标识本身即「层级 + 该层级内序号」的规范形式。 */
export function parseAnchorToken(anchor) {
  const m = /^(.+)#h([1-6])-(\d+)$/.exec(anchor)
  if (!m) throw new Error(`锚点标识不是 {fileKey}#h{level}-{n} 形式：${anchor}`)
  return { level: Number(m[2]), ordinal: Number(m[3]) }
}

/**
 * 对象标识的确定性生成：`{锚点标识大写}-{类型大写}-{该锚点内对象序号}`。
 *
 * 例：锚点 `chapter4#h3-1`（chapterRef 为 `chapter4-h3-1`）+ 类型 Playbook + 序号 01
 *     → `CHAPTER4-H3-1-PLAYBOOK-01`
 *
 * 序号是「**该锚点内**的对象序号」，不含全局计数——因此新增/删除别的锚点的对象
 * 不会改变本对象的 id，重跑也不产生新 id（下游可按 id 稳定引用）。
 */
export function objectIdFor(chapterRef, type, seq) {
  const seg = chapterRef.toUpperCase()
  if (!/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$/.test(seg)) {
    throw new Error(`由锚点推导出的标识段不合 identifier 正则：${seg}`)
  }
  return `${seg}-${type.toUpperCase()}-${String(seq).padStart(2, '0')}`
}
