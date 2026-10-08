#!/usr/bin/env node
/**
 * 判定者层的推理档位对照探针（ADR-009 定档的主证据来源）
 *
 * ## 为什么需要这个工具
 *
 * ADR-009 把第 2 层推理档位的定档推到卡 09 之前，并写明定档时必须
 * **同时评估生产者与判定者两层**——因为判定者本身也是 LLM 调用，它也会被降档影响。
 * 生产者层的对照可以直接用 `run.mjs --llm-reasoning-effort` 跑两次比回执；
 * 判定者层不能：判定者的「区分力」只有在**同一批带已知标签的对象**上才量得出来，
 * 而流水线每次都是对新产出的对象判，没有一个固定的标尺。
 *
 * 本工具就是那把标尺：**固定一批对象，只拨档位，不动别的任何东西**。
 *
 * ## 判据为什么是「不一致矩阵」而不是「拒绝率」
 *
 * 降档的危险形式不是「判得更严」或「判得更松」，而是**丢掉区分力**——
 * 把本该被拒的对象放过。单看某一档的拒绝率看不出这件事：一个把所有对象都判「支撑」
 * 的判定者，在一个本来就多半是好的集合上，拒绝率看起来完全正常。
 *
 * 因此本工具的核心产出是**两档之间的逐对象判决差异**，并把它拆成两个方向：
 *
 *   - `flipToLenient`：高档拒、低档放 —— **降档丢掉的检出**，这是要盯住的量
 *   - `flipToStrict`：高档放、低档拒 —— 降档带来的额外拒绝，多半是噪声
 *
 * 只有当 `flipToLenient` 相对高档的拒绝总数**可忽略**时，「低档判定者仍具区分力」才成立。
 *
 * ## 边界（必须知道）
 *
 * - 它是**测量工具，不是判据**。不改任何既有回执，不写任何产物（除非显式传 `--out`）。
 * - 它不判断对象本身好坏，只判断「判定者在这一档还看不看得见差异」。
 * - 对照的有效性依赖**判定者提示词在两档间完全相同**：工具会打出提示词指纹，
 *   若两次调用的指纹不一致，结论无效（判据变了，不是档位变了）。
 *
 * ## 用法
 *
 * ```bash
 * node pipeline/tools/tier-probe.mjs \
 *   --objects pipeline/knowledge/history/chapter4.a257afe6.objects.json \
 *   --anchors pipeline/knowledge/chapter4.anchors.json \
 *   --tiers low,high \
 *   --judge-model deepseek-v4-pro --judge-base-url https://api.deepseek.com \
 *   --baseline pipeline/registry/run-7afb98d262b5.receipt.json
 * ```
 *
 * `--baseline` 是可选但强烈建议的：它给出一份**另一次独立运行**在未指定档位时
 * 对这些对象的判决（即服务端默认档下的答案），使「工具本身的稳定性」可被核对——
 * 若本次 high 档与 baseline 差异很大，那么本次对照的任何结论都不可信。
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from './anchor-index.mjs'
import {
  VERDICTS,
  buildJudgeInput,
  judgeObject,
  judgePromptFingerprint,
} from './judge.mjs'
import {
  createUsageLedger,
  normalizeReasoningEffort,
  resolveJudgeLlmConfig,
} from './llm-client.mjs'

const REPO_ROOT = DEFAULT_REPO_ROOT

/** 判定为「支撑」才算放过；其余两种都算检出。与 ADR-010 决策 2 同口径。 */
const PASSING_VERDICT = 'supported'

function parseArgs(argv) {
  const flags = {
    objects: null,
    anchors: null,
    source: null,
    tiers: ['low', 'high'],
    judgeModel: null,
    judgeBaseUrl: null,
    judgeProvider: null,
    baseline: null,
    out: null,
    filter: null,
    json: false,
  }
  const need = (i, name) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--objects') flags.objects = need(i, a), (i += 1)
    else if (a === '--anchors') flags.anchors = need(i, a), (i += 1)
    else if (a === '--source') flags.source = need(i, a), (i += 1)
    else if (a === '--tiers') flags.tiers = need(i, a).split(',').map((s) => s.trim()).filter(Boolean), (i += 1)
    else if (a === '--judge-model') flags.judgeModel = need(i, a), (i += 1)
    else if (a === '--judge-base-url') flags.judgeBaseUrl = need(i, a), (i += 1)
    else if (a === '--judge-provider') flags.judgeProvider = need(i, a), (i += 1)
    else if (a === '--baseline') flags.baseline = need(i, a), (i += 1)
    else if (a === '--out') flags.out = need(i, a), (i += 1)
    else if (a === '--filter') flags.filter = need(i, a), (i += 1)
    else if (a === '--json') flags.json = true
    else if (a.startsWith('--')) throw new Error(`未知参数：${a}`)
  }
  return flags
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

