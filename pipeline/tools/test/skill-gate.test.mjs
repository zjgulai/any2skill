/**
 * 门禁一 · skill 侧的测试（ticket 10，tracer bullet）
 *
 * 本文件钉两件事：
 *   1. 判据本身——frontmatter 硬限、6 段骨架、体积、溯源，各自该拒什么、该放什么；
 *   2. **今天的实测结论**：chapter4#h2-2 簇装出来的 SKILL.md **在两种口径下都被拒**，
 *      且拒绝理由不取决于「条目数算不算判据」这处解释歧义。
 *
 * 第 2 条是这份测试里最重要的东西。它是 tracer bullet 的结论本身，被写成回归测试后，
 * 任何人都不能靠悄悄放宽某一处口径，把它变成「通过」——要改结论，必须显式改这条测试并给理由。
 */

import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { DEFAULT_REPO_ROOT, buildAnchorIndex, sha256Hex } from '../../tools/anchor-index.mjs'
import { validate, validateSchemaDocument } from '../../tools/json-schema-subset.mjs'
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  SIZE_LIMIT_BYTES,
  parseFrontmatter,
  splitSections,
  verifySkill,
} from '../../tools/verify-skill.mjs'
import {
  assembleSkill,
  collectClusterObjects,
  collectCodePointers,
  deriveCluster,
  unwrapObjectsFile,
} from '../../tools/skill-builder.mjs'

const REPO = DEFAULT_REPO_ROOT
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'
const CODE_ROOT_REL = 'sources/ai-agent-book-zh/code/chapter4'

let IDX
let ASSEMBLED
let ASSEMBLED_NO_CODE

before(async () => {
  IDX = await buildAnchorIndex(path.join(REPO, SOURCE_REL), { repoRoot: REPO })
  const objects = unwrapObjectsFile(
    JSON.parse(await readFile(path.join(REPO, 'pipeline/knowledge/chapter4.objects.json'), 'utf8')),
  )
  const cluster = deriveCluster(IDX.anchors, 'chapter4#h2-2')
  const inCluster = collectClusterObjects(objects, cluster.anchors)
  // 只用「门禁一判过通过」的对象。当前盘上该簇 8 个全部通过（见 run-f8dc2538217f 回执）。
  const base = { cluster, objects: inCluster, antipatterns: [], slug: 'chapter4-tool-design-principles', skillTitle: '工具设计的通用原则' }

  // 含配套代码（镜像已就位）——这是 CLI 现在的真实输入。
  ASSEMBLED = assembleSkill({
    ...base,
    codePointers: collectCodePointers(path.join(REPO, CODE_ROOT_REL), { relPrefix: CODE_ROOT_REL }),
  })
  // 不含配套代码——镜像尚不存在时的形状。两条都由本文件钉住，因为「有/没有」决定门禁结论。
  ASSEMBLED_NO_CODE = assembleSkill({ ...base, codePointers: [] })
})

/** 便捷构造：拿一份合法的产物，按需改一处。 */
function doc(markdown) {
  return {
    markdown,
    contract: { sourceRefs: [{ file: SOURCE_REL, anchor: 'chapter4#h2-2', lineStart: 34, lineEnd: 37 }] },
    anchorIndexes: [IDX],
    sectionCountsExpected: null,
  }
}

describe('parseFrontmatter', () => {
  it('非 `---` 起始即判不可解析', () => {
    assert.equal(parseFrontmatter('# 没有 frontmatter').ok, false)
  })

  it('未闭合即判不可解析', () => {
    assert.equal(parseFrontmatter('---\nname: a\n').ok, false)
  })

  it('正常解析出字段与正文', () => {
    const r = parseFrontmatter('---\nname: a\ndescription: b\n---\n# 正文\n')
    assert.equal(r.ok, true)
    assert.equal(r.fields.name, 'a')
    assert.equal(r.body.trim(), '# 正文')
  })
})

