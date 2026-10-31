#!/usr/bin/env node
/**
 * 卡 33 · 四层记忆蒸馏入库脚本（Nowledge Mem / SOP v2.0 六步法第 4 步）
 *
 * 单一真源：16 条记忆正文只在本文件的 MEMORIES 数组维护；specs/04 §3 只做索引。
 * 默认 --dry-run：只写本地 JSONL 与统计，零 nmem 调用。
 * 显式 --apply：逐条 `nmem memories add --id ...`（确定性 upsert，二次运行 +0）。
 */

import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

// ── 配置常量 ──────────────────────────────────────────────────────────────
const DEFAULT_SPACE = 'any2skills'
const DEFAULT_AGENT = 'any2skills-steward'
const LAYER_UNIT_TYPE = { 1: 'decision', 2: 'fact', 3: 'learning', 4: 'context' }
const LAYER_WHEN = { 1: 'timeless', 2: 'timeless', 3: 'timeless', 4: 'past' }
const VALID_UNIT_TYPES = new Set([
  'fact', 'preference', 'decision', 'plan',
  'procedure', 'learning', 'context', 'event',
])

// ── 16 条四层记忆（L1 4 / L2 4 / L3 6 / L4 2）─────────────────────────────
// 每条 content 2–5 句、去空白字符 ≤300；source 指向仓库内出处。
const MEMORIES = [
  {
    id: 'any2skills-l1-01',
    layer: 1,
    title: '证据可回查是最高红线：无 sourceRefs 不得进入下一环节',
    importance: 1.0,
    unitType: 'decision',
    labels: ['evidence', 'redline'],
    source: 'docs/adr/ADR-003-ir-knowledge-object-model.md',
    content: '每条知识对象必须带 sourceRefs（源文件+锚点+行号区间）与可逐字比对的 evidenceQuote；无来源对象硬拒绝、无豁免。与「让大模型直接读文档写 skill」的分界线，就是中间存在机器可判定的 IR：锚点索引+类型化对象+逐字引文+回执。任何规则、数字与发布结论都必须能反查到具体行号。',
  },
  {
    id: 'any2skills-l1-02',
    layer: 1,
    title: '构建者不得自评，三道门禁必须独立',
    importance: 1.0,
    unitType: 'decision',
    labels: ['quality-gates', 'independence'],
    source: 'docs/adr/ADR-006-three-quality-gates.md',
    content: '质量判定由独立于生产者的执行者完成：门禁一是确定性脚本，门禁二是只看 name+description 的盲测 agent，门禁三是消费者 A/B；基准比对由独立 agent 在产出冻结后执行。门禁一通过只证明「装得出来」，门禁三才回答「装上有没有用、会不会有害」。negative transfer 必须在复跑中复现后拒绝，不能仅标注。',
  },
  {
    id: 'any2skills-l1-03',
    layer: 1,
    title: '诚实披露优先于漂亮指标：passed/low-utility/rejected 三态如实标注',
    importance: 1.0,
    unitType: 'decision',
    labels: ['honesty', 'low-utility'],
    source: 'docs/adr/ADR-030-low-utility-governance.md',
    content: '技能档位如实标注：passed=实测有改进；low-utility=在本测量设计下未测出效用增量（不是「无用」也不是「没测过」）；rejected=退化复跑复现，移入 registry/rejected 并写 REJECTION.md，内容不随重组复活。发布数不能当 KPI；重测必须有因，禁止换样本直到测出改进。任何效应先给同档噪声带，否则不得归因。',
  },
  {
    id: 'any2skills-l1-04',
    layer: 1,
    title: '零静默与平面隔离：不静默覆盖、不静默丢失、不静默忽略',
    importance: 1.0,
    unitType: 'decision',
    labels: ['isolation', 'zero-silence'],
    source: 'docs/adr/ADR-001-mvp-scope-full-book.md',
    content: '生成链路只写 pipeline/knowledge 与 pipeline/registry，skills/ 只接收门禁一通过的产物；旧产物先归档 history，拒绝例移入 registry/rejected。生成链路禁止读取 benchmark/，隔离由每进程独立的 fs 账本反证；账本缺席或截断时不得判隔离通过。缺门禁回执即拒绝装配——没有回执不等于都通过。',
  },
  {
    id: 'any2skills-l2-01',
    layer: 2,
    title: '产品定义与当前资产基线（截至 2026-10-31）',
    importance: 0.9,
    unitType: 'fact',
    labels: ['product', 'baseline'],
    source: 'reports/Know-项目成果总结-20261031.md',
    content: 'any2skills（成果报告内称「Know」）是「Any content → executable Agent Skills」的生产管线，分界线是中间存在机器可判定的 IR。截至 2026-10-31：发布区 17 个任务型技能（6 Agent 工程+11 Rust），档位 7 passed / 10 low-utility / 0 rejected；全库 1089 条知识对象（1075 唯一 id，9 类）；32 篇 ADR、32 张执行卡。资产计数会随演进漂移，引用时以盘上复算为准。',
  },
  {
    id: 'any2skills-l2-02',
    layer: 2,
    title: '两个信息源与粒度：章级 13 md + 节级 105 md',
    importance: 0.9,
    unitType: 'fact',
    labels: ['sources', 'granularity'],
    source: 'docs/specs/01-pipeline-spec.md',
    content: '第一源《深入理解 AI Agent》中文版在 sources/ai-agent-book-zh：13 个 md（章级，1102782 字节，336 锚点/604 对象）+ chapter4 代码镜像 851 个文件与 1 份 MIRROR-MANIFEST（盘上共 852 个文件）。第二源《Rust 程序设计语言》中文版在 sources/rust-book-cn：105 个 md（mdBook 节级，513 锚点，pin commit cde74c4）。第二源判据零改动跑通，证明「any content」成立。',
  },
  {
    id: 'any2skills-l2-03',
    layer: 2,
    title: '三道门禁分工与 16,568 字节体积阈值',
    importance: 0.9,
    unitType: 'fact',
    labels: ['quality-gates', 'thresholds'],
    source: 'docs/adr/ADR-028-size-limit-aligned-to-source.md',
    content: '门禁一「契约与证据」查结构合规：确定性、零成本、全量必过，实测拒绝率 3.8%。门禁二「触发盲测」每候选 3 应触发+20 无关场景，只看乱序代号+name+description，40 候选×120 场景共 280 次，只产出 merge/demote/risk-sampling 清单。门禁三「效用 A/B」每 skill 6 任务、K=6 复跑，判定三态。体积阈值 16568 字节来自原书最大 skill 实测值。「准入 ≠ 效用」，发布数不能当 KPI。',
  },
  {
    id: 'any2skills-l2-04',
    layer: 2,
    title: '多源命名空间纪律：缺省源逐字节不变，其他源加 .<key> 后缀',
    importance: 0.9,
    unitType: 'fact',
    labels: ['multi-source', 'namespace'],
    source: 'playbook.html',
    content: '每本书一个 sourceKey；缺省源 ai-agent-book-zh 的文件名逐字节不变，其他源产物统一加「.<key>」后缀（如 cluster-input.rust-book-cn.json）。固定路径是第二源头号杀手：clusters/candidates、跨章反模式池、门禁二/三产物、候选清单、主题三件套五处硬编码均被实跑撞到才修。新增产物面先问「按源命名了吗」；跨源产物绝不互相回落，缺失即 absent。',
  },
  {
    id: 'any2skills-l3-01',
    layer: 3,
    title: '--layer2 缺省 stub 会静默覆盖真实对象',
    importance: 0.85,
    unitType: 'learning',
    labels: ['layer2', 'stub'],
    source: 'docs/guides/book-to-skills-runbook.md',
    content: '真实运行必须显式写 --layer2 deepseek；替身路径不检查已有产出，会用 20 个替身对象覆写 objects.json（旧版进 history 可按 sha 复原，但先拿到假产出）。改下游判据不要重跑上游，partial 复用只为未完成锚点付费。任何「全量对象」结论都要先数盘上文件，不能引用跑通日志。',
  },
  {
    id: 'any2skills-l3-02',
    layer: 3,
    title: '非 dry-run 的 build 就是发布',
    importance: 0.85,
    unitType: 'learning',
    labels: ['publish', 'dry-run'],
    source: 'docs/tickets/19-second-source-materials.md',
    content: 'build-skill 与 build-task-suite 必须先干跑：不带 --dry-run 会直接写 registry/build 并把通过门禁的产物拷入 skills/，项目发生过一次误发布（卡 19 核验命令漏带 --dry-run）。发布面变更一律走「先 build --dry-run → 看门禁回执 → 再 publish」；危险命令要靠设计（dry-run 默认化）而不是流程记忆。',
  },
  {
    id: 'any2skills-l3-03',
    layer: 3,
    title: '账本必须每进程独立，账本缺席不等于没有访问',
    importance: 0.85,
    unitType: 'learning',
    labels: ['ledger', 'isolation'],
    source: 'docs/tickets/09-full-book-run.md',
    content: 'run-book 为每个源文件起一个子进程（并发上限 8），每进程独立 DSH_FS_LEDGER，--require 参数的 ./ 前缀必须有。共用账本会互相覆写；0 条记录是方法错误而非「未访问」的证据。--verify-isolation 要求子账本+编排账本齐全；账本缺席或截断时拒绝出隔离结论。',
  },
  {
    id: 'any2skills-l3-04',
    layer: 3,
    title: '判定者只看主锚点会系统性误杀跨章对象',
    importance: 0.85,
    unitType: 'learning',
    labels: ['judge', 'anchors'],
    source: 'docs/adr/ADR-022-judge-vision-all-anchors.md',
    content: 'judge-prompt/v1 的 anchorText 只解析 sourceRefs[0]，支撑句逐字在第二条锚点却不可见，跨章 16 条拒 5。v2 把输入改为 claim/quote/anchors，anchors 是全对象声明的全部锚点区间，跨章 14 过/2 拒、单章不变。改判定契约必须升 PIPELINE_VERSION，让 raw runId 与判定产物身份解耦，改判据不重买原始响应。',
  },
  {
    id: 'any2skills-l3-05',
    layer: 3,
    title: '非锚定围栏正则曾把合法 JSON 切坏',
    importance: 0.85,
    unitType: 'learning',
    labels: ['parser', 'json'],
    source: 'docs/adr/ADR-023-unanchored-fence-regex.md',
    content: '旧围栏正则未锚定，技术书代码块内的三反引号会让它从响应头匹配到字符串内部并把合法 JSON 切坏；全书首跑 6/13 文件退出码 4，但 6 份原始响应本身都是合法 JSON。修法是唯一实现 model-json.mjs，按「整份原样 → 锚定围栏 → 首末大括号」解析，四个解析器复用；不做语义修补，提示词与 PIPELINE_VERSION 不变。',
  },
  {
    id: 'any2skills-l3-06',
    layer: 3,
    title: 'shell 的 stat 可能多报 4096 字节，别把内容未损坏误判成 binary',
    importance: 0.85,
    unitType: 'learning',
    labels: ['environment', 'stat'],
    source: 'README.md',
    content: '本仓实测有 7 个文件被 ls/stat 多报 4096 字节，Read 工具按报出大小补零后判为 binary 拒读；内容从未损坏，git hash-object 与工作区逐字节一致。修复方法是用同内容重写并核对 blob 哈希不变。命中过 README、成果总结 md 与 ticket 32。遇到「文件像二进制」先核对哈希再下结论。',
  },
  {
    id: 'any2skills-l4-01',
    layer: 4,
    title: '项目时间线与规模画像（快照：2026-10-09 至 2026-10-31）',
    importance: 0.8,
    unitType: 'context',
    labels: ['timeline', 'profile'],
    source: 'reports/Know-项目成果总结-20261031.md',
    content: '2026-10-09 开工，2026-10-22 完成主线：90 次线性提交、32 篇 ADR、32 张执行卡、12 份冻结清单，提交高峰 10-13 与 10-14。仓库已推 GitHub zjgulai/any2skill，clone 后 npm test 即绿。成果报告 2026-10-31，报告文件 reports/Know-项目成果总结-20261031.md/.html。本条为历史快照，计数不随后续演进更新。',
  },
  {
    id: 'any2skills-l4-02',
    layer: 4,
    title: '双平面结构、运行入口与分发成熟度',
    importance: 0.75,
    unitType: 'context',
    labels: ['architecture', 'distribution'],
    source: 'docs/adr/ADR-002-project-structure-dual-plane.md',
    content: '外层 skills/ 遵守 Claude 技能发布规范保证即插即用；内层 pipeline/ 承载 IR、回执、账本与门禁保证可审计。新书编排入口 node pipeline/run-new-book.mjs（all|onboard|pipeline|scaffold），主流程真源 docs/guides/book-to-skills-runbook.md，全景 playbook.html。截至 2026-10-31 成熟度是「可克隆运行」而非「可安装即插即用」：无 LICENSE、无 CI、package.json private，.claude-plugin 分发层未落地。',
  },
]

