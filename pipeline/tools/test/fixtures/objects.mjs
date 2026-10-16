/**
 * 知识对象测试夹具（ticket 02）
 *
 * 每种类型一个**正例**，并以「只改一处」的方式派生负例——这样负例失败时能确定失败原因，
 * 而不是「这份 JSON 有很多问题所以被拒了」。
 *
 * 正例中的所有内容都取自本项目已核实的事实，不编造业务数据。
 * sourceRefs 指向的锚点取自 ticket 01 在 chapter4.md 上的实测产出（h2-2 行 34–37、
 * h3-1 行 38–69），可被第 3 层实际解析。
 */

const SOURCE_FILE = 'sources/ai-agent-book-zh/book/chapter4.md'

const sourceRefPrimary = {
  file: SOURCE_FILE,
  anchor: 'chapter4#h3-1',
  title: '能力的表达形式：专用工具、通用执行器与 Skill',
  lineStart: 38,
  lineEnd: 69,
  contentHash: 'sha256:' + 'a'.repeat(64),
}

const sourceRefCrossChapter = {
  file: 'sources/ai-agent-book-zh/book/chapter5.md',
  anchor: 'chapter5#h2-2',
  lineStart: 40,
  lineEnd: 90,
}

export const base = (objectType, id) => ({
  id,
  objectType,
  revision: 1,
  status: 'candidate',
  createdAt: '2026-10-08T12:00:00Z',
  sourceRefs: [structuredClone(sourceRefPrimary)],
  evidenceGrade: 'E2-derived',
  freshness: { state: 'fresh', asOf: '2026-10-08T12:00:00Z' },
})