describe('splitSections · 条目计数', () => {
  it('顶格 `- ` 算条目，缩进行不算（常见陷阱的「后果/纠正」是子行）', () => {
    const body = ['## 常见陷阱', '', '- **一**', '  - 后果：x', '  - 纠正：y', '- **二**', ''].join('\n')
    const [s] = splitSections(body)
    assert.equal(s.itemCount, 2)
  })

  it('加粗行按条目计数（核心原则那种写法）', () => {
    const body = ['## 核心原则', '', '**一**', '', '解释', '', '**二**', ''].join('\n')
    const [s] = splitSections(body)
    assert.equal(s.itemCount, 2)
  })

  it('只有空白即判为空段', () => {
    const body = ['## 配套代码', '', '', '## 深度阅读', '', '- x', ''].join('\n')
    const secs = splitSections(body)
    assert.equal(secs[0].isEmpty, true)
    assert.equal(secs[1].isEmpty, false)
  })
})

describe('实践模式的条目是加粗小节头，不是示例列表项（ADR-025，环 3 端到端暴露）', () => {
  const withCounts = (markdown, patternsExpected) => ({
    markdown,
    contract: { sourceRefs: [{ file: SOURCE_REL, anchor: 'chapter4#h2-2', lineStart: 34, lineEnd: 37 }] },
    anchorIndexes: [IDX],
    sectionCountsExpected: { patterns: patternsExpected },
  })

  it('概念带多个示例时不再误报（实际形状：契约 N / 列表项 > N / 加粗行 N）', async () => {
    const expected = ASSEMBLED.sectionCounts.patterns
    assert.ok(expected >= 1, '夹具前提：实践模式至少有一个概念')
    const withMoreExamples = ASSEMBLED.markdown.replace('\n## 常见陷阱', '- 额外示例一\n- 额外示例二\n\n## 常见陷阱')
    const v = await verifySkill(withCounts(withMoreExamples, expected))
    assert.ok(!v.reasonCodes.includes('SECTION_COUNT_OUT_OF_RANGE'), JSON.stringify(v.failures))
  })

  it('少了一个概念（加粗小节头）仍会被抓住——检查本身没有被放宽', async () => {
    const expected = ASSEMBLED.sectionCounts.patterns
    const at = ASSEMBLED.markdown.indexOf('## 实践模式')
    const m = /^\*\*[^*]+\*\*$/m.exec(ASSEMBLED.markdown.slice(at))
    assert.ok(m, '夹具前提：实践模式里有加粗小节头')
    const dropped = ASSEMBLED.markdown.slice(0, at + m.index) + ASSEMBLED.markdown.slice(at + m.index + m[0].length)
    const v = await verifySkill(withCounts(dropped, expected))
    assert.ok(v.reasonCodes.includes('SECTION_COUNT_OUT_OF_RANGE'), JSON.stringify(v.failures))
  })
})

describe('frontmatter 硬限（ADR-004 / 官方规范）', () => {
  it('合法产物通过这两项', async () => {
    const v = await verifySkill(doc(ASSEMBLED.markdown))
    assert.ok(!v.reasonCodes.includes('NAME_INVALID'), JSON.stringify(v.failures))
    assert.ok(!v.reasonCodes.includes('DESCRIPTION_INVALID'))
  })

  it('name 含大写即拒', async () => {
    const v = await verifySkill(doc(ASSEMBLED.markdown.replace('name: chapter4-tool-design-principles', 'name: Chapter4')))
    assert.ok(v.reasonCodes.includes('NAME_INVALID'))
  })

  it('name 含 claude / anthropic 即拒', async () => {
    for (const bad of ['claude-tools', 'anthropic-tools']) {
      const v = await verifySkill(
        doc(ASSEMBLED.markdown.replace('name: chapter4-tool-design-principles', `name: ${bad}`)),
      )
      assert.ok(v.reasonCodes.includes('NAME_INVALID'), bad)
    }
  })

  it(`name 超过 ${NAME_MAX_LENGTH} 字符即拒`, async () => {
    const v = await verifySkill(
      doc(ASSEMBLED.markdown.replace('name: chapter4-tool-design-principles', `name: ${'a'.repeat(65)}`)),
    )
    assert.ok(v.reasonCodes.includes('NAME_INVALID'))
  })

  it(`description 超过 ${DESCRIPTION_MAX_LENGTH} 字符即拒`, async () => {
    const long = 'x'.repeat(DESCRIPTION_MAX_LENGTH + 1)
    const md = ASSEMBLED.markdown.replace(/^description: .*$/m, `description: ${long}`)
    const v = await verifySkill(doc(md))
    assert.ok(v.reasonCodes.includes('DESCRIPTION_INVALID'))
  })

  it('frontmatter 出现 name/description 之外的键即拒', async () => {
    const md = ASSEMBLED.markdown.replace('name: chapter4-tool-design-principles', 'name: chapter4-tool-design-principles\nversion: 1')
    const v = await verifySkill(doc(md))
    assert.ok(v.reasonCodes.includes('FRONTMATTER_MALFORMED'))
  })
})

