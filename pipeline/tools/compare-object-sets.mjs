#!/usr/bin/env node
/**
 * 两组知识对象的聚合对照（零模型调用、只读）。
 *
 * ## 为什么需要它
 *
 * 判据或提示词一改，产出就不可比——**但「不可比」到底可不可比，要分清是哪一层**：
 * 这篇工具给出的答案是**聚合可比、逐条不可比**。
 *
 * 逐条不可比的根因在 `synthesizedIdFor(themeId, seq)`（`antipattern-synthesis.mjs`）：
 * 它把对象 id 派生为 `<前缀>-<主题>-<序号>`，是**位置序号**而非内容身份。
 * 于是同一个 id 在两批里可能是两条完全不同的反模式——把两次运行的 `AP-SYNTH-T12-06`
 * 当成「同一条被改写了」是错的，而那种读法看起来非常自然，所以必须写下来。
 *
 * ## 口径
 *
 * - 「跨章」= `sourceRefs` 里的锚点去重后覆盖 **≥2 个章节**（不是 sourceRefs 条数）。
 * - 字数一律按 **JS 字符串长度**（UTF-16 码元）计，与发布件的字节数不是同一个口径。
 * - 没有判定表时照样给聚合数字，只是不输出判定分布。
 *
 * 用法：
 *   node pipeline/tools/compare-object-sets.mjs --old <对象集> --new <对象集> \
 *     [--old-verdicts <判定表>] [--new-verdicts <判定表>] [--json] [--top <n>]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const USAGE =
  '用法：node pipeline/tools/compare-object-sets.mjs --old <对象集> --new <对象集> ' +
  '[--old-verdicts <判定表>] [--new-verdicts <判定表>] [--json] [--top <n>]'

export function parseArgs(argv) {
  const flags = { old: null, new: null, oldVerdicts: null, newVerdicts: null, json: false, top: 12 }
  const need = (i, name) => {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺少取值`)
    return v
  }
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--old') (flags.old = need(i, a)), (i += 1)
    else if (a === '--new') (flags.new = need(i, a)), (i += 1)
    else if (a === '--old-verdicts') (flags.oldVerdicts = need(i, a)), (i += 1)
    else if (a === '--new-verdicts') (flags.newVerdicts = need(i, a)), (i += 1)
    else if (a === '--top') (flags.top = Number(need(i, a))), (i += 1)
    else if (a === '--json') flags.json = true
    else throw new Error(`未知参数：${a}`)
  }
  if (flags.old === null || flags.new === null) throw new Error('--old 与 --new 都必填')
  return flags
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'))

/** 对象集文件有带 wrapper 与裸数组两种形状（与 `unwrapObjectsFile` 同义）。 */
export const objectsOf = (doc) => (Array.isArray(doc) ? doc : (doc.objects ?? []))

/** 判定表 → objectId → verdict。没有判定表时返回 null，**不是空表**（「没判」≠「判了都没有」）。 */
export function verdictsOf(doc) {
  if (doc === null || doc === undefined) return null
  const m = new Map()
  for (const v of doc.verdicts ?? []) m.set(v.objectId, v)
  return m
}

const chaptersOf = (o) => new Set((o.sourceRefs ?? []).map((r) => String(r.anchor).split('#')[0]))

const median = (xs) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}

const stat = (xs) =>
  xs.length === 0
    ? { avg: null, median: null, min: null, max: null }
    : {
        avg: +(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1),
        median: median(xs),
        min: Math.min(...xs),
        max: Math.max(...xs),
      }

export function profile(objs, verdicts, label) {
  const rows = objs.map((o) => {
    const ch = chaptersOf(o)
    return {
      id: o.id,
      refs: (o.sourceRefs ?? []).length,
      chapters: ch.size,
      claimChars: `${o.pattern ?? ''}${o.harm ?? ''}`.length,
      patternChars: (o.pattern ?? '').length,
      harmChars: (o.harm ?? '').length,
      quoteChars: (o.evidenceQuote ?? '').length,
      status: verdicts?.get(o.id)?.status ?? null,
    }
  })
  const cross = rows.filter((r) => r.chapters >= 2).length
  const summary = {
    标签: label,
    对象数: rows.length,
    跨章对象数: cross,
    跨章比例: `${cross}/${rows.length}`,
    引用条数: stat(rows.map((r) => r.refs)),
    不同章节数: stat(rows.map((r) => r.chapters)),
    主张字数: stat(rows.map((r) => r.claimChars)),
    pattern字数: stat(rows.map((r) => r.patternChars)),
    harm字数: stat(rows.map((r) => r.harmChars)),
    主引文字数: stat(rows.map((r) => r.quoteChars)),
  }
  if (verdicts !== null) {
    const dist = {}
    for (const r of rows) dist[r.status ?? '(无判定)'] = (dist[r.status ?? '(无判定)'] ?? 0) + 1
    summary.判定分布 = dist
  }
  return { summary, rows }
}

/**
 * 逐条对照表。
 *
 * ⚠️ 输出的 `id` **不是跨运行稳定的键**（见文件头）。这张表用来找「谁的主张最长」这类分布问题，
 * 不能用来断言「同一条变了」。
 */
function orderedRows(a, b, top) {
  return [
    ...a.rows.map((r) => ({ ...r, side: '旧' })),
    ...b.rows.map((r) => ({ ...r, side: '新' })),
  ]
    .sort((x, y) => y.claimChars - x.claimChars)
    .slice(0, top)
}

function main(argv) {
  let flags
  try {
    flags = parseArgs(argv)
  } catch (err) {
    process.stderr.write(`${err.message}\n${USAGE}\n`)
    return 2
  }
  const a = profile(
    objectsOf(readJson(flags.old)),
    verdictsOf(flags.oldVerdicts === null ? null : readJson(flags.oldVerdicts)),
    '旧',
  )
  const b = profile(
    objectsOf(readJson(flags.new)),
    verdictsOf(flags.newVerdicts === null ? null : readJson(flags.newVerdicts)),
    '新',
  )
  if (flags.json) {
    process.stdout.write(
      `${JSON.stringify({ old: a.summary, new: b.summary, rows: orderedRows(a, b, flags.top) }, null, 2)}\n`,
    )
    return 0
  }
  process.stdout.write(`${JSON.stringify({ old: a.summary, new: b.summary }, null, 2)}\n`)
  process.stdout.write('\n逐条对照（按主张字数降序取前若干；**id 不是跨运行稳定的键**）：\n')
  process.stdout.write(['side', 'id', 'refs', 'ch', 'claim', 'quote', 'status'].join('\t') + '\n')
  for (const r of orderedRows(a, b, flags.top)) {
    process.stdout.write(
      [r.side, r.id, r.refs, r.chapters, r.claimChars, r.quoteChars, r.status ?? '-'].join('\t') + '\n',
    )
  }
  return 0
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  process.exitCode = main(process.argv)
}
