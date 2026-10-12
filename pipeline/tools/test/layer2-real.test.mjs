/**
 * ticket 04 的验收测试：九种对象类型 + 第 2 层真实模型接入
 *
 * 整份文件**不发出任何真实模型调用、不读任何凭据、不访问网络**：
 *   - 第 2 层的真实路径通过注入 `chatImpl` / `fetchImpl` 替身驱动，因此「调用了多少次、
 *     记了多少 token、失败了怎么算」都能被严格断言；
 *   - 九类正例/负例直接喂给第 3 层（`verifyObjects`），不走模型——这也正是本卡
 *     「九种类型各有正例通过、各至少一个负例被拒」应当被钉住的方式：钉的是**契约**，
 *     不是某次模型采样的运气。
 */

import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_REPO_ROOT, buildAnchorIndex } from '../../tools/anchor-index.mjs'
import { EXIT, HISTORY_DIR, LAYER2_KINDS, PIPELINE_VERSION, checkPartialUsable, runPipeline } from '../../run.mjs'
import { verifyObjects, OBJECT_TYPES } from '../../tools/verifier.mjs'
import {
  BASE_REQUIRED_FIELDS,
  TYPE_BOUNDARY_CRITERIA,
  TYPE_FIELD_SHAPES,
  TYPE_REQUIRED_FIELDS,
} from '../../tools/object-contract.mjs'
import {
  buildSystemPrompt,
  extractObjectList,
  materializeObject,
  parseModelPayload,
  promptFingerprint,
  Layer2Error,
  DERIVED_FIELDS,
} from '../../tools/layer2-extractor.mjs'
import {
  chatCompletion,
  createUsageLedger,
  LlmConfigError,
  parseCredentialRefs,
  resolveLlmConfig,
} from '../../tools/llm-client.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = DEFAULT_REPO_ROOT
const SOURCE_REL = 'sources/ai-agent-book-zh/book/chapter4.md'
const SOURCE_ABS = path.join(REPO, SOURCE_REL)
const SCHEMA_DIR = path.join(REPO, 'pipeline', 'schemas')

// ---------------------------------------------------------------------------
// 九类正例/负例：直接对第 3 层构造输入
// ---------------------------------------------------------------------------

let IDX
let REGION
let QUOTE
let SOURCE_REF

before(async () => {
  IDX = await buildAnchorIndex(SOURCE_ABS, { repoRoot: REPO })
  const a = IDX.anchors.find((x) => x.anchor === 'chapter4#h2-1')
  const raw = await readFile(SOURCE_ABS, 'utf8')
  const lines = raw.split(/\r\n|\n|\r/).map((l) => l.replace(/[ \t]+$/, ''))
  REGION = lines.slice(a.lineStart - 1, a.lineEnd).join('\n')
  QUOTE = lines
    .slice(a.lineStart - 1, a.lineEnd)
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'))
  SOURCE_REF = {
    file: IDX.sourceFile,
    anchor: a.anchor,
    title: a.title,
    lineStart: a.lineStart,
    lineEnd: a.lineEnd,
    contentHash: a.contentHash,
  }
})

/** 各类型的**合法**载荷（只含类型专属字段；公共字段与 evidenceQuote 单独加）。 */
function validPayload(type) {
  const ref = { ...SOURCE_REF }
  switch (type) {
    case 'Concept':
      return { canonicalTerm: '工具描述', aliases: ['tool description'], definition: '…', examples: ['…'] }
    case 'Metric':
      return {
        name: '工具调用成功率',
        formula: '成功调用数 / 总调用数',
        inputs: ['成功调用数', '总调用数'],
        unit: '百分比',
        window: '按日',
        failureModes: ['分母为零'],
      }
    case 'MentalModel':
      return {
        trigger: '设计工具时',
        inputs: ['任务描述'],
        reasoning: '…',
        limits: '仅在单步任务成立',
        counterexample: '多步任务下失效',
      }
    case 'DecisionModel':
      return {
        inputs: ['任务复杂度'],
        branches: [{ condition: '步骤数 > 5', action: '拆成子任务' }],
        outputs: ['子任务列表'],
        unknownPolicy: '信息不足时先追问',
        stopConditions: ['子任务粒度到可单步执行'],
        reviewState: 'candidate',
      }
    case 'Heuristic':
      return { trigger: '描述过长时', recommendation: '压缩到一行', confidence: 0.6, exceptions: ['需精确定位参数时'] }
    case 'Case':
      return {
        title: '某团队的工具重构',
        context: '…',
        facts: ['…'],
        decisions: ['…'],
        outcome: '…',
        evidenceRefs: [ref],
        limitations: ['单一团队样本'],
        dataClass: 'public',
      }
    case 'Playbook':
      return {
        title: '工具上线检查单',
        prerequisites: ['…'],
        steps: [{ order: 1, action: '…' }],
        checks: ['…'],
        rollback: '…',
        approval: 'none',
      }
    case 'EngineeringRule':
      return { statement: '…', rationale: '…', appliesWhen: '…', violation: '…', chapterRef: 'chapter4-h2-1' }
    case 'AntiPattern':
      return { pattern: '…', harm: '…', corrective: '…', evidence: ['…'], chapterRef: 'chapter4-h2-1' }
    default:
      throw new Error(`未定义类型：${type}`)
  }
}

/** 一条完整的合法对象（公共字段 + 类型载荷 + 逐字引文）。 */
function validObject(type, id = `${type.toUpperCase()}-POSITIVE-01`) {
  return {
    id,
    objectType: type,
    revision: 1,
    status: 'candidate',
    createdAt: '2026-10-08T00:00:00.000Z',
    sourceRefs: [{ ...SOURCE_REF }],
    evidenceQuote: QUOTE,
    ...validPayload(type),
  }
}