describe('6 段骨架', () => {
  it('删掉一段即判 SECTION_MISSING', async () => {
    const md = ASSEMBLED.markdown.replace('## 常见陷阱\n', '')
    const v = await verifySkill(doc(md))
    assert.ok(v.reasonCodes.includes('SECTION_MISSING'))
  })

  it('段落换序即判 SECTION_OUT_OF_ORDER', async () => {
    const md = ASSEMBLED.markdown
      .replace('## 何时使用', '@@A@@')
      .replace('## 核心原则', '## 何时使用')
      .replace('@@A@@', '## 核心原则')
    const v = await verifySkill(doc(md))
    assert.ok(v.reasonCodes.includes('SECTION_OUT_OF_ORDER'))
  })

  it('出现骨架之外的段即拒', async () => {
    const v = await verifySkill(doc(`${ASSEMBLED.markdown}\n## 附录\n\n- x\n`))
    assert.ok(v.reasonCodes.includes('SECTION_OUT_OF_ORDER'))
  })
})

describe('体积', () => {
  it(`超过 ${SIZE_LIMIT_BYTES} 字节即拒`, async () => {
    const v = await verifySkill(doc(`${ASSEMBLED.markdown}\n${'x'.repeat(SIZE_LIMIT_BYTES)}\n`))
    assert.ok(v.reasonCodes.includes('SIZE_EXCEEDED'))
  })
})

describe('溯源', () => {
  it('契约无 sourceRefs 即拒', async () => {
    const v = await verifySkill({ markdown: ASSEMBLED.markdown, contract: { sourceRefs: [] }, anchorIndexes: [IDX] })
    assert.ok(v.reasonCodes.includes('SOURCEREF_UNRESOLVED'))
  })

  it('锚点不可解析即拒', async () => {
    const v = await verifySkill({
      markdown: ASSEMBLED.markdown,
      contract: { sourceRefs: [{ file: SOURCE_REL, anchor: 'chapter4#h9-9' }] },
      anchorIndexes: [IDX],
    })
    assert.ok(v.reasonCodes.includes('SOURCEREF_UNRESOLVED'))
  })

  it('深度阅读段未回链出处文件即拒', async () => {
    const md = ASSEMBLED.markdown.replace(/`sources\/ai-agent-book-zh\/book\/chapter4\.md`/g, '`book/chapter4.md`')
    const v = await verifySkill(doc(md))
    assert.ok(v.reasonCodes.includes('SOURCEREF_UNRESOLVED'))
  })
})

describe('条目数不再入判据（ADR-021），但契约与正文的不一致仍然查', () => {
  it('条目数低于骨架建议值**不**导致任何拒因', async () => {
    const v = await verifySkill(doc(ASSEMBLED.markdown))
    // 本簇的常见陷阱只有 1 条，远低于建议值 6——它应被记成缺口与风险标记，而不是拒因。
    assert.ok(!v.reasonCodes.includes('SECTION_COUNT_OUT_OF_RANGE'), JSON.stringify(v.failures))
    assert.deepEqual(v.reasonCodes, [])
  })

  it('契约记录的条目数与正文不一致即拒（这条与条目数口径无关）', async () => {
    const v = await verifySkill({
      ...doc(ASSEMBLED.markdown),
      sectionCountsExpected: { ...ASSEMBLED.sectionCounts, pitfalls: 99 },
    })
    assert.ok(v.reasonCodes.includes('SECTION_COUNT_OUT_OF_RANGE'))
  })
})

