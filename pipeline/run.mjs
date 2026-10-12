/**
 * 三段式提取流水线 · 唯一命令行接缝（ticket 03 建立；ticket 04 接入真实第 2 层）
 *
 *   node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md            # 第 2 层 = 确定性替身（默认，零调用）
 *   node pipeline/run.mjs sources/…/chapter4.md --layer2 deepseek             # 第 2 层 = 真实模型
 *   node pipeline/run.mjs sources/…/chapter4.md --layer2 deepseek --rerun     # 显式重跑（会重新花钱）
 *
 * 一条命令覆盖第 1（确定性锚点索引）/ 2（综合）/ 3（机器验证）层，
 * 产出「知识对象 + 验证回执」两组产物，并用退出码承载判定结果。
 *
 * 退出码（口径见 docs/specs/01-pipeline-spec.md 的 D8 一节）：
 *   0  全部对象通过第 3 层
 *   3  流水线成功执行，但有对象被拒（**内容问题**：需要人看回执）
 *   4  运行失败（**工程问题**：源文件不存在、路径守卫拒绝、锚点索引产不出、第 2 层调用失败、
 *      冻结产物已过期、无法确认冻结产物的产出者）
 *
 * ⚠ 引用更正（2026-10-11）：本行原文引的是 `docs/adr/ADR-009-single-seam-cli-and-exit-codes.md`，
 *    该文件**不存在**（`ls docs/adr/` 下 ADR-009 的实际文件是
 *    `ADR-009-layer2-reasoning-tier-deferred.md`，主题是第 2 层推理档位的推迟决定）。
 *    两类非零语义的定义落点是规格的 D8 一节——
 *    复核命令：`grep -n "退出码" docs/specs/01-pipeline-spec.md` → `289:### D8 · 退出码语义`。
 *
 * 两类非零码必须可区分：混成一个会让 CI 无法区分「这本书抽得不好」与「脚本坏了」。
 *
 * 产物落盘（平面隔离，ADR-002）：
 *   pipeline/knowledge/  ← 锚点索引 + 知识对象（`history/` 存被替换过的旧对象）
 *   pipeline/registry/   ← 验证回执 + 第 2 层原始响应（审计平面）
 * 本命令**不写** skills/ 与 benchmark/。
 */

import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_BENCHMARK_DIR,
  DEFAULT_REPO_ROOT,
  DEFAULT_SOURCE_ROOT,
  SourcePathError,
  assertAllowedSource,
  buildAnchorIndex,
  resolveRealPath,
  sha256Hex,
  writeAnchorIndex,
} from './tools/anchor-index.mjs'
import {
  STUB_MODEL_ID,
  StubModelError,
  loadFixtureObjects,
  normalizeLines,
  objectSetFingerprint,
  stubGenerateObjects,
} from './tools/model-stub.mjs'
import {
  BYTES_PER_INPUT_TOKEN_MEASURED,
  DEFAULT_MAX_ANCHOR_BYTES,
  INPUT_TOKEN_OVERHEAD_MEASURED,
  Layer2Error,
  extractByAnchor,
  promptFingerprint,
  splitAnchorIntoSlices,
  usageTokensOf,
} from './tools/layer2-extractor.mjs'
import { LlmCallError, LlmConfigError, createUsageLedger, resolveJudgeLlmConfig, resolveLlmConfig, urlHost } from './tools/llm-client.mjs'
import { JudgeError, describeJudgeRoute, judgeObject } from './tools/judge.mjs'
import { verifyObjects, REASON_CODES, OBJECT_TYPES } from './tools/verifier.mjs'

/** 退出码。导出以便测试引用同一常量，避免测试里出现魔法数字。 */
export const EXIT = Object.freeze({
  PASS: 0,
  OBJECT_REJECTED: 3,
  RUN_FAILED: 4,
})

/**
 * 流水线版本，参与运行指纹；改动产出口径（含**判定口径**）时必须递增。
 *
 * v3：引文判据改为忽略 markdown 强调标记与空白差异（见 verifier 的 QUOTE_NORMALIZATION）。
 *     判定口径一改，同一批对象的判定结果就变了，因此旧回执与它记的计数**不再代表现状**；
 *     版本号进指纹，使重判会落到新的 runId，旧回执原样保留而不是被覆盖。
 * v4：第 3 层接入判定者判据（ticket 05）。判定口径新增一组独立判据（支撑 / 不充分 / 不支撑，
 *     后两者均拒绝），因此 v3 回执记的 passed/rejected 不再代表现状——同样触发重判。
 * v5：判定者的**主张字段表**纳入范围限定类字段（`trigger` / `appliesWhen` / `window`）。
 *     这同样是判定口径的变更：同一批对象，判定者看到的「主张」内容变了，判定结果就可能变。
 *     版本号进指纹的意义正在于此——它让「对着同一批对象、只换尺子重判」成为一次显式操作
 *     （`--judge`），不必连第 2 层一起重跑。
 * v6：回执新增三个**固定字段**，并新增超预算锚点的按结构边界切分（ticket 07）：
 *     ① `coverage`——索引锚点数 / 已处理锚点数 / 覆盖锚点数 / **零产出锚点清单**；
 *     ② `counts.objectTypes`——本章产出的类型分布（九类**全给**，含 0）；
 *     ③ `layer2.usage`——第 2 层按章的调用与 token，含逐锚点明细。
 *     为什么必须递增：旧回执里**没有**这三个字段，而「字段缺席」与「该值为 0」在
 *     语义上完全不同（「零产出锚点 0 个」与「这份回执答不了这个问题」）。
 *     版本号进指纹，使旧回执只能被当成旧口径的记录，不会被当成新口径的结论。
 * v7：引文判据的归一化扩到**渲染后不可见的四类标记 + 空白**（ADR-018）。
 *     相对 v3 新增：引用块标记 `>`、行内代码标记 `` ` ``、反斜杠转义 `\\`；
 *     空白从「折叠成一个空格」改为**整体忽略**。依据是对盘上全部 12 份对象集
 *     （398 个对象）逐条归因：被拒 15 条**全部**只是这类渲染差异，0 条是改写或编造。
 *     中文弯引号 ↔ ASCII 直引号**有意不放宽**（那是字符替换，不是零宽差异），
 *     同一批测量里另有 2 条属于此类，至今仍被拒。
 *     判定口径一改，同一批对象的判定结果就变了——版本号进指纹，使重判落到新的 runId，
 *     旧回执原样保留而不是被覆盖。
 * v8：判定者判据 `judge-prompt/v1` → `v2`——判据的**视野**从「主锚点那一段」放宽到
 *     「对象声明的全部锚点区间」（`JUDGE_INPUT_KEYS` 的 `anchorText` → `anchors`）。
 *     触发依据是可复现的假阴性：跨章 16 条被拒 5 条，其中 `AP-SYNTH-T02-01` 的拒绝理由
 *     要的那句话**逐字就在该对象第二条锚点里**，旧契约让它按结构看不到；同一批里
 *     单章提取 39 条则 39/39 全过——即「跨章综合」在旧判据下是净损失。
 *     回归：单章 39 条 39/39 不变（输入与 v1 逐字节相同，是纯提示词对照）；跨章 16 条
 *     由 11 通过 / 5 拒变为 14 通过 / 2 拒，真错 `AP-SYNTH-T12-06` 仍被拒。
 */
export const PIPELINE_VERSION = 8

/**
 * 质量门禁的完成度。**必须进回执**：判定者未启用时，`passed` 只代表「过了确定性判据」，
 * 不代表「过了第 3 层的全部判据」。把这个区别塞进注释等于没有——审计者读的是回执。
 */
export const VERIFICATION_GATE = Object.freeze({
  FULL: 'gate-1-full（确定性判据 + 判定者判据）',
  DETERMINISTIC_ONLY: 'gate-1-deterministic-only（判定者未启用——结论不完整）',
})

/** 回执 schema 标识。 */
export const RECEIPT_SCHEMA_VERSION = 'receipt/v1'

export const OBJECTS_DIR = path.join('pipeline', 'knowledge')
export const REGISTRY_DIR = path.join('pipeline', 'registry')
/** 被替换过的旧对象归档处（「不静默覆盖」的落点）。 */
export const HISTORY_DIR = path.join('pipeline', 'knowledge', 'history')

/** 第 2 层的两种实现。默认替身——默认路径不许花钱。 */
export const LAYER2_KINDS = Object.freeze(['stub', 'deepseek'])

/**
 * 运行标识：同一源 + 同一产出对象集合 + 同一第 2 层实现 → 同一 id（因此回执文件名可复现）。
 *
 * 注意「同一第 2 层实现」在真实模型下指的是**模型与端点的标识**，不是「同一次推理」——
 * 真实模型两次产出的对象集合不同 → 对象指纹不同 → runId 不同 → 两份回执并存而非互相覆盖。
 */
export function computeRunId({ sourceHash, modelId, objects, judgeApplied }) {
  // `judgeApplied` 进指纹的理由与 `pipelineVersion` 进指纹是同一条（ADR-014）：
  // 运行身份必须覆盖「这次运行实际做了哪些事」。门禁完成度不是流水线的版本，
  // 而是**每次运行各自的选择**（`--judge` / `--no-judge` / 复用路径的缺省），
  // 因此它无法借版本号表达——两份门禁不同的回执本来就是两次不同的运行，
  // 给它们同一个 id 会让后写的那份把先写的那份顶掉，而两者记的 `counts` 并不相同。
  const fingerprint = [
    sourceHash,
    modelId,
    objectSetFingerprint(objects),
    `pipeline:v${PIPELINE_VERSION}`,
    `gate:${judgeApplied ? 'full' : 'deterministic-only'}`,
  ].join('\n')
  return `run-${sha256Hex(fingerprint).slice(0, 12)}`
}

/** 对象文件路径：`<源文件基名>.objects.json`。 */
export function objectsPathFor(index) {
  return path.join(OBJECTS_DIR, `${index.fileKey}.objects.json`)
}

/** 回执文件路径：`<runId>.receipt.json`。 */
export function receiptPathFor(runId) {
  return path.join(REGISTRY_DIR, `${runId}.receipt.json`)
}

/** 第 2 层原始响应的落盘路径：`<runId>.layer2-raw.json`（审计平面，非回执本身）。 */
export function layer2RawPathFor(runId) {
  return path.join(REGISTRY_DIR, `${runId}.layer2-raw.json`)
}

/**
 * 增量落盘路径（第 2 层每完成一个锚点就写一次）。
 *
 * 名字里带 `.partial` 是刻意的：它是**半成品**，谁都不该把它当成冻结产物。
 * 复用判定只认最终文件名，因此中途失败的残留不会被误当成可用产出。
 */
export const PARTIAL_OBJECTS_SUFFIX = '.objects.partial.json'
export const PARTIAL_RAW_SUFFIX = '.layer2-raw.partial.json'

export function partialObjectsPathFor(index) {
  return path.join(OBJECTS_DIR, `${index.fileKey}${PARTIAL_OBJECTS_SUFFIX}`)
}

/** 判定者响应解析失败时的原文本落盘路径。与第 2 层同构，理由也同构。 */
export function judgeRawPathFor(runId) {
  return path.join(REGISTRY_DIR, `${runId}.judge-raw.json`)
}