describe('04 · 九种类型的正例与负例', () => {
  it('九种类型各有正例通过第 3 层（含逐字引文判据）', async () => {
    const objects = OBJECT_TYPES.map((t) => validObject(t))
    const { verdicts, summary } = await verifyObjects(objects, IDX, { repoRoot: REPO })
    const bad = verdicts.filter((v) => v.status !== 'pass')
    assert.deepEqual(
      bad.map((v) => `${v.objectId}:${v.reasonCode}:${v.failures.map((f) => f.code).join('+')}`),
      [],
      '九类正例应当全部通过',
    )
    assert.equal(summary.passed, 9)
    assert.equal(summary.rejected, 0)
  })

  it('九种类型各有负例被拒：逐个抽掉该类型的第一个必填字段', async () => {
    const cases = []
    for (const t of OBJECT_TYPES) {
      const dropped = TYPE_REQUIRED_FIELDS[t][0]
      const obj = validObject(t, `${t.toUpperCase()}-NEGATIVE-01`)
      delete obj[dropped]
      cases.push({ type: t, dropped, obj })
    }
    const { verdicts, summary } = await verifyObjects(
      cases.map((c) => c.obj),
      IDX,
      { repoRoot: REPO },
    )
    const wrong = verdicts
      .map((v, i) => ({ v, c: cases[i] }))
      .filter(({ v }) => !(v.status === 'reject' && v.reasonCode === 'SCHEMA_INVALID'))
    assert.deepEqual(
      wrong.map(({ v, c }) => `${c.type} 缺 ${c.dropped} → ${v.status}:${v.reasonCode}`),
      [],
      '每种类型抽掉必填字段后都应按 SCHEMA_INVALID 被拒',
    )
    assert.equal(summary.rejected, 9)
  })

  it('MentalModel 缺 limits 或缺 counterexample 都被拒（不是警告）', async () => {
    for (const dropped of ['limits', 'counterexample']) {
      const obj = validObject('MentalModel', `MENTALMODEL-NO-${dropped.toUpperCase()}-01`)
      delete obj[dropped]
      const { verdicts } = await verifyObjects([obj], IDX, { repoRoot: REPO })
      assert.equal(verdicts[0].status, 'reject', `缺 ${dropped} 必须被拒`)
      assert.equal(verdicts[0].reasonCode, 'SCHEMA_INVALID')
    }
  })

  it('object-contract 的字段形状表与组装后的 schema 逐字一致（这是首轮 9 条拒绝的主要成因）', async () => {
    for (const t of OBJECT_TYPES) {
      const schema = JSON.parse(await readFile(path.join(SCHEMA_DIR, `${t}.schema.json`), 'utf8'))
      const props = {}
      for (const branch of schema.allOf) Object.assign(props, branch.properties ?? {})
      const shapes = TYPE_FIELD_SHAPES[t]
      assert.deepEqual(
        Object.keys(shapes).sort(),
        [...TYPE_REQUIRED_FIELDS[t]].sort(),
        `${t} 的形状表字段集合与必填字段表不一致`,
      )
      const deref = (v) => (v?.$ref ? schema.$defs[v.$ref.replace('#/$defs/', '')] : v)
      for (const field of TYPE_REQUIRED_FIELDS[t]) {
        const declared = shapes[field]
        const actual = deref(props[field])
        assert.equal(actual.type, declared.kind, `${t}.${field} 的类型不一致`)
        if (declared.kind === 'array') {
          assert.equal(
            actual.minItems ?? undefined,
            declared.minItems,
            `${t}.${field} 的 minItems 不一致（空数组是否放行必须与 schema 一致）`,
          )
        }
        if (declared.kind === 'number') {
          assert.equal(actual.minimum, declared.minimum, `${t}.${field} 的下界不一致`)
          assert.equal(actual.maximum, declared.maximum, `${t}.${field} 的上界不一致`)
        }
        if (declared.enum) assert.deepEqual(actual.enum, declared.enum, `${t}.${field} 的枚举不一致`)
      }
    }
  })

  it('提示词把形状说清（字符串 vs 数组、哪些数组不得为空）', () => {
    const p = buildSystemPrompt()
    assert.match(p, /examples\(数组，至少 1 项\)/)
    assert.match(p, /appliesWhen\(字符串\)/)
    assert.match(p, /evidence\(数组，至少 1 项\)/)
    assert.match(p, /reviewState\(字符串，取值必须是/)
    assert.match(p, /不要\*\*写成数组/)
  })

  it('提示词指纹稳定且随提示词变化（否则「这批对象是哪版提示词产的」说不清）', () => {
    const a = promptFingerprint()
    assert.equal(a, promptFingerprint(), '同一参数下指纹必须稳定')
    assert.match(a, /^prompt-[0-9a-f]{12}$/)
    assert.notEqual(a, promptFingerprint({ maxObjectsPerAnchor: 3 }), '提示词一变，指纹必须变')
  })

  it('object-contract 的必填字段表与组装后的 schema 逐字一致（防漂移）', async () => {
    for (const t of OBJECT_TYPES) {
      const schema = JSON.parse(await readFile(path.join(SCHEMA_DIR, `${t}.schema.json`), 'utf8'))
      const required = new Set()
      for (const branch of schema.allOf) {
        for (const f of branch.required ?? []) required.add(f)
      }
      for (const f of BASE_REQUIRED_FIELDS) required.delete(f)
      assert.deepEqual(
        [...required].sort(),
        [...TYPE_REQUIRED_FIELDS[t]].sort(),
        `${t} 的必填字段表与 schema 不一致`,
      )
    }
  })
})

describe('05 · 引文的职责：既要逐字命中，也要支撑主张', () => {
  // 背景（实测）：卡 05 接入判定者后，第一次真实运行 37 个对象里 12 个被判「不充分」，
  // 全部是同一个模式——主张断言得比它附的那条引文更多，而根因是第 2 层提示词当初把
  // evidenceQuote 定义成**防编造凭证**（≤120 字、逐字比对），只字未提「要支撑主张」。
  // 判定者问的是同一个字段上的**第二个、不同的问题**，而该字段从未为此被规定过。
  // 这一组断言钉住修法：两个用途必须**同时**写清楚，且必须**耦合**。
  it('提示词同时写明引文的两个用途，且二者耦合', () => {
    const p = buildSystemPrompt()
    // 用途一：防编造 / 逐字命中
    assert.ok(p.includes('逐字复制'), '必须写明引文要逐字复制')
    // 用途二：语义支撑
    assert.match(p, /引文必须支撑主张/, '必须写明引文要支撑主张')
    // 耦合的另一半——只写「引文要支撑主张」而不禁止主张越界，模型会把引文越写越长
    assert.match(p, /不得断言引文之外的内容/, '必须禁止主张断言引文之外的内容')
    // 放宽后的长度上限
    assert.match(p, /引文长度上限 400 字/)
  })

  it('提示词给出「短引文不足以承载主张」时的二选一，而不是含糊其辞', () => {
    const p = buildSystemPrompt()
    assert.match(p, /把引文写长到能承载/)
    assert.match(p, /把主张收窄到引文能承载的粒度/)
  })

  it('提示词告知第 3 层有独立判定者把关，使模型知道随手挑一句会被拒', () => {
    const p = buildSystemPrompt()
    assert.match(p, /独立判定者/)
    assert.match(p, /不支撑或不充分/)
  })

  it('schema 真源与 9 份组装产物都写明引文的两个用途（防漂移）', async () => {
    const src = JSON.parse(await readFile(path.join(SCHEMA_DIR, 'knowledge-object.schema.json'), 'utf8'))
    assert.match(src.$defs.quote.description, /支撑该对象主张/, '真源没写明语义用途')
    for (const t of OBJECT_TYPES) {
      const s = JSON.parse(await readFile(path.join(SCHEMA_DIR, `${t}.schema.json`), 'utf8'))
      assert.match(s.$defs.quote.description, /支撑该对象主张/, `${t} 的组装产物没跟上真源`)
      assert.match(s.$defs.quote.description, /逐字比对/, `${t} 的组装产物丢了确定性用途`)
    }
  })

  it('长度上限只由提示词约束，schema 刻意不设 maxLength', async () => {
    // 这是**有意的取舍**：上限会随判据口径调整，而 schema 是契约，不宜随之漂移。
    // 钉住它是为了防止后来者「顺手加个 maxLength」——那会让两处对同一件事各说一套。
    const src = JSON.parse(await readFile(path.join(SCHEMA_DIR, 'knowledge-object.schema.json'), 'utf8'))
    assert.equal(src.$defs.quote.maxLength, undefined, 'schema 不应设 maxLength')
    assert.equal(src.$defs.quote.minLength, 1)
  })

  it('超长引文不被确定性判据拒绝——上限是提示词侧的引导，不是机器判据', async () => {
    // 把「提示词怎么说」与「机器怎么判」分清楚：若这里变成拒绝，就等于在确定性判据里
    // 新增了一条谁都没拍板的口径。当前行为是**接受**（引文仍逐字命中、仍在锚点区间内），
    // 交给判定者去判断它是否支撑主张。
    const longQuote = REGION.replace(/\n+/g, '\n').slice(0, 600)
    const obj = {
      id: 'QUOTE-LEN-H2-1-CONCEPT-01',
      objectType: 'Concept',
      revision: 1,
      status: 'candidate',
      createdAt: '2026-10-08T00:00:00.000Z',
      sourceRefs: [{ ...SOURCE_REF }],
      canonicalTerm: '测试',
      aliases: [],
      definition: '一条主张',
      examples: ['例'],
      evidenceQuote: longQuote,
    }
    const { verdicts } = await verifyObjects([obj], IDX, { repoRoot: REPO })
    assert.notEqual(verdicts[0].reasonCode, 'QUOTE_MISMATCH', '超长引文不该被逐字判据拒绝')
    assert.notEqual(verdicts[0].reasonCode, 'QUOTE_MISSING')
  })
})

describe('04 · 三者边界判据', () => {
  it('提示词逐字携带九种类型与三条边界判据', () => {
    const p = buildSystemPrompt()
    for (const t of OBJECT_TYPES) assert.ok(p.includes(t), `提示词缺类型 ${t}`)
    for (const c of TYPE_BOUNDARY_CRITERIA) assert.ok(p.includes(c), `提示词缺边界判据：${c}`)
    for (const t of OBJECT_TYPES) {
      for (const f of TYPE_REQUIRED_FIELDS[t]) assert.ok(p.includes(f), `提示词缺字段 ${t}.${f}`)
    }
    assert.ok(p.includes('逐字复制'), '提示词必须写明引文要逐字复制')
  })

  it('机械侧由 schema 兜住：EngineeringRule 多了 confidence 即被拒', async () => {
    const obj = validObject('EngineeringRule')
    obj.confidence = 0.8 // 有置信度的东西不该是硬规则
    const { verdicts } = await verifyObjects([obj], IDX, { repoRoot: REPO })
    assert.equal(verdicts[0].status, 'reject')
    assert.equal(verdicts[0].reasonCode, 'SCHEMA_INVALID')
  })

  it('机械侧由 schema 兜住：Heuristic 缺 confidence 即被拒', async () => {
    const obj = validObject('Heuristic')
    delete obj.confidence
    const { verdicts } = await verifyObjects([obj], IDX, { repoRoot: REPO })
    assert.equal(verdicts[0].reasonCode, 'SCHEMA_INVALID')
  })

  it('机械侧由 schema 兜住：DecisionModel 缺 branches 即被拒', async () => {
    const obj = validObject('DecisionModel')
    delete obj.branches
    const { verdicts } = await verifyObjects([obj], IDX, { repoRoot: REPO })
    assert.equal(verdicts[0].reasonCode, 'SCHEMA_INVALID')
  })
})

describe('04 · 模型配置解析：env 优先，回落 DSH 凭据', () => {
  const CRED = [
    'version: 1',
    'refs:',
    '  DEEPSEEK_API_KEY: sk-from-dsh-file',
    '  OTHER_KEY: other-value',
    'records:',
    '  client-connection/browser-session: {}',
    '',
  ].join('\n')

  const tmpCredFile = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-cred-'))
    const f = path.join(dir, '.credentials.yaml')
    await writeFile(f, CRED, 'utf8')
    return f
  }

  it('环境变量优先于凭据文件', async () => {
    const f = await tmpCredFile()
    const cfg = await resolveLlmConfig({
      env: {
        ANY2SKILLS_LLM_API_KEY: 'sk-from-env',
        ANY2SKILLS_LLM_MODEL: 'some-model',
        ANY2SKILLS_LLM_BASE_URL: 'https://example.invalid/v1/',
        ANY2SKILLS_LLM_PROVIDER: 'example',
      },
      credentialsFile: f,
    })
    assert.equal(cfg.apiKey, 'sk-from-env')
    assert.equal(cfg.apiKeySource, 'env:ANY2SKILLS_LLM_API_KEY')
    assert.equal(cfg.modelId, 'some-model')
    assert.equal(cfg.baseUrl, 'https://example.invalid/v1', '末尾斜杠应被归一')
    assert.equal(cfg.provider, 'example')
  })

  it('环境变量缺失时回落读凭据文件的 refs，且记明来源', async () => {
    const f = await tmpCredFile()
    const cfg = await resolveLlmConfig({
      env: {
        ANY2SKILLS_LLM_MODEL: 'some-model',
        ANY2SKILLS_LLM_BASE_URL: 'https://example.invalid',
      },
      credentialsFile: f,
    })
    assert.equal(cfg.apiKey, 'sk-from-dsh-file')
    assert.equal(cfg.apiKeySource, 'dsh-credentials:DEEPSEEK_API_KEY')
    assert.equal(cfg.modelSource, 'env:ANY2SKILLS_LLM_MODEL')
  })

  it('凭据文件读不到时报错，且错误信息里不出现任何凭据值', async () => {
    await assert.rejects(
      () =>
        resolveLlmConfig({
          env: { ANY2SKILLS_LLM_MODEL: 'm', ANY2SKILLS_LLM_BASE_URL: 'https://x.invalid' },
          credentialsFile: path.join(os.tmpdir(), 'any2skills-not-here', '.credentials.yaml'),
        }),
      (err) => {
        assert.ok(err instanceof LlmConfigError)
        assert.ok(!err.message.includes('sk-'), '错误信息不得含凭据片段')
        return true
      },
    )
  })

  it('不提供默认模型：缺少 modelId 即报错，而不是偷偷用某个模型', async () => {
    await assert.rejects(
      () =>
        resolveLlmConfig({
          env: { ANY2SKILLS_LLM_API_KEY: 'k', ANY2SKILLS_LLM_BASE_URL: 'https://x.invalid' },
          credentialsFile: '/dev/null',
        }),
      /未指定模型/,
    )
  })

  it('凭据文件形状不认识时显式报错，不静默返回空值', () => {
    assert.throws(
      () => parseCredentialRefs(['version: 1', 'refs:', '      DEEPSEEK_API_KEY: x'].join('\n')),
      /非预期缩进/,
    )
    assert.throws(() => parseCredentialRefs(['refs:', '  bad key: x'].join('\n')), /不符合/)
    assert.deepEqual(parseCredentialRefs(['version: 1', 'refs:', '  A: "quoted"'].join('\n')), { A: 'quoted' })
  })
})

