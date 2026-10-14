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
  collectCodePointers,
  collectCrossChapterAntipatterns,
  deriveCluster,
  firstParagraph,
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

  it('没有来源的段落出「来源说明」而非留空，且记一条 SECTION_SOURCE_ABSENT 缺口（ADR-029）', () => {
    const r = assembleSkill({
      cluster: cluster(),
      objects: inCluster(),
      antipatterns: [],
      slug: 'x',
      skillTitle: 'T',
    })
    assert.equal(r.sectionCounts.code, 0, '来源说明不是条目——段计数口径不变')
    const gap = r.gaps.find((g) => g.section === 'code')
    assert.equal(gap.code, GAP_CODES.SOURCE_ABSENT)
    // 旧的「留空」口径已被 ADR-029 取代：空段读起来像忘写，来源说明如实回答为什么没有。
    // 说明是引用块（>），不是列表项——不得被条目计数吃进去。
    const seg = r.markdown.split('## 配套代码')[1].split('## 深度阅读')[0]
    assert.match(seg, /本段无来源/)
    assert.equal(r.contract.codeSource.available, false)
    assert.match(r.contract.codeSource.note, /本段无来源/)
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

  it('跨章反模式的出处必须回链，否则门禁一定报 SOURCEREF_UNRESOLVED', async () => {
    // 这条钉的是「跨章反模式第一次真的进 skill」时会撞上的那面墙：校验器要求契约里
    // 每个 `sourceRefs[].file` 都在深度阅读段回链，而跨章反模式的出处按定义落在别的章节。
    // 此前 `crossChapterKept` 恒为 0 把这面墙盖住了。
    //
    // `buildAnchorIndex` 是 async：漏掉 await 会得到一个 Promise，查找表悄悄变空，
    // 本用例就会退化成「什么都没验」——实测踩过一次（漏 await 时失败信息指向的是断言，
    // 而不是那句真正的原因）。
    const idx2 = await buildAnchorIndex(
      path.join(REPO, 'sources', 'ai-agent-book-zh', 'book', 'chapter2.md'),
      { repoRoot: REPO },
    )
    assert.ok(idx2?.anchors?.some((a) => a.anchor === 'chapter2#h3-17'), 'chapter2 索引应含 h3-17')
    const cross = collectCrossChapterAntipatterns(ANTIPATTERNS, cluster().anchors)
    assert.ok(cross.length > 0, '夹具应至少有一条跨章反模式，否则本用例什么都没验')

    const r = assembleSkill({
      cluster: cluster(),
      objects: inCluster(),
      antipatterns: cross,
      slug: 'x',
      skillTitle: 'T',
      anchorIndexes: [IDX, idx2],
    })
    const seg = r.markdown.split('## 深度阅读')[1]
    assert.match(seg, /`sources\/ai-agent-book-zh\/book\/chapter2\.md`/, '跨章出处所在的文件必须在阅读段回链')
    const entry = seg.split('\n').find((l) => l.includes('chapter2.md'))
    assert.match(entry, /（第 \d+–\d+ 行）/, '回链条目应带**索引里的**行号区间')
  })

  it('索引里查不到的跨章出处不臆造行号（宁缺勿编，由门禁去抓）', async () => {
    const cross = collectCrossChapterAntipatterns(ANTIPATTERNS, cluster().anchors)
    const r = assembleSkill({
      cluster: cluster(),
      objects: inCluster(),
      antipatterns: cross,
      slug: 'x',
      skillTitle: 'T',
      anchorIndexes: [IDX], // 故意不给 chapter2 的索引
    })
    const seg = r.markdown.split('## 深度阅读')[1]
    assert.ok(!seg.includes('chapter2.md'), '无索引可查时不得凭对象自述补出回链')
    // 反向对照：给了索引就必须出现（否则上一条断言可能因为「路径写错」而假通过）。
    const withIdx = assembleSkill({
      cluster: cluster(),
      objects: inCluster(),
      antipatterns: cross,
      slug: 'x',
      skillTitle: 'T',
      anchorIndexes: [
        IDX,
        await buildAnchorIndex(path.join(REPO, 'sources', 'ai-agent-book-zh', 'book', 'chapter2.md'), {
          repoRoot: REPO,
        }),
      ],
    })
    assert.match(
      withIdx.markdown.split('## 深度阅读')[1],
      /chapter2\.md/,
      '同一输入下补上索引就应该出现——否则本用例无法区分「不臆造」与「路径写错」',
    )
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

describe('配套代码目录（信息源扩充后新增的来源）', () => {
  const CODE_ROOT_REL = 'sources/ai-agent-book-zh/code/chapter4'

  it('实测取到 6 个目录，且路径是仓库相对路径而非本机绝对路径', () => {
    const ptrs = collectCodePointers(path.join(REPO, CODE_ROOT_REL), { relPrefix: CODE_ROOT_REL })
    assert.equal(ptrs.length, 6)
    for (const p of ptrs) {
      assert.ok(p.path.startsWith('sources/'), `路径应是仓库相对：${p.path}`)
      assert.ok(!p.path.startsWith('/'), `不得是本机绝对路径：${p.path}`)
    }
    assert.deepEqual(
      ptrs.map((p) => p.dir),
      ['active-tool-discovery', 'active-tool-selection', 'collaboration-tools', 'execution-tools', 'multimodal-agent', 'perception-tools'],
    )
  })

  it('每个目录都有一句话说明——取 README 首段，不是生成的', () => {
    const ptrs = collectCodePointers(path.join(REPO, CODE_ROOT_REL), { relPrefix: CODE_ROOT_REL })
    for (const p of ptrs) {
      assert.ok(p.summary && p.summary.length > 10, `${p.dir} 缺少一句话说明`)
    }
  })

  it('目录不存在时返回空数组，由装配器记缺口——不编内容', () => {
    assert.deepEqual(collectCodePointers('/nonexistent/path'), [])
  })

  it('firstParagraph 跳过标题、剥掉行内标记、不做改写', () => {
    const md = '# 标题\n\n**加粗**的[链接](http://x)与`代码`。\n\n第二段不该被取到。\n'
    assert.equal(firstParagraph(md), '加粗的链接与代码。')
  })

  it('装配含配套代码时，该段条目数等于目录数，且不再有 SECTION_NO_SOURCE 缺口', () => {
    const cluster = deriveCluster(IDX.anchors, 'chapter4#h2-2')
    const r = assembleSkill({
      cluster,
      objects: collectClusterObjects(OBJECTS, cluster.anchors),
      antipatterns: [],
      codePointers: collectCodePointers(path.join(REPO, CODE_ROOT_REL), { relPrefix: CODE_ROOT_REL }),
      slug: 'x',
      skillTitle: 'T',
    })
    assert.equal(r.sectionCounts.code, 6)
    assert.equal(r.contract.codeSource.available, true)
    assert.equal(r.contract.codeSource.note, null)
    assert.ok(!r.gaps.some((g) => g.section === 'code' && (g.code === GAP_CODES.NO_SOURCE || g.code === GAP_CODES.SOURCE_ABSENT)))
    // 但粒度是章级而非簇级，这件事必须留痕——否则读者会以为做过锚点级映射。
    const gran = r.gaps.find((g) => g.code === GAP_CODES.GRANULARITY)
    assert.ok(gran, '应记录「章级列举」的粒度缺口')
    assert.equal(gran.coarse, true)
  })
})
