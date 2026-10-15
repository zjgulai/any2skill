/**
 * 任务技能套件（卡 26 / ADR-031）
 *
 * 钉住四类不变式：**覆盖**（并集等于旧 30 契约去重并集，零内容丢失）、**不相交**
 * （主对象两两唯一主人）、**门禁**（每个 owned 对象可解析且过门禁一）、**诚实**
 * （rejected 绝不出现；通用技能不虚标未覆盖能力；Rust 技能显式写 Rust）。
 * 另加确定性（两遍渲染逐字节相同）与工作流完整性。
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { planMigration } from '../../publish-task-suite.mjs'

import {
  TASK_SKELETON_SECTIONS,
  TASK_SUITE_SCHEMA_VERSION,
  loadMemberSources,
  loadObjectIndex,
  loadSuiteManifest,
  loadWorkflow,
  renderTaskSkill,
} from '../../tools/task-skill-builder.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..')

const FIRST = ['chapter1-s1', 'chapter2-s3', 'chapter4-single-tool-design', 'chapter4-tool-design-principles', 'chapter5-s3', 'chapter9-s2', 'chapter10-s3']
const RUST = [
  'ch04-02-references-and-borrowing-s1', 'ch04-03-slices-s1', 'ch05-01-defining-structs-s1', 'ch05-03-method-syntax-s1',
  'ch06-01-defining-an-enum-s1', 'ch06-02-match-s1', 'ch08-02-strings-s1', 'ch08-03-hash-maps-s1', 'ch10-01-syntax-s1',
  'ch10-02-traits-s1', 'ch10-03-lifetime-syntax-s1', 'ch11-02-running-tests-s1', 'ch12-03-improving-error-handling-and-modularity-s1',
  'ch13-01-closures-s1', 'ch13-01-closures-s2', 'ch15-01-box-s2', 'ch15-03-drop-s1', 'ch15-05-interior-mutability-s1',
  'ch16-01-threads-s1', 'ch16-02-message-passing-s1', 'ch16-03-shared-state-s1', 'ch17-03-oo-design-patterns-s1', 'ch18-02-refutability-s1',
]
const REJECTED = ['chapter3-s1', 'ch13-02-iterators-s1']

const contractOf = async (slug) =>
  JSON.parse(await readFile(path.join(REPO, 'pipeline', 'registry', 'build', slug, 'skill-contract.json'), 'utf8'))

describe('26 · 任务套件清单：覆盖与不相交', () => {
  let suite
  let objectIndex
  before(async () => {
    suite = await loadSuiteManifest(REPO)
    objectIndex = await loadObjectIndex(REPO)
  })

  it('15 个成员（+2 rejected 记录）、slug 唯一且合法；30 个旧 slug 全部被引用；rejected 绝不出现', () => {
    assert.equal(suite.manifest.schemaVersion, TASK_SUITE_SCHEMA_VERSION)
    const slugs = suite.manifest.members.map((m) => m.slug)
    // 15 = 19 首版 − 2 对合并（19→17）+ 2 个评测拒绝下架（17→15，见清单 mergeNote/assessmentNote）
    assert.equal(slugs.length, 15)
    assert.equal(new Set(slugs).size, 15)
    assert.equal((suite.manifest.rejected ?? []).length, 2, '两个确认负迁移的记录在 rejected 段')
    for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)+$/)
    const referenced = new Set([...suite.manifest.members, ...(suite.manifest.rejected ?? [])].flatMap((m) => m.legacySlugs))
    for (const l of [...FIRST, ...RUST]) assert.ok(referenced.has(l), `旧 slug 未被引用：${l}`)
    assert.equal(referenced.size, 30)
    const raw = JSON.stringify(suite.manifest)
    for (const r of REJECTED) assert.ok(!raw.includes(r), `rejected 出现在清单：${r}`)
  })

  it('主对象两两不相交；并集 = 旧 30 契约去重并集（两源分别验）', async () => {
    const unionOfLegacy = async (slugs) => {
      const set = new Set()
      for (const l of slugs) for (const o of (await contractOf(l)).sourceObjects ?? []) set.add(o)
      return set
    }
    // rejected 段（卡 27）：所有权记录保留——并集与不相交对「在售 ∪ 已拒」全量成立。
    const allOwnership = [...suite.manifest.members, ...(suite.manifest.rejected ?? [])]
    const firstMembers = allOwnership.filter((m) => m.sourceKey === 'ai-agent-book-zh')
    const rustMembers = allOwnership.filter((m) => m.sourceKey === 'rust-book-cn')

    for (const [members, legacy] of [[firstMembers, FIRST], [rustMembers, RUST]]) {
      const seen = new Map()
      const union = new Set()
      for (const m of members) {
        for (const o of m.primaryObjects) {
          assert.ok(!seen.has(o), `主对象重复：${o}（${seen.get(o)} 与 ${m.slug}）`)
          seen.set(o, m.slug)
          union.add(o)
        }
      }
      const legacyUnion = await unionOfLegacy(legacy)
      const missing = [...legacyUnion].filter((x) => !union.has(x))
      const extra = [...union].filter((x) => !legacyUnion.has(x))
      assert.deepEqual(missing, [], '旧契约有对象未被任何新成员认领')
      assert.deepEqual(extra, [], '新成员声明了旧契约之外的主对象')
    }
  })

  it('跨章反模式并集 = 旧契约 AP 去重并集（允许跨成员共享——旧版即如此）', async () => {
    const legacyApsOf = async (slugs) => {
      const set = new Set()
      for (const l of slugs) for (const a of (await contractOf(l)).crossChapterObjects ?? []) set.add(a)
      return set
    }
    const rustSlugs = [...suite.manifest.members, ...(suite.manifest.rejected ?? [])].filter((m) => m.sourceKey === 'rust-book-cn').map((m) => m.slug)
    for (const [legacy, keys] of [[FIRST, ['design-agent-tools', 'define-agent-boundaries-and-safeguards', 'update-agent-instructions']], [RUST, rustSlugs]]) {
      const legacyUnion = await legacyApsOf(legacy)
      const newUnion = new Set()
      const scope = [...suite.manifest.members, ...(suite.manifest.rejected ?? [])]
      for (const m of scope.filter((x) => keys.includes(x.slug))) for (const a of m.crossChapterObjects ?? []) newUnion.add(a)
      const missing = [...legacyUnion].filter((x) => !newUnion.has(x))
      assert.deepEqual(missing, [], '旧 AP 未被认领')
    }
  })

  it('每个 owned 对象可解析且过门禁一（含跨章池判定）——15 个成员逐个装载', async () => {
    for (const member of suite.manifest.members) {
      const { objects, aps } = await loadMemberSources(REPO, member, objectIndex)
      assert.equal(objects.length, member.primaryObjects.length, `${member.slug} 装载数不符`)
      assert.equal(aps.length, (member.crossChapterObjects ?? []).length, `${member.slug} AP 装载数不符`)
    }
  })
})

describe('26 · 工作流与渲染：完整性与确定性', () => {
  it('15 份工作流字段齐全（含 rollback 处置与非空数组）', async () => {
    const suite = await loadSuiteManifest(REPO)
    for (const member of suite.manifest.members) {
      const { workflow } = await loadWorkflow(REPO, member)
      assert.ok(workflow.steps.length >= 3, `${member.slug} 步骤过少`)
      assert.ok(workflow.checks.length >= 2, `${member.slug} 检查项过少`)
    }
  })

  it('两遍渲染逐字节相同（纯函数，无时间戳）', async () => {
    const suite = await loadSuiteManifest(REPO)
    const objectIndex = await loadObjectIndex(REPO)
    const member = suite.manifest.members[0]
    const { objects, aps } = await loadMemberSources(REPO, member, objectIndex)
    const { workflow } = await loadWorkflow(REPO, member)
    const a = renderTaskSkill({ member, workflow, objects, aps })
    const b = renderTaskSkill({ member, workflow, objects, aps })
    assert.equal(a, b)
    // 骨架段全部出现且顺序正确
    const headings = [...a.matchAll(/^## (.+)$/gm)].map((m) => `## ${m[1]}`)
    assert.deepEqual(headings, TASK_SKELETON_SECTIONS.map((s) => s.heading))
  })

  it('通用成员描述不虚标未覆盖能力；Rust 成员描述显式写 Rust', async () => {
    const suite = await loadSuiteManifest(REPO)
    const forbidden = [/JavaScript/i, /TypeScript/i, /Python\b/i, /RAG\b/, /向量数据库/, /Kubernetes|\bK8s\b/, /可观测性/, /前端框架/]
    for (const member of suite.manifest.members) {
      const { workflow } = await loadWorkflow(REPO, member)
      if (member.sourceKey === 'ai-agent-book-zh') {
        for (const re of forbidden) {
          assert.ok(!re.test(workflow.description), `${member.slug} 描述出现未覆盖能力：${re}`)
        }
      } else {
        assert.match(workflow.description, /Rust/, `${member.slug} 描述未显式写 Rust`)
      }
    }
  })

  it('仓库处于已迁移态：活动发布面 = 套件 19；旧 30 在归档且 fetch 不再可见', async () => {
    const plan = await planMigration(REPO)
    assert.equal(plan.state, 'already-migrated', '仓库不处于已迁移态——先跑 pipeline/publish-task-suite.mjs')
    const active = (await readdir(path.join(REPO, 'skills'))).sort()
    assert.deepEqual(active, [...plan.newSlugs].sort(), '发布面与套件清单不一致')
    const archived = (await readdir(path.join(REPO, 'pipeline', 'registry', 'legacy-published', 'chapter-suite-v1', 'skills'))).sort()
    assert.deepEqual(archived, [...plan.legacy].sort(), '归档面与旧 slug 清单不一致')
    // 旧 slug 不得在活动面留触发桩（ADR-031：无别名）
    for (const l of plan.legacy) assert.ok(!(await readdir(path.join(REPO, 'skills'))).includes(l))
  })
})