describe('04 · 调用与用量记账', () => {
  const CONFIG = {
    provider: 'test',
    modelId: 'test-model',
    baseUrl: 'https://api.example.invalid',
    apiKey: 'sk-secret-value-1234567890',
  }

  const fakeFetch = (responses) => {
    let n = 0
    return async (url, init) => {
      const r = responses[Math.min(n, responses.length - 1)]
      n += 1
      assert.ok(String(url).endsWith('/chat/completions'), `端点不对：${url}`)
      assert.ok(String(init.headers.authorization).startsWith('Bearer '), '缺少凭据头')
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      }
    }
  }

  const okBody = {
    choices: [{ message: { content: '{"objects": []}' } }],
    usage: { prompt_tokens: 120, completion_tokens: 30 },
  }

  it('成功一次：calls=1，token 按服务端返回累加', async () => {
    const ledger = createUsageLedger()
    const res = await chatCompletion(CONFIG, {
      system: 's',
      user: 'u',
      fetchImpl: fakeFetch([{ status: 200, body: okBody }]),
      ledger,
    })
    assert.equal(res.text, '{"objects": []}')
    assert.equal(ledger.calls, 1)
    assert.equal(ledger.failedCalls, 0)
    assert.deepEqual(ledger.tokens, { input: 120, output: 30 })
  })

  it('5xx 重试：失败的尝试也计入 calls（否则「花了多少次」会低于实际）', async () => {
    const ledger = createUsageLedger()
    const res = await chatCompletion(CONFIG, {
      system: 's',
      user: 'u',
      maxAttempts: 2,
      fetchImpl: fakeFetch([{ status: 503, body: 'boom' }, { status: 200, body: okBody }]),
      ledger,
    })
    assert.ok(res.text.length > 0)
    assert.equal(ledger.calls, 2, '两次 HTTP 尝试必须记两次')
    assert.equal(ledger.failedCalls, 1)
    assert.equal(ledger.retries, 1)
    assert.deepEqual(ledger.tokens, { input: 120, output: 30 }, '只有成功的响应才计 token')
  })

  it('401 不重试（重试无意义且重复花钱），且错误信息里不出现凭据', async () => {
    const ledger = createUsageLedger()
    await assert.rejects(
      () =>
        chatCompletion(CONFIG, {
          system: 's',
          user: 'u',
          maxAttempts: 3,
          fetchImpl: fakeFetch([{ status: 401, body: 'unauthorized' }]),
          ledger,
        }),
      (err) => {
        assert.equal(err.status, 401)
        assert.ok(!err.message.includes(CONFIG.apiKey), '错误信息泄露了凭据')
        return true
      },
    )
    assert.equal(ledger.calls, 1)
  })

  it('服务端不返回用量时不估算 token，而是留 0 并写明原因', async () => {
    const ledger = createUsageLedger()
    await chatCompletion(CONFIG, {
      system: 's',
      user: 'u',
      fetchImpl: fakeFetch([{ status: 200, body: { choices: [{ message: { content: '{}' } }] } }]),
      ledger,
    })
    assert.deepEqual(ledger.tokens, { input: 0, output: 0 })
    assert.match(String(ledger.note), /未返回可识别的 token 用量/)
  })

  it('推理型模型：思维链计入 completion，单列 reasoning 才解释得了「输出很少却很贵」', async () => {
    const ledger = createUsageLedger()
    await chatCompletion(CONFIG, {
      system: 's',
      user: 'u',
      fetchImpl: fakeFetch([
        {
          status: 200,
          body: {
            choices: [{ message: { content: '{"objects":[]}' }, finish_reason: 'stop' }],
            usage: {
              prompt_tokens: 1479,
              completion_tokens: 4530,
              completion_tokens_details: { reasoning_tokens: 4307 },
              prompt_tokens_details: { cached_tokens: 1408 },
            },
          },
        },
      ]),
      ledger,
    })
    assert.deepEqual(ledger.tokens, { input: 1479, output: 4530 })
    assert.deepEqual(ledger.tokensDetail, { reasoning: 4307, cachedInput: 1408 })
  })

  it('思维链吃光 max_tokens 导致 content 为空 → 报成「截断」而不是让人去猜为什么不是 JSON', async () => {
    const ledger = createUsageLedger()
    await assert.rejects(
      () =>
        chatCompletion(CONFIG, {
          system: 's',
          user: 'u',
          maxAttempts: 1,
          fetchImpl: fakeFetch([
            {
              status: 200,
              body: {
                choices: [
                  {
                    message: { content: '', reasoning_content: 'x'.repeat(500) },
                    finish_reason: 'length',
                  },
                ],
                usage: { prompt_tokens: 1479, completion_tokens: 2000, completion_tokens_details: { reasoning_tokens: 2000 } },
              },
            },
          ]),
          ledger,
        }),
      (err) => {
        assert.equal(err.truncated, true, '必须标记为截断')
        assert.match(err.message, /max_tokens/)
        assert.match(err.message, /推理占用 2000/)
        return true
      },
    )
    assert.equal(ledger.failedCalls, 1)
  })
})