export function partialRawPathFor(index) {
  return path.join(REGISTRY_DIR, `${index.fileKey}${PARTIAL_RAW_SUFFIX}`)
}

/** 旧对象归档路径：`history/<fileKey>.<sha8>.objects.json`。 */
export function historyPathFor(fileKey, sha256) {
  return path.join(HISTORY_DIR, `${fileKey}.${String(sha256).replace(/^sha256:/, '').slice(0, 8)}.objects.json`)
}

/** 落盘产物指针：路径 + 摘要 + 体量 + 计数（回执据此不必复制产物正文）。 */
async function artifactRef(repoRoot, relPath, extra = {}) {
  const raw = await readFile(path.join(repoRoot, relPath), 'utf8')
  return {
    path: relPath,
    sha256: `sha256:${sha256Hex(raw)}`,
    bytes: Buffer.byteLength(raw, 'utf8'),
    ...extra,
  }
}

const readJsonIfExists = async (abs) => {
  try {
    return JSON.parse(await readFile(abs, 'utf8'))
  } catch {
    return null
  }
}

const writeJson = async (absPath, value) => {
  await mkdir(path.dirname(absPath), { recursive: true })
  const text = JSON.stringify(value, null, 2) + '\n'
  await writeFile(absPath, text, 'utf8')
  return { text, bytes: Buffer.byteLength(text, 'utf8') }
}

/** 把「第 2 层替身」的默认实现显式建模：返回对象数组、调用次数为 0、无 token 消耗。 */
async function runLayer2Stub({ index, sourceAbsPath, repoRoot, fixturePath }) {
  if (fixturePath === null) {
    const objects = await stubGenerateObjects(index, { sourceFile: sourceAbsPath })
    return { objects, fixture: null, modelId: STUB_MODEL_ID, ledger: createUsageLedger(), perAnchor: [], rawByAnchor: null }
  }

  // 注入模式：仅测试使用。注入路径同样不得落在盲测基准目录内。
  const abs = path.resolve(repoRoot, fixturePath)
  const benchmarkAbs = path.resolve(repoRoot, DEFAULT_BENCHMARK_DIR)
  if (abs === benchmarkAbs || abs.startsWith(benchmarkAbs + path.sep)) {
    throw new StubModelError(`拒绝从盲测基准目录注入对象：${abs}（污染隔离，ADR-001）`)
  }
  const fixture = JSON.parse(await readFile(abs, 'utf8'))
  return {
    objects: loadFixtureObjects(fixture, index),
    fixture: { path: fixturePath, sha256: `sha256:${sha256Hex(JSON.stringify(fixture))}` },
    modelId: `${STUB_MODEL_ID}+fixture`,
    ledger: createUsageLedger(),
    perAnchor: [],
    rawByAnchor: null,
  }
}

/**
 * 半成品是否可以直接续跑。
 *
 * 判据刻意落在**内容**上，而不是「信一个元数据字段」：把半成品里已完成的锚点逐个与当前
 * 索引比对锚点标识与行号区间，并逐条校验其中对象的 contentHash。这比只比一个 sourceHash
 * 更强——源文改动但锚点结构未变时，只比哈希会把可用半成品误判为过期。
 *
 * 副作用是它对「早期版本写下的半成品」（没有 sourceHash 字段）同样适用，因此升级不会
 * 白白丢掉已经付过费的产出。
 *
 * @param {{lines?:string[], maxAnchorBytes?:number}} [opts] 校验「片中断点」所需：片数是
 *        「源文 + 预算」的函数，两者任一变了，旧半成品记的切片位置就可能已经不存在。
 *        不传 lines 时跳过片校验（只按锚点粒度续，退化成 v5 的行为）。
 * @returns {{ok:boolean, reason:string|null, done:number, inFlight:object|null}}
 */
export function checkPartialUsable(partial, objects, index, opts = {}) {
  if (!partial || typeof partial !== 'object') return { ok: false, inFlight: null, reason: 'no-partial', done: 0 }
  if (!Array.isArray(objects)) return { ok: false, inFlight: null, reason: 'objects-not-array', done: 0 }
  if (partial.sourceHash !== undefined && partial.sourceHash !== index.sourceHash) {
    return { ok: false, inFlight: null, reason: 'source-version-changed', done: 0 }
  }
  const done = partial.completedAnchors
  // `done` 允许为 0：半成品可以停在**第一个锚点的第一片之后**（ticket 07 的片级落盘），
  // 此时一个锚点都还没收尾，但片产出已经付过费、可以续。
  if (!Number.isInteger(done) || done < 0 || done >= index.anchorCount) {
    return { ok: false, inFlight: null, reason: 'completion-out-of-range', done: 0 }
  }
  if (!Array.isArray(partial.anchors) || partial.anchors.length !== done) {
    return { ok: false, inFlight: null, reason: 'anchors-missing', done: 0 }
  }
  for (let i = 0; i < done; i += 1) {
    const a = partial.anchors[i]
    const e = index.anchors[i]
    if (a?.anchor !== e.anchor || a.lineStart !== e.lineStart || a.lineEnd !== e.lineEnd) {
      return { ok: false, inFlight: null, reason: `anchor-${i + 1}-mismatch`, done: 0 }
    }
  }
  // 片中断点：必须是**下一个**锚点，且其已完成片数落在该锚点实际的片数区间内。
  // 逐项核对而不是信一个字段：片数是源文与预算的函数，源文没变而预算变了时，
  // 旧半成品记的切片位置可能已经不存在了——那种半成品必须丢弃，不能拿来续。
  const inFlight = partial.inFlight ?? null
  let inFlightCheck = null
  if (inFlight !== null) {
    if (typeof inFlight !== 'object') return { ok: false, inFlight: null, reason: 'in-flight-malformed', done: 0 }
    const next = index.anchors[done]
    if (next === undefined || inFlight.anchor !== next.anchor) {
      return { ok: false, inFlight: null, reason: 'in-flight-anchor-mismatch', done: 0 }
    }
    if (opts.lines !== undefined && opts.lines !== null) {
      const slices = splitAnchorIntoSlices(next, opts.lines, {
        maxAnchorBytes: opts.maxAnchorBytes ?? DEFAULT_MAX_ANCHOR_BYTES,
      })
      const total = slices.length
      if (
        !Number.isInteger(inFlight.slicesDone) ||
        inFlight.slicesDone < 1 ||
        inFlight.slicesDone > total
      ) {
        return { ok: false, inFlight: null, reason: 'in-flight-slices-out-of-range', done: 0 }
      }
      inFlightCheck = { anchor: next.anchor, slicesDone: inFlight.slicesDone, sliceCount: total }
    }
  }
  for (const o of objects) {
    const ref = Array.isArray(o?.sourceRefs) ? o.sourceRefs[0] : null
    const e = index.anchors.find((x) => x.anchor === ref?.anchor)
    if (!e || ref.contentHash !== e.contentHash) {
      return { ok: false, inFlight: null, reason: 'object-content-hash-mismatch', done: 0 }
    }
  }
  return { ok: true, reason: null, done, inFlight: inFlightCheck }
}

/**
 * 冻结产物的产出者认定。
 *
 * 复用时我们**不知道**这批对象当初是哪个模型产出的，而回执里的 `model.modelId` 会参与
 * runId 复算——猜一个会让回执不再可复核。因此：在审计平面里按「对象文件哈希 + 源文件哈希」
 * 反查原回执；查不到就报错，绝不猜。
 */
export async function findFrozenProducer({ repoRoot, objectsSha256, sourceHash }) {
  let files
  try {
    files = await readdir(path.join(repoRoot, REGISTRY_DIR))
  } catch {
    return null
  }
  const candidates = files.filter((f) => f.endsWith('.receipt.json')).sort()
  for (const f of candidates) {
    const r = await readJsonIfExists(path.join(repoRoot, REGISTRY_DIR, f))
    if (!r || r.engineeringFailure) continue
    // 排除「复用型回执」：它描述的是「读了一次」，不是「产出过一次」。
    // 不排除的话，复用会指向另一份复用，最终指回自己——链条断了，且没有任何产出记录。
    if (r?.layer2?.reused === true) continue
    if (r?.artifacts?.objects?.sha256 === objectsSha256 && r?.source?.hash === sourceHash) {
      return {
        runId: r.runId,
        receiptPath: path.join(REGISTRY_DIR, f),
        modelId: r.model?.modelId ?? null,
        provider: r.model?.provider ?? null,
        createdAt: r.createdAt ?? null,
        calls: r.model?.calls ?? null,
        tokens: r.model?.tokens ?? null,
      }
    }
  }
  return null
}

/**
 * 冻结产物是否仍然对应**当前**源版本。
 *
 * 判据用对象自带的 `sourceRefs[].contentHash` 与新索引逐条比对，而不是另存一个指纹文件：
 * 这些哈希本来就在对象里，再存一份就多了一个会各自漂移的真源。
 */
export function checkFrozenFreshness(objects, index) {
  const lookup = new Map(index.anchors.map((a) => [a.anchor, a]))
  const problems = []
  for (const o of objects) {
    const refs = Array.isArray(o?.sourceRefs) ? o.sourceRefs : []
    if (refs.length === 0) {
      problems.push({ objectId: o?.id ?? null, reason: 'REFERENCE_MISSING' })
      continue
    }
    const ref = refs[0]
    const entry = lookup.get(ref?.anchor)
    if (!entry) {
      problems.push({ objectId: o?.id ?? null, reason: 'REFERENCE_UNRESOLVED', anchor: ref?.anchor ?? null })
      continue
    }
    if (ref.contentHash !== entry.contentHash) {
      problems.push({ objectId: o?.id ?? null, reason: 'SOURCE_VERSION_DRIFT', anchor: ref.anchor })
    }
  }
  return problems
}

/**
 * 锚点覆盖数与**零产出锚点**（ticket 07 的核心补充）。
 *
 * ## 为什么它必须从「对象 × 索引」反推，而不是读 `perAnchor`
 *
 * 这张卡的真实失效模式是**调用了、但没有产出**——它从原验收项的缝隙里穿过去。
 * 盘上的证据只有 `perAnchor[].objectCount: 0` 这一条，而它**只在真正跑了第 2 层的路径上存在**：
 * 复用路径与重判路径的 `perAnchor` 是空数组（实测），于是该信号在这两条路径上**整体消失**。
 * 更糟的是那两条路径正是「你回头看这批对象时最可能走的路径」。
 *
 * 因此判据落在**对象本身**：一个锚点若没有任何对象把 `sourceRefs` 指向它，它就是零产出锚点。
 * 这个推导只依赖「对象」与「索引」，而这两样在每条路径上都在盘上、都可复算，
 * 于是同一个数字在任何路径上都算得出来，且**同一个源 + 同一批对象必然算出同一个数字**。
 *
 * 它的方向是**保守的**：未处理的锚点会落进「零产出」而不是消失。宁可多报一个
 * 「被处理但没产出」，不可漏报一个「整节被静默跳过」。
 *
 * @returns {{indexAnchors:number, processedAnchors:number|null, coveredAnchors:number,
 *   withoutObjects:{count:number, anchors:string[]}, unresolvedReferenceAnchors:string[],
 *   reading:string, perLevel:object}}
 */