/** 九种类型的正例。键名与 objectType 一致。 */
export const validExamples = {
  Concept: {
    ...base('Concept', 'CHAPTER4-H3-1-CONCEPT-01'),
    canonicalTerm: 'ACI（Agent-Computer Interface）',
    aliases: ['Agent 计算机接口'],
    definition:
      '工具应对应 Agent 的目标，而不是底层的 API 操作；ACI 是对标 HCI 提出的概念，核心是让工具对 Agent 而非对人友好。',
    examples: ['把「部署应用」做成一个目标级工具，而不是拆成构建/打包/部署三个 API 级工具。'],
    evidenceQuote: '工具应该对应 Agent 的目标，而不是底层的 API 操作。',
  },

  Metric: {
    ...base('Metric', 'CHAPTER4-H2-2-METRIC-01'),
    name: '上下文占用率',
    formula: 'occupancy = usedTokens / contextWindow',
    inputs: ['usedTokens', 'contextWindow'],
    unit: 'ratio',
    window: '单次会话',
    failureModes: ['窗口估算偏小会导致超限截断', '把缓存命中部分计入占用会高估'],
    evidenceQuote: '一份 skill 在目录里只占几十个 token，正文用到时才读。',
  },

  MentalModel: {
    ...base('MentalModel', 'CHAPTER4-H3-1-MENTALMODEL-01'),
    trigger: '需要决定某个能力该做成专用工具、通用执行器还是 Skill 文档时',
    inputs: ['能力的目标粒度', '调用频次', '参数约束强度'],
    reasoning: '沿「专用—通用」谱系取舍：越专用越确定、越可测试，但定义本身占用的 token 越多。',
    limits: '当能力需要跨多步交互、且每步参数依赖运行时结果时，专用工具的表达能力不足。',
    counterexample: '把「部署应用」拆成三个更细的工具并不总是更好——粒度太细会迫使 Agent 协调多个工具才能完成一个目标。',
    evidenceQuote: '同一件事——比如“部署应用”——可以做成一个 deploy_app 专用工具，可以拆成构建、打包、部署三个更细的工具，也可以干脆不做工具，只写一份 Skill 文档。',
  },

  DecisionModel: {
    ...base('DecisionModel', 'CHAPTER4-H3-1-DECISIONMODEL-01'),
    inputs: ['目标是否需要确定性参数约束', '是否需要跨环境复用'],
    branches: [
      { condition: '需要强参数约束与确定性行为', action: '做成专用工具' },
      { condition: '步骤随环境变化、以自然语言描述更稳', action: '写成 Skill 文档，用通用执行器运行' },
    ],
    outputs: ['工具定义或 Skill 文档'],
    unknownPolicy: '当目标粒度无法判定时，默认选择通用形式，待出现重复调用再收敛为专用工具。',
    stopConditions: ['同一能力反复出现参数歧义，说明专用化不足，应停止继续用 Skill 形式承载'],
    reviewState: 'candidate',
    evidenceQuote: '这些选项构成一条从**专用**到**通用**的谱系。',
  },

  Heuristic: {
    ...base('Heuristic', 'CHAPTER4-H3-2-HEURISTIC-01'),
    trigger: '为工具编写给模型看的描述时',
    recommendation: '描述应写清「什么时候用」而不只是「能做什么」，因为模型选择工具依赖描述的触发语义。',
    confidence: 0.7,
    exceptions: ['当工具是唯一的同类能力、不存在选择歧义时，描述的触发语义重要性下降'],
    evidenceQuote: '工具描述的艺术',
  },

  Case: {
    ...base('Case', 'CHAPTER4-H3-1-CASE-01'),
    title: '把 API 端点直接包装成工具导致的粒度问题',
    context: '早期工具设计的常见形态是直接把每个 API 端点包成一个工具。',
    facts: ['粒度过细', 'Agent 往往要协调好几个工具才能完成一个目标'],
    decisions: ['改为按 Agent 目标而非 API 操作来定义工具'],
    outcome: '工具数量下降，单次任务所需的工具协调步数减少。',
    evidenceRefs: [structuredClone(sourceRefPrimary)],
    limitations: ['原文未给出量化对比数据，结论为定性描述'],
    dataClass: 'public',
    evidenceQuote: '工具设计的早期形态是直接的 API 封装——把每个 API 端点包成一个工具，粒度过细。',
  },

  Playbook: {
    ...base('Playbook', 'CHAPTER4-H3-1-PLAYBOOK-01'),
    title: '为一个能力选择表达形式',
    prerequisites: ['已明确该能力的目标（而非底层操作）'],
    steps: [
      { order: 1, action: '写下能力对应的目标，而不是实现它的 API 序列' },
      { order: 2, action: '判断是否需要强参数约束：需要则倾向专用工具', note: '参数受 schema 约束是专用工具的主要优势' },
      { order: 3, action: '若步骤随环境变化，改写为 Skill 文档交由通用执行器运行' },
    ],
    checks: ['产出的工具数量没有随 API 数量线性膨胀'],
    rollback: '若专用工具数量失控，退回 Skill 文档形式，只在出现重复调用后再专门化。',
    approval: 'none',
    evidenceQuote: '工具应该对应 Agent 的**目标**，而不是底层的 API 操作。',
  },

  EngineeringRule: {
    ...base('EngineeringRule', 'CHAPTER4-H3-1-ENGINEERINGRULE-01'),
    statement: '工具应对应目标，不对应 API 端点。',
    rationale: '按 API 端点定义工具会使粒度与接口数量绑定，而非与 Agent 的目标绑定。',
    appliesWhen: '设计任何被 Agent 调用的工具时',
    violation: '工具数量随 API 数量膨胀；Agent 需要协调多个工具才能完成一个目标，调用步数与出错面同时上升。',
    chapterRef: 'chapter4-h3-1',
    evidenceQuote: '工具应该对应 Agent 的**目标**，而不是底层的 API 操作。',
  },

  AntiPattern: {
    ...base('AntiPattern', 'CHAPTER4-H3-1-ANTIPATTERN-01'),
    sourceRefs: [structuredClone(sourceRefPrimary), structuredClone(sourceRefCrossChapter)],
    pattern: '按 API 端点逐个包装工具，使工具粒度与底层接口一一对应。',
    harm: '粒度过细，Agent 往往要协调好几个工具才能完成一个目标；同时每个工具定义都占用上下文预算。',
    corrective: '按 Agent 的目标定义工具，把多个 API 调用收敛到一个目标级工具里。',
    evidence: ['工具设计的早期形态是直接的 API 封装——把每个 API 端点包成一个工具，粒度过细。'],
    chapterRef: 'chapter4-h3-1',
    evidenceQuote: '工具设计的早期形态是直接的 API 封装——把每个 API 端点包成一个工具，粒度过细，Agent 往往要协调好几个工具才能完成一个目标。',
  },
}

/** 浅拷贝一个正例，便于测试「只改一处」。 */
export function exampleCopy(objectType) {
  return structuredClone(validExamples[objectType])
}

export const allTypes = Object.keys(validExamples)