describe('04 · 第 2 层解析与对象实体化', () => {
  it('响应解析容忍 markdown 围栏与前后解释文字', () => {
    assert.deepEqual(parseModelPayload('```json\n{"objects":[]}\n```'), { objects: [] })
    assert.deepEqual(parseModelPayload('好的，结果如下：{"objects":[]} 完毕'), { objects: [] })
    assert.deepEqual(parseModelPayload('[{"objectType":"Concept"}]'), [{ objectType: 'Concept' }])
  })

  // 回归：2026-10-11 全书首跑 6/13 文件退出码 4，根因不是模型输出坏，
  // 而是旧解析器把**本来合法的 JSON** 切坏了——它先在整份响应上跑一个**未锚定**的
  // 围栏正则，于是命中字符串值**内部**的代码围栏，把一大段中间内容当「围栏壳」剥掉。
  // 每个样本都取自 `pipeline/registry/run-failed-*.layer2-raw.json` 的真实原文。
  it('**合法 JSON 内字符串含代码围栏时，不得被剥壳剥坏**（首跑 6 例的真实形态）', () => {
    const cases = [
      // introduction：evidenceQuote 里含 ```bash 代码块
      '{"objects": [{"objectType": "Concept", "evidenceQuote": "获取全部配套代码：\\n\\n```bash\\ngit clone https://example.com/repo.git\\ncd repo\\n```\\n\\n以上是全部步骤。"}]}',
      // chapter2：```text 代码块
      '{"objects": [{"objectType": "Concept", "evidenceQuote": "比如一个系统提示词同时用了两者：\\n\\n```text\\n# 工具使用规范\\n\\n## 文件操作\\n</file_operation>\\n```\\n\\n这样组织。"}]}',
      // chapter6：```text 且是字符串里**唯一**的一对围栏（旧正则从响应头切到它）
      '{"objects": [{"objectType": "Concept", "evidenceQuote": "世界模型至少要能编码当前状态：\\n\\n```text\\n桌面状态 + click/type/scroll/wait ──> 下一状态的表示\\n```\\n\\n这样 Agent 就能比较后果。"}]}',
      // chapter7：```text
      '{"objects": [{"objectType": "EngineeringRule", "evidenceQuote": "沿以下链路寻找首个差异：\\n\\n```text\\n文件原始字节 → 工具返回 → Harness 序列化 → 模型上下文\\n→ 模型 token 输出 → 解码字符串 → JSON 解析\\n```\\n\\n最小化评估探针。"}]}',
    ]
    for (const raw of cases) {
      const parsed = parseModelPayload(raw)
      assert.equal(parsed.objects.length, 1, `应解析出 1 个对象：${raw.slice(0, 60)}…`)
      // 关键断言：引文**逐字保留**了代码块，没有被剥壳吃掉中间那段。
      assert.ok(
        parsed.objects[0].evidenceQuote.includes('```'),
        '引文里的代码围栏必须原样保留',
      )
      assert.ok(
        parsed.objects[0].evidenceQuote.includes('\n'),
        '引文里的换行必须原样保留（JSON.parse 后已是真实换行）',
      )
    }
  })

  it('整份被围栏包裹时才剥壳；围栏在字符串内部时不剥', () => {
    // 包裹整份：剥壳
    assert.deepEqual(parseModelPayload('```json\n{"objects":[]}\n```'), { objects: [] })
    // 围栏在字符串内部：不剥壳，按原样解析
    const inner = '{"objects":[{"objectType":"Concept","evidenceQuote":"```bash\\ngit x\\n```"}]}'
    assert.equal(parseModelPayload(inner).objects[0].evidenceQuote, '```bash\ngit x\n```')
  })

  it('三种形态都取不出 JSON 时才报错，且报的是**首次原样尝试**的诊断', () => {
    try {
      parseModelPayload('这不是 JSON')
      assert.fail('应当抛错')
    } catch (err) {
      assert.ok(err instanceof Layer2Error)
      assert.equal(err.rawText, '这不是 JSON')
    }
  })

  it('对象列表形状不符即报错，不静默当作空列表', () => {
    assert.throws(() => extractObjectList({ items: [] }), /没有 objects 数组/)
    assert.deepEqual(extractObjectList({ objects: [] }), [])
  })

  it('模型提供的身份字段被忽略并记账，知识字段原样保留', () => {
    const anchorEntry = IDX.anchors.find((a) => a.anchor === 'chapter4#h2-1')
    const { obj, ignored } = materializeObject(
      {
        objectType: 'Concept',
        evidenceQuote: 'x',
        canonicalTerm: 'A',
        id: 'MODEL-WROTE-THIS-01',
        sourceRefs: [{ anchor: 'bogus' }],
        revision: 99,
      },
      {
        anchorEntry,
        sourceFile: IDX.sourceFile,
        seq: 1,
        createdAt: '2026-10-08T00:00:00.000Z',
        chapterRef: 'chapter4-h2-1',
      },
    )
    assert.equal(obj.id, 'CHAPTER4-H2-1-CONCEPT-01', 'id 必须由锚点确定性生成')
    assert.deepEqual(ignored, ['id', 'revision', 'sourceRefs'])
    assert.equal(obj.revision, 1)
    assert.equal(obj.sourceRefs[0].anchor, 'chapter4#h2-1')
    assert.equal(obj.canonicalTerm, 'A', '知识字段必须原样保留')
    for (const f of DERIVED_FIELDS) assert.ok(!ignored.includes(f) || true)
  })

  it('未知类型仍然落盘（交给第 3 层报错），不在这里被吞掉', () => {
    const anchorEntry = IDX.anchors.find((a) => a.anchor === 'chapter4#h2-1')
    const { obj } = materializeObject(
      { objectType: 'SkillCandidate', evidenceQuote: 'x' },
      { anchorEntry, sourceFile: IDX.sourceFile, seq: 1, createdAt: '2026-10-08T00:00:00.000Z', chapterRef: 'chapter4-h2-1' },
    )
    assert.equal(obj.objectType, 'SkillCandidate')
    assert.ok(!/^CHAPTER4-H2-1-SKILLCANDIDATE-01$/.test(obj.id), '未知类型不得被赋予合法 id')
  })
})