export function computeAnchorCoverage(objects, index, { processedAnchors = null } = {}) {
  const indexAnchors = index.anchors.map((a) => a.anchor)
  const known = new Set(indexAnchors)
  const covered = new Set()
  const unresolved = new Set()

  for (const o of Array.isArray(objects) ? objects : []) {
    const refs = Array.isArray(o?.sourceRefs) ? o.sourceRefs : []
    for (const ref of refs) {
      const anchor = ref?.anchor
      if (typeof anchor !== 'string') continue
      if (known.has(anchor)) covered.add(anchor)
      else unresolved.add(anchor)
    }
  }

  const without = indexAnchors.filter((a) => !covered.has(a))

  // 按层级分列：失效模式对层级有偏好（实测漏的都是 `h2-8` 本章小结与 `h2-9` 思考题这类
  // 「不像知识」的末节）。只给一个总数，就看不出漏的是哪一类锚点。
  const perLevel = {}
  for (const a of index.anchors) {
    const key = `h${a.level}`
    const slot = (perLevel[key] ??= { index: 0, covered: 0, without: 0 })
    slot.index += 1
    if (covered.has(a.anchor)) slot.covered += 1
    else slot.without += 1
  }

  return {
    indexAnchors: indexAnchors.length,
    // 「被处理」在本回执里**不是猜的**：它等于逐锚点明细的条数（本次真的为哪些锚点发过调用）。
    // 取不到（替身/夹具路径）时是 null——此时「零产出」的清单仍然有效，但它答的是
    // 「哪些锚点没有任何对象指向」，答不了「哪些锚点被处理过却没产出」。两者必须能分开读。
    processedAnchors,
    processedKnown: processedAnchors !== null,
    coveredAnchors: indexAnchors.length - without.length,
    withoutObjects: { count: without.length, anchors: without },
    unresolvedReferenceAnchors: [...unresolved].sort(),
    reading:
      processedAnchors === null
        ? '本次第 2 层**未按锚点发起调用**（替身/夹具路径），因此无法区分「被处理但产出 0」与「未处理」。' +
          'withoutObjects 列的是**没有任何对象指向**的锚点，是一个保守的上界。'
        : '本次按锚点发起过调用。withoutObjects 列的就是**被处理但产出 0 个对象**的锚点（' +
          'processedAnchors=' +
          processedAnchors +
          '，索引锚点数=' +
          indexAnchors.length +
          '）。',
    perLevel,
  }
}

/**
 * 本章产出的类型分布。九种类型**全部给出**，包括计数为 0 的那几类。
 *
 * 为什么 0 也要给：读了 `{"Concept": 3}` 的人无法区分「本章没有 Playbook」与
 * 「这一版回执还没统计 Playbook」。缺失的键与值为 0 的键是两条不同的信息，
 * 而前者的代价是让人对着一个空位猜。
 */
export function computeTypeDistribution(objects) {
  const dist = {}
  for (const t of OBJECT_TYPES) dist[t] = 0
  for (const o of Array.isArray(objects) ? objects : []) {
    const t = typeof o?.objectType === 'string' ? o.objectType : '(未知类型)'
    dist[t] = (dist[t] ?? 0) + 1
  }
  return dist
}

/**
 * 第 2 层按章的调用与 token：总量 + **逐锚点明细**（ticket 07）。
 *
 * 为什么要逐锚点：`model.calls` 只能回答「这一章花了多少」，答不了「这一章里哪一段最贵」。
 * 而「某个锚点特别贵」与「某个锚点零产出」往往是同一件事的两面——模型在一段上烧掉
 * 一万 token 却什么也没产出，这是提示词或切分该被调整的地方，只在总量上看不出来。
 *
 * ## 两个数字的口径必须说清，否则它们对不上就是一笔糊账
 *
 * `model.calls` 是**客户端账本的 HTTP 尝试次数**（`llm-client` 的重试循环里逐次自增），
 * 而本块的 `calls` 是**每次成功响应**的计数（一个锚点切片一次）。两者在发生过重试时
 * **本来就不相等**，因此这里不把它们当成同一个数，而是显式做一次对账：
 *   成功响应数 应当等于 `model.calls - model.failedCalls`（重试成功的那次也算 failedCalls）。
 * 对不上就是缺陷信号，`matches` 会如实为 false 而不是被解释掉。
 * 取不到用量（服务端没回 usage）时 `matches` 是 **null**，不是 true——「不知道」不是「对得上」。
 */
export function summarizeLayer2Usage(perAnchor, { ledgerCalls = 0, ledgerFailedCalls = 0 } = {}) {
  const byAnchor = []
  const anchorsWithoutUsage = []
  let calls = 0
  let input = 0
  let output = 0

  for (const a of Array.isArray(perAnchor) ? perAnchor : []) {
    const totals = a?.usageTotals ?? null
    const sliceCount = Number.isInteger(a?.sliceCount) ? a.sliceCount : 1
    const anchorCalls = Number.isInteger(totals?.calls) ? totals.calls : sliceCount
    const tokens = totals?.tokens ?? usageTokensOf(a?.usage)
    calls += anchorCalls
    if (tokens === null) {
      anchorsWithoutUsage.push(a?.anchor ?? null)
      byAnchor.push({ anchor: a?.anchor ?? null, calls: anchorCalls, tokens: null })
      continue
    }
    input += tokens.input
    output += tokens.output
    byAnchor.push({ anchor: a?.anchor ?? null, calls: anchorCalls, tokens })
  }

  const ledgerSuccessful = ledgerCalls - ledgerFailedCalls
  const matches =
    anchorsWithoutUsage.length > 0 ? null : calls === ledgerSuccessful

  return {
    calls,
    tokens: { input, output },
    byAnchor,
    anchorsWithoutUsage,
    // 逐锚点明细为空 = 本次第 2 层**没有按锚点发起调用**（替身路径、夹具注入路径）。
    // 这个区别必须说出来：`calls: 0` 与「这一版没统计」读起来一样，
    // 而下一个人会用这个 0 去推断成本。
    byAnchorNote:
      byAnchor.length === 0
        ? '本次第 2 层未按锚点发起任何真实调用（替身/夹具路径），因此没有逐锚点用量。此处 calls=0 表示「没有调用」，不表示「统计缺失」。'
        : null,
    reconciliation: {
      perAnchorCalls: calls,
      modelCallsAreHttpAttempts: true,
      ledgerCalls,
      ledgerFailedCalls,
      ledgerSuccessfulCalls: ledgerSuccessful,
      matches,
      note:
        '本块的 calls 是**成功响应**计数；`model.calls` 是客户端账本记的 **HTTP 尝试**次数' +
        '（重试逐次自增）。对账式：本块 calls ?= model.calls − model.failedCalls。' +
        (anchorsWithoutUsage.length > 0
          ? `取不到用量的锚点有 ${anchorsWithoutUsage.length} 个，因此本次**无法对账**（matches=null，不是 true）。`
          : ''),
    },
  }
}

/**
 * 把「命令行 flags」转成 `runPipeline` 的入参。
 *
 * **这个函数存在的唯一理由是修一个真实缺陷。** 此前 `main()` 逐个枚举要传的字段
 * （`layer2:` / `rerun:` / `llmModel:` …），而 ticket 05 新增判定者的六个开关时只加了
 * 参数解析、忘了加这份清单——CLI **收下参数然后默默丢掉**，`--judge` 看起来被接受、
 * 实际什么都没发生（实测踩到：一次重扫跑了 0 次模型调用）。
 *
 * 离线测试没抓到它，因为它们直接调 `runPipeline()`，**绕过了 CLI 这一层**。
 * 因此修法不是「补上那六行」（下次加参数照样会忘），而是**改成整体透传 + 用测试钉住这条性质**：
 * `parseArgs` 产出的每一个键都必须原样出现在本函数的输出里，键名与取值都不得改动。
 * 测试见 `pipeline/tools/test/cli-flags.test.mjs`。
 *
 * 只有三个键需要改写，且都是为了与 `runPipeline` 的既有约定对齐：
 *   `source`（位置参数 → 字段）、`repoRoot`（realpath 归一化，调用方先算好再传入）、
 *   `objectsFixture`（空串 → null；下游用 `=== null` 判断「有没有夹具」）。
 * 这三处是**穷尽清单**——`cli-flags.test.mjs` 断言其余每一个键都逐值透传。
 */
export function buildRunInput(flags, { target, repoRoot }) {
  return { ...flags, source: target, repoRoot, objectsFixture: flags.objectsFixture || null }
}

/**
 * 路由覆盖的**键映射表**：`runPipeline` 入参键 → `resolveLlmConfig` 的 override 键。
 *
 * **这张表存在的理由是同一个缺陷犯了两次。**
 *
 * 第一次（卡 05）：`main()` 逐个枚举要传给 `runPipeline` 的字段，新增判定者六个开关时
 * 忘了加进清单，CLI 收下参数然后默默丢掉。当时的修法是 `buildRunInput` 整体透传。
 *
 * 第二次（批次一）：修了 `flags → input` 这一跳，却没修 `input → resolveLlmConfig` 这一跳。
 * 结果新增的 `--llm-reasoning-effort` 在**生产者**那条链上被静默丢弃——臂 B 名义上跑低档，
 * 实际发的是「不带 reasoning_effort」的请求。而它**看起来是正确的**：
 * 判定者那条链因为走的是另一份 opts，正确继承了 `low`，于是回执里
 * `judge.reasoningEffort = "low"` 赫然在目，`model.configSource.reasoningEffort = null` 却无人对账。
 *
 * 因此这里不再写两次字面量，而是**由表驱动**，并用测试钉住这条性质：
 * 每一个路由类的 CLI 开关，都必须出现在某张表的值里。
 * 测试见 `pipeline/tools/test/route-overrides.test.mjs`。
 */
export const PRODUCER_OVERRIDE_KEYS = Object.freeze({
  modelId: 'llmModel',
  baseUrl: 'llmBaseUrl',
  provider: 'llmProvider',
  apiKey: 'llmApiKey',
  reasoningEffort: 'llmReasoningEffort',
})

export const JUDGE_OVERRIDE_KEYS = Object.freeze({
  modelId: 'judgeModel',
  baseUrl: 'judgeBaseUrl',
  provider: 'judgeProvider',
  reasoningEffort: 'judgeReasoningEffort',
})

/**
 * 由映射表产出 `resolveLlmConfig` 的 overrides。
 *
 * **只放「取值确实存在」的键，不放 `null`。** 这一条是缺陷修出来的：
 * `resolveLlmConfig` 判定来源时读的是「这个 override 键在不在、是不是非空串」，
 * 若我们无条件把所有键都填上 `null`，它会认为「调用方显式传了 `null`」——
 * 于是回执里写 `override(reasoningEffort)`，而实际上**根本没人拨过档**。
 * 值是对的（`null` → 不发字段），来源是假的。而回执的来源字段存在的全部意义
 * 就是让人事后能问「这次到底是谁把它设成这样的」。
 */