/** 兼容「顶层数组」与「顶层对象带 objects 键」两种落盘形状。 */
function asObjectList(parsed) {
  return Array.isArray(parsed) ? parsed : (parsed.objects ?? [])
}

/**
 * 重建每个对象在**判定者眼中**的输入：`{ claim, quote, anchorText }`。
 *
 * 锚点原文一律从**锚点索引**取（不采信对象自带的行号），与 `verifier.mjs` 同口径——
 * 否则探针量的就不是流水线实际发出的那个请求了。
 */
async function buildProbeInputs({ objectsPath, anchorsPath, sourcePath, filter }) {
  const objects = asObjectList(readJson(objectsPath))
  const index = readJson(anchorsPath)
  const lookup = new Map(index.anchors.map((a) => [`${a.file}::${a.anchor}`, a]))

  const sourceAbs = path.resolve(REPO_ROOT, sourcePath ?? index.sourceFile)
  const lines = fs.readFileSync(sourceAbs, 'utf8').split('\n')

  const inputs = []
  const skipped = []
  for (const obj of objects) {
    if (filter && obj.objectType !== filter) continue
    const ref = Array.isArray(obj.sourceRefs) ? obj.sourceRefs[0] : null
    const entry = ref ? lookup.get(`${ref.file}::${ref.anchor}`) : undefined
    if (!entry) {
      skipped.push({ id: obj.id, why: '锚点解析不到（无法构造判定者输入）' })
      continue
    }
    const anchorText = lines.slice(entry.lineStart - 1, entry.lineEnd).join('\n')
    inputs.push({
      objectId: obj.id,
      objectType: obj.objectType,
      input: buildJudgeInput({ objectType: obj.objectType, object: obj, anchorText }),
    })
  }
  // 按 id 排序，使两个档位臂处理的是**同一顺序**的同一批对象。
  inputs.sort((a, b) => String(a.objectId).localeCompare(String(b.objectId)))
  return { inputs, skipped, sourceFile: index.sourceFile }
}

/** 逐对象跑一遍判定者（串行：并发会让两个臂的请求交错，用量数字就无法按臂归因）。 */
async function runArm({ tier, label, config, inputs, onProgress }) {
  const ledger = createUsageLedger()
  const verdicts = {}
  for (let i = 0; i < inputs.length; i += 1) {
    const item = inputs[i]
    const res = await judgeObject({
      config,
      input: item.input,
      ordinal: i,
      ledger,
      reasoningEffort: tier,
    })
    verdicts[item.objectId] = { verdict: res.verdict, reason: res.reason }
    onProgress?.(i + 1, inputs.length, item.objectId, res.verdict)
  }
  return { tier, label, verdicts, usage: ledger, calls: ledger.calls }
}

/**
 * 给每个臂一个**唯一**标签。
 *
 * 存在的理由是一个真实缺陷：最初直接用档位名作键，于是 `--tiers high,high`
 * （量噪声底的标准做法）会让第二个臂覆盖第一个臂的判决，**看起来两臂完全一致**——
 * 恰好把噪声底报成 0，把「这仪器有多不稳」这个最重要的量抹掉。
 */
export function labelArms(tiers) {
  const seen = new Map()
  return tiers.map((t) => {
    const base = t ?? 'default'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { tier: t, label: n === 1 ? base : `${base}#${n}` }
  })
}

function tally(verdicts) {
  const out = Object.fromEntries(VERDICTS.map((v) => [v, 0]))
  for (const { verdict } of Object.values(verdicts)) {
    if (out[verdict] === undefined) out[verdict] = 0
    out[verdict] += 1
  }
  return out
}

/**
 * 两臂之间的逐对象对照。
 *
 * 方向的含义必须写死，否则读者会把「不一致」当成一个数看——
 * 而两个方向的意义完全相反：
 *   - `<A>-only`：A 检出、B 放过 ⇒ **B 丢掉的检出**。若 B 是低档，这就是降档的代价。
 *   - `<B>-only`：B 检出、A 放过 ⇒ B 更严。多半是噪声或过度拒绝，也可能是有益的补漏。
 * 只有前者能支持「不该降档」的结论。
 */