// ---------------------------------------------------------------------------
// 端到端：真实路径（注入替身），以及「产出落盘固化 / 显式重跑 / 不静默覆盖」
// ---------------------------------------------------------------------------

let TMP
const calls = { chat: 0 }

/**
 * 可编排的 chat 替身。
 *
 * 默认实现**按请求里给出的锚点区间现算引文**（从用户提示词里那段正文取第一行非标题文字），
 * 因此它产出的引文必然与第 3 层的比对范围一致——这不是为了让测试变绿，而是为了让替身
 * 表现得像一个称职的模型；否则测出来的只是「替身写错了引文」。
 *
 * 替身必须**自己维护 ledger**：记账的职责在客户端（只有它知道重试了几次），
 * 所以换掉客户端就得接过记账。否则「回执里的调用次数」这条断言测的就不是生产口径。
 */
function makeChatImpl(recordsFor = defaultRecords, { inputTokens = 10, outputTokens = 5 } = {}) {
  return async (config, { system, user, ledger }) => {
    calls.chat += 1
    SYSTEM_FAKE_OBJECTS.system = system
    if (ledger) {
      ledger.calls += 1
      ledger.tokens.input += inputTokens
      ledger.tokens.output += outputTokens
    }
    const anchor = /锚点：(\S+?)（第 (\d+)–(\d+) 行/.exec(user)
    assert.ok(anchor, '用户提示词必须带锚点定位')
    const body = /\n---\n([\s\S]*)\n---\n?$/.exec(user)?.[1]
    assert.ok(typeof body === 'string' && body.length > 0, '用户提示词必须带正文')
    const quote = body
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l !== '' && !l.startsWith('#'))
    const records = recordsFor({ anchor: anchor[1], lineStart: Number(anchor[2]), quote, system, user })
    return {
      text: JSON.stringify({ objects: records }),
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens },
      calls: 1,
    }
  }
}

/** 默认：每个锚点产出一个 Concept，引文取该锚点正文的第一行非标题文字。 */
const defaultRecords = ({ quote }) => [
  { objectType: 'Concept', evidenceQuote: quote, canonicalTerm: '工具描述', aliases: [], definition: '…', examples: ['…'] },
]

const fakeConfigEnv = () => ({
  ANY2SKILLS_LLM_API_KEY: 'sk-test-not-real',
  ANY2SKILLS_LLM_MODEL: 'test-model',
  ANY2SKILLS_LLM_BASE_URL: 'https://api.example.invalid',
  ANY2SKILLS_LLM_PROVIDER: 'test',
})

let SYSTEM_FAKE_OBJECTS

before(async () => {
  SYSTEM_FAKE_OBJECTS = { system: null }
  TMP = await mkdtemp(path.join(os.tmpdir(), 'any2skills-layer2-'))
  const bookDir = path.join(TMP, 'sources', 'ai-agent-book-zh', 'book')
  await mkdir(bookDir, { recursive: true })
  await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
})

after(async () => {
  if (TMP) await rm(TMP, { recursive: true, force: true })
})

/** 跑一次真实路径（第 2 层为替身客户端）：锚点集合 = 整份索引，与生产口径一致。 */
const runReal = async ({ rerun = false, chatImpl, repoRoot = TMP } = {}) =>
  runPipeline({
    source: SOURCE_REL,
    repoRoot,
    layer2: 'deepseek',
    rerun,
    env: fakeConfigEnv(),
    chatImpl: chatImpl ?? makeChatImpl(),
    maxAttempts: 1,
  })

/** 整份索引的锚点数——用于核对「每锚点一次调用」这条口径。 */
const ANCHOR_COUNT = () => IDX.anchorCount