function overridesFrom(table, input) {
  const out = {}
  for (const [overrideKey, inputKey] of Object.entries(table)) {
    const v = input[inputKey]
    if (typeof v === 'string' && v.trim() !== '') out[overrideKey] = v
  }
  return out
}

/** 生产者路由覆盖。 */
export function buildProducerOverrides(input) {
  return overridesFrom(PRODUCER_OVERRIDE_KEYS, input)
}

/** 判定者路由覆盖。 */
export function buildJudgeOverrides(input) {
  return overridesFrom(JUDGE_OVERRIDE_KEYS, input)
}

/**
 * CLI 开关表 · **唯一真源**。
 *
 * 存在的理由与 `PRODUCER_OVERRIDE_KEYS` 同源：这份清单原先散在 `parseArgs` 的
 * 一长串 `else if` 里，于是任何**第二个**需要认识这些开关的程序（`pipeline/run-book.mjs`
 * 要把它们原样透传给每个子进程）都只能照着抄一遍——抄出来的那份会在新增开关时静默过期，
 * 而「透传少了一个开关」的表现是「参数被接受但什么都没发生」，正是 ticket 05 踩过的那个坑。
 *
 * `kind: 'bool'` 的项自带取值（`--no-resume` 把 `resume` 置 false）；
 * `kind: 'value'` 的项吃下一个参数，`parse` 缺省是原样字符串。
 */
export const CLI_FLAGS = Object.freeze({
  '--json': { key: 'json', kind: 'bool', value: true },
  '--rerun': { key: 'rerun', kind: 'bool', value: true },
  '--no-resume': { key: 'resume', kind: 'bool', value: false },
  '--judge-all': { key: 'judgeAll', kind: 'bool', value: true },
  '--judge': { key: 'judge', kind: 'bool', value: true },
  '--no-judge': { key: 'noJudge', kind: 'bool', value: true },
  '--repo-root': { key: 'repoRoot', kind: 'value', parse: (v) => path.resolve(v) },
  '--objects-fixture': { key: 'objectsFixture', kind: 'value' },
  '--layer2': { key: 'layer2', kind: 'value' },
  '--llm-model': { key: 'llmModel', kind: 'value' },
  '--llm-base-url': { key: 'llmBaseUrl', kind: 'value' },
  '--llm-provider': { key: 'llmProvider', kind: 'value' },
  '--llm-reasoning-effort': { key: 'llmReasoningEffort', kind: 'value' },
  '--judge-model': { key: 'judgeModel', kind: 'value' },
  '--judge-base-url': { key: 'judgeBaseUrl', kind: 'value' },
  '--judge-provider': { key: 'judgeProvider', kind: 'value' },
  '--judge-reasoning-effort': { key: 'judgeReasoningEffort', kind: 'value' },
  '--max-objects-per-anchor': { key: 'maxObjectsPerAnchor', kind: 'value', parse: Number },
  '--max-tokens': { key: 'maxTokens', kind: 'value', parse: Number },
  '--max-anchor-bytes': { key: 'maxAnchorBytes', kind: 'value', parse: Number },
})

export function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    json: false,
    repoRoot: DEFAULT_REPO_ROOT,
    objectsFixture: null,
    layer2: 'stub',
    rerun: false,
    llmModel: null,
    llmBaseUrl: null,
    llmProvider: null,
    judgeAll: false,
    noJudge: false,
    judge: null,
    judgeModel: null,
    judgeBaseUrl: null,
    judgeProvider: null,
    llmReasoningEffort: null,
    judgeReasoningEffort: null,
    maxObjectsPerAnchor: null,
    maxTokens: null,
    maxAnchorBytes: null,
    resume: true,
  }
  const positional = []
  const need = (i, name) => {
    const v = args[i + 1]
    if (v === undefined || v.startsWith('--')) throw new SourcePathError(`${name} 缺少取值`)
    return v
  }
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i]
    const spec = CLI_FLAGS[a]
    if (spec === undefined) {
      if (a.startsWith('--')) throw new SourcePathError(`未知参数：${a}`)
      positional.push(a)
      continue
    }
    if (spec.kind === 'bool') {
      flags[spec.key] = spec.value
      continue
    }
    const raw = need(i, a)
    i += 1
    flags[spec.key] = spec.parse ? spec.parse(raw) : raw
  }
  return { flags, positional }
}

/**
 * 跑完整条流水线。
 *
 * @returns {Promise<{exitCode: number, receipt: object, stderr: string|null}>}
 */
