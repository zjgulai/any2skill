/**
 * 门禁二 · 触发盲测的测试（ticket 12）
 *
 * 全部离线：两段模型调用（场景生成 / 盲测）一律用注入的 `chat` 替身。
 * 这个文件里最要紧的是第一组：**盲测隔离必须是机制**——题面构造只读白名单字段，
 * 用哨兵字符串证明「对象内容、来源、skillId 不可能经由题面漏出」；谁把题面改成
 * 直吐整个候选对象，这组测试立刻变红。
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import {
  Gate2Error,
  blindInputHash,
  blindPromptFingerprint,
  buildBlindCatalog,
  buildBlindSystemPrompt,
  buildBlindUserPrompt,
  buildGate2Report,
  catalogHash,
  generateScenariosForCandidate,
  runBlindScenario,
  scenarioGenInputHash,
  scenarioGenPromptFingerprint,
  validateBlindAnswer,
  validateScenarioGen,
} from '../gate2-blind-test.mjs'
import { loadCandidatesForBlindTest, parseArgs as parseGate2Args } from '../../run-gate2.mjs'

/* ──────────────────────────── 盲测隔离（本文件最要紧的一组） ──────────────────────────── */

describe('12 · 盲测题面的白名单是机制：内容/来源/skillId 不可能漏出', () => {
  const SENTINELS = {
    statement: '哨兵-正文陈述-9f3a',
    sourceRefs: '哨兵-出处-4b21',
    evidenceQuote: '哨兵-引文-77cc',
    body: '哨兵-全文-aa01',
  }

  it('目录条目携带任何白名单外字段，都不进题面；skillId 也不进（代号化）', () => {
    const catalogWithExtras = [
      {
        code: 'k01',
        name: '工具设计',
        description: '工具设计的通用原则：适用于设计工具时。',
        skillId: 'chapter4-s1', // 不许出现——它泄露来源
        ...SENTINELS,
      },
    ]
    const prompt = buildBlindUserPrompt({ scenarioText: '我要给 Agent 设计一批工具。', catalog: catalogWithExtras })
    assert.ok(prompt.includes('工具设计'), '白名单字段应在（否则这组测试是空跑）')
    assert.ok(prompt.includes('k01'))
    assert.ok(!prompt.includes('chapter4-s1'), 'skillId 不得出现在题面')
    for (const [field, sentinel] of Object.entries(SENTINELS)) {
      assert.ok(!prompt.includes(sentinel), `题面漏出了 ${field} 的内容`)
    }
  })

  it('构造器只从参数里取白名单字段——即使有人传入整个候选对象也会被字段读取方式挡住', () => {
    const candidateLike = {
      skillId: 'chapter2-s3',
      name: '上下文压缩',
      description: '上下文压缩：适用于会话变长时。',
      sourceObjects: ['哨兵-对象集合-1234'],
      units: ['哨兵-单元-5678'],
      anchors: ['哨兵-锚点-9012'],
    }
    const prompt = buildBlindUserPrompt({ scenarioText: '会话太长了怎么办？', catalog: [candidateLike] })
    for (const v of ['哨兵-对象集合-1234', '哨兵-单元-5678', '哨兵-锚点-9012', 'chapter2-s3']) {
      assert.ok(!prompt.includes(v), `题面漏出了 ${v}`)
    }
  })

  it('盲测系统提示词钉住「宁缺毋滥」与空列表形态', () => {
    const sys = buildBlindSystemPrompt()
    assert.ok(sys.includes('宁缺毋滥'))
    assert.ok(sys.includes('空列表写作 []'))
  })
})

/* ──────────────────────────── 校核 ──────────────────────────── */