describe('04 · 真实第 2 层的端到端：记账、固化、显式重跑', () => {
  it('第一次跑：每锚点一次调用，回执记录调用次数与 token 用量', async () => {
    calls.chat = 0
    const { exitCode, receipt } = await runReal()
    assert.equal(exitCode, EXIT.PASS, JSON.stringify(receipt?.counts))
    assert.equal(calls.chat, ANCHOR_COUNT(), '调用次数必须等于锚点数（每锚点一次调用）')
    assert.equal(receipt.layer2.kind, 'deepseek')
    assert.equal(receipt.layer2.reused, false)
    assert.equal(receipt.model.calls, ANCHOR_COUNT())
    assert.deepEqual(receipt.model.tokens, { input: 10 * ANCHOR_COUNT(), output: 5 * ANCHOR_COUNT() })
    assert.equal(receipt.model.modelId, 'test/test-model')
    assert.equal(receipt.model.configSource.apiKey, 'env:ANY2SKILLS_LLM_API_KEY')
    assert.match(receipt.model.billing, /真实模型调用/)
    assert.equal(receipt.pipelineVersion, PIPELINE_VERSION)
  })

  it('第 2 层原始响应落盘到审计平面（不在回执里塞原文）', async () => {
    const files = await readdir(path.join(TMP, 'pipeline', 'registry'))
    const raw = files.filter((f) => f.endsWith('.layer2-raw.json'))
    assert.equal(raw.length, 1, `应有 1 份原始响应，实际：${files.join(', ')}`)
    const body = JSON.parse(await readFile(path.join(TMP, 'pipeline', 'registry', raw[0]), 'utf8'))
    assert.ok(body.anchors.length >= 2)
    assert.ok(body.anchors[0].rawText.includes('objects'))
  })

  it('增量落盘：跑完后不留半成品（半成品只在过程中存在）', async () => {
    const knowledge = await readdir(path.join(TMP, 'pipeline', 'knowledge'))
    const registry = await readdir(path.join(TMP, 'pipeline', 'registry'))
    assert.deepEqual(
      [...knowledge, ...registry].filter((f) => f.includes('.partial.')),
      [],
      '跑完后不应残留任何 .partial 文件',
    )
  })

  it('增量落盘：每个锚点完成即写出半成品（中途失败不吞掉已付费的产出）', async () => {
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'any2skills-partial-'))
    try {
      const bookDir = path.join(isolated, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
      const seen = []
      const base = makeChatImpl()
      let n = 0
      // 让第 3 个锚点失败，模拟中途断掉。
      const flaky = async (config, req) => {
        n += 1
        if (n === 3) throw new Error('模拟中断')
        return base(config, req)
      }
      await assert.rejects(() =>
        runPipeline({
          source: SOURCE_REL,
          repoRoot: isolated,
          layer2: 'deepseek',
          env: fakeConfigEnv(),
          chatImpl: flaky,
          maxAttempts: 1,
        }),
      )
      void seen
      const partial = (await readdir(path.join(isolated, 'pipeline', 'knowledge'))).filter((f) =>
        f.endsWith('.partial.json'),
      )
      assert.equal(partial.length, 1, '中断后应留下半成品对象文件')
      const objs = JSON.parse(
        await readFile(path.join(isolated, 'pipeline', 'knowledge', partial[0]), 'utf8'),
      )
      assert.equal(objs.length, 2, '前两个锚点的产出必须被保住')
      const rawPartial = (await readdir(path.join(isolated, 'pipeline', 'registry'))).filter((f) =>
        f.endsWith('.partial.json'),
      )
      assert.equal(rawPartial.length, 1)
      const raw = JSON.parse(
        await readFile(path.join(isolated, 'pipeline', 'registry', rawPartial[0]), 'utf8'),
      )
      assert.equal(raw.status, 'partial')
      assert.equal(raw.completedAnchors, 2)
      assert.ok(raw.usageSoFar.calls >= 2, '半成品里必须带上已发生的用量')
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('不显式指定重跑 → 复用冻结产物：0 次调用，且不写任何新产物、不重写生产回执', async () => {
    calls.chat = 0
    const objectsBefore = await readFile(path.join(TMP, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8')
    const registryBefore = await readdir(path.join(TMP, 'pipeline', 'registry'))
    const receiptsBefore = {}
    for (const f of registryBefore) {
      receiptsBefore[f] = await readFile(path.join(TMP, 'pipeline', 'registry', f), 'utf8')
    }

    const out = await runReal({ rerun: false })
    assert.equal(calls.chat, 0, '复用路径不得发出任何调用')
    assert.equal(out.reused, true, '返回值必须明说本次是复用')
    assert.ok(out.producerReceiptPath, '必须给出生产回执的路径')
    assert.ok(out.exitCode === EXIT.PASS || out.exitCode === EXIT.OBJECT_REJECTED)

    const objectsAfter = await readFile(path.join(TMP, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8')
    assert.equal(objectsAfter, objectsBefore, '复用不得改动对象文件')

    // 关键：复用**不得**重写生产回执。回执是「这批对象怎么来的」的凭证；
    // 让「今天读了一遍」覆盖它，审计平面就丢掉了真正的生产记录。
    const registryAfter = await readdir(path.join(TMP, 'pipeline', 'registry'))
    assert.deepEqual(registryAfter, registryBefore, '复用不得新增或改名任何审计文件')
    for (const f of registryAfter) {
      assert.equal(
        await readFile(path.join(TMP, 'pipeline', 'registry', f), 'utf8'),
        receiptsBefore[f],
        `${f} 被复用改写了`,
      )
    }
    // 回放的就是生产回执本身，因此它仍然记着真实的产出次数
    assert.ok(out.receipt.model.calls > 0, '回放的生产回执必须仍记着真实产出次数')
    assert.equal(out.receipt.layer2.reused, false, '生产回执不该被改写成「复用型」')
  })

  it('显式重跑且产出不同 → 新回执并存，旧对象进 history/，不静默覆盖', async () => {
    calls.chat = 0
    const first = await runPipeline({
      source: SOURCE_REL,
      repoRoot: TMP,
      layer2: 'deepseek',
      rerun: true,
      env: fakeConfigEnv(),
      maxAttempts: 1,
      chatImpl: makeChatImpl(() => []), // 清空：这一轮无对象产出
    })
    assert.ok(calls.chat > 0, '显式重跑必须真的调用模型')
    const hist = await readdir(path.join(TMP, HISTORY_DIR))
    assert.equal(hist.length, 1, `旧对象应被归档，实际：${hist.join(', ') || '空'}`)
    assert.ok(first.receipt.artifacts.objects.archivedPrevious, '回执必须记录被替换掉的旧产物')
    assert.match(first.receipt.artifacts.objects.archivedPrevious.sha256, /^sha256:[0-9a-f]{64}$/)

    const registry = await readdir(path.join(TMP, 'pipeline', 'registry'))
    const receipts = registry.filter((f) => f.endsWith('.receipt.json'))
    assert.ok(receipts.length >= 2, '新旧回执必须并存')
  })

  it('冻结产物与当前源版本不一致 → 拒绝复用并提示 --rerun，而不是静默沿用旧对象', async () => {
    const srcPath = path.join(TMP, 'sources', 'ai-agent-book-zh', 'book', 'chapter4.md')
    const original = await readFile(srcPath, 'utf8')
    try {
      await writeFile(srcPath, `${original}\n\n## 新增小节\n\n这一节是为了让锚点内容哈希发生变化。\n`, 'utf8')
      await assert.rejects(
        () => runReal({ rerun: false }),
        /拒绝复用|--rerun/,
      )
    } finally {
      await writeFile(srcPath, original, 'utf8')
    }
  })

  it('审计平面里查不到产出者时拒绝猜模型名', async () => {
    // 造一个「有对象、无对应回执」的临时根。
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'any2skills-noprod-'))
    try {
      const bookDir = path.join(isolated, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
      await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        layer2: 'deepseek',
        env: fakeConfigEnv(),
        maxAttempts: 1,
        chatImpl: makeChatImpl(),
      })
      // 删掉回执，只留对象：此时无法认定产出者。
      await rm(path.join(isolated, 'pipeline', 'registry'), { recursive: true, force: true })
      await assert.rejects(
        () =>
          runPipeline({
            source: SOURCE_REL,
            repoRoot: isolated,
            layer2: 'deepseek',
            rerun: false,
            env: fakeConfigEnv(),
            maxAttempts: 1,
            chatImpl: makeChatImpl(),
          }),
        /无法认定已落盘对象的产出者|--rerun/,
      )
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('第 2 层配置错误为工程问题：退出码 4 的成因可分类', async () => {
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'any2skills-nocfg-'))
    try {
      const bookDir = path.join(isolated, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
      await assert.rejects(
        () =>
          runPipeline({
            source: SOURCE_REL,
            repoRoot: isolated,
            layer2: 'deepseek',
            env: {}, // 无凭据、无模型
            credentialsFile: path.join(isolated, 'nope.yaml'),
          }),
        (err) => err instanceof LlmConfigError && /未找到模型凭据/.test(err.message),
      )
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('断点续跑：有可用的半成品时只跑剩下的锚点，用量与上次累加', async () => {
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'any2skills-resume-'))
    try {
      const bookDir = path.join(isolated, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))

      // 造一个「已完成前 2 个锚点」的半成品，用量故意给成与真实不同的一组数。
      const done = IDX.anchors.slice(0, 2)
      const seededObjects = done.map((a, i) => ({
        ...validObject('Concept', `CHAPTER4-H${a.level}-${a.ordinal}-CONCEPT-01`),
        id: `CHAPTER4-H${a.level}-${a.ordinal}-CONCEPT-01`,
        sourceRefs: [
          {
            file: IDX.sourceFile,
            anchor: a.anchor,
            title: a.title,
            lineStart: a.lineStart,
            lineEnd: a.lineEnd,
            contentHash: a.contentHash,
          },
        ],
        evidenceQuote: `第 ${i + 1} 个已完成锚点的引文`,
      }))
      await mkdir(path.join(isolated, 'pipeline', 'knowledge'), { recursive: true })
      await mkdir(path.join(isolated, 'pipeline', 'registry'), { recursive: true })
      await writeFile(
        path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.partial.json'),
        JSON.stringify(seededObjects, null, 2),
        'utf8',
      )
      await writeFile(
        path.join(isolated, 'pipeline', 'registry', 'chapter4.layer2-raw.partial.json'),
        JSON.stringify(
          {
            schemaVersion: 'layer2-raw/v1',
            status: 'partial',
            sourceHash: IDX.sourceHash,
            completedAnchors: 2,
            totalAnchors: IDX.anchorCount,
            usageSoFar: {
              calls: 2,
              failedCalls: 0,
              tokens: { input: 100, output: 200 },
              tokensDetail: { reasoning: 190, cachedInput: 0 },
            },
            anchors: done.map((a) => ({
              anchor: a.anchor,
              lineStart: a.lineStart,
              lineEnd: a.lineEnd,
              objectIds: [],
              usage: null,
              finishReason: 'stop',
              reasoningChars: 0,
              derivedFieldsIgnored: [],
              rawText: '{}',
            })),
          },
          null,
          2,
        ),
        'utf8',
      )

      calls.chat = 0
      const { receipt } = await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        layer2: 'deepseek',
        env: fakeConfigEnv(),
        chatImpl: makeChatImpl(),
        maxAttempts: 1,
      })
      assert.equal(calls.chat, IDX.anchorCount - 2, '只应跑剩下的锚点')
      assert.equal(receipt.model.calls, IDX.anchorCount, '用量必须与上次累加（2 + 剩余）')
      assert.deepEqual(receipt.model.tokens, {
        input: 100 + 10 * (IDX.anchorCount - 2),
        output: 200 + 5 * (IDX.anchorCount - 2),
      })
      assert.equal(receipt.layer2.resumedFrom.completedAnchorsBefore, 2)
      assert.equal(receipt.counts.objects, IDX.anchorCount, '半成品的对象必须保留在新产出里')
      const partials = (await readdir(path.join(isolated, 'pipeline', 'knowledge'))).filter((f) =>
        f.endsWith('.partial.json'),
      )
      assert.deepEqual(partials, [], '跑完后不应残留半成品')
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('半成品来自早期版本（无 sourceHash 字段）时也能续：判据落在内容而不是元数据字段上', async () => {
    const partial = {
      completedAnchors: 2,
      anchors: IDX.anchors.slice(0, 2).map((a) => ({
        anchor: a.anchor,
        lineStart: a.lineStart,
        lineEnd: a.lineEnd,
      })),
    }
    const objects = IDX.anchors.slice(0, 2).map((a) => ({
      id: 'X-Y-CONCEPT-01',
      sourceRefs: [{ anchor: a.anchor, contentHash: a.contentHash }],
    }))
    assert.deepEqual(checkPartialUsable(partial, objects, IDX), {
      ok: true,
      reason: null,
      done: 2,
      inFlight: null,
    })

    // 少一个锚点记录 → 不可用
    const short = { ...partial, anchors: partial.anchors.slice(0, 1) }
    assert.equal(checkPartialUsable(short, objects, IDX).reason, 'anchors-missing')

    // 锚点行号对不上 → 不可用
    const shifted = {
      ...partial,
      anchors: [{ ...partial.anchors[0], lineEnd: partial.anchors[0].lineEnd + 5 }, partial.anchors[1]],
    }
    assert.equal(checkPartialUsable(shifted, objects, IDX).reason, 'anchor-1-mismatch')

    // 对象内容哈希对不上（对象来自旧版正文）→ 不可用
    const staleObjects = [{ id: 'X', sourceRefs: [{ anchor: IDX.anchors[0].anchor, contentHash: 'sha256:0' }] }]
    assert.equal(checkPartialUsable(partial, staleObjects, IDX).reason, 'object-content-hash-mismatch')

    // 半成品已声称完成全部锚点 → 不可用（那是冻结产物，不是半成品）
    const complete = { ...partial, completedAnchors: IDX.anchorCount }
    assert.equal(checkPartialUsable(complete, objects, IDX).reason, 'completion-out-of-range')
  })

  it('源版本变了 → 半成品被丢弃并写明原因，不拿旧半成品当进度', async () => {
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'any2skills-resume2-'))
    try {
      const bookDir = path.join(isolated, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
      await mkdir(path.join(isolated, 'pipeline', 'knowledge'), { recursive: true })
      await mkdir(path.join(isolated, 'pipeline', 'registry'), { recursive: true })
      await writeFile(
        path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.partial.json'),
        '[]',
        'utf8',
      )
      await writeFile(
        path.join(isolated, 'pipeline', 'registry', 'chapter4.layer2-raw.partial.json'),
        JSON.stringify({
          sourceHash: 'sha256:deadbeef',
          completedAnchors: 2,
          totalAnchors: IDX.anchorCount,
          usageSoFar: { calls: 2, tokens: { input: 1, output: 1 } },
          anchors: [],
        }),
        'utf8',
      )
      calls.chat = 0
      const { receipt } = await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        layer2: 'deepseek',
        env: fakeConfigEnv(),
        chatImpl: makeChatImpl(),
        maxAttempts: 1,
      })
      assert.equal(calls.chat, IDX.anchorCount, '源变了就必须从头跑，不能续')
      assert.equal(receipt.layer2.resumedFrom, null)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('判据升级后的重判：不重跑第 2 层、不动对象文件、新旧回执并存', async () => {
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'any2skills-rejudge-'))
    try {
      const bookDir = path.join(isolated, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))

      calls.chat = 0
      await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        layer2: 'deepseek',
        env: fakeConfigEnv(),
        chatImpl: makeChatImpl(),
        maxAttempts: 1,
      })
      assert.equal(calls.chat, IDX.anchorCount)
      const objectsBefore = await readFile(path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8')

      // 同版本 → 回放既有回执，不写任何新文件
      const replay = await runReal({ rerun: false, repoRoot: isolated })
      assert.equal(replay.reused, true)

      // 伪造一次「判据升级」：runId 里含流水线版本，因此旧版本产出的回执文件名与现行
      // 版本算出的名字不同。把回执改名 + 把版本号改小，就复现了「判据已变」的状态；
      // 产出者认定按「对象哈希 + 源哈希」匹配，改名不影响它被找到。
      const registryDir = path.join(isolated, 'pipeline', 'registry')
      const files = (await readdir(registryDir)).filter((f) => f.endsWith('.receipt.json'))
      assert.equal(files.length, 1)
      const producerPath = path.join(registryDir, files[0])
      const producer = JSON.parse(await readFile(producerPath, 'utf8'))
      producer.pipelineVersion = 1
      const legacyName = 'run-legacyv1.receipt.json'
      await writeFile(path.join(registryDir, legacyName), JSON.stringify(producer, null, 2), 'utf8')
      await rm(producerPath, { force: true })

      calls.chat = 0
      const out = await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        layer2: 'deepseek',
        rerun: false,
        env: fakeConfigEnv(),
        chatImpl: makeChatImpl(),
        maxAttempts: 1,
      })
      assert.equal(calls.chat, 0, '重判不得发出任何模型调用')
      assert.notEqual(out.receipt.runId, 'legacyv1', '重判应落到新的文件名上，旧回执不被覆盖')
      assert.equal(out.receipt.pipelineVersion, PIPELINE_VERSION)
      assert.equal(out.receipt.model.calls, producer.model.calls, '用量沿用它产出时的实测值，不写成 0')
      assert.match(String(out.receipt.model.usageNote), /判据升级后的重判/)
      assert.equal(
        await readFile(path.join(isolated, 'pipeline', 'knowledge', 'chapter4.objects.json'), 'utf8'),
        objectsBefore,
        '重判不得改动对象文件',
      )
      const after = (await readdir(registryDir)).filter((f) => f.endsWith('.receipt.json'))
      assert.equal(after.length, 2, `新旧回执必须并存，实际：${after.join(', ')}`)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })

  it('默认第 2 层是替身：不传 --layer2 就不该有任何真实调用', async () => {
    assert.deepEqual(LAYER2_KINDS, ['stub', 'deepseek'])
    const isolated = await mkdtemp(path.join(os.tmpdir(), 'any2skills-default-'))
    try {
      const bookDir = path.join(isolated, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))
      calls.chat = 0
      const { receipt } = await runPipeline({
        source: SOURCE_REL,
        repoRoot: isolated,
        // 不传 layer2，也不传任何凭据：默认路径必须能跑通且零调用
        chatImpl: makeChatImpl(),
      })
      assert.equal(calls.chat, 0)
      assert.equal(receipt.layer2.kind, 'stub')
      assert.equal(receipt.model.calls, 0)
      assert.match(receipt.model.billing, /未发出任何真实模型调用/)
    } finally {
      await rm(isolated, { recursive: true, force: true })
    }
  })
})