export async function runPipeline(input) {
  // 仓库根先 realpath 归一：路径守卫、落盘、产物指针与回执里的相对路径必须共用同一个根，
  // 否则 macOS 上 os.tmpdir() 的 /var → /private/var 软链会让 path.relative 产出 `../../` 串。
  const repoRoot = resolveRealPath(input.repoRoot ?? DEFAULT_REPO_ROOT)
  const layer2Kind = input.layer2 ?? 'stub'
  if (!LAYER2_KINDS.includes(layer2Kind)) {
    throw new LlmConfigError(`未知的第 2 层实现：${layer2Kind}（可选：${LAYER2_KINDS.join(' | ')}）`)
  }
  const fixturePath =
    input.objectsFixture === null || input.objectsFixture === undefined
      ? null
      : path.resolve(repoRoot, input.objectsFixture)

  // ---- 第 0 步：路径守卫（工程问题：不合法即拒绝，绝不静默） ----
  const sourceAbs = assertAllowedSource(path.resolve(repoRoot, input.source), { repoRoot })

  // ---- 第 1 层：确定性锚点索引 ----
  const index = await buildAnchorIndex(sourceAbs, { repoRoot })
  const anchorsAbs = await writeAnchorIndex(index, { sourceFile: sourceAbs, repoRoot })

  // ---- 第 2 层：综合 ----
  const createdAt = new Date().toISOString()
  const objectsRel = objectsPathFor(index)
  const objectsAbs = path.join(repoRoot, objectsRel)
  const previousObjectsRaw = await readFile(objectsAbs, 'utf8').catch(() => null)
  const previousObjectsSha = previousObjectsRaw === null ? null : `sha256:${sha256Hex(previousObjectsRaw)}`

  /** @type {{objects:object[], fixture:object|null, modelId:string, ledger:object, perAnchor:object[], rawByAnchor:object[]|null, reused:object|null, configSource:object|null}} */
  let layer2

  if (layer2Kind === 'stub') {
    layer2 = { ...(await runLayer2Stub({ index, sourceAbsPath: sourceAbs, repoRoot, fixturePath })), reused: null, configSource: null }
  } else {
    const frozen = previousObjectsRaw === null ? null : JSON.parse(previousObjectsRaw)
    const useFrozen = frozen !== null && input.rerun !== true

    if (useFrozen) {
      if (!Array.isArray(frozen)) {
        throw new LlmConfigError(
          `${objectsRel} 不是对象数组（顶层为 ${frozen === null ? 'null' : typeof frozen}），` +
            '无法作为冻结产物复用。请传 --rerun 重新产出。',
        )
      }
      // 冻结产物：不重新调用模型。必须先证明它仍对应当前源版本，且能认定产出者。
      const problems = checkFrozenFreshness(frozen, index)
      if (problems.length > 0) {
        throw new LlmConfigError(
          `已落盘的对象与当前源版本不一致（${problems.length} 条，首条：` +
            `${problems[0].objectId ?? '未知对象'} → ${problems[0].reason}），拒绝复用。\n` +
            `这批对象是基于旧版正文产出的；要基于当前正文重新产出，请显式传 --rerun（会产生模型调用）。`,
        )
      }
      const producer = await findFrozenProducer({
        repoRoot,
        objectsSha256: previousObjectsSha,
        sourceHash: index.sourceHash,
      })
      if (producer === null || producer.modelId === null) {
        throw new LlmConfigError(
          '无法认定已落盘对象的产出者：审计平面里没有与之对应的回执。拒绝猜一个模型名——' +
            '回执里的 model.modelId 会参与 runId 复算，猜错会让整份回执不可复核。\n' +
            '若这批对象来自外部，请传 --rerun 重新产出。',
        )
      }
      layer2 = {
        objects: frozen,
        fixture: null,
        modelId: producer.modelId,
        ledger: createUsageLedger(),
        perAnchor: [],
        rawByAnchor: null,
        reused: producer,
        configSource: null,
      }
    } else {
      const config = await resolveLlmConfig({
        env: input.env,
        overrides: buildProducerOverrides(input),
      })
      const lines = normalizeLines(await readFile(sourceAbs, 'utf8'))
      const maxAnchorBytes =
        Number.isFinite(input.maxAnchorBytes) && input.maxAnchorBytes > 0
          ? input.maxAnchorBytes
          : DEFAULT_MAX_ANCHOR_BYTES
      const partialObjectsAbs = path.join(repoRoot, partialObjectsPathFor(index))
      const partialRawAbs = path.join(repoRoot, partialRawPathFor(index))

      // ---- 断点续跑：半成品是「已经付过费的产出」，能续就不重跑 ----
      // 自动续跑（可用 input.resume === false 关掉）与「产出固化」是同一条道理：已经花过的钱
      // 不该再花第二遍。只有「同一源版本 + 同一锚点总数 + 半成品确实未完成」三条同时成立才续，
      // 其余一律丢弃重来——把不可用的半成品当成进度才是真正危险的。
      let seed = null
      if (input.rerun !== true && input.resume !== false) {
        const rawPartial = await readJsonIfExists(partialRawAbs)
        const objectsPartial = await readJsonIfExists(partialObjectsAbs)
        const verdict = checkPartialUsable(
          rawPartial === null ? null : { ...rawPartial, totalAnchors: rawPartial.totalAnchors ?? index.anchorCount },
          objectsPartial,
          index,
          { lines, maxAnchorBytes },
        )
        if (verdict.ok) {
          // 「在跑锚点」的对象：半成品按定义把它们写在数组**尾部**（收尾那次落盘最后写入）。
          // 这里按锚点筛出来交给第 2 层续，它自己会核对「确实是尾部」这条不变量。
          const inFlight = verdict.inFlight
          const carried =
            inFlight === null
              ? []
              : objectsPartial.filter((o) => o?.sourceRefs?.[0]?.anchor === inFlight.anchor)
          seed = {
            objects: objectsPartial,
            perAnchor: rawPartial.anchors ?? [],
            usage: rawPartial.usageSoFar ?? null,
            done: rawPartial.completedAnchors,
            resumeInFlight: inFlight === null ? null : { ...inFlight, objects: carried },
          }
          process.stderr.write(
            `[断点续跑] 已有 ${seed.done}/${index.anchorCount} 个锚点的付费产出` +
              (inFlight === null
                ? ''
                : `，另有 ${inFlight.anchor} 的第 ${inFlight.slicesDone}/${inFlight.sliceCount} 片`) +
              `，从第 ${seed.done + 1} 个锚点继续。\n`,
          )
        } else if (rawPartial !== null) {
          await rm(partialObjectsAbs, { force: true })
          await rm(partialRawAbs, { force: true })
          process.stderr.write(
            `[断点续跑] 丢弃不可用的半成品（${verdict.reason}），从头开始。\n`,
          )
        }
      }

      const ledger = createUsageLedger()
      if (seed?.usage) {
        // 账要连着上次一起算：回执报的是「产出这批对象一共花了多少」，不是「这个进程花了多少」。
        ledger.calls = seed.usage.calls ?? 0
        ledger.failedCalls = seed.usage.failedCalls ?? 0
        ledger.tokens.input = seed.usage.tokens?.input ?? 0
        ledger.tokens.output = seed.usage.tokens?.output ?? 0
        ledger.tokensDetail.reasoning = seed.usage.tokensDetail?.reasoning ?? 0
        ledger.tokensDetail.cachedInput = seed.usage.tokensDetail?.cachedInput ?? 0
      }

      const extracted = await extractByAnchor({
        config,
        index,
        lines,
        createdAt,
        chatImpl: input.chatImpl,
        fetchImpl: input.fetchImpl,
        ledger,
        anchors: seed !== null ? index.anchors.slice(seed.done) : index.anchors,
        initialObjects: seed?.objects ?? [],
        initialPerAnchor: seed?.perAnchor ?? [],
        resumeInFlight: seed?.resumeInFlight ?? null,
        maxAnchorBytes,
        ...(input.maxObjectsPerAnchor ? { maxObjectsPerAnchor: input.maxObjectsPerAnchor } : {}),
        ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
        maxAttempts: input.maxAttempts,
        retryDelayMs: input.retryDelayMs,
        // 增量落盘：整章要跑十几分钟，中途失败若什么都不留，已付费的产出就全丢了。
        // 回调**每片**都会触发（不只是每个锚点）：一次超预算锚点的切分是 3–4 次调用，
        // 只在锚点收尾时落盘会让「跑到第 3 片被杀」白丢前两片的钱。
        onAnchorDone: async ({ objects, perAnchor: soFar, ledger: snapshot, inFlight }) => {
          await writeJson(partialObjectsAbs, objects)
          await writeJson(partialRawAbs, {
            schemaVersion: 'layer2-raw/v1',
            status: 'partial',
            note: '半成品：第 2 层尚未跑完全部锚点。不要当成冻结产物使用；下一次运行会自动从此处续跑。',
            createdAt,
            sourceHash: index.sourceHash,
            // 片数是「源文 + 预算」的函数，续跑时要按同一个预算复算切片位置，
            // 因此预算本身必须写进半成品——它变了，旧半成品的切片位置就不再有效。
            maxAnchorBytes,
            modelId: `${config.provider ? `${config.provider}/` : ''}${config.modelId}`,
            // 半成品也带上提示词指纹：续跑时若提示词已变，产物就是「两版提示词混在一起」的，
            // 这个字段是唯一能让人事后发现这点的线索。
            promptFingerprint: promptFingerprint(
              input.maxObjectsPerAnchor ? { maxObjectsPerAnchor: input.maxObjectsPerAnchor } : {},
            ),
            completedAnchors: soFar.length,
            totalAnchors: index.anchorCount,
            // 已收尾锚点的**下一个**锚点若已跑了一部分片，记在这里。它使续跑能停在片中间，
            // 而不是把整节重跑一遍；`checkPartialUsable` 会核对它确实是下一个锚点。
            inFlight: inFlight ?? null,
            usageSoFar: {
              calls: snapshot.calls,
              failedCalls: snapshot.failedCalls,
              tokens: snapshot.tokens,
              tokensDetail: snapshot.tokensDetail,
            },
            anchors: soFar.map((a) => ({
              anchor: a.anchor,
              lineStart: a.lineStart,
              lineEnd: a.lineEnd,
              objectIds: a.objectIds,
              usage: a.usage,
              finishReason: a.finishReason,
              reasoningChars: a.reasoningChars,
              derivedFieldsIgnored: a.derivedFieldsIgnored,
              sliceCount: a.sliceCount,
              oversizedSlices: a.oversizedSlices,
              usageTotals: a.usageTotals,
              rawText: a.rawText,
            })),
          })
        },
      })
      // 跑完了才撤掉半成品——它已完成使命，留着只会让人分不清哪个是冻结产物。
      await rm(partialObjectsAbs, { force: true })
      await rm(partialRawAbs, { force: true })

      // ---- 「已处理锚点数 = 索引锚点数」的机械断言（ticket 07） ----
      // 这一条挡的是**整节被静默跳过**：第 2 层声称跑完了，但某个锚点从未被处理。
      // 它必须在写任何产物**之前**炸掉，否则一份少了整节的对象文件会被当成完整产出落盘，
      // 而下游（第 3 层、回执、未来的聚类）没有任何判据会为缺席者报警。
      if (extracted.perAnchor.length !== index.anchorCount) {
        throw new Layer2Error(
          `第 2 层声称跑完，但只处理了 ${extracted.perAnchor.length}/${index.anchorCount} 个锚点——` +
            '拒绝把这份产出当成整章结果落盘（静默漏节不会被任何计数发现）。',
        )
      }
      const routeLabel = config.provider ?? urlHost(config.baseUrl) ?? 'unrecorded'
      layer2 = {
        objects: extracted.objects,
        fixture: null,
        modelId: `${config.provider ? `${config.provider}/` : ''}${config.modelId}`,
        routeLabel,
        promptFingerprint: promptFingerprint(
          input.maxObjectsPerAnchor ? { maxObjectsPerAnchor: input.maxObjectsPerAnchor } : {},
        ),
        ledger: extracted.ledger,
        perAnchor: extracted.perAnchor,
        rawByAnchor: extracted.perAnchor,
        reused: null,
        resumedFrom:
          seed === null
            ? null
            : {
                completedAnchorsBefore: seed.done,
                inFlightBefore: seed.resumeInFlight ?? null,
                note: '本次为断点续跑：calls/tokens 含前次已完成锚点的消耗（前次那次被截断的调用不在其中，因为它没有产出可记录的用量）。',
              },
        configSource: {
          provider: config.providerSource ?? `derived-from-baseUrl:${urlHost(config.baseUrl) ?? 'unknown'}`,
          modelId: config.modelSource,
          baseUrl: config.baseUrlSource,
          apiKey: config.apiKeySource,
          baseUrlHost: urlHost(config.baseUrl),
          reasoningEffort: config.reasoningEffortSource ?? null,
        },
        reasoningEffort: config.reasoningEffort ?? null,
      }
    }
  }

  // ---- 复用：不产出任何新东西，因此不写任何产物，也**不重写既有回执** ----
  // 回执是「这批对象是怎么来的」的凭证，由**产出它们的运行**写一次。复用只是读了一遍；
  // 若让它覆盖生产回执，审计平面就会丢掉真正的生产记录（实测踩到过：calls 从 20 变成 0，
  // 生产记录被「今天读了一次」替换掉）。
  let skipArtifactWrite = false
  /** 提示词漂移的观察结果；仅在复用路径上有值。写进本次运行自己写的回执，见收尾处。 */
  let reuseObservation = null
  if (layer2.reused !== null) {
    const producerReceipt = await readJsonIfExists(path.join(repoRoot, layer2.reused.receiptPath))
    if (producerReceipt === null) {
      throw new LlmConfigError(
        `认定到产出者 ${layer2.reused.runId}，但它的回执读不到（${layer2.reused.receiptPath}）。` +
          '拒绝用一份新写的回执顶替缺失的生产记录——那会让「这批对象怎么来的」永远说不清。',
      )
    }

    // 两个候选 id：门禁完成度不同的两份回执各有自己的 id，因此它们能并存。
    // **优先回放「做过判定者」的那份**——它对同一批对象做的事更多，是更好的记录；
    // 只在它不存在时才退回确定性-only 那份。
    const idForGate = (full) =>
      computeRunId({
        sourceHash: index.sourceHash,
        modelId: layer2.modelId,
        objects: layer2.objects,
        judgeApplied: full,
      })
    const fullGateRunId = idForGate(true)
    const deterministicGateRunId = idForGate(false)
    const fullGateReceipt = await readJsonIfExists(path.join(repoRoot, receiptPathFor(fullGateRunId)))
    const deterministicGateReceipt = await readJsonIfExists(
      path.join(repoRoot, receiptPathFor(deterministicGateRunId)),
    )
    const sameVersionReceipt = fullGateReceipt ?? deterministicGateReceipt

    // ---- 提示词漂移检测（用户拍板：**告警后复用**，不硬拒） ----
    //
    // 为什么告警而不硬拒：提示词变了与源版本变了是**两种不同性质**的问题。
    //   源变了 → 对象失效（`sourceRefs.contentHash` 指不到东西了），必须拒绝复用；
    //   提示词变了 → 对象**仍然有效，只是旧了**。
    // 用同一种手段（硬拒）处理两者，会把代价花在不必要的地方：任何提示词微调都会强制
    // 全章重跑（每章 20 次调用、实测单章输出 8–12 万 token），而提示词在现阶段还会反复调。
    //
    // 但**也不能只记不比**——那等于没有机制：默认行为会静默给出旧货，读回执的人得自己
    // 想到去比对两个指纹。这正是 ADR-008 明确反对过的失败模式。
    const currentPromptFingerprint =
      layer2Kind === 'stub'
        ? null
        : promptFingerprint(
            input.maxObjectsPerAnchor ? { maxObjectsPerAnchor: input.maxObjectsPerAnchor } : {},
          )
    const producerPromptFingerprint = producerReceipt.layer2?.promptFingerprint ?? null
    const promptDrift =
      currentPromptFingerprint !== null &&
      producerPromptFingerprint !== null &&
      currentPromptFingerprint !== producerPromptFingerprint
    reuseObservation = {
      detected: promptDrift,
      producerPromptFingerprint,
      currentPromptFingerprint,
      note: promptDrift
        ? '本次复用的对象是由**另一个版本的提示词**产出的。对象仍然有效（源版本未变），但不再是当前提示词会产出的东西。要按当前提示词重新产出，传 --rerun。'
        : '本次复用的对象由当前提示词产出。',
    }
    if (promptDrift) {
      process.stderr.write(
        `[提示词漂移] ⚠ 已落盘对象由 ${producerPromptFingerprint} 产出，而当前提示词是 ` +
          `${currentPromptFingerprint}——**两者不同**。\n` +
          '[提示词漂移] 本次仍然复用这批对象（它们对源文件依然有效），但它们不再是当前提示词会产出的东西。' +
          '要按当前提示词重新产出，传 --rerun；回执的 reuseObservation 里并排列着两个指纹。\n',
      )
    }

    // 仅在「本次要产出的门禁完成度」与既有回执一致时才回放。
    //
    // 为什么必须比对门禁完成度（实测踩到）：`--judge` 是一道显式指令，而回放判据只看了
    // 「版本 + 对象」。于是一份**只跑了确定性判据**的回执会把后续带 `--judge` 的运行挡在门外，
    // 返回一个「33 通过」而用户要的判定者从未运行——显式指令被静默吞掉。
    // 判据本身很简单：**要重扫判定者，就不能拿一份没扫过判定者的回执交差。**
    const wantsJudgeExplicitly =
      layer2Kind !== 'stub' && input.noJudge !== true && input.judge === true
    const replayGateMismatch = wantsJudgeExplicitly && fullGateReceipt === null
    if (sameVersionReceipt !== null && !replayGateMismatch) {
      // 同一版本、同一对象、同完成度 → 既有回执就是这批对象的判定结果，写任何新文件都只是噪音。
      //
      // 注意 `reuseObservation` 只加在**返回给调用方的对象**上，**不写盘**：
      // 盘上那份回执是**产出者**的记录，它的内容不该随「谁在什么时候读了一遍」而改变。
      // 把本次的观察写回去，会让同一份文件在不同时刻显示不同的东西——那正是本项目
      // 「回执是运行事实的凭证」这条约束要挡的。
      // 代价是：审计平面上看不到这次漂移观察，只有运行者会看到 stderr 告警。
      // 让它在盘面上可见需要给运行身份定清楚（见工单的待定项），不在此处顺手改。
      return {
        exitCode: sameVersionReceipt.counts?.rejected > 0 ? EXIT.OBJECT_REJECTED : EXIT.PASS,
        receipt: { ...sameVersionReceipt, reuseObservation: reuseObservation },
        reused: true,
        producerReceiptPath: layer2.reused.receiptPath,
        stderr: null,
      }
    }

    // 走到这里说明**判定口径变了**（流水线版本不同），或者**本次明确要求重扫判定者**
    // 而既有回执没扫过。两种情形都：旧回执记的计数不再代表现状，必须重判，
    // 但**不必重跑第 2 层**——对象没变，变的只是判它们的那把尺子。
    // 重判会落到新的 runId 上，因此旧回执原样保留，新旧判定结果可并存对比。
    const judgeWillRun = wantsJudgeExplicitly
    process.stderr.write(
      `[判据升级重判] 已落盘对象由 v${producerReceipt.pipelineVersion ?? '?'} 的判据判过；` +
        `本次用 v${PIPELINE_VERSION} 的判据重判，不重跑第 2 层。\n` +
        (judgeWillRun
          ? '[判据升级重判] 本次**同时重扫判定者**（收到 --judge）：会产生真实判定者调用，' +
            '但不重跑第 2 层。\n'
          : '[判据升级重判] 本次**只用确定性判据**（重判路径默认不产生模型调用）。' +
            '要只重扫判定者而不重跑第 2 层，传 --judge；要连第 2 层一起重跑，传 --rerun。' +
            '回执的 verificationGate 会写明本次门禁只完成了哪一半。\n') +
        // 覆盖必须说出来。同一批对象、同一版本下，两次运行的 runId 相同，
        // 因此门禁完成度不同的两份回执**无法并存**——后一份会顶掉前一份。
        // 而且它不是前一份的超集：确定性-only 那次判它通过的，全覆盖那次可能判它不通过，
        // 两份记的 `counts` 因此不同。**静默覆盖掉一个仍然成立的运行事实，是不可接受的；
        // 让它可见是当前设计的底线。** 根本解法（把门禁完成度纳入 runId，使两者并存）另案拍板。
        // 只在「确实存在一份确定性-only 的既成回执」时才说并存——版本不同而根本没有回执时，
        // 这里没有第二份可谈，说了反而误导。
        (replayGateMismatch && deterministicGateReceipt !== null
          ? `[判据升级重判] 既有回执 ${deterministicGateReceipt.runId ?? deterministicGateRunId} 是` +
            '「deterministic-only」；本次写「gate-1-full」那份，**两份并存**（门禁完成度进 runId）。' +
            '两份记的计数不同，各自代表同一批对象在两组判据下的结论。\n'
          : ''),
    )
    skipArtifactWrite = true
    layer2 = {
      ...layer2,
      // 生产事实沿用产出者的：重判不该把「花了多少次调用」改写成 0。
      ledger: {
        ...createUsageLedger(),
        calls: producerReceipt.model?.calls ?? 0,
        failedCalls: producerReceipt.model?.failedCalls ?? 0,
        retries: producerReceipt.model?.retries ?? 0,
        tokens: {
          input: producerReceipt.model?.tokens?.input ?? 0,
          output: producerReceipt.model?.tokens?.output ?? 0,
        },
        tokensDetail: {
          reasoning: producerReceipt.model?.tokensDetail?.reasoning ?? 0,
          cachedInput: producerReceipt.model?.tokensDetail?.cachedInput ?? 0,
        },
        note:
          '本次为**判据升级后的重判**：未发出任何模型调用；calls/tokens 沿用它产出时的实测值，' +
          '不是本次的开销。',
      },
      resumedFrom: producerReceipt.layer2?.resumedFrom ?? null,
      promptFingerprint: producerReceipt.layer2?.promptFingerprint ?? null,
      configSource: producerReceipt.model?.configSource ?? null,
      routeLabel: producerReceipt.model?.provider ?? null,
      // **逐锚点明细与按章用量同样是生产事实，必须一并沿用。**
      // 此前只沿用了 ledger，`perAnchor` 留在空数组上——于是「哪个锚点被处理过、哪个锚点
      // 一个对象都没产出」这条信号在重判路径上**整体消失**（实测）。而重判路径恰恰是
      // 「同一批对象、只看换尺子之后结论怎么变」时最常走的路径：正是最需要按锚点看的时候。
      perAnchor: Array.isArray(producerReceipt.layer2?.perAnchor) ? producerReceipt.layer2.perAnchor : [],
    }
  }

  // ---- 产出对象平面（先落盘、后验证：被拒对象也在盘上，失败可归因到具体环节） ----
  const objectsText = JSON.stringify(layer2.objects, null, 2) + '\n'
  const newObjectsSha = `sha256:${sha256Hex(objectsText)}`
  let archivedPrevious = null
  if (skipArtifactWrite) {
    // 重判：对象是在盘上的既成事实，一律不动（连字节相同的重写都不做，免得改变 mtime 误导人）。
  } else if (previousObjectsRaw !== null && previousObjectsSha !== newObjectsSha) {
    // 新旧产出不同：旧产出挪进 history/，两份都留得住（不静默覆盖）。
    const histRel = historyPathFor(index.fileKey, previousObjectsSha)
    const histAbs = path.join(repoRoot, histRel)
    await mkdir(path.dirname(histAbs), { recursive: true })
    await rename(objectsAbs, histAbs)
    archivedPrevious = { path: histRel, sha256: previousObjectsSha, bytes: Buffer.byteLength(previousObjectsRaw, 'utf8') }
  }
  if (!skipArtifactWrite) await writeJson(objectsAbs, layer2.objects)

  // ---- 第 3 层：机器验证（独立阶段；只接收对象与第 1 层产物） ----
  //
  // 判定者何时启用（ADR-010 决策 3 的落地）：
  //   - 本次**真的产出了新对象**（重判/复用路径不启用）。那条路径对用户承诺过
  //     「不重跑第 2 层、不产生任何模型调用」，在那里顺手调判定者会让这句承诺变成假话，
  //     也会让「重判不花钱」的直觉失效。要连判定者一起重跑，走 --rerun。
  //   - 第 2 层不是替身（替身路径零凭据零网络，判定者无从调用）。
  //   - **注入的第 2 层传输有配套的判定者传输**。这条是防呆，不是洁癖：调用方注入
  //     `chatImpl` 就是在声明「这次不碰真网」，此时判定者若静默回落到真实 `chatCompletion`，
  //     就会从一次本应离线的运行里发出真实计费请求（实测踩到：测试跑到 DNS 解析才暴露）。
  //     宁可关掉并写明，不可偷偷联网。
  //   - 未被 --no-judge 显式关掉。
  //
  // 上述都是**缺省**。`--judge` 可以把判定者显式打开——它存在是因为「对象没变、只换了尺子」
  // 正是重判路径的本职：卡 05 本身就是一次判据升级（新增了一组判据），若重判永远用不上
  // 判定者，那么「升级判据后对着同一批对象重判」这条能力就永远缺一半，只能靠 --rerun
  // 连第 2 层一起重跑，白花一遍提取的钱。
  const injectedTransport = input.chatImpl !== undefined && input.chatImpl !== null
  const judgeTransportReady = !injectedTransport || typeof input.judgeChatImpl === 'function'
  const explicitJudge = input.judge === true && input.noJudge !== true

  const judgeDisabledReason =
    layer2Kind === 'stub'
      ? '第 2 层为确定性替身（零凭据、零网络），判定者无从调用'
      : input.noJudge === true
        ? '显式传入 --no-judge'
        : !judgeTransportReady
          ? '注入了第 2 层传输（chatImpl）却未注入判定者传输（judgeChatImpl）——判定者不做真实回调，故本次关闭'
          : skipArtifactWrite === true
            ? '本次为复用/重判路径，第 2 层未发出任何调用；该路径默认不产生模型调用（要连判定者一起重扫请传 --judge，要连第 2 层一起重跑请传 --rerun）'
            : null

  const judgeRequested = explicitJudge || judgeDisabledReason === null
  let judgeConfig = null
  const judgeLedger = createUsageLedger()
  if (judgeRequested) {
    judgeConfig = await resolveJudgeLlmConfig({
      env: input.env,
      overrides: buildProducerOverrides(input),
      judgeOverrides: buildJudgeOverrides(input),
    })
  }

  const verification = await verifyObjects(layer2.objects, index, {
    repoRoot,
    judgeFn: judgeRequested
      ? (args) => judgeObject({ ...args, chat: input.judgeChatImpl, maxAttempts: input.maxAttempts })
      : null,
    judgeConfig,
    judgeLedger,
    judgeAll: input.judgeAll === true,
  })

  // ---- 回执 ----
  const runId = computeRunId({
    sourceHash: index.sourceHash,
    modelId: layer2.modelId,
    objects: layer2.objects,
    // 本次运行**实际**有没有跑判定者——它决定 runId，因此两份门禁不同的回执各有其名、互不覆盖。
    judgeApplied: judgeRequested,
  })
  const receiptRel = receiptPathFor(runId)
  const anchorsRel = path.relative(repoRoot, anchorsAbs)

  // ---- 切分的可审计面（ticket 07）----
  // 只列**真的被切过**的锚点。缺省预算下全书没有锚点会被切分（实测最大锚点 16,718 字节
  // < 24,000），因此这一栏通常为空数组——「为空」本身就是一条可核对的结论：
  // 它说明这次运行的每个对象都来自一次看完整节的调用，而不是来自碎片。
  const splits = layer2.perAnchor
    .filter((a) => (a.sliceCount ?? 1) > 1)
    .map((a) => ({
      anchor: a.anchor,
      sliceCount: a.sliceCount,
      oversizedSlices: a.oversizedSlices ?? [],
      slices: (a.slices ?? []).map((s) => ({
        index: s.index,
        lineStart: s.lineStart,
        lineEnd: s.lineEnd,
        bytes: s.bytes,
        oversized: s.oversized,
        objectCount: s.objectCount,
      })),
    }))

  // ---- 覆盖数与零产出锚点（ticket 07）----
  // 从「对象 × 索引」反推，而不是读 `perAnchor`——理由见 computeAnchorCoverage 的注释：
  // `perAnchor` 在复用/重判路径上是空的，读它会让这个信号在那两条路径上整体消失。
  const coverage = computeAnchorCoverage(layer2.objects, index, {
    processedAnchors: layer2.perAnchor.length > 0 ? layer2.perAnchor.length : null,
  })

  // ---- 第 2 层按章用量（ticket 07）----
  const layer2Usage = summarizeLayer2Usage(layer2.perAnchor, {
    ledgerCalls: layer2.ledger.calls,
    ledgerFailedCalls: layer2.ledger.failedCalls,
  })

  // ---- 第 2 层原始响应：只在真有原文时落盘（替身没有原文，因此替身路径不产生该文件） ----
  let rawRel = null
  if (layer2.rawByAnchor !== null) {
    rawRel = layer2RawPathFor(runId)
    await writeJson(path.join(repoRoot, rawRel), {
      schemaVersion: 'layer2-raw/v1',
      runId,
      createdAt,
      modelId: layer2.modelId,
      configSource: layer2.configSource,
      promptFingerprint: layer2.promptFingerprint ?? null,
      maxAnchorBytes: Number.isFinite(input.maxAnchorBytes) ? input.maxAnchorBytes : DEFAULT_MAX_ANCHOR_BYTES,
      note: '第 2 层的**原始响应**，未经第 3 层修正。用于把失败归因到具体锚点与具体响应。',
      anchors: layer2.rawByAnchor.map((a) => ({
        anchor: a.anchor,
        lineStart: a.lineStart,
        lineEnd: a.lineEnd,
        objectIds: a.objectIds,
        usage: a.usage,
        finishReason: a.finishReason,
        reasoningChars: a.reasoningChars,
        derivedFieldsIgnored: a.derivedFieldsIgnored,
        sliceCount: a.sliceCount ?? 1,
        oversizedSlices: a.oversizedSlices ?? [],
        usageTotals: a.usageTotals ?? null,
        // 多片时 `rawText` 为 null（一次调用回的原文不能被拼成一个字符串），
        // 每一片的原文各在 `slices[].rawText` 里——按片归因，不伪造一次调用的假象。
        rawText: a.rawText,
        slices: (a.slices ?? []).map((s) => ({
          index: s.index,
          lineStart: s.lineStart,
          lineEnd: s.lineEnd,
          bytes: s.bytes,
          oversized: s.oversized,
          objectIds: s.objectIds,
          objectCount: s.objectCount,
          usage: s.usage,
          finishReason: s.finishReason,
          reasoningChars: s.reasoningChars,
          rawText: s.rawText,
        })),
      })),
      reasoningPolicy:
        '本文件只保存模型返回的 content（第 2 层的产物），**不保存推理正文**（reasoning_content）。' +
        '理由：推理正文是生产者的思维链，ticket 05 要求判定者看不到它；把它写到盘上等于给它留了回流路径。' +
        '只记 reasoningChars 长度，足以判断「输出很少却很贵」是不是推理吃掉了额度。',
    })
  }

  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    runId,
    createdAt,
    source: {
      path: index.sourceFile,
      hash: index.sourceHash,
      totalLines: index.totalLines,
    },
    layer2: {
      kind: layer2Kind,
      resumedFrom: layer2.resumedFrom ?? null,
      reused: layer2.reused !== null,
      note:
        layer2.reused !== null
          ? '本次**未调用模型**：直接复用已落盘的对象（卡 04 的「产出落盘固化」）。要重新产出请显式传 --rerun。'
          : layer2Kind === 'stub'
            ? '第 2 层为确定性替身：本卡不发出任何真实模型调用。'
            : '第 2 层为真实模型：本次产生了真实调用与 token 消耗。',
      reusedFrom: layer2.reused,
      promptFingerprint: layer2Kind === 'stub' ? null : (layer2.promptFingerprint ?? null),
      perAnchor: layer2.perAnchor.map((a) => ({
        anchor: a.anchor,
        lineStart: a.lineStart,
        lineEnd: a.lineEnd,
        objectCount: a.objectIds.length,
        objectIds: a.objectIds,
        // 逐锚点用量与切分信息一并带上：`layer2.usage.byAnchor` 与 `layer2.splits` 都从
        // 这一份明细派生，而**顶层的 `coverage` 不从它派生**（理由见 computeAnchorCoverage）。
        // 两处并存是刻意的：一处答「跑了什么」，一处答「留下了什么」，两者对不上就是线索。
        sliceCount: a.sliceCount ?? 1,
        usageTotals: a.usageTotals ?? null,
      })),
      splits,
      usage: layer2Usage,
    },
    model: {
      provider:
        layer2Kind === 'stub'
          ? 'stub'
          : (layer2.routeLabel ?? layer2.reused?.provider ?? 'unrecorded'),
      modelId: layer2.modelId,
      calls: layer2.ledger.calls,
      tokens: { input: layer2.ledger.tokens.input, output: layer2.ledger.tokens.output },
      // 单列：推理型模型把思维链计入 completion，不单列就无法解释「输出很少却贵」。
      tokensDetail: {
        reasoning: layer2.ledger.tokensDetail.reasoning,
        cachedInput: layer2.ledger.tokensDetail.cachedInput,
      },
      failedCalls: layer2.ledger.failedCalls,
      retries: layer2.ledger.retries,
      usageNote: layer2.ledger.note,
      billing:
        layer2Kind === 'stub'
          ? 'none（本次未发出任何真实模型调用；零凭据、零网络）'
          : layer2.reused !== null
            ? 'none（本次复用冻结产物，未发出任何真实模型调用）'
            : 'real（真实模型调用，按服务商计费）',
      configSource: layer2.configSource,
      // 档位单列，**与 configSource.reasoningEffort 并排**：前者是生效值，后者是来源。
      // 批次一的实测症状正出在这里——判定者层的档位看得见，生产者层的看不见，
      // 于是一次「名义上低档、实际默认档」的运行在回执上没有任何破绽。
      reasoningEffort: layer2.reasoningEffort ?? null,
      fixture: layer2.fixture,
    },
    // 判定者判据的可审计面（ticket 05）。四项缺一不可：
    //   「谁判的」（modelId + promptFingerprint + instanceIdPrefix）、
    //   「判了几次」（calls/tokens，与第 2 层分开记账）、
    //   「同模型自审这件事可见」（sameModelAsProducer，ADR-010 决策 1 的缓解措施）、
    //   「覆盖了哪些对象」（scope + 逐对象明细在 objectVerdicts[].judge）。
    judge: judgeRequested
      ? {
          implemented: true,
          enabled: true,
          ...describeJudgeRoute(judgeConfig, judgeLedger),
          scope: input.judgeAll === true ? 'all-objects' : 'deterministic-survivors-only',
          scopeNote:
            input.judgeAll === true
              ? '本次对所有对象都调了判定者（--judge-all），交叉表见 crossTab。'
              : '默认短路（ADR-010 决策 3）：已被确定性判据拒绝的对象未送判定者，其明细标注 not-called。',
          summary: verification.summary.judge,
          crossTab: verification.summary.crossTab,
          billing: 'real（判定者调用真实模型；与第 2 层分开记账，两笔都能单独看到）',
        }
      : {
          implemented: true,
          enabled: false,
          reason: judgeDisabledReason,
          note:
            '本次**未应用判定者判据**：本次的 passed 只代表过了确定性判据，' +
            '不代表过了第 3 层的全部判据——规格 D6 要求两组判据同权。',
        },
    artifacts: {
      anchors: await artifactRef(repoRoot, anchorsRel, { anchorCount: index.anchorCount }),
      objects: {
        path: objectsRel,
        sha256: newObjectsSha,
        bytes: Buffer.byteLength(objectsText, 'utf8'),
        objectCount: layer2.objects.length,
        ...(archivedPrevious === null ? {} : { archivedPrevious }),
      },
      layer2Raw: rawRel === null ? null : { path: rawRel, sha256: `sha256:${sha256Hex(await readFile(path.join(repoRoot, rawRel), 'utf8'))}` },
    },
    counts: {
      anchors: index.anchorCount,
      objects: verification.summary.total,
      passed: verification.summary.passed,
      rejected: verification.summary.rejected,
      // 类型分布（ticket 07）。九类**全给**，含 0——缺一个键与「这一章没有这一类产出」
      // 是两条不同的信息，而前者会让人对着一个空位猜。
      objectTypes: computeTypeDistribution(layer2.objects),
    },
    // 覆盖数与**零产出锚点**（ticket 07 的固定字段）。
    // 它替代了「去 `perAnchor` 里翻 `objectCount: 0`」那种靠人眼找的做法：
    // `coverage.withoutObjects.count` 是一个可以直接进断言、进告警、进趋势图的数字，
    // 而它算在**每条路径**上（对象 × 索引，不依赖 `perAnchor`）。
    //
    // 读法：`coveredAnchors < indexAnchors` 就说明有整节没有产出任何对象。
    // **它不是错误，是一份需要人看的清单**——`h2-8`（本章小结）与 `h2-9`（思考题）
    // 这类末节确实可能不承载任何知识对象，那正是「正确的零产出」；而一个正文节
    // 出现在这份清单里，则几乎一定是漏抽。区别只能靠人看清单，不能靠阈值。
    coverage,
    reasonCodes: {
      // 从 verifier 的真源取，不在回执里手抄一份——手抄的词表会在新增理由码时静默过期，
      // 而验收项恰恰是「回执里的理由码落在封闭词表内」，两者不同步就等于该验收项永远为真。
      vocabulary: [...REASON_CODES],
      byCode: verification.summary.byReasonCode,
    },
    // 门禁完成度。判定者未启用时**必须**在这里写明，不能只写进 note：
    // `passed` 的含义随它而变，读回执的人据此决定要不要复核。
    verificationGate: judgeRequested ? VERIFICATION_GATE.FULL : VERIFICATION_GATE.DETERMINISTIC_ONLY,
    // 提示词漂移的观察**写进本次运行自己写的回执**（它有主，写进去不污染别人的记录）。
    // 纯回放路径没有自己的回执可写，那一处只出 stderr 告警——理由见那边的注释。
    reuseObservation: reuseObservation ?? null,
    objectVerdicts: verification.verdicts,
    contentProblems: verification.summary.rejected,
    engineeringFailure: null,
  }

  await writeJson(path.join(repoRoot, receiptRel), receipt)

  return {
    exitCode: receipt.counts.rejected > 0 ? EXIT.OBJECT_REJECTED : EXIT.PASS,
    receipt,
    stderr: null,
  }
}

