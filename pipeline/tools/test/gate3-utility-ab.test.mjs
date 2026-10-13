/**
 * 门禁三 · 效用 A/B 的测试（ticket 14）
 *
 * 本文件里最要紧的三组：
 *   1. **盲臂机制**：无 skill 臂的提示词里不可能出现 SKILL.md 片段（哨兵反证）——
 *      ADR-027 的「构建者不得自评」与「有 skill 臂注入原文」都要靠它落地；
 *   2. **路径白名单**：产物路径越界（`..`、绝对路径）不写盘、逐条记录；
 *   3. **判定规则三路径**：退化复现即拒 / 复现不了记噪声 / 改进即通过——外加
 *      「未复跑不下结论」的 pending 态。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  Gate3Error,
  buildExecutionSystemPrompt,
  buildExecutionUserPrompt,
  evaluateChecker,
  isSafeRelPath,
  runTaskArm,
  validateExecutionOutput,
  validateTaskSet,
  verdictForSkill,
} from '../gate3-utility-ab.mjs'

/* ──────────────────────────── 盲臂机制（最要紧） ──────────────────────────── */

describe('14 · 无 skill 臂不得出现 SKILL.md 任何片段', () => {
  const SENTINELS = ['哨兵-正文-7a01', '哨兵-原则-8b02', '哨兵-陷阱-9c03']
  const markdown = `# 工具设计\n\n核心原则里写着 ${SENTINELS[0]}。\n\n## 常见陷阱\n- ${SENTINELS[1]}\n- ${SENTINELS[2]}\n`

  it('without 臂的 system 提示词逐哨兵断言不出现；with 臂必须出现（否则这组是空跑）', () => {
    const without = buildExecutionSystemPrompt({ arm: 'without' })
    const withArm = buildExecutionSystemPrompt({ arm: 'with', skillMarkdown: markdown })
    for (const s of SENTINELS) {
      assert.ok(!without.includes(s), `without 臂漏出了 ${s}`)
      assert.ok(withArm.includes(s), `with 臂应注入 ${s}`)
    }
    assert.ok(!without.includes('技能文档开始'), 'without 臂不得带技能注入的框架文字')
  })
})

/* ──────────────────────────── 路径白名单 ──────────────────────────── */

describe('14 · 产物路径白名单', () => {
  it('相对路径合法；`..`、绝对路径、空段、超长一律拒绝', () => {
    assert.ok(isSafeRelPath('out/report.md'))
    assert.ok(isSafeRelPath('a.json'))
    assert.ok(isSafeRelPath('中文目录/说明.md'))
    for (const bad of ['../etc/passwd', '/abs/path', 'a/../b', '', 'a//b', 'x'.repeat(201), 'a\u0000b']) {
      assert.ok(!isSafeRelPath(bad), `应拒绝：${JSON.stringify(bad)}`)
    }
  })

  it('执行产物里的越界路径被逐条记录、不进入待写集合', () => {
    const r = validateExecutionOutput({
      files: { 'ok.md': 'x', '../evil.sh': 'rm -rf /', '/etc/x': 'y' },
    })
    assert.deepEqual(Object.keys(r.files), ['ok.md'])
    assert.deepEqual(r.invalidPaths.sort(), ['../evil.sh', '/etc/x'])
  })

  it('产物不是 {files:{…}} 形状 → 抛错', () => {
    assert.throws(() => validateExecutionOutput({ nope: 1 }), Gate3Error)
  })
})

/* ──────────────────────────── 检查单求值 ──────────────────────────── */