export function comparePair(a, b, matrix) {
  const rows = []
  for (const row of matrix) {
    const va = row.byArm[a.label]
    const vb = row.byArm[b.label]
    if (va === vb) continue
    const aDetected = va !== PASSING_VERDICT
    const bDetected = vb !== PASSING_VERDICT
    rows.push({
      objectId: row.objectId,
      objectType: row.objectType,
      [a.label]: va,
      [b.label]: vb,
      direction:
        aDetected && !bDetected
          ? `${a.label}-only`
          : bDetected && !aDetected
            ? `${b.label}-only`
            : 'both-detect-differently',
    })
  }
  return {
    comparedArms: [a.label, b.label],
    counts: { total: matrix.length, agree: matrix.length - rows.length, disagree: rows.length },
    rows,
  }
}


async function main(argv) {
  const flags = parseArgs(argv)
  if (flags.objects === null) throw new Error('必须传 --objects（固定对象集，探针的标尺）')
  if (flags.anchors === null) throw new Error('必须传 --anchors（锚点索引，用于重建判定者输入）')
  const tiers = flags.tiers.map((t) => normalizeReasoningEffort(t))

  const { inputs, skipped, sourceFile } = await buildProbeInputs({
    objectsPath: path.resolve(REPO_ROOT, flags.objects),
    anchorsPath: path.resolve(REPO_ROOT, flags.anchors),
    sourcePath: flags.source,
    filter: flags.filter,
  })

  if (inputs.length === 0) throw new Error('探针集为空：没有对象能构造出判定者输入')

  const config = await resolveJudgeLlmConfig({
    overrides: { modelId: flags.judgeModel, baseUrl: flags.judgeBaseUrl, provider: flags.judgeProvider },
    judgeOverrides: { modelId: flags.judgeModel, baseUrl: flags.judgeBaseUrl, provider: flags.judgeProvider },
  })

  const fingerprint = judgePromptFingerprint()
  process.stderr.write(
    `探针集 ${inputs.length} 个对象（跳过 ${skipped.length}）｜源 ${sourceFile}\n` +
      `判定者 ${config.modelId} @ ${config.baseUrl}｜提示词指纹 ${fingerprint}\n` +
      `档位臂：${tiers.map((t) => t ?? '默认').join(' vs ')}\n`,
  )

  const arms = []
  for (const { tier, label } of labelArms(tiers)) {
    process.stderr.write(`\n—— 开跑臂 ${label}（档位 ${tier ?? '默认：不发 reasoning_effort'}）——\n`)
    const arm = await runArm({
      tier,
      label,
      config,
      inputs,
      onProgress: (done, total, id, verdict) => {
        if (done % 5 === 0 || done === total) {
          process.stderr.write(`  ${done}/${total}  ${id} → ${verdict}\n`)
        }
      },
    })
    arms.push(arm)
  }

  // ---- 逐对象对齐 ----
  const matrix = inputs.map((item) => {
    const row = { objectId: item.objectId, objectType: item.objectType, byArm: {} }
    for (const arm of arms) {
      row.byArm[arm.label] = arm.verdicts[item.objectId]?.verdict ?? null
    }
    return row
  })

  // ---- 不一致矩阵：任意两臂之间都算，方向按「谁检出、谁放过」判 ----
  const pairReports = []
  for (let i = 0; i < arms.length; i += 1) {
    for (let j = i + 1; j < arms.length; j += 1) {
      pairReports.push(comparePair(arms[i], arms[j], matrix))
    }
  }
  // 向后兼容的单对字段：两臂时即那一对，多臂时取第一对。
  const disagreement = pairReports[0] ?? null

  const report = {
    probeVersion: 'judge-tier-probe/v1',
    createdAt: new Date().toISOString(),
    repoRoot: REPO_ROOT,
    judgePromptFingerprint: fingerprint,
    judge: {
      modelId: config.modelId,
      baseUrlHost: config.baseUrl,
      sameModelAsProducer: config.sameModelAsProducer,
    },
    probeSet: {
      objectsPath: flags.objects,
      objectsFileCount: inputs.length,
      skipped,
    },
    arms: arms.map((arm) => ({
      tier: arm.tier,
      label: arm.label,
      verdicts: tally(arm.verdicts),
      detected: Object.values(arm.verdicts).filter((v) => v.verdict !== PASSING_VERDICT).length,
      calls: arm.calls,
      tokens: { ...arm.usage.tokens },
      tokensDetail: { ...arm.usage.tokensDetail },
      failedCalls: arm.usage.failedCalls,
      retries: arm.usage.retries,
    })),
    /** 所有两两对照。**噪声底就藏在「同档两臂」的那一对里。** */
    pairs: pairReports,
    disagreement,
    matrix,
  }

  // 可选：核对基准（另一次独立运行在未指定档位时对这些对象的判决）
  if (flags.baseline) {
    const base = readJson(path.resolve(REPO_ROOT, flags.baseline))
    const baseVerdicts = new Map()
    for (const v of base.objectVerdicts ?? []) {
      if (v.judge?.verdict) baseVerdicts.set(v.objectId, v.judge.verdict)
    }
    const overlap = matrix.filter((r) => baseVerdicts.has(r.objectId))
    let agree = 0
    const diffs = []
    for (const row of overlap) {
      const expected = baseVerdicts.get(row.objectId)
      const got = row.byArm[arms[0].label]
      if (got === expected) agree += 1
      else diffs.push({ objectId: row.objectId, baseline: expected, probe: got })
    }
    report.baselineCheck = {
      receipt: flags.baseline,
      baselineRunId: base.runId ?? null,
      baselineJudgeFingerprint: base.judge?.promptFingerprint ?? null,
      comparable: (base.judge?.promptFingerprint ?? null) === fingerprint,
      overlappingObjects: overlap.length,
      agree,
      agreeRate: overlap.length === 0 ? null : `${agree}/${overlap.length}`,
      differences: diffs,
      note:
        '这是**工具稳定性**的核对，不是档位结论。基准与本次第一臂若差异显著，' +
        '说明判定者本身在这些对象上不稳定，本次任何档位结论都不成立。',
    }
  }

  if (flags.out) {
    const outAbs = path.resolve(REPO_ROOT, flags.out)
    fs.writeFileSync(outAbs, JSON.stringify(report, null, 2) + '\n', 'utf8')
    process.stderr.write(`\n对照报告已落盘：${outAbs}\n`)
  }

  if (flags.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  } else {
    process.stdout.write(formatHuman(report))
  }
  return 0
}