/**
 * 运行失败的统一回执（也落盘，使「工程问题」留下可查的证据而非只在终端一闪而过）。
 *
 * `judge` 与 `model` 两块**不能写成常量**：本函数原先无条件写 `judge.enabled: false` 与
 * `calls: 0`，而失败是可能发生在**判定者已经跑了若干次之后**的（实测：v7 补全门禁时，
 * 判定者回了不可解析的 JSON，运行中止）。那时回执写的是「判定者未运行」、
 * 而实际已经花掉的判定者调用**记在哪个数上都不是 0**——这正是「本地账本把真实消耗显示成 0」
 * 的形态。判断能给出的只有「这次失败发生在哪一阶段」，因此就只写到这个精度：
 * `judge.failedInJudgePhase` 说明「判定者也跑过」，`calls` 保持 0 并**显式标注它只是未知**，
 * 而不是让 0 冒充事实。
 */
function failureReceipt({ runId, kind, message, sourcePath }) {
  const failedInJudgePhase = kind === 'judge-response'
  return {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    pipelineVersion: PIPELINE_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    source: { path: sourcePath ?? null, hash: null, totalLines: null },
    layer2: {
      kind: null,
      reused: false,
      note: null,
      reusedFrom: null,
      perAnchor: [],
      splits: [],
      usage: null,
    },
    model: {
      provider: null,
      modelId: null,
      calls: 0,
      tokens: { input: 0, output: 0 },
      tokensDetail: { reasoning: 0, cachedInput: 0 },
      failedCalls: 0,
      retries: 0,
      usageNote:
        '运行在写下用量之前就失败了，因此这里的 0 **不是「没有消耗」**，而是「没有记账」——' +
        '真实的调用次数与 token 只能去服务商侧对账。',
      billing: 'unknown（失败路径没有记账，不得读成 none）',
      configSource: null,
      fixture: null,
    },
    judge: failedInJudgePhase
      ? { enabled: true, failedInJudgePhase: true, reason: '判定者已运行并在其阶段失败；本次的判定者判据没有完整结果' }
      : { enabled: false, failedInJudgePhase: false, reason: '运行在验证阶段之前就失败了，判定者未运行' },
    artifacts: {},
    counts: { anchors: 0, objects: 0, passed: 0, rejected: 0, objectTypes: null },
    // 运行在验证阶段之前就失败了 → 这两块**没有观测值**。给 `null` 而不是空对象/零，
    // 是为了让「答不了这个问题」与「答案是 0 个」在回执上仍然可区分。
    coverage: null,
    reasonCodes: { vocabulary: [], byCode: {} },
    objectVerdicts: [],
    contentProblems: 0,
    engineeringFailure: { kind, message },
  }
}