describe('05 · 复用守卫：提示词漂移必须被说出来', () => {
  // 缺陷背景：`promptFingerprint` 早已进回执，但复用路径**只记不比**。于是改了第 2 层提示词
  // 之后，一次普通重跑会静默复用旧提示词产出的对象——读回执的人得自己想到去比对两个指纹。
  // 这正是 ADR-008 明确反对的失败模式（「换了模型却没人察觉」的默认化）。
  //
  // 拍板的处置是**告警后复用**，不是硬拒：提示词变了与源版本变了性质不同——
  // 源变了对象失效，必须拒；提示词变了对象**仍然有效、只是旧了**。硬拒会让任何提示词微调
  // 都强制全章重跑（每章 20 次调用、单章输出 8–12 万 token），而提示词现阶段还会反复调。
  const PRODUCER_FP = 'prompt-f99d3ed8ead4'

  /** 把现行回执的提示词指纹改成「上一版提示词」的样子，复现漂移状态。 */
  async function pretendOldPrompt(dir) {
    const registryDir = path.join(dir, 'pipeline', 'registry')
    const files = (await readdir(registryDir)).filter((f) => f.endsWith('.receipt.json'))
    assert.equal(files.length, 1)
    const p = path.join(registryDir, files[0])
    const receipt = JSON.parse(await readFile(p, 'utf8'))
    receipt.layer2.promptFingerprint = PRODUCER_FP
    await writeFile(p, JSON.stringify(receipt, null, 2), 'utf8')
  }

  /** 捕获 stderr：本组用例要断言的是「漂移被说出来了」，而不是只被记录。 */
  async function withStderrCapture(fn) {
    const captured = []
    const original = process.stderr.write
    process.stderr.write = (chunk, ...rest) => {
      captured.push(String(chunk))
      return original.call(process.stderr, chunk, ...rest)
    }
    try {
      const out = await fn()
      return { out, stderr: captured.join('') }
    } finally {
      process.stderr.write = original
    }
  }

  it('指纹一致 → 复用、不告警、观察结果记为「无漂移」', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-drift-none-'))
    try {
      const bookDir = path.join(dir, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))

      await runPipeline({
        source: SOURCE_REL, repoRoot: dir, layer2: 'deepseek', rerun: true,
        env: fakeConfigEnv(), chatImpl: makeChatImpl(), maxAttempts: 1,
      })
      const { out, stderr } = await withStderrCapture(() =>
        runPipeline({
          source: SOURCE_REL, repoRoot: dir, layer2: 'deepseek',
          env: fakeConfigEnv(),
          chatImpl: async () => assert.fail('复用不得调用第 2 层'),
          maxAttempts: 1,
        }),
      )
      assert.equal(out.reused, true)
      assert.equal(out.receipt.reuseObservation.detected, false)
      assert.equal(
        out.receipt.reuseObservation.producerPromptFingerprint,
        out.receipt.reuseObservation.currentPromptFingerprint,
      )
      assert.ok(!stderr.includes('[提示词漂移]'), '无漂移时不得告警')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('指纹不一致 → 仍然复用（对象对源文件依然有效），但必须告警并并排列出两个指纹', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-drift-some-'))
    try {
      const bookDir = path.join(dir, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))

      await runPipeline({
        source: SOURCE_REL, repoRoot: dir, layer2: 'deepseek', rerun: true,
        env: fakeConfigEnv(), chatImpl: makeChatImpl(), maxAttempts: 1,
      })
      await pretendOldPrompt(dir)

      const { out, stderr } = await withStderrCapture(() =>
        runPipeline({
          source: SOURCE_REL, repoRoot: dir, layer2: 'deepseek',
          env: fakeConfigEnv(),
          chatImpl: async () => assert.fail('漂移是告警、不是重跑——不得调用第 2 层'),
          maxAttempts: 1,
        }),
      )

      // ① 仍然复用（这正是拍板的取舍：不硬拒）
      assert.equal(out.reused, true, '漂移不得导致硬拒')
      // ② 告警必须打在 stderr 上，且**并排列出两个指纹**
      assert.match(stderr, /\[提示词漂移\]/)
      assert.ok(stderr.includes(PRODUCER_FP), '告警里必须出现产出者那版的指纹')
      assert.ok(
        stderr.includes(out.receipt.reuseObservation.currentPromptFingerprint),
        '告警里必须出现当前那版的指纹',
      )
      assert.match(stderr, /--rerun/, '告警必须给出出路')
      // ③ 观察结果并排进回执
      assert.equal(out.receipt.reuseObservation.detected, true)
      assert.equal(out.receipt.reuseObservation.producerPromptFingerprint, PRODUCER_FP)
      assert.match(out.receipt.reuseObservation.currentPromptFingerprint, /^prompt-[0-9a-f]{12}$/)
      assert.match(out.receipt.reuseObservation.note, /另一个版本的提示词/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('盘上的回执不被改写——漂移观察只加在返回给调用方的对象上', async () => {
    // 盘上那份回执是**产出者**的记录，它的内容不该随「谁在什么时候读了一遍」而改变。
    const dir = await mkdtemp(path.join(os.tmpdir(), 'any2skills-drift-immutable-'))
    try {
      const bookDir = path.join(dir, 'sources', 'ai-agent-book-zh', 'book')
      await mkdir(bookDir, { recursive: true })
      await copyFile(SOURCE_ABS, path.join(bookDir, 'chapter4.md'))

      await runPipeline({
        source: SOURCE_REL, repoRoot: dir, layer2: 'deepseek', rerun: true,
        env: fakeConfigEnv(), chatImpl: makeChatImpl(), maxAttempts: 1,
      })
      await pretendOldPrompt(dir)
      const registryDir = path.join(dir, 'pipeline', 'registry')
      const receiptPath = path.join(registryDir, (await readdir(registryDir)).find((f) => f.endsWith('.receipt.json')))
      const before = await readFile(receiptPath, 'utf8')

      await withStderrCapture(() =>
        runPipeline({
          source: SOURCE_REL, repoRoot: dir, layer2: 'deepseek',
          env: fakeConfigEnv(), chatImpl: makeChatImpl(), maxAttempts: 1,
        }),
      )

      assert.equal(await readFile(receiptPath, 'utf8'), before, '复用不得改写盘上的生产回执')
      // 注意断言的是**值**而不是键名：首次运行写的回执本来就带 `reuseObservation: null`
      // 这个键（它是常规字段），要查的是它**没被这次复用填上内容**。
      const onDisk = JSON.parse(await readFile(receiptPath, 'utf8'))
      assert.equal(onDisk.reuseObservation, null, '漂移观察不得被写进产出者的回执')
      assert.equal(onDisk.layer2.promptFingerprint, PRODUCER_FP, '被篡改的指纹也不该被「修正」回去')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