describe('14 · 声明式检查单：五种类型、逐条判定、坏检查不炸整轮', () => {
  it('五种类型各自的通过与失败', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-gate3-check-'))
    try {
      await (await import('node:fs/promises')).writeFile(path.join(dir, 'out.md'), '包含甲和乙', 'utf8')
      await (await import('node:fs/promises')).writeFile(path.join(dir, 'o.json'), '{"a":{"b":[1,2]}}', 'utf8')
      const pass = evaluateChecker(
        {
          checks: [
            { type: 'file_exists', path: 'out.md' },
            { type: 'contains', path: 'out.md', patterns: ['甲', '乙'] },
            { type: 'not_contains', path: 'out.md', patterns: ['丙'] },
            { type: 'regex', path: 'out.md', pattern: '包含[甲乙]和[乙甲]' },
            { type: 'json_field', path: 'o.json', pointer: '/a/b/1', equals: 2 },
          ],
        },
        dir,
      )
      assert.equal(pass.passed, true, JSON.stringify(pass.results))
      const fail = evaluateChecker(
        {
          checks: [
            { type: 'file_exists', path: 'missing.md' },
            { type: 'contains', path: 'out.md', patterns: ['丙'] },
            { type: 'json_field', path: 'o.json', pointer: '/a/b/9', equals: 2 },
          ],
        },
        dir,
      )
      assert.equal(fail.passed, false)
      assert.equal(fail.results.length, 3)
      assert.ok(fail.results.every((r) => r.ok === false && r.detail.length > 0))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('正则编译失败只判该条失败，不抛出', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-gate3-regex-'))
    try {
      const r = evaluateChecker({ checks: [{ type: 'regex', path: 'x.md', pattern: '([' }] }, dir)
      assert.equal(r.passed, false)
      assert.match(r.results[0].detail, /检查自身出错/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('空检查单判失败（必然通过的空检查单等于没有检查）', () => {
    assert.equal(evaluateChecker({ checks: [] }, os.tmpdir()).passed, false)
  })
})

/* ──────────────────────────── 任务集校核 ──────────────────────────── */

describe('14 · 任务集校核：名称泄漏、非法类型、越界路径、无检查单逐条记录', () => {
  it('四类问题都记录且不静默', () => {
    const { tasks, problems } = validateTaskSet(
      {
        tasks: [
          { prompt: '帮我做工具设计', fixtures: {}, checks: [{ type: 'contains', path: 'a.md', patterns: ['x'] }] },
          { prompt: '写一个说明', fixtures: { '../x': 'y' }, checks: [{ type: 'magic', path: 'a.md' }] },
          { prompt: '写第二个说明', fixtures: {}, checks: [] },
        ],
      },
      { expected: 3, forbiddenName: '工具设计' },
    )
    assert.equal(tasks.length, 3)
    const codes = problems.map((p) => p.code)
    assert.ok(codes.includes('NAME_LEAK'))
    assert.ok(codes.includes('UNSAFE_FIXTURE_PATH'))
    assert.ok(codes.includes('UNKNOWN_CHECK_TYPE'))
    assert.ok(codes.includes('NO_CHECKS'))
    assert.equal(tasks[0].containsNameLeak, true)
  })

  it('数量不足被记录', () => {
    const { problems } = validateTaskSet({ tasks: [{ prompt: 'p', fixtures: {}, checks: [{ type: 'file_exists', path: 'a' }] }] }, { expected: 6 })
    assert.ok(problems.some((p) => p.code === 'COUNT_BELOW_EXPECTED'))
  })
})

/* ──────────────────────────── 单臂执行（替身） ──────────────────────────── */

describe('14 · runTaskArm（替身）：物化产物、跑检查单、沙箱清理', () => {
  const task = {
    taskId: 'skill-t1',
    prompt: '写一个 hello.txt，内容包含「你好」',
    fixtures: { 'note.md': '预置夹具' },
    checks: [
      { type: 'file_exists', path: 'hello.txt' },
      { type: 'contains', path: 'hello.txt', patterns: ['你好'] },
    ],
  }

  it('产物落进沙箱并通过检查单；夹具可见于提示词', async () => {
    let seenUser = null
    const chat = async (config, { user }) => {
      seenUser = user
      return {
        text: JSON.stringify({ files: { 'hello.txt': '你好，世界' } }),
        usage: { prompt_tokens: 5, completion_tokens: 3 },
        finishReason: 'stop',
      }
    }
    const r = await runTaskArm({ config: { modelId: 'm' }, arm: 'without', task, taskId: 'skill-t1', chat })
    assert.equal(r.passed, true, JSON.stringify(r.checks))
    assert.deepEqual(r.filesWritten, ['hello.txt'])
    assert.ok(seenUser.includes('预置夹具'), '夹具内容必须在题面里可见')
  })

  it('产物坏了（不是 JSON）→ 该臂判失败，rawText 保留', async () => {
    const chat = async () => ({ text: '不是 JSON', usage: null, finishReason: 'stop' })
    const r = await runTaskArm({ config: { modelId: 'm' }, arm: 'with', task, taskId: 'skill-t1', skillMarkdown: 'x', chat })
    assert.equal(r.passed, false)
    assert.equal(r.rawText, '不是 JSON')
  })
})

/* ──────────────────────────── 判定规则（三路径 + pending） ──────────────────────────── */

describe('14 · 判定规则：复现即拒 / 不复现记噪声 / 改进即通过 / 未复跑不下结论', () => {
  const T = (id, w, t, rerun = null) => ({
    taskId: id,
    without: { passed: w },
    with: { passed: t },
    rerun: rerun === null ? null : { without: { passed: rerun[0] }, with: { passed: rerun[1] } },
  })

  it('退化复现 → rejected（ADR-006 硬约束）', () => {
    const v = verdictForSkill({ skillId: 's', name: 's', taskResults: [T('t1', true, false, [true, false])] })
    assert.equal(v.verdict, 'rejected')
    assert.equal(v.counts.confirmedDegradations, 1)
  })

  it('退化不复现 → 记噪声，且无改进时判 low-utility', () => {
    const v = verdictForSkill({ skillId: 's', name: 's', taskResults: [T('t1', true, false, [true, true])] })
    assert.equal(v.verdict, 'low-utility')
    assert.equal(v.counts.noiseDegradations, 1)
    assert.equal(v.counts.confirmedDegradations, 0)
  })

  it('有改进且无确认退化 → passed；退化未复跑 → pending-rerun（不得直接拒、不得记噪声）', () => {
    const passed = verdictForSkill({ skillId: 's', name: 's', taskResults: [T('t1', false, true), T('t2', true, true)] })
    assert.equal(passed.verdict, 'passed')
    const pending = verdictForSkill({ skillId: 's', name: 's', taskResults: [T('t1', true, false)] })
    assert.equal(pending.verdict, 'pending-rerun')
  })

  it('两臂都败 → 任务无效，可见但不计入效用', () => {
    const v = verdictForSkill({ skillId: 's', name: 's', taskResults: [T('t1', false, false), T('t2', true, true)] })
    assert.equal(v.verdict, 'low-utility')
    assert.equal(v.counts.invalidTasks, 1)
  })

  it('风险标记随判定一起落盘（风险标记必须有下游）', () => {
    const v = verdictForSkill({
      skillId: 's',
      name: 's',
      riskFlags: ['PITFALL_COVERAGE_BELOW_ADVISORY'],
      taskResults: [T('t1', true, true)],
    })
    assert.deepEqual(v.riskFlags, ['PITFALL_COVERAGE_BELOW_ADVISORY'])
  })
})