// ── CLI 参数 ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { apply: false, space: DEFAULT_SPACE, agentId: DEFAULT_AGENT, out: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--apply') args.apply = true
    else if (a === '--space') args.space = argv[++i]
    else if (a === '--agent-id') args.agentId = argv[++i]
    else if (a === '--out') args.out = argv[++i]
    else throw new Error(`未知参数：${a}`)
  }
  return args
}

// ── 校验（卡 33 验收：与 validate-memories.mjs 同口径）─────────────────────
function sentenceCount(text) {
  const marks = text.match(/[。？！]/g)
  return marks ? marks.length : 0
}

function validateMemory(m) {
  const errors = []
  if (!m.id.match(/^any2skills-l[1-4]-\d{2}$/)) errors.push(`ID 不合规: ${m.id}`)
  if (!VALID_UNIT_TYPES.has(m.unitType)) errors.push(`${m.id} unit_type 非法: ${m.unitType}`)
  if (m.unitType !== LAYER_UNIT_TYPE[m.layer]) errors.push(`${m.id} 层级与 unit_type 不匹配`)
  const sc = sentenceCount(m.content)
  if (sc < 2 || sc > 5) errors.push(`${m.id} 句数 ${sc} 不在 2–5`)
  const stripped = m.content.replace(/\s/g, '')
  if (stripped.length > 300) errors.push(`${m.id} 去空白 ${stripped.length} 字 >300`)
  if (m.importance < 0 || m.importance > 1) errors.push(`${m.id} importance 越界`)
  return errors
}