function formatHuman(r) {
  const L = []
  L.push(`探针集：${r.probeSet.objectsFileCount} 个对象（${r.probeSet.objectsPath}）`)
  L.push(`判定者：${r.judge.modelId}｜提示词指纹 ${r.judgePromptFingerprint}`)
  L.push('')
  L.push('臂          支撑  不充分  不支撑   检出  调用  input/output token（其中推理）')
  for (const a of r.arms) {
    L.push(
      `${String(a.label).padEnd(12)}` +
        `${String(a.verdicts.supported ?? 0).padStart(5)}` +
        `${String(a.verdicts.insufficient ?? 0).padStart(7)}` +
        `${String(a.verdicts.unsupported ?? 0).padStart(7)}` +
        `${String(a.detected).padStart(6)}` +
        `${String(a.calls).padStart(6)}` +
        `  ${a.tokens.input}/${a.tokens.output}（${a.tokensDetail.reasoning}）`,
    )
  }
  for (const d of r.pairs ?? (r.disagreement ? [r.disagreement] : [])) {
    const [ka, kb] = d.comparedArms
    L.push('')
    L.push(`「${ka}」vs「${kb}」：${d.counts.agree}/${d.counts.total} 一致，${d.counts.disagree} 不一致`)
    for (const row of d.rows) {
      L.push(`  ${row.objectId.padEnd(34)} ${ka}=${row[ka]} | ${kb}=${row[kb]}   ${row.direction}`)
    }
  }
  if (r.baselineCheck) {
    const b = r.baselineCheck
    L.push('')
    L.push(
      `基准核对（${b.baselineRunId}）：可比性 ${b.comparable ? '✓ 指纹相同' : '✗ 指纹不同，不可比'}｜` +
        `重叠 ${b.overlappingObjects} 个，一致 ${b.agreeRate ?? 'n/a'}`,
    )
    for (const d of b.differences.slice(0, 10)) {
      L.push(`  ${d.objectId.padEnd(34)} 基准=${d.baseline} 本次=${d.probe}`)
    }
  }
  return L.join('\n') + '\n'
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv).then(
    (code) => {
      process.exitCode = code
    },
    (err) => {
      process.stderr.write(`探针失败：${err.message}\n`)
      process.exitCode = 1
    },
  )
}