/** 失败分类：把「谁的错」判出来，使退出码 4 的成因不靠人读日志。 */
function classifyFailure(err, { fixturePath }) {
  if (err instanceof SourcePathError) return 'path-guard'
  if (err instanceof StubModelError) return 'layer2-model-stub'
  if (err instanceof LlmConfigError) return 'llm-config'
  // 截断要单列：它的修法是「调大 maxTokens 重跑」，与「服务端拒绝」「网络不通」不同。
  if (err instanceof LlmCallError && err.truncated === true) return 'layer2-truncated'
  if (err instanceof LlmCallError) return 'layer2-llm-call'
  if (err instanceof Layer2Error) return 'layer2-response'
  // 判定者的响应问题与第 2 层同源（模型回了不合契约的文本），但**修法不同**：
  // 一个要改提取提示词，一个要改判定提示词。混成一类会让「该改哪一边」回到读日志去猜。
  if (err instanceof JudgeError) return 'judge-response'
  if (fixturePath !== null && String(err?.message).includes(fixturePath)) return 'objects-fixture-missing'
  if (err?.code === 'ENOENT') return 'source-missing'
  return 'internal'
}

export const FAILURE_KINDS = Object.freeze([
  'path-guard',
  'layer2-model-stub',
  'llm-config',
  'layer2-truncated',
  'layer2-llm-call',
  'layer2-response',
  'judge-response',
  'objects-fixture-missing',
  'source-missing',
  'internal',
])