describe('tracer bullet 的结论（改动它必须显式说明理由）', () => {
  // 本节的结论被**显式修订过两次**，两次都是因为「信息源或对它的认识真的变了」：
  //   1. 2026-10-09：上游 chapter4/ 的配套代码目录被镜像进 sources/（ADR-020），
  //      「配套代码」段第一次有了来源，SECTION_EMPTY 消失。改的是原因，不是判据。
  //   2. 2026-10-14：第二源揭穿了该段的隐含假设——它要求源提供**目录形态**的配套代码
  //      （第一源能过是巧合，不是机制）。ADR-029 改为**源条件骨架**：无来源时渲染
  //      「来源说明」而非空段，门禁一放行（非空下限不变，变的是该段装什么算内容）。

  it('含配套代码时：门禁一通过（2026-10-09 起）', async () => {
    const v = await verifySkill(doc(ASSEMBLED.markdown))
    assert.equal(v.passed, true, JSON.stringify(v.failures, null, 2))
    assert.deepEqual(v.reasonCodes, [])
  })

  it('不含配套代码时：渲染来源说明，门禁一不再拒（ADR-029，2026-10-14 修订）', async () => {
    const v = await verifySkill(doc(ASSEMBLED_NO_CODE.markdown))
    assert.equal(v.passed, true, JSON.stringify(v.failures, null, 2))
    const seg = ASSEMBLED_NO_CODE.markdown.split('## 配套代码')[1].split('## 深度阅读')[0]
    assert.match(seg, /本段无来源/)
    assert.equal(ASSEMBLED_NO_CODE.contract.codeSource.available, false)
  })

  it('低覆盖不拒绝，但必须被标记为高风险（ADR-006 门禁三的入口）', () => {
    const flags = ASSEMBLED.riskFlags
    assert.equal(flags.length, 1)
    assert.equal(flags[0].flag, 'PITFALL_COVERAGE_BELOW_ADVISORY')
    assert.match(flags[0].routing, /门禁三/)
  })

  it('对象供给：8 个对象、6 段全部有来源、常见陷阱只有 1 条（骨架要求 6–8）', () => {
    assert.equal(ASSEMBLED.sectionCounts.whenToUse, 5)
    assert.equal(ASSEMBLED.sectionCounts.principles, 3)
    assert.equal(ASSEMBLED.sectionCounts.patterns, 2)
    assert.equal(ASSEMBLED.sectionCounts.pitfalls, 1)
    assert.equal(ASSEMBLED.sectionCounts.code, 6)
    assert.equal(ASSEMBLED.sectionCounts.reading, 4)
  })

  it('配套代码段的一句话说明是 README 原话，不是生成的', async () => {
    const seg = ASSEMBLED.markdown.split('## 配套代码')[1].split('## 深度阅读')[0]
    const readme = await readFile(
      path.join(REPO, CODE_ROOT_REL, 'perception-tools', 'README.md'),
      'utf8',
    )
    const firstLine = readme
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))[0]
    assert.ok(firstLine, 'README 应有一个正文段落')
    assert.ok(seg.includes(firstLine.slice(0, 30)), `SKILL.md 的配套代码段应含 README 首段原文\n${seg.slice(0, 400)}`)
  })
})

describe('Skill 契约侧车 · schema 不是摆设', () => {
  it('schema 本身只用受支持的关键字', async () => {
    const schema = JSON.parse(
      await readFile(path.join(REPO, 'pipeline/schemas/skill.schema.json'), 'utf8'),
    )
    const check = validateSchemaDocument(schema)
    const problems = Array.isArray(check) ? check : check.problems || []
    assert.equal(problems.length, 0, JSON.stringify(problems))
  })

  it('装配器实际产出的契约通过 schema 校验', async () => {
    const schema = JSON.parse(
      await readFile(path.join(REPO, 'pipeline/schemas/skill.schema.json'), 'utf8'),
    )
    const contract = {
      ...ASSEMBLED.contract,
      skillId: 'CHAPTER4-H2-2-SKILL-01',
      gapCodes: ASSEMBLED.gaps.map((g) => g.code),
      gaps: ASSEMBLED.gaps,
      gateReceipt: null,
      provenance: {},
    }
    const { valid, errors } = validate(contract, schema)
    assert.equal(valid, true, JSON.stringify(errors, null, 2))
  })

  it('approved 是合法的**未来**状态，但实际产出的契约不得是它', async () => {
    const schema = JSON.parse(
      await readFile(path.join(REPO, 'pipeline/schemas/skill.schema.json'), 'utf8'),
    )
    // schema 描述形状：approved 是声明过的取值，故它本身必须合法。
    // 「当前不得出现 approved」是**策略**，属 ADR 与门禁，不该塞进 schema——
    // 把策略写进 schema 会让「这个状态还没开放」与「这个值写错了」混成同一个错误。
    const { valid } = validate({ ...ASSEMBLED.contract, promotionState: 'approved' }, schema)
    assert.equal(valid, true)
    // 而真实产物的状态必须是 assembled：门禁二/三未构建，没有任何东西能把它推到 approved。
    assert.equal(ASSEMBLED.contract.promotionState, 'assembled')
  })

  it('skillId 与知识对象共用同一套标识正则', async () => {
    const schema = JSON.parse(
      await readFile(path.join(REPO, 'pipeline/schemas/skill.schema.json'), 'utf8'),
    )
    const bad = { ...ASSEMBLED.contract, skillId: 'chapter4-h2-2' }
    const { valid } = validate(bad, schema)
    assert.equal(valid, false)
  })
})

