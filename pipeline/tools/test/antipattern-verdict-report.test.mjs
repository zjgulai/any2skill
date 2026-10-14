/**
 * 跨章反模式判定报告工具的测试（离线：不调用模型、不写盘）
 *
 * 钉住的是**读法**，不是排版：
 *   ① 被拒对象必须出现在报告里（它们不在对象集文件里，只有判定表记得）；
 *   ② `--rejected-only` 不能把被拒项连理由一起丢掉（理由正是这个工具存在的理由）；
 *   ③ 身份取不到时**不回退**——回退会让报告看起来是关于当前对象集的，实际不是。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildReport, findVerdictsForObjects, groupByTheme, parseArgs, summarizeVerdict } from '../antipattern-verdict-report.mjs'

const V = (id, status, reasonCode, reason) => ({
  objectId: id,
  status,
  reasonCode,
  judgedAnchors: [{ anchor: 'chapter5#h3-9' }],
  judge: reason ? { verdict: status === 'pass' ? 'supported' : 'insufficient', reason } : null,
})

const SAMPLE = [
  V('AP-SYNTH-T02-01', 'pass', null, '支撑'),
  V('AP-SYNTH-T02-02', 'reject', 'QUOTE_MISMATCH'),
  V('AP-SYNTH-T12-01', 'pass', null, '支撑'),
  V('AP-SYNTH-T12-02', 'reject', 'JUDGE_NOT_SUPPORTED', '方向相反'),
  V('SOMETHING-ELSE', 'pass', null, null),
]

describe('判定报告 · 被拒对象必须看得见', () => {
  it('按主题分组，解析不出主题的归 unknown（不丢）', () => {
    const g = groupByTheme(SAMPLE.map(summarizeVerdict))
    assert.deepEqual([...g.keys()], ['T02', 'T12', 'unknown'])
    assert.equal(g.get('T12').length, 2)
  })

  it('逐条判决压成一行时，理由原样带上（不截断）', () => {
    const s = summarizeVerdict(V('AP-SYNTH-T12-02', 'reject', 'JUDGE_NOT_SUPPORTED', '方向相反：原文说不能修改'))
    assert.equal(s.judgeReason, '方向相反：原文说不能修改')
    assert.deepEqual(s.anchors, ['chapter5#h3-9'])
  })

  it('全量报告含被拒项及其理由；--rejected-only 只留被拒项但理由仍在', () => {
    const all = buildReport(SAMPLE)
    assert.equal(all.totals.objects, 5)
    assert.equal(all.totals.rejected, 2)
    assert.deepEqual(all.totals.reasonCodes, { QUOTE_MISMATCH: 1, JUDGE_NOT_SUPPORTED: 1 })
    const t12 = all.themes.find((t) => t.themeId === 'T12')
    assert.equal(t12.items.length, 2)

    const only = buildReport(SAMPLE, { rejectedOnly: true })
    const items = only.themes.flatMap((t) => t.items)
    assert.deepEqual(items.map((i) => i.objectId), ['AP-SYNTH-T02-02', 'AP-SYNTH-T12-02'])
    assert.equal(items[1].judgeReason, '方向相反', '被拒项的理由不得被 --rejected-only 过滤掉')
  })

  it('汇总函数幂等：先 map 一遍再传进 buildReport，理由不许被抹掉', () => {
    // 这条防的是一个真实的踩法：`buildReport` 收原始判决，而调用方顺手先 map 了一遍汇总。
    // 非幂等的汇总函数在那一刻会把 `judge.reason` 读成 undefined，且**看起来一切正常**——
    // 只有理由那一栏变成 null。
    const twice = buildReport(SAMPLE.map(summarizeVerdict), { rejectedOnly: true })
    const items = twice.themes.flatMap((t) => t.items)
    assert.equal(items[1].judgeReason, '方向相反')
  })

  it('--theme 过滤只保留该主题（合计仍是全量，避免把「只看了一个主题」读成总体）', () => {
    const r = buildReport(SAMPLE.map(summarizeVerdict), { themeFilter: 'T12' })
    assert.deepEqual(r.themes.map((t) => t.themeId), ['T12'])
    assert.equal(r.totals.objects, 5, '合计口径不随过滤器变化')
  })

  it('报告里必须写明对象集文件的真实口径：**全部产出对象**（通过与被拒都在）', () => {
    // 2026-10-14（卡 22）修正：旧断言钉的是「被拒对象不在对象集文件里」——**那是错的**。
    // 实测（rust 合成：95 产出 / 76 过 / 19 拒）19 条被拒对象逐条在文件里；
    // 章级对象文件同口径（也都装全部产出，由回执决定谁通过）。旧断言把错误文本钉成了回归。
    const note = buildReport([]).note
    assert.match(note, /全部产出对象/)
    assert.ok(!/被拒对象不在/.test(note), '不得再出现已被证伪的旧表述')
  })

  it('身份取不到时不回退到 mtime：明说取不到，并列候选', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'any2skills-verdict-'))
    try {
      await mkdir(path.join(root, 'pipeline', 'registry'), { recursive: true })
      await mkdir(path.join(root, 'pipeline', 'knowledge'), { recursive: true })
      await writeFile(path.join(root, 'pipeline', 'knowledge', 'antipatterns.objects.json'), JSON.stringify({ runId: 'run-aaaa', objects: [] }))
      await writeFile(path.join(root, 'pipeline', 'registry', 'run-bbbb.antipattern-verdicts.json'), JSON.stringify({ runId: 'run-bbbb', verdicts: [] }))
      const found = await findVerdictsForObjects(root)
      assert.equal(found.identityMatch, false)
      assert.equal(found.verdictsPath, null)
      assert.deepEqual(found.candidates, ['run-bbbb.antipattern-verdicts.json'])

      // 同源时正常取到
      await writeFile(path.join(root, 'pipeline', 'registry', 'run-aaaa.antipattern-verdicts.json'), JSON.stringify({ runId: 'run-aaaa', verdicts: [] }))
      const ok = await findVerdictsForObjects(root)
      assert.equal(ok.identityMatch, true)
      assert.match(ok.verdictsPath, /run-aaaa\.antipattern-verdicts\.json$/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('未知参数报错', () => {
    assert.throws(() => parseArgs(['node', 'x.mjs', '--nope']), /未知参数/)
  })
})