describe('12 · 场景生成校核：数量不足、名称泄漏、空文本都不许静默', () => {
  it('数量不足被记录（不是静默接受 1 个场景当 3 个）', () => {
    const r = validateScenarioGen({ scenarios: [{ text: '场景甲', why: 'w' }] }, { expected: 3 })
    assert.equal(r.scenarios.length, 1)
    assert.ok(r.problems.some((p) => p.code === 'COUNT_BELOW_EXPECTED'))
  })

  it('场景里出现技能短名 → NAME_LEAK 逐条记录（防字面泄漏给盲测者）', () => {
    const r = validateScenarioGen(
      { scenarios: [{ text: '帮我做工具设计', why: 'w' }] },
      { expected: 1, forbiddenName: '工具设计' },
    )
    assert.equal(r.scenarios[0].containsNameLeak, true)
    assert.ok(r.problems.some((p) => p.code === 'NAME_LEAK'))
  })

  it('空文本条目被跳过并记录；缺 scenarios 数组即抛', () => {
    const r = validateScenarioGen({ scenarios: [{ text: '  ', why: 'w' }] }, { expected: 1 })
    assert.equal(r.scenarios.length, 0)
    assert.ok(r.problems.some((p) => p.code === 'EMPTY_TEXT'))
    assert.throws(() => validateScenarioGen({ nope: [] }, { expected: 1 }), Gate2Error)
  })
})

describe('12 · 盲测回答校核：未知代号逐条记录、重复去重', () => {
  it('未知代号进 unknownCodes，不被静默丢弃', () => {
    const codeToSkillId = new Map([['k01', 'chapter4-s1']])
    const r = validateBlindAnswer({ triggered: ['k01', 'k99', 'k01'] }, { codeToSkillId })
    assert.deepEqual(r.skillIds, ['chapter4-s1'])
    assert.deepEqual(r.unknownCodes, ['k99'])
  })

  it('缺 triggered 数组即抛', () => {
    assert.throws(() => validateBlindAnswer({ skills: [] }, { codeToSkillId: new Map() }), Gate2Error)
  })
})

/* ──────────────────────────── 乱序与代号 ──────────────────────────── */

describe('12 · 代号化目录：同种子可复算、与输入顺序无关', () => {
  const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((x) => ({ skillId: x, name: `名${x}`, description: `描${x}` }))

  it('同种子 → 同映射（复算要一致）', () => {
    const a = buildBlindCatalog(list, { seed: 'deadbeef' })
    const b = buildBlindCatalog(list, { seed: 'deadbeef' })
    assert.deepEqual(a, b)
    assert.deepEqual(a.map((m) => m.code), ['k01', 'k02', 'k03', 'k04', 'k05', 'k06', 'k07', 'k08'])
  })

  it('映射由种子决定且确实打乱了输入顺序（固定种子，结果可硬编码复算）', () => {
    const a = buildBlindCatalog(list, { seed: '00000001' })
    assert.deepEqual(
      a.map((m) => m.skillId),
      ['c', 'e', 'f', 'h', 'a', 'g', 'd', 'b'],
      '这串顺序由 xorshift32(seed=1) 确定；若实现改了洗牌，本断言会红——正是它该做的事',
    )
  })
})

/* ──────────────────────────── 判分与动作清单 ──────────────────────────── */