describe('发布区只接收装配产物（ADR-002 平面隔离）', () => {
  it('已发布的 SKILL.md 与装配器产出逐字节相同——手改发布区会被本测试抓到', async () => {
    // ⚠️ 比对基准由夹具重装一份改为**回执指向的暂存产物**（本次修订）。
    // 原因：夹具是 `antipatterns: []`，而真实装配自 `judge-prompt/v2` 起会纳入跨章反模式
    // （`crossChapterKept` 0 → 2，常见陷阱段 1 → 3 条）。夹具产出与发布产物于是**按设计**
    // 不再相同——继续拿夹具比对，这条测试要么永远失败、要么逼着人把发布产物改回单章版本。
    // 换基准并不放松这条判据：暂存产物由**装配器**写、发布由**构建**写，分属两个步骤，
    // 手改其中任一个都会让两者分叉；而且比对对象取自**回执**而不是路径约定，
    // 「这份发布对应哪次装配」可查。
    const receiptPath = path.join(
      REPO,
      'pipeline',
      'registry',
      'build',
      'chapter4-tool-design-principles',
      'gate-receipt.json',
    )
    let receipt
    try {
      receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
    } catch (err) {
      if (err.code === 'ENOENT') return // 尚未装配时跳过，不假装验过
      throw err
    }
    if (!receipt.artifacts?.published || !receipt.artifacts?.staged) return

    const staged = await readFile(path.join(REPO, receipt.artifacts.staged), 'utf8')
    const onDisk = await readFile(path.join(REPO, receipt.artifacts.published), 'utf8')
    assert.equal(
      onDisk,
      staged,
      '发布区的内容与装配器产出不一致：要么有人手改了 skills/，要么装配产物变了而没重新发布',
    )

    // 更强的断言：发布件必须就是**门禁验过的那一份**。比对暂存件只证明「两步产物一致」，
    // 而哈希对上契约里记录的 `markdownHash` 才证明「发布出去的东西通过了那次门禁」——
    // 装配器改了但没重跑门禁时，暂存件与发布件仍会一致，只有哈希能暴露它。
    const contractPath = path.join(REPO, receipt.artifacts.contract)
    const contract = JSON.parse(await readFile(contractPath, 'utf8'))
    const want = contract.gateReceipt?.markdownHash
    assert.ok(want, '契约缺少 gateReceipt.markdownHash——无法证明发布件过了门禁')
    const got = `sha256:${sha256Hex(onDisk)}`
    assert.equal(got, want, '发布件的哈希与门禁记录的 markdownHash 不一致')
  })

  it('已发布的 SKILL.md 通过门禁一', async () => {
    const published = path.join(REPO, 'skills', 'chapter4-tool-design-principles', 'SKILL.md')
    let onDisk
    try {
      onDisk = await readFile(published, 'utf8')
    } catch (err) {
      if (err.code === 'ENOENT') return
      throw err
    }
    // 条目数不是判据（ADR-021），因此 `sectionCountsExpected` 取**发布文件自己**的实测段数：
    // 门禁一在这里验的是「这份文件自身是否成立」，不是「它是否等于某次夹具装配」。
    const v = await verifySkill({ ...doc(onDisk) })
    assert.equal(v.passed, true, JSON.stringify(v.failures, null, 2))
  })
})
