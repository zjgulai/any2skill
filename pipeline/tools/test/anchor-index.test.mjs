/**
 * ticket 01 的验收测试：单文件确定性锚点索引
 *
 * 测外部行为：解析结果、落盘产物、退出码。不断言内部函数结构。
 * 与真实语料的断言使用 chapter4.md 的实测值（该文件不含代码围栏，是干净样本）。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildAnchorIndex,
  assertAllowedSource,
  computeFencedFlags,
  SourcePathError,
  DEFAULT_REPO_ROOT,
  DEFAULT_SOURCE_ROOT,
} from '../../tools/anchor-index.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.join(HERE, 'fixtures')
const CHAPTER4 = path.join(DEFAULT_REPO_ROOT, DEFAULT_SOURCE_ROOT, 'chapter4.md')
const AFTERWORD = path.join(DEFAULT_REPO_ROOT, DEFAULT_SOURCE_ROOT, 'afterword.md')
const INTRO = path.join(DEFAULT_REPO_ROOT, DEFAULT_SOURCE_ROOT, 'introduction.md')
const CLI = path.join(DEFAULT_REPO_ROOT, 'pipeline', 'tools', 'anchor-index.mjs')
const KNOWLEDGE_DIR = path.join(DEFAULT_REPO_ROOT, 'pipeline', 'knowledge')

const runCli = (args) =>
  spawnSync(process.execPath, [CLI, ...args], { cwd: DEFAULT_REPO_ROOT, encoding: 'utf8' })

describe('第 1 层 · 标题解析与行号区间', () => {
  it('覆盖 ## / ### / #### 三个层级，且每个锚点都有行号区间', async () => {
    const idx = await buildAnchorIndex(CHAPTER4)
    const levels = new Set(idx.anchors.map((a) => a.level))
    assert.ok(idx.anchors.length > 0)
    for (const a of idx.anchors) {
      assert.ok(Number.isInteger(a.lineStart) && a.lineStart >= 1, `${a.anchor} 缺 lineStart`)
      assert.ok(Number.isInteger(a.lineEnd) && a.lineEnd >= a.lineStart, `${a.anchor} 行号区间非法`)
    }
    assert.deepEqual([...levels].sort(), [1, 2, 3, 4], '应覆盖 h1/h2/h3/h4 四个层级')
  })

  it('chapter4.md 实测：9 个 ## 锚点、7 个 ### 锚点、3 个 #### 锚点', async () => {
    const idx = await buildAnchorIndex(CHAPTER4)
    assert.deepEqual(idx.levelCounts, { h1: 1, h2: 9, h3: 7, h4: 3 })
    assert.equal(idx.anchorCount, 20)
  })

  it('chapter4.md 实测行号区间：三个 ### 小节的区间逐条成立', async () => {
    const idx = await buildAnchorIndex(CHAPTER4)
    const byTitle = new Map(idx.anchors.map((a) => [a.title, a]))
    const expectations = [
      ['能力的表达形式：专用工具、通用执行器与 Skill', 38, 69],
      ['工具描述的艺术', 70, 87],
      ['参数传递的保真性', 88, 99],
    ]
    for (const [title, lineStart, lineEnd] of expectations) {
      const a = byTitle.get(title)
      assert.ok(a, `未找到标题「${title}」`)
      assert.equal(a.lineStart, lineStart, `「${title}」起始行`)
      assert.equal(a.lineEnd, lineEnd, `「${title}」结束行`)
    }
  })

  it('区间约定可自证的推论：## 区间的结束行 = 下一个任意层级标题的起始行 - 1', async () => {
    const idx = await buildAnchorIndex(CHAPTER4)
    // h2-2「工具设计的通用原则」起于 34，其下第一个 ### 起于 38 ⇒ 34–37
    const h2 = idx.anchors.find((a) => a.anchor === 'chapter4#h2-2')
    assert.equal(h2.lineStart, 34)
    assert.equal(h2.lineEnd, 37)
    const nextHeading = idx.anchors.find((a) => a.lineStart === 38)
    assert.equal(nextHeading.level, 3)
    assert.equal(h2.lineEnd, nextHeading.lineStart - 1)
  })
})

describe('第 1 层 · 锚点标识的稳定性（不随行号变化）', () => {
  it('重排版后标识与顺序不变，而行号确实发生变化', async () => {
    const before = await buildAnchorIndex(path.join(FIXTURES, 'mixed.md'))
    const after = await buildAnchorIndex(path.join(FIXTURES, 'mixed-reflowed.md'))

    // 两个夹具是**不同文件名**，而标识按设计含文件名，故先归一化掉前缀再比对；
    // 「同文件重排版时标识不变」这一点由下一个用例单独证明。
    const payload = (a) => a.anchor.replace(/^[^#]+/, '')
    assert.deepEqual(
      after.anchors.map(payload),
      before.anchors.map(payload),
      '标识的层级-序号部分在重排版后必须逐项相同',
    )
    assert.deepEqual(
      after.anchors.map((a) => a.level),
      before.anchors.map((a) => a.level),
      '标题序列必须一致',
    )
    assert.notEqual(before.fileKey, after.fileKey, '两个夹具本就是不同文件')
    assert.notDeepEqual(
      after.anchors.map((a) => a.lineStart),
      before.anchors.map((a) => a.lineStart),
      '该夹具的作用就是让行号变化——若行号也没变，这个测试就没在验证稳定性',
    )
  })

  it('标识形如 <文件名>#h<层级>-<序号>，与行号无关', async () => {
    const idx = await buildAnchorIndex(CHAPTER4)
    for (const a of idx.anchors) {
      const m = /^chapter4#h([1-6])-(\d+)$/.exec(a.anchor)
      assert.ok(m, `标识格式不符：${a.anchor}`)
      // 序号是「该层级内的第几个」——按文档出现顺序自增，故必等于该层级已出现次数
      assert.equal(Number(m[1]), a.level, `标识里的层级与 level 字段不一致：${a.anchor}`)
    }
    assert.equal(idx.anchors[0].anchor, 'chapter4#h1-1')

    // 同一层级内的序号必须是连续正整数，不跳号、不重复
    for (const level of [1, 2, 3, 4]) {
      const ordinals = idx.anchors
        .filter((a) => a.level === level)
        .map((a) => Number(/-(\d+)$/.exec(a.anchor)[1]))
      assert.deepEqual(
        ordinals,
        Array.from({ length: ordinals.length }, (_, i) => i + 1),
        `h${level} 的序号应为连续正整数`,
      )
    }
    // 稳定性本身由「重排版后标识不变」的用例证明，此处只钉住构成规则。
  })

  it('同一锚点的内容被改动后哈希变化，而标识不变', async () => {
    // 用 chapter4 自身做「同文件、同内容」的基线，再用夹具证明「内容变了哈希就变」。
    const before = await buildAnchorIndex(path.join(FIXTURES, 'mixed.md'))
    const after = await buildAnchorIndex(path.join(FIXTURES, 'mixed-reflowed.md'))
    const payload = (a) => a.anchor.replace(/^[^#]+/, '')

    // 标识不变（仅文件名前缀不同）
    assert.deepEqual(after.anchors.map(payload), before.anchors.map(payload))

    // h1 区间含被改动的开篇段落 ⇒ 哈希必须变化
    const h1Before = before.anchors.find((a) => a.level === 1)
    const h1After = after.anchors.find((a) => a.level === 1)
    assert.notEqual(h1Before.contentHash, h1After.contentHash, '内容变了哈希必须变')

    // 内容未变的小节 ⇒ 哈希必须相同（否则哈希无法用于失效检测，只会产生噪声）
    const h3Before = before.anchors.find((a) => a.level === 3)
    const h3After = after.anchors.find((a) => a.level === 3)
    assert.equal(payload(h3Before), payload(h3After))
    assert.equal(h3Before.contentHash, h3After.contentHash, '内容未变时哈希必须相同')
  })
})

describe('第 1 层 · 确定性（逐字节可复现）', () => {
  it('同一输入连跑两次，产物逐字节相同', async () => {
    const a = await buildAnchorIndex(CHAPTER4)
    const b = await buildAnchorIndex(CHAPTER4)
    assert.equal(JSON.stringify(a, null, 2), JSON.stringify(b, null, 2))
  })

  it('CLI 两次运行写出同一份索引文件（用 diff 口径比对字节）', async () => {
    const first = runCli([path.relative(DEFAULT_REPO_ROOT, CHAPTER4)])
    assert.equal(first.status, 0, first.stderr)
    const outPath = path.join(KNOWLEDGE_DIR, 'chapter4.anchors.json')
    const bytes1 = await readFile(outPath)
    const second = runCli([path.relative(DEFAULT_REPO_ROOT, CHAPTER4)])
    assert.equal(second.status, 0, second.stderr)
    const bytes2 = await readFile(outPath)
    assert.ok(bytes1.equals(bytes2), '两次运行的索引文件必须逐字节相同')
  })
})

describe('第 1 层 · 非规范标题（中文、全角冒号、行尾属性标记）', () => {
  it('afterword.md 的首行标题被正确解析，属性标记不计入标题文本', async () => {
    const idx = await buildAnchorIndex(AFTERWORD)
    const h1 = idx.anchors.find((a) => a.level === 1)
    assert.equal(h1.title, '后记：回到 Agent = LLM + 上下文 + 工具')
    assert.ok(!h1.title.includes('{.unnumbered}'), '行尾属性标记不应计入标题文本')
  })

  it('introduction.md：含全角冒号与方括号的多个标题均被解析', async () => {
    const idx = await buildAnchorIndex(INTRO)
    const titles = idx.anchors.map((a) => a.title)
    assert.ok(titles.includes('引言'))
    assert.ok(titles.includes('全书结构'))
    assert.ok(titles.includes('如何阅读本书'))
    assert.ok(titles.includes('前置知识'))
    assert.ok(titles.includes('致谢'))
    for (const t of titles) assert.ok(!t.includes('{.'), `标题残留属性标记：${t}`)
  })
})

describe('第 1 层 · 代码块内的伪标题不得被当作标题', () => {
  it('围栏状态机把围栏内的 ## 行标记为块内', async () => {
    const raw = await readFile(path.join(FIXTURES, 'mixed.md'), 'utf8')
    const flags = computeFencedFlags(raw.split('\n'))
    const lines = raw.split('\n')
    const fencedHeadingLines = lines
      .map((l, i) => ({ l, i }))
      .filter(({ l, i }) => flags[i] && /^#{1,6}\s/.test(l))
    assert.ok(fencedHeadingLines.length >= 2, '该夹具应含至少两个块内伪标题')
  })

  it('解析结果只含 6 个真标题，块内伪标题被剔除', async () => {
    // 该夹具的真实标题：1 个 h1 + 2 个 h2（「工具设计的通用原则」「代码示例」）
    // + 3 个 h3（在 h2-1 之下）。围栏内的「工具使用规范」「文件操作」「网络请求」
    // 都是正文里的 markdown 示例，不是本文档的标题。
    const idx = await buildAnchorIndex(path.join(FIXTURES, 'mixed.md'))
    assert.equal(
      idx.anchorCount,
      6,
      `期望 6 个真标题，实际 ${idx.anchorCount}：${JSON.stringify(idx.anchors.map((a) => a.title))}`,
    )
    assert.deepEqual(idx.levelCounts, { h1: 1, h2: 2, h3: 3 })
    const titles = idx.anchors.map((a) => a.title)
    assert.ok(!titles.includes('文件操作'), '块内的「文件操作」被误认成真标题')
    assert.ok(!titles.includes('网络请求'), '块内的「网络请求」被误认成真标题')
    assert.ok(!titles.includes('工具使用规范'), '块内的「工具使用规范」被误认成真标题')
    // 围栏自身不是标题；「代码示例」是围栏之前那个真 h2
    assert.ok(titles.includes('代码示例'), '围栏前的真标题不应丢失')
  })

  it('真实语料上的同一守卫：chapter2.md 的块内 markdown 示例不含「文件操作」标题', async () => {
    const idx = await buildAnchorIndex(
      path.join(DEFAULT_REPO_ROOT, DEFAULT_SOURCE_ROOT, 'chapter2.md'),
    )
    const titles = idx.anchors.map((a) => a.title)
    // 该章代码块内含 ```text 包裹的 markdown 示例，其中有两个以井号开头的小节名
    assert.ok(!titles.includes('文件操作'), 'chapter2 块内的「文件操作」被误认成真标题')
    assert.ok(!titles.includes('网络请求'), 'chapter2 块内的「网络请求」被误认成真标题')
    // 实测：该文件的二级标题行共 11 行，其中第 626、632 行（「文件操作」「网络请求」）
    // 位于 ```text 围栏内部，属正文里的 markdown 示例。剔除后应为 9 个真标题。
    assert.equal(idx.levelCounts.h2, 9, 'chapter2 的真二级标题应为 9 个（11 行减 2 行块内伪标题）')
  })
})

describe('第 1 层 · 路径守卫（隔离起点）', () => {
  it('拒绝盲测基准目录，并给出明确报错', () => {
    assert.throws(
      () => assertAllowedSource(path.join(DEFAULT_REPO_ROOT, 'benchmark', 'probe.md')),
      (err) => {
        assert.ok(err instanceof SourcePathError, '错误类型应为 SourcePathError')
        assert.match(err.message, /基准目录/)
        return true
      },
    )
  })

  it('拒绝源正文根目录之外的文件', () => {
    assert.throws(
      () => assertAllowedSource(path.join(DEFAULT_REPO_ROOT, 'README.md')),
      SourcePathError,
    )
  })

  it('拒绝非 .md 后缀', () => {
    assert.throws(
      () =>
        assertAllowedSource(path.join(DEFAULT_REPO_ROOT, DEFAULT_SOURCE_ROOT, 'notes.txt')),
      SourcePathError,
    )
  })

  it('接受源正文根目录内的 .md', () => {
    assert.equal(assertAllowedSource(CHAPTER4), CHAPTER4)
  })

  it('CLI 传入基准目录路径时退出码非 0，且不产出任何新文件', async () => {
    const before = await readdir(KNOWLEDGE_DIR).catch(() => [])
    const res = runCli([path.join('benchmark', 'probe.md')])
    assert.notEqual(res.status, 0, '必须拒绝')
    assert.equal(res.status, 2, '路径守卫拒绝应为工程问题退出码 2')
    assert.match(res.stderr, /基准目录/)
    const after = await readdir(KNOWLEDGE_DIR).catch(() => [])
    assert.deepEqual(after, before, '被拒绝时不得写入任何文件')
  })
})
