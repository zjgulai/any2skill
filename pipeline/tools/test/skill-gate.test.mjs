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

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import { validate, validateSchemaDocument } from '../../tools/json-schema-subset.mjs'
import {
  DESCRIPTION_MAX_LENGTH,
  NAME_MAX_LENGTH,
  SECTION_COUNT_POLICIES,
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

describe('条目数口径是一处解释歧义，不是内容缺陷', () => {
  it('契约记录的条目数与正文不一致时，两种口径都拒', async () => {
    for (const policy of [SECTION_COUNT_POLICIES.STRICT, SECTION_COUNT_POLICIES.PRESENCE_ONLY]) {
      const v = await verifySkill({
        ...doc(ASSEMBLED.markdown),
        sectionCountsExpected: { ...ASSEMBLED.sectionCounts, pitfalls: 99 },
        sectionCountPolicy: policy,
      })
      assert.ok(v.reasonCodes.includes('SECTION_COUNT_OUT_OF_RANGE'), policy)
    }
  })
})

describe('tracer bullet 的结论（改动它必须显式说明理由）', () => {
  // 本节的结论在 2026-10-09 被**显式修订过一次**，原因是信息源真的变了：
  // 上游 chapter4/ 的配套代码目录被镜像进 sources/（ADR-020），
  // 「配套代码」段第一次有了来源，SECTION_EMPTY 消失。改的是原因，不是判据。

  it('含配套代码时：严格口径拒，宽松口径过——拒绝**取决于**条目数口径', async () => {
    const strict = await verifySkill(doc(ASSEMBLED.markdown))
    const lenient = await verifySkill({
      ...doc(ASSEMBLED.markdown),
      sectionCountPolicy: SECTION_COUNT_POLICIES.PRESENCE_ONLY,
    })
    assert.equal(strict.passed, false)
    assert.deepEqual(strict.reasonCodes, ['SECTION_COUNT_OUT_OF_RANGE'])
    assert.equal(lenient.passed, true, '配套代码段已被信息源扩充填上，宽松口径下应通过')
    // 剩下的唯一障碍就是「常见陷阱 6–8 条算不算硬约束」这处解释歧义。
  })

  it('不含配套代码时：两种口径都拒——配套代码段为空与条目数无关', async () => {
    const strict = await verifySkill(doc(ASSEMBLED_NO_CODE.markdown))
    const lenient = await verifySkill({
      ...doc(ASSEMBLED_NO_CODE.markdown),
      sectionCountPolicy: SECTION_COUNT_POLICIES.PRESENCE_ONLY,
    })
    assert.equal(strict.passed, false)
    assert.equal(lenient.passed, false)
    const empty = lenient.failures.find((f) => f.code === 'SECTION_EMPTY')
    assert.ok(empty, '必须有 SECTION_EMPTY')
    assert.match(empty.detail, /配套代码/)
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