// ── 写入 ─────────────────────────────────────────────────────────────────
function buildCliArgs(m, space, agentId) {
  const args = [
    'memories', 'add', '--id', m.id,
    // 标题可能以 -- 开头（如 l3-01 的 --layer2），必须用 = 形式防止被当作 flag
    `--title=${m.title}`,
    '--importance', String(m.importance), '--unit-type', m.unitType,
    '--when', LAYER_WHEN[m.layer], '--space', space, '--agent-id', agentId,
    '--source', m.source, '--stdin',
  ]
  for (const l of m.labels) args.push('--label', l)
  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))

  // 全量校验（任何一条失败即整体失败）
  const allErrors = []
  const seen = new Set()
  const layerCounts = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const m of MEMORIES) {
    if (seen.has(m.id)) allErrors.push(`ID 重复: ${m.id}`)
    seen.add(m.id)
    layerCounts[m.layer] += 1
    allErrors.push(...validateMemory(m))
  }
  if (allErrors.length > 0) {
    console.error('校验失败：')
    for (const e of allErrors) console.error(`  - ${e}`)
    process.exit(1)
  }

  const jsonl = MEMORIES.map((m) => JSON.stringify({
    id: m.id, layer: m.layer, title: m.title, importance: m.importance,
    unit_type: m.unitType, when: LAYER_WHEN[m.layer], labels: m.labels,
    source: m.source, content: m.content,
  })).join('\n') + '\n'

  if (!args.apply) {
    const outPath = args.out || 'docs/audits/any2skills-nmem-memory-candidates-20261031.jsonl'
    writeFileSync(outPath, jsonl)
    console.log(`[dry-run] 已写出 ${MEMORIES.length} 条候选 → ${outPath}`)
    console.log(`[dry-run] 层级计数 L1=${layerCounts[1]} L2=${layerCounts[2]} L3=${layerCounts[3]} L4=${layerCounts[4]}`)
    console.log('[dry-run] nmem 写调用 0。确认后加 --apply 执行写入。')
    return
  }

  let ok = 0, fail = 0
  const results = []
  for (const m of MEMORIES) {
    const res = spawnSync('nmem', buildCliArgs(m, args.space, args.agentId), {
      input: m.content, encoding: 'utf8', timeout: 30000,
    })
    if (res.status === 0) {
      ok += 1
      results.push({ id: m.id, status: 'ok' })
      console.log(`ok: ${m.id}`)
    } else {
      fail += 1
      results.push({ id: m.id, status: 'fail', stderr: (res.stderr || '').trim() })
      console.error(`fail: ${m.id} → ${(res.stderr || res.error || '').toString().trim()}`)
    }
  }

  const summary = { applied_at_args: { space: args.space, agent: args.agentId }, ok, fail, results }
  const outPath = args.out || 'docs/audits/any2skills-nmem-memories-20261031.json'
  writeFileSync(outPath, JSON.stringify(summary, null, 2) + '\n')
  console.log(`\n写入完成 ok=${ok} fail=${fail}；结果 → ${outPath}`)
  if (fail > 0) process.exit(3)
}

main()
