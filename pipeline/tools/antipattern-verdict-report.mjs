/**
 * 跨章反模式判定报告的**只读**查询工具（ADR-022「未决」第 5 条的量具）
 *
 *   node pipeline/tools/antipattern-verdict-report.mjs                      # 全部主题
 *   node pipeline/tools/antipattern-verdict-report.mjs --theme T12
 *   node pipeline/tools/antipattern-verdict-report.mjs --rejected-only
 *   node pipeline/tools/antipattern-verdict-report.mjs --verdicts <path> --json
 *
 * ## 为什么要有它
 *
 * ADR-022 记下了一个「同一主题、同一失效模式、不同对象」的反复出现的形状：跨章综合里有对象
 * 把原文的**禁止**读成**允许**。两次运行各出现一条，n 太小，不足以判断它是系统性弱项还是偶然。
 * 要判断就得在**更大样本**上数它，而数它的前提是：拒绝理由能被原样摊开来看。
 *
 * 这件事**不能**靠去看 `antipatterns.objects.json` 里还剩什么——**被拒的对象不在里面**。
 * 也就是说，对着最终产物找「方向反转」，永远只能找到漏网的那几条，
 * 会把「判定者抓住了」读成「根本没这回事」。判定表才是唯一记得被拒对象的文件。
 *
 * ## 它不做什么
 *
 * 不调用模型、不写盘、不下结论。它把「判定者说了什么」原样排出来，分类由人做
 * （n 只有十几条，机器的二次分类不会比人读得更准，只会多一层看不见的错）。
 */

import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT } from './anchor-index.mjs'

const REGISTRY_REL = path.join('pipeline', 'registry')
const OBJECTS_REL = path.join('pipeline', 'knowledge', 'antipatterns.objects.json')

/**
 * 找到「当前对象集自己声明的身份」所对应的判定表。
 *
 * 与 `build-skill.mjs` 的取法同一条纪律：**以对象文件声明的 runId 为准**，
 * 不按 mtime 挑最新——registry 里会同时留着不同身份的判定表，
 * 「最新」不等于「与对象同源」（ADR-022 决策 6）。
 */
export async function findVerdictsForObjects(repoRoot, { objectsPath = OBJECTS_REL } = {}) {
  const objects = JSON.parse(await readFile(path.join(repoRoot, objectsPath), 'utf8'))
  const wanted = objects.runId
  const dir = path.join(repoRoot, REGISTRY_REL)
  const candidates = (await readdir(dir)).filter((f) => f.endsWith('.antipattern-verdicts.json'))
  const match = candidates.filter((f) => f.startsWith(`${wanted}.`))
  return {
    objectsRunId: wanted,
    objectsPath,
    identityMatch: match.length === 1,
    verdictsPath: match.length === 1 ? path.join(REGISTRY_REL, match[0]) : null,
    candidates: candidates.sort(),
  }
}

/**
 * 一条判决压成一行可读的形状；`reason` 原样带上，不截断（它是本工具存在的理由）。
 *
 * **幂等**：已汇总过的行再汇总一次必须得到同样的行。这条不是洁癖——`buildReport` 收的就是
 * 原始判决，而调用方与测试很容易顺手先 `map(summarizeVerdict)` 再传进去，
 * 而「第二次汇总」的失败方式是**静默把理由抹成 null**（第二次读不到 `judge.reason`），
 * 于是报告里恰好只剩下最该被看见的那一栏是空的。
 */
export function summarizeVerdict(verdict) {
  if (verdict && verdict.judge === undefined && 'judgeReason' in verdict) {
    return {
      objectId: verdict.objectId,
      status: verdict.status,
      reasonCode: verdict.reasonCode ?? null,
      judgeVerdict: verdict.judgeVerdict ?? null,
      judgeReason: verdict.judgeReason ?? null,
      anchors: verdict.anchors ?? [],
    }
  }
  const judge = verdict.judge ?? {}
  return {
    objectId: verdict.objectId,
    status: verdict.status,
    reasonCode: verdict.reasonCode ?? null,
    judgeVerdict: judge.verdict ?? null,
    judgeReason: judge.reason ?? null,
    anchors: (verdict.judgedAnchors ?? []).map((a) => a.anchor),
  }
}