describe('12 · 判分：命中/零命中/争抢三态与 ADR-007 动作清单', () => {
  const candidates = [
    { skillId: 'A', name: '甲' },
    { skillId: 'B', name: '乙' },
    { skillId: 'C', name: '丙' },
  ]
  const catalog = [
    { code: 'k01', skillId: 'A', name: '甲', description: 'dA' },
    { code: 'k02', skillId: 'B', name: '乙', description: 'dB' },
    { code: 'k03', skillId: 'C', name: '丙', description: 'dC' },
  ]
  const scenarioSet = {
    candidates: [
      { skillId: 'A', scenarios: [{ scenarioId: 'A-sc1', text: 'sA1' }, { scenarioId: 'A-sc2', text: 'sA2' }] },
      { skillId: 'B', scenarios: [{ scenarioId: 'B-sc1', text: 'sB1' }, { scenarioId: 'B-sc2', text: 'sB2' }] },
      { skillId: 'C', scenarios: [{ scenarioId: 'C-sc1', text: 'sC1' }] },
    ],
    unrelated: [{ scenarioId: 'unrelated-sc1', text: 'sU1' }, { scenarioId: 'unrelated-sc2', text: 'sU2' }],
  }
  const answers = {
    'A-sc1': { skillIds: ['A', 'B'], unknownCodes: [] }, // 争抢
    'A-sc2': { skillIds: ['A'], unknownCodes: [] },
    'B-sc1': { skillIds: ['A', 'B'], unknownCodes: [] }, // 争抢
    'B-sc2': { skillIds: [], unknownCodes: [] },
    'C-sc1': { skillIds: [], unknownCodes: [] }, // 零命中
    'unrelated-sc1': { skillIds: ['B'], unknownCodes: [] }, // 误触发
    'unrelated-sc2': { skillIds: [], unknownCodes: [] },
  }

  const report = buildGate2Report({ candidates, catalog, scenarioSet, answers })
  const byId = new Map(report.perCandidate.map((c) => [c.skillId, c]))

  it('三态判定：A/B 争抢、C 零命中', () => {
    assert.equal(byId.get('A').promotionState, 'trigger-conflict')
    assert.equal(byId.get('B').promotionState, 'trigger-conflict')
    assert.equal(byId.get('C').promotionState, 'trigger-miss')
    assert.equal(byId.get('A').hits, 2)
    assert.equal(byId.get('B').hits, 1)
    assert.equal(byId.get('C').hits, 0)
  })

  it('明细可复核：争抢组、零命中者的场景被谁认领、无关场景误触发', () => {
    assert.equal(report.conflictGroups.length, 2)
    assert.equal(report.totals.unrelatedFalseTriggers, 1)
    assert.equal(report.unrelated[0].falseTrigger, true)
    assert.deepEqual(byId.get('C').missedScenariosClaimedBy, [])
  })

  it('动作清单照 ADR-007：合并组 / 并入或降级 / 高风险抽样——只出清单，不改划分', () => {
    const kinds = report.actions.map((a) => a.kind)
    assert.ok(kinds.includes('merge'))
    assert.ok(kinds.includes('merge-or-demote'))
    assert.ok(kinds.includes('route-to-risk-sampling'))
    const merge = report.actions.find((a) => a.kind === 'merge')
    assert.deepEqual([...merge.candidates].sort(), ['A', 'B'])
    const demote = report.actions.find((a) => a.kind === 'merge-or-demote')
    assert.deepEqual(demote.candidates, ['C'])
    const risk = report.actions.find((a) => a.kind === 'route-to-risk-sampling')
    assert.deepEqual(risk.candidates, ['B'])
  })

  it('零命中且场景无人认领时的理由文本区分两种形状', () => {
    const solo = buildGate2Report({
      candidates: [{ skillId: 'C', name: '丙' }],
      catalog: [{ code: 'k01', skillId: 'C', name: '丙', description: 'd' }],
      scenarioSet: { candidates: [{ skillId: 'C', scenarios: [{ scenarioId: 'C-sc1', text: 's' }] }], unrelated: [] },
      answers: { 'C-sc1': { skillIds: [], unknownCodes: [] } },
    })
    assert.match(solo.actions[0].basis, /无人认领/)
  })
})

/* ──────────────────────────── 身份与替身调用 ──────────────────────────── */

