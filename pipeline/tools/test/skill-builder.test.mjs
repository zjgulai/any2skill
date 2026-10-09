/**
 * 环 4 装配器的测试（ticket 10，tracer bullet）
 *
 * 本文件钉三件事：
 *   1. 簇派生是确定性的，且边界判据是「层级」而不是「行号猜测」；
 *   2. 装配器**不编内容**——没有来源的段落必须留空，不能出现看似完整的内容；
 *   3. 两类「静默空结果」必须抛错而不是返回空数组。
 *
 * 第 3 条不是假想的：第一版装配器把 `antipatterns.objects.json`（对象形状，含 `.objects`）
 * 整个传进 `collectCrossChapterAntipatterns`，那里的 `Array.isArray` 判断让它静默返回 `[]`。
 * 产物里显示「跨章反模式 0 条」，看起来像「本主题没有反模式」，实际是「读错了形状」。
 * 这两个原因在输出里长得一模一样——测试的价值就在于让它们不再一样。
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import {
  GAP_CODES,
  SkillBuildError,
  assembleSkill,
  collectClusterObjects,
  collectCrossChapterAntipatterns,
  deriveCluster,
  buildDescription,
  unwrapObjectsFile,
} from '../../tools/skill-builder.mjs'

const REPO = DEFAULT_REPO_ROOT
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'

let IDX
let OBJECTS
let ANTIPATTERNS

before(async () => {
  IDX = await buildAnchorIndex(path.join(REPO, SOURCE_REL), { repoRoot: REPO })
  OBJECTS = unwrapObjectsFile(
    JSON.parse(await readFile(path.join(REPO, 'pipeline/knowledge/chapter4.objects.json'), 'utf8')),
    'chapter4.objects.json',
  )
  ANTIPATTERNS = unwrapObjectsFile(
    JSON.parse(
      await readFile(path.join(REPO, 'pipeline/knowledge/antipatterns.objects.json'), 'utf8'),
    ),
    'antipatterns.objects.json',
  )
})

describe('deriveCluster · 子树边界', () => {
  it('h2-2 收敛 h2-2 自己 + 其下 h3-1/h3-2/h3-3，遇到 h2-3 即止', () => {
    const c = deriveCluster(IDX.anchors, 'chapter4#h2-2')
    assert.deepEqual(
      c.anchors.map((a) => a.anchor),
      ['chapter4#h2-2', 'chapter4#h3-1', 'chapter4#h3-2', 'chapter4#h3-3'],
    )
  })

  it('h2 根锚点之间的簇互不重叠', () => {
    const a = deriveCluster(IDX.anchors, 'chapter4#h2-1').anchors.map((x) => x.anchor)
    const b = deriveCluster(IDX.anchors, 'chapter4#h2-2').anchors.map((x) => x.anchor)
    assert.equal(a.filter((x) => b.includes(x)).length, 0)
  })

  it('根锚点不存在时抛错，而不是返回空簇', () => {
    assert.throws(
      () => deriveCluster(IDX.anchors, 'chapter4#h9-9'),
      (err) => err instanceof SkillBuildError && err.code === 'ROOT_ANCHOR_MISSING',
    )
  })
})

describe('unwrapObjectsFile · 两种盘上形状', () => {
  it('接受数组', () => {
    assert.equal(unwrapObjectsFile([{ id: 'A' }]).length, 1)
  })

  it('接受 { objects: [...] } 形状', () => {
    assert.equal(unwrapObjectsFile({ schemaVersion: 'x', objects: [{ id: 'A' }] }).length, 1)
  })

  it('实测：chapter4 那份是数组，antipatterns 那份是对象——这是本函数存在的原因', async () => {
    const rawChapter = JSON.parse(
      await readFile(path.join(REPO, 'pipeline/knowledge/chapter4.objects.json'), 'utf8'),
    )
    const rawAnti = JSON.parse(
      await readFile(path.join(REPO, 'pipeline/knowledge/antipatterns.objects.json'), 'utf8'),
    )
    assert.ok(Array.isArray(rawChapter), 'chapter4.objects.json 应为数组')
    assert.ok(!Array.isArray(rawAnti), 'antipatterns.objects.json 应为对象')
    assert.ok(Array.isArray(rawAnti.objects), '它把对象放在 .objects 下')
    // 两条路都能取到对象
    assert.ok(unwrapObjectsFile(rawChapter).length > 0)
    assert.ok(unwrapObjectsFile(rawAnti).length > 0)
  })

  it('形状不可识别时抛错，而不是返回空数组', () => {
    assert.throws(
      () => unwrapObjectsFile({ schemaVersion: 'x', items: [] }),
      (err) => err instanceof SkillBuildError && err.code === 'OBJECTS_FILE_SHAPE_UNKNOWN',
    )
  })
})

describe('collectCrossChapterAntipatterns · 不许静默返回空', () => {
  it('传对象进来会抛错（这正是第一版踩的坑）', () => {
    assert.throws(
      () => collectCrossChapterAntipatterns({ objects: ANTIPATTERNS }, ['chapter4#h3-2']),
      (err) => err instanceof SkillBuildError && err.code === 'OBJECTS_NOT_ARRAY',
    )
  })

  it('chapter4#h2-2 簇引到 2 条跨章反模式（T02-03 引 h3-2、T02-04 引 h3-3）', () => {
    const c = deriveCluster(IDX.anchors, 'chapter4#h2-2')
    const hits = collectCrossChapterAntipatterns(ANTIPATTERNS, c.anchors)
    assert.deepEqual(hits.map((o) => o.id).sort(), ['AP-SYNTH-T02-03', 'AP-SYNTH-T02-04'])
  })

  it('collectClusterObjects 同样不接受非数组', () => {
    assert.throws(
      () => collectClusterObjects({ objects: OBJECTS }, ['chapter4#h2-2']),
      (err) => err instanceof SkillBuildError && err.code === 'OBJECTS_NOT_ARRAY',
    )
  })
})

describe('assembleSkill · 确定性与「不编内容」', () => {
  const cluster = () => deriveCluster(IDX.anchors, 'chapter4#h2-2')
  const inCluster = () => collectClusterObjects(OBJECTS, cluster().anchors)

  it('同样的输入产出逐字节相同的 markdown', () => {
    const args = { cluster: cluster(), objects: inCluster(), antipatterns: [], slug: 'x', skillTitle: 'T' }
    const a = assembleSkill(args)
    const b = assembleSkill(args)
    assert.equal(a.markdown, b.markdown)
  })

  it('没有来源的段落留空，且记一条 SECTION_NO_SOURCE 缺口', () => {
    const r = assembleSkill({
      cluster: cluster(),
      objects: inCluster(),
      antipatterns: [],
      slug: 'x',
      skillTitle: 'T',
    })
    assert.equal(r.sectionCounts.code, 0)
    const gap = r.gaps.find((g) => g.section === 'code')
    assert.equal(gap.code, GAP_CODES.NO_SOURCE)
    // 留空的段落里不得出现任何替代性文字——「看似完整」比「看起来缺」更危险。
    const seg = r.markdown.split('## 配套代码')[1].split('## 深度阅读')[0]
    assert.equal(seg.trim(), '')
  })

  it('六段标题齐全且顺序与骨架一致', () => {
    const r = assembleSkill({
      cluster: cluster(),
      objects: inCluster(),
      antipatterns: [],
      slug: 'x',
      skillTitle: 'T',
    })
    const heads = r.markdown.match(/^## .+$/gm)
    assert.deepEqual(heads, [
      '## 何时使用',
      '## 核心原则',
      '## 实践模式',
      '## 常见陷阱',
      '## 配套代码',
      '## 深度阅读',
    ])
  })

  it('深度阅读段回链的是源文件而非书内相对路径（口径与 ADR-004 的 `book/chapterN.md` 表述有别，见 ADR-019）', () => {
    const r = assembleSkill({
      cluster: cluster(),
      objects: inCluster(),
      antipatterns: [],
      slug: 'x',
      skillTitle: 'T',
    })
    const seg = r.markdown.split('## 深度阅读')[1]
    assert.match(seg, /`sources\/ai-agent-book-zh\/book\/chapter4\.md`/)
  })
})

describe('buildDescription', () => {
  it('不产生相邻标点，且以句号收尾', () => {
    const text = buildDescription({
      cluster: { title: '工具设计的通用原则' },
      principles: [{ text: '工具应该对应 Agent 的目标。' }],
      whenToUse: [{ text: '当设计面向 Agent 使用的工具时。' }],
    })
    assert.ok(!/[。；]\s*；/.test(text), text)
    assert.ok(text.endsWith('。'), text)
  })

  it('超过 1024 字符时截断（官方硬限）', () => {
    const text = buildDescription({
      cluster: { title: 'T' },
      principles: [{ text: 'x'.repeat(2000) }],
      whenToUse: [],
    })
    assert.ok(text.length <= 1024, `实际 ${text.length}`)
  })
})