async function main(argv) {
  let parsed
  try {
    parsed = parseArgs(argv)
  } catch (err) {
    process.stderr.write(
      `参数错误：${err.message}\n` +
        '用法：node pipeline/run.mjs <内容源.md> [--json] [--repo-root <dir>] [--objects-fixture <file>]\n' +
        '      [--layer2 stub|deepseek] [--rerun] [--no-resume] [--max-tokens <n>] [--max-objects-per-anchor <n>]\n' +
        '      [--max-anchor-bytes <n>] [--llm-model <id>] [--llm-base-url <url>] [--llm-provider <name>]\n' +
        '      [--judge] [--no-judge] [--judge-all] [--judge-model <id>] [--judge-base-url <url>] [--judge-provider <name>]\n' +
        '  判定者（第 3 层的第二组判据）缺省与第 2 层同路由；--judge-all 对所有对象都判（含已被\n' +
        '  确定性判据拒绝的），产出两组判据的交叉表；--no-judge 显式关掉（回执会写明门禁不完整）。\n' +
        `  --max-anchor-bytes 是单个锚点的正文预算（字节，缺省 ${DEFAULT_MAX_ANCHOR_BYTES}）：超过它才按**段落边界**\n` +
        '  切分（绝不按字节硬切、绝不在代码围栏内切）。全书最大锚点 16,718 字节，故缺省下不会触发。\n' +
        `  换算（实测 ${BYTES_PER_INPUT_TOKEN_MEASURED} 字节/输入 token + ${INPUT_TOKEN_OVERHEAD_MEASURED} token 固定开销）：\n` +
        `  缺省预算 ≈ ${Math.round(INPUT_TOKEN_OVERHEAD_MEASURED + DEFAULT_MAX_ANCHOR_BYTES / BYTES_PER_INPUT_TOKEN_MEASURED)} 输入 token；` +
        `全书最大锚点 ≈ ${Math.round(INPUT_TOKEN_OVERHEAD_MEASURED + 16718 / BYTES_PER_INPUT_TOKEN_MEASURED)} 输入 token。\n`,
    )
    return EXIT.RUN_FAILED
  }

  const { flags, positional } = parsed
  const target = positional[0]
  if (!target) {
    process.stderr.write(
      '用法：node pipeline/run.mjs <内容源.md> [--json]\n' +
        `内容源必须位于 ${DEFAULT_SOURCE_ROOT}/ 之内。\n`,
    )
    return EXIT.RUN_FAILED
  }

  // 与 runPipeline 同口径归一，使 catch 里的夹具缺失判定能对上真实的绝对路径。
  const repoRoot = resolveRealPath(flags.repoRoot)
  const fixturePath = flags.objectsFixture ? path.resolve(repoRoot, flags.objectsFixture) : null

  try {
    const out = await runPipeline(buildRunInput(flags, { target, repoRoot }))
    const { exitCode, receipt } = out
    if (out.reused) {
      process.stderr.write(
        `[产出固化] 本次未调用模型，直接复用已落盘对象；回执仍是由产出它们的运行写下的那一份：${out.producerReceiptPath}\n` +
          '要基于当前正文重新产出，请显式传 --rerun（会产生模型调用）。\n',
      )
    }
    if (flags.json) process.stdout.write(JSON.stringify(receipt, null, 2) + '\n')
    else
      process.stdout.write(
        `${receipt.source.path}：锚点 ${receipt.counts.anchors}，对象 ${receipt.counts.objects}` +
          `（通过 ${receipt.counts.passed} / 拒绝 ${receipt.counts.rejected}）` +
          `［第 2 层 ${receipt.layer2.kind}${receipt.layer2.reused ? '·复用冻结产物' : ''}，` +
          `调用 ${receipt.model.calls} 次，token ${receipt.model.tokens.input}+${receipt.model.tokens.output}］` +
          // 判定者的用量单独报：它与第 2 层分开记账，合并成一个数字就无法回答
          // 「判定者花了多少」——而 ADR-009 定档时两层都要评估。
          (receipt.judge.enabled
            ? `［判定者 ${receipt.judge.modelId}，调用 ${receipt.judge.calls} 次，` +
              `token ${receipt.judge.tokens.input}+${receipt.judge.tokens.output}，` +
              `判定 ${JSON.stringify(receipt.judge.summary.verdicts)}，` +
              `未判 ${receipt.judge.summary.notCalled}］\n`
            : `\n⚠ 本次未应用判定者判据（${receipt.judge.reason}）：` +
              `「通过」只代表过了确定性判据。门禁完成度：${receipt.verificationGate}\n`) +
          // 覆盖数**每行都打**，不是只在出问题时打：「本次覆盖了 20/20」是一条可核对的结论，
          // 而只在有零产出时才出声，会让人分不清「没有零产出」与「这一版根本没统计」。
          (receipt.coverage === null || receipt.coverage === undefined
            ? ''
            : `覆盖：${receipt.coverage.coveredAnchors}/${receipt.coverage.indexAnchors} 个锚点有产出` +
              (receipt.coverage.withoutObjects.count > 0
                ? `；⚠ ${receipt.coverage.withoutObjects.count} 个锚点**` +
                  (receipt.coverage.processedKnown
                    ? '被处理但产出 0 个对象'
                    : '没有任何对象指向它') +
                  `**：${receipt.coverage.withoutObjects.anchors.join('、')}\n` +
                  '  （这不必然是错误——本章小结/思考题这类末节本就可能不承载知识对象；' +
                  '要人看这份清单，不能靠阈值。）\n'
                : `（无零产出锚点）\n`) +
              (receipt.coverage.processedKnown || receipt.coverage.withoutObjects.count === 0
                ? ''
                : `  已处理锚点数未知：本次第 2 层未按锚点发起调用（${receipt.layer2.kind} 路径），` +
                  '因此上面这份清单是「没有被指向」的锚点，不等于「被处理过却没产出」的锚点。\n') +
              (receipt.layer2.splits?.length > 0
                ? `切分：${receipt.layer2.splits.length} 个锚点超预算被按段落边界切开：` +
                  `${receipt.layer2.splits.map((s) => `${s.anchor}→${s.sliceCount} 片`).join('、')}\n`
                : '')) +
          `对象：${receipt.artifacts.objects.path}\n回执：${receiptPathFor(receipt.runId)}\n`,
      )
    return exitCode
  } catch (err) {
    const kind = classifyFailure(err, { fixturePath })
    const runId = `run-failed-${sha256Hex(String(err.message)).slice(0, 12)}`
    const receipt = failureReceipt({
      runId,
      kind,
      message: err.message,
      sourcePath: target,
    })
    try {
      await writeJson(path.join(repoRoot, receiptPathFor(runId)), receipt)
      // 响应不可解析时，把原文一并落盘——否则「模型到底回了什么」永久丢失。
      // 判定者走同一条：JudgeError 同样带 rawText，但此前**只有** Layer2Error 被落盘，
      // 于是实测中判定者那次失败的原文本被丢掉，只能从一行错误消息去猜，无法归因。
      if (err instanceof Layer2Error && typeof err.rawText === 'string') {
        await writeJson(path.join(repoRoot, layer2RawPathFor(runId)), {
          schemaVersion: 'layer2-raw/v1',
          runId,
          createdAt: new Date().toISOString(),
          note: '第 2 层响应解析失败时的**原文**，用于事后归因。',
          error: err.message,
          rawText: err.rawText,
        })
      }
      if (err instanceof JudgeError && typeof err.rawText === 'string') {
        await writeJson(path.join(repoRoot, judgeRawPathFor(runId)), {
          schemaVersion: 'judge-raw/v1',
          runId,
          createdAt: new Date().toISOString(),
          note: '判定者响应解析失败时的**原文**，用于事后归因。',
          error: err.message,
          rawText: err.rawText,
        })
      }
    } catch {
      // 连回执都写不下去时不再掩盖原始错误
    }
    process.stderr.write(`运行失败（${kind}）：${err.message}\n`)
    if (flags.json) process.stdout.write(JSON.stringify(receipt, null, 2) + '\n')
    return EXIT.RUN_FAILED
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv)
}