/** 按主题把判决分组（id 形如 `AP-SYNTH-<主题>-<序号>`；解析不出来归 `unknown`）。 */
export function groupByTheme(verdicts) {
  const groups = new Map()
  for (const v of verdicts) {
    const m = /^AP-(?:SYNTH|GEN)-([A-Z]\d+)-/.exec(v.objectId ?? '')
    const key = m ? m[1] : 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(v)
  }
  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export function buildReport(verdicts, { receipt = null, verdictsPath = null, themeFilter = null, rejectedOnly = false } = {}) {
  const rows = verdicts.map(summarizeVerdict)
  const byTheme = groupByTheme(rows)
  const themes = []
  for (const [themeId, items] of byTheme) {
    if (themeFilter && themeId !== themeFilter) continue
    const rejected = items.filter((v) => v.status !== 'pass')
    themes.push({
      themeId,
      name: receipt?.perTheme?.find((t) => t.themeId === themeId)?.name ?? null,
      chapters: receipt?.perTheme?.find((t) => t.themeId === themeId)?.chapters ?? null,
      total: items.length,
      passed: items.length - rejected.length,
      rejected: rejected.length,
      reasonCodes: countBy(rejected.map((v) => v.reasonCode ?? '(无理由码)')),
      items: rejectedOnly ? rejected : items,
    })
  }
  const allRejected = rows.filter((v) => v.status !== 'pass')
  return {
    verdictsPath,
    verdictsRunId: null,
    themes,
    totals: {
      objects: rows.length,
      passed: rows.length - allRejected.length,
      rejected: allRejected.length,
      reasonCodes: countBy(allRejected.map((v) => v.reasonCode ?? '(无理由码)')),
    },
    rejectedOnly,
    note:
      '**被拒对象不在 `pipeline/knowledge/antipatterns.objects.json` 里**——那份文件只装通过的。' +
      '要问「有没有方向反转这类失效」，只能看判定表；对着最终产物找，永远只能找到漏网的。',
  }
}

function countBy(xs) {
  const out = {}
  for (const x of xs) out[x] = (out[x] ?? 0) + 1
  return out
}

export function formatReport(report, out = process.stdout) {
  const t = report.totals
  out.write(
    `判定表 ${report.verdictsPath ?? '(未指定)'}：对象 ${t.objects}，通过 ${t.passed}，拒绝 ${t.rejected}` +
      `，理由码 ${JSON.stringify(t.reasonCodes)}\n`,
  )
  for (const th of report.themes) {
    out.write(`\n【${th.themeId}】${th.name ?? ''}${th.chapters ? `（${th.chapters.length} 章：${th.chapters.join(', ')}）` : ''}\n`)
    out.write(`  对象 ${th.total}，通过 ${th.passed}，拒绝 ${th.rejected}${th.rejected ? `（${JSON.stringify(th.reasonCodes)}）` : ''}\n`)
    for (const v of th.items) {
      out.write(`  · ${v.objectId}  ${v.status}${v.reasonCode ? ` / ${v.reasonCode}` : ''}  锚点 ${v.anchors.join(' + ') || '—'}\n`)
      if (v.judgeReason) out.write(`      理由：${v.judgeReason}\n`)
    }
  }
  out.write(`\n${report.note}\n`)
}

/* ──────────────────────────── CLI ──────────────────────────── */

export function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = { repoRoot: DEFAULT_REPO_ROOT, verdicts: null, objects: OBJECTS_REL, theme: null, json: false, rejectedOnly: false }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    const need = () => {
      const v = args[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} 缺少取值`)
      i += 1
      return v
    }
    if (a === '--repo-root') flags.repoRoot = path.resolve(need())
    else if (a === '--verdicts') flags.verdicts = need()
    else if (a === '--objects') flags.objects = need()
    else if (a === '--theme') flags.theme = need()
    else if (a === '--json') flags.json = true
    else if (a === '--rejected-only') flags.rejectedOnly = true
    else throw new Error(`未知参数：${a}`)
  }
  return flags
}

export async function main(argv) {
  const repoRoot = (await import('./anchor-index.mjs')).resolveRealPath(parseArgs(argv).repoRoot ?? DEFAULT_REPO_ROOT)
  const flags = parseArgs(argv)
  let verdictsPath = flags.verdicts
  let receipt = null
  if (!verdictsPath) {
    const found = await findVerdictsForObjects(repoRoot, { objectsPath: flags.objects })
    if (!found.identityMatch) {
      process.stderr.write(
        `取不到与对象集同源的判定表：对象声明 ${found.objectsRunId}，registry 里有 ${found.candidates.length} 份候选。\n` +
          '按身份取不到时**不按 mtime 回退**——回退会让报告看起来是关于当前对象集的，实际不是。\n' +
          '请显式传 --verdicts <path>。\n',
      )
      return 4
    }
    verdictsPath = found.verdictsPath
  }
  const parsed = JSON.parse(await readFile(path.join(repoRoot, verdictsPath), 'utf8'))
  const runId = parsed.runId
  try {
    receipt = JSON.parse(await readFile(path.join(repoRoot, REGISTRY_REL, `${runId}.antipattern-receipt.json`), 'utf8'))
  } catch {
    receipt = null
  }
  const report = { ...buildReport(parsed.verdicts ?? [], { receipt, verdictsPath, themeFilter: flags.theme, rejectedOnly: flags.rejectedOnly }), verdictsRunId: runId }
  if (flags.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  else formatReport(report)
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