describe('12 · 身份键与两段替身调用', () => {
  const candidate = { name: '甲', trigger: '当甲时', description: '甲：描述。' }
  const objectRows = [{ objectType: 'Concept', summary: '术语：定义' }]

  it('身份键：同输入同键；描述/场景/模型任一变化即变', () => {
    const base = scenarioGenInputHash({ candidate, objectRows, k: 3, modelId: 'm1' })
    assert.equal(base, scenarioGenInputHash({ candidate, objectRows, k: 3, modelId: 'm1' }))
    assert.notEqual(base, scenarioGenInputHash({ candidate: { ...candidate, description: '甲：改了。' }, objectRows, k: 3, modelId: 'm1' }))
    assert.notEqual(base, scenarioGenInputHash({ candidate, objectRows, k: 3, modelId: 'm2' }))
    const blindBase = blindInputHash({ scenarioText: 's', catalog: [{ code: 'k01', name: '甲', description: 'd' }], modelId: 'm1' })
    assert.equal(blindBase, blindInputHash({ scenarioText: 's', catalog: [{ code: 'k01', name: '甲', description: 'd' }], modelId: 'm1' }))
    assert.notEqual(blindBase, blindInputHash({ scenarioText: 's2', catalog: [{ code: 'k01', name: '甲', description: 'd' }], modelId: 'm1' }))
  })

  it('提示词指纹是常量且形状正确', () => {
    assert.match(scenarioGenPromptFingerprint(), /^prompt-[0-9a-f]{12}$/)
    assert.match(blindPromptFingerprint(), /^prompt-[0-9a-f]{12}$/)
  })

  it('目录哈希：名称或描述变化 → 身份变', () => {
    const a = catalogHash([{ skillId: 'A', name: '甲', description: 'd' }])
    const b = catalogHash([{ skillId: 'A', name: '甲', description: 'd2' }])
    assert.notEqual(a, b)
  })

  it('generateScenariosForCandidate（替身）：形状与身份键由单一真源给出', async () => {
    const chat = async () => ({
      text: JSON.stringify({ scenarios: [{ text: '场景一', why: 'w1' }, { text: '场景二', why: 'w2' }, { text: '场景三', why: 'w3' }] }),
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      finishReason: 'stop',
    })
    const r = await generateScenariosForCandidate({ config: { modelId: 'm1' }, candidate, objectRows, k: 3, chat })
    assert.equal(r.scenarios.length, 3)
    assert.equal(r.inputHash, scenarioGenInputHash({ candidate, objectRows, k: 3, modelId: 'm1' }))
  })

  it('runBlindScenario（替身）：代号解析回真实 id，未知代号被记录', async () => {
    const chat = async () => ({
      text: JSON.stringify({ triggered: ['k02', 'k99'] }),
      usage: null,
      finishReason: 'stop',
    })
    const r = await runBlindScenario({
      config: { modelId: 'm1' },
      scenarioId: 'X-sc1',
      scenarioText: 's',
      catalog: [{ code: 'k01', name: '甲', description: 'd' }, { code: 'k02', name: '乙', description: 'd' }],
      codeToSkillId: new Map([['k01', 'A'], ['k02', 'B']]),
      chat,
    })
    assert.deepEqual(r.skillIds, ['B'])
    assert.deepEqual(r.unknownCodes, ['k99'])
  })
})

/* ──────────────────────────── 严格口径第二读数（口径校准） ──────────────────────────── */

describe('12 · 严格口径第二读数：换口径即换身份，超限如实记录', () => {
  it('系统/用户提示词按口径变化；两种口径的指纹不同', () => {
    assert.ok(buildBlindSystemPrompt({ max: 2 }).includes('至多列 2 个'))
    assert.ok(buildBlindUserPrompt({ scenarioText: 's', catalog: [], max: 2 }).includes('至多 2 个'))
    assert.notEqual(blindPromptFingerprint({ max: null }), blindPromptFingerprint({ max: 2 }))
  })

  it('身份键随口径变化（同场景同目录，两种口径不互相复用）', () => {
    const base = { scenarioText: 's', catalog: [{ code: 'k01', name: 'n', description: 'd' }], modelId: 'm' }
    assert.notEqual(blindInputHash({ ...base, max: null }), blindInputHash({ ...base, max: 2 }))
  })

  it('超限如实记录、不截断（截断等于替模型改答案）', () => {
    const map = new Map([['k01', 'A'], ['k02', 'B'], ['k03', 'C']])
    const r = validateBlindAnswer({ triggered: ['k01', 'k02', 'k03'] }, { codeToSkillId: map, max: 2 })
    assert.equal(r.skillIds.length, 3)
    assert.equal(r.overMax, 3)
    assert.equal(validateBlindAnswer({ triggered: ['k01'] }, { codeToSkillId: map, max: 2 }).overMax, null)
  })

  it('CLI --blind-mode 非法值被拒（列出可用口径）', () => {
    assert.throws(() => parseGate2Args(['node', 'run-gate2.mjs', '--blind-mode', 'nope']), /--blind-mode 只支持 list \| strict/)
  })
})

/* ──────────────────────────── CLI 干跑（临时仓库根） ──────────────────────────── */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = DEFAULT_REPO_ROOT
const CLI = path.join(REPO, 'pipeline', 'run-gate2.mjs')
const SOURCE_REL = path.join('sources', 'ai-agent-book-zh', 'book', 'chapter4.md')

let ROOT

before(async () => {
  ROOT = await mkdtemp(path.join(os.tmpdir(), 'any2skills-gate2-'))
  await mkdir(path.join(ROOT, 'sources', 'ai-agent-book-zh', 'book'), { recursive: true })
  await copyFile(path.join(REPO, SOURCE_REL), path.join(ROOT, SOURCE_REL))
  const idx = await buildAnchorIndex(path.join(ROOT, SOURCE_REL), { repoRoot: ROOT })
  const a = idx.anchors[0].anchor
  const b = idx.anchors[1].anchor

  await mkdir(path.join(ROOT, 'pipeline', 'knowledge'), { recursive: true })
  await mkdir(path.join(ROOT, 'pipeline', 'registry'), { recursive: true })
  await writeFile(
    path.join(ROOT, 'pipeline', 'knowledge', 'chapter4.objects.json'),
    JSON.stringify([
      { id: 'T-1', objectType: 'EngineeringRule', statement: '规则甲', appliesWhen: '场景甲', sourceRefs: [{ file: SOURCE_REL, anchor: a }] },
      { id: 'T-2', objectType: 'Concept', canonicalTerm: '术语', definition: '定义', sourceRefs: [{ file: SOURCE_REL, anchor: b }] },
    ]),
  )
  await writeFile(
    path.join(ROOT, 'pipeline', 'registry', 'run-testgate2.receipt.json'),
    JSON.stringify({
      runId: 'run-testgate2',
      createdAt: new Date().toISOString(),
      source: { path: SOURCE_REL },
      objectVerdicts: [
        { objectId: 'T-1', status: 'pass' },
        { objectId: 'T-2', status: 'pass' },
      ],
    }),
  )
  await writeFile(
    path.join(ROOT, 'pipeline', 'knowledge', 'clusters.json'),
    JSON.stringify({
      schemaVersion: 'clusters/v1',
      chapters: [
        {
          fileKey: 'chapter4',
          units: [{ unitId: 'chapter4-u1', name: '单元一', objectIds: ['T-1', 'T-2'], anchors: [a, b], rationale: 'r' }],
          skills: [{ skillId: 'chapter4-s1', name: '候选一', trigger: '当设计时', unitIds: ['chapter4-u1'], rationale: 'r' }],
        },
      ],
    }),
  )
  await writeFile(
    path.join(ROOT, 'pipeline', 'registry', 'skill-candidates.json'),
    JSON.stringify({
      schemaVersion: 'skill-candidates/v1',
      candidates: [
        {
          skillId: 'chapter4-s1',
          name: '候选一',
          trigger: '当设计时',
          sourceObjects: ['T-1', 'T-2'],
          chapterRefs: ['chapter4'],
          promotionState: 'candidate',
          units: ['chapter4-u1'],
          anchors: [a, b],
          rationale: 'r',
        },
      ],
    }),
  )
})

after(async () => {
  if (ROOT) await rm(ROOT, { recursive: true, force: true })
})

describe('12 · CLI 干跑与前置拒绝', () => {
  const runCli = (args) => spawnSync(process.execPath, [CLI, '--repo-root', ROOT, ...args], { cwd: REPO, encoding: 'utf8' })

  it('--dry-run：报候选数、计划调用数与生成侧规模；零调用零写盘', () => {
    const r = runCli(['--dry-run', '--json'])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.candidates, 1)
    assert.equal(out.plannedGenerationCalls, 2) // 1 候选 + 无关场景
    assert.equal(out.plannedBlindCalls, 3 + 20)
    assert.ok(!r.stdout.includes('哨兵'))
  })

  it('--blind-mode strict：干跑如实标记口径（两份读数各走各的 partial 与报告）', () => {
    const r = runCli(['--dry-run', '--json', '--blind-mode', 'strict'])
    assert.equal(r.status, 0, r.stderr)
    const out = JSON.parse(r.stdout)
    assert.equal(out.blindMode, 'strict')
  })

  it('--skill 未知候选 → 拒绝并列出现有', () => {
    const r = runCli(['--dry-run', '--skill', 'nope'])
    assert.equal(r.status, 4)
    assert.match(r.stderr, /候选不存在：nope/)
    assert.match(r.stderr, /chapter4-s1/)
  })

  it('候选的描述由装配器生成（与发布产物同源），不是重写的简介', async () => {
    const { candidates } = await loadCandidatesForBlindTest(ROOT)
    assert.equal(candidates.length, 1)
    assert.match(candidates[0].description, /^候选一：/)
    assert.ok(candidates[0].description.includes('适用于'))
    assert.ok(!candidates[0].description.includes('哨兵'))
  })
})
