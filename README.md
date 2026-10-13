# any2skills

Any content → executable Agent Skills. MVP pipeline.

**当前状态**：环 1–2 已跑通（源文件 → 锚点索引 → 知识对象 → 机器验证，含独立判定者）。
**环 3 已跑通**（章内语义聚类 + 技能候选：13 章 / 115 单元 / 40 候选，593 个对象全归类；
见 [`docs/tickets/11-ring3-semantic-clustering.md`](docs/tickets/11-ring3-semantic-clustering.md)）。
**环 4 已实现（确定性装配 + 门禁一 skill 侧）**，两种入口并存：手工子树（`--root-anchor`）与
**环 3 的划分产物（`--cluster`，已支持跨章候选）**。环 5 的**门禁二已建成并跑出三读数 +
一轮按反馈的重切**：两口径对照得 87 对稳定共认领 → 执行 11 对合并（候选 40→29）→
第三读数**部分消解**（共认领 78→46）——合并的边际收益已到顶，下一层是**收敛描述**；
全过程见 [`docs/tickets/12-gate2-trigger-blind-test.md`](docs/tickets/12-gate2-trigger-blind-test.md)
与 [`docs/tickets/13-ring3-resplit-from-gate2.md`](docs/tickets/13-ring3-resplit-from-gate2.md)。
**门禁三（效用 A/B）已全量实测**（8 个发布物：4 通过 / 3 低效用 / 1 拒绝）：
首跑**排除** negative transfer，扩样**检出**一次确认的 negative transfer（chapter3-s1，
复跑复现）并按 ADR-006 拒绝下架——「唯一能检出 skill 有害」的定位第一次有真实产出；
三道门禁至此全部建成并实测
（[`docs/tickets/14-gate3-utility-ab.md`](docs/tickets/14-gate3-utility-ab.md)、
[`卡 17`](docs/tickets/17-gates-cover-new-publishes.md)）。
**MVP 验收 4 已达成**：产出经冻结（`freeze-outputs.mjs`）后由**独立于构建者的子代理**
完成与 `benchmark/` 22 个原书 skill 的比对——**正向覆盖 22/22，数量差异完成专项归因**
（发布门径 / 来源缺口 / 体积阈值，不诉诸「质量不够」），报告见
[`docs/specs/02-benchmark-report.md`](docs/specs/02-benchmark-report.md)。

> ### 盘上已有 7 个已发布的 skill
>
> `find . -path ./node_modules -prune -o -name "SKILL.md" -print` → `skills/` 下 7 个：
> `chapter4-tool-design-principles`（首个，卡 10/ADR-019）、`chapter4-single-tool-design`
> （环 3 端到端首件，卡 11），以及卡 16「打通发布门径」放行的 6 个中的 5 个：
> `chapter10-s3` / `chapter1-s1` / `chapter5-s3` / `chapter2-s3` / `chapter9-s2`
> （其中三个带 `references/` 溢出文件——ADR-004 溢出阀的首批产物）。
>
> ⚠ **`chapter3-s1` 已被门禁三拒绝并下架**（`pipeline/registry/rejected/chapter3-s1/`，
> 移动而非删除）：全量效用 A/B 检出**首个确认的 negative transfer**（任务 t2 复跑复现：
> 无 skill 过、有 skill 败），按 ADR-006 硬约束执行拒绝。发布区 8 → 7。
> 8 个发布物的门禁三判定（4 通过 / 3 低效用 / 1 拒绝）与门禁二登记表见
> [`卡 17`](docs/tickets/17-gates-cover-new-publishes.md)。
>
> 放行的三件依据（见 [`卡 16`](docs/tickets/16-publish-path.md)）：其余章配套代码
> **轻镜像**（README 100% 覆盖）、溢出阀实现、体积阈值**对齐原书实测上限**（
> [`ADR-028`](docs/adr/ADR-028-size-limit-aligned-to-source.md)）。
>
> 达成路径是三件事依次落地，**前两件不是放宽判据本身**：
> ① [ADR-020](docs/adr/ADR-020-source-expansion-chapter4-code.md) 扩充信息源——
> 上游 `chapter4/` 配套代码镜像进 `sources/ai-agent-book-zh/code/`
> （851 文件，逐文件哈希校验 851/851 一致，见
> [`MIRROR-MANIFEST.md`](sources/ai-agent-book-zh/code/chapter4/MIRROR-MANIFEST.md)），
> 「配套代码」段第一次有来源；② [ADR-021](docs/adr/ADR-021-section-item-counts-advisory.md)
> 把骨架条目数降为**建议值**——ADR-004 的「必须遵守的约束」从未把它列为硬约束，
> 而实测 chapter4 每簇最多 2 条反模式、整章也只有 5 条，6–8 出自作者人工写作；
> ③ [ADR-022](docs/adr/ADR-022-judge-vision-all-anchors.md) 把判定者的视野从
> 「主锚点那一段」扩到「对象声明的全部锚点区间」——**这一件是有意放宽判据**，
> 触发依据是一条可复现的假阴性（`AP-SYNTH-T02-01` 的拒绝理由要的那句话
> 逐字就在该对象第二条锚点里，旧契约让它按结构看不到）。
>
> ### 「通过」不等于「合格」
>
> 发布时该 skill 的 `## 常见陷阱` 只有 **1 条**（建议值 6）；ADR-022 落地后重建为 **3 条**，
> 新增的 2 条正是此前被旧判据误拒的两条跨章反模式。契约里仍带风险标记
> `PITFALL_COVERAGE_BELOW_ADVISORY`。它还带着 11 条缺口：1 条语义不符
> （「实践模式」装出来的是术语定义而非可操作模式）、1 条可疑触发条目、
> **7 个契约字段在当前对象模型下没有任何来源**（`inputContract`/`outputContract`/
> `tools`/`steps`/`stopConditions`/`rollback`/`tests`）、1 条粒度说明（配套代码段列的是
> 本章全部目录而非本簇专属）、1 条低覆盖。
>
> ⚠ **门禁二/三尚未构建，风险标记当前没有下游消费者。** 这是 ADR-021 留下的真实暴露面，
> 不该被「门禁通过了」这句话掩盖。
>
> 全部实测与未决项见 [`ADR-019`](docs/adr/ADR-019-ring4-deterministic-skill-assembly.md)、
> [`ADR-020`](docs/adr/ADR-020-source-expansion-chapter4-code.md)、
> [`ADR-021`](docs/adr/ADR-021-section-item-counts-advisory.md)、
> [`ADR-022`](docs/adr/ADR-022-judge-vision-all-anchors.md)。

## 三段式链路

```
内容源 .md
  │
  ├─ 第 1 层 确定性结构层（无 LLM）
  │     产出：锚点索引（行号区间 + 内容哈希）      → pipeline/knowledge/<file>.anchors.json
  │
  ├─ 第 2 层 LLM 综合层（全链路唯一非确定性环节）
  │     产出：类型化知识对象，强制带 sourceRefs + 逐字 evidenceQuote
  │                                              → pipeline/knowledge/<file>.objects.json
  │
  └─ 第 3 层 机器验证层（两组判据，同权，= 门禁一）
        ├─ 确定性判据：无 LLM，逐字节可复现
        └─ 判定者判据：LLM，独立实例、独立上下文、输入受限
                                               → pipeline/registry/run-<id>.receipt.json
```

关键区别只有一条，也是本项目与「让大模型直接读文档写 skill」的分界：**中间存在一个机器可判定的 IR**。
规格全文见 [`docs/specs/01-pipeline-spec.md`](docs/specs/01-pipeline-spec.md)，设计决策见 [`docs/adr/`](docs/adr/)。

## 运行

```bash
npm test                                    # 553 项，零网络、零凭据（实测 2026-10-13）

# 替身路径：零凭据、零网络、确定性产出（第 3 层的判定者判据不启用）
node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md

# 真实路径：需要模型凭据；产出真实对象，并调用判定者
node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md \
  --layer2 deepseek --llm-model deepseek-v4-pro --llm-base-url https://api.deepseek.com

# 环 3：语义聚类（逐章一次调用），产出内容单元与技能候选（卡 11）
node pipeline/propose-clusters.mjs --dry-run          # 只看规模与调用预算，零调用、零写盘
node pipeline/propose-clusters.mjs --model deepseek-v4-pro --base-url https://api.deepseek.com

# 环 4：把一批对象确定性装配成一个 SKILL.md，并跑门禁一（零模型调用）
node pipeline/build-skill.mjs --root-anchor chapter4#h2-2 \
  --slug chapter4-tool-design-principles --title "工具设计的通用原则" --dry-run
node pipeline/build-skill.mjs --cluster chapter4-s1 --dry-run   # 按环 3 的簇定义装配（ADR-024）

# 门禁二：触发盲测——场景生成 + 盲测两段分离（ADR-026；盲测题面只含 name+description）
node pipeline/run-gate2.mjs --dry-run          # 只看规模与调用预算，零调用、零写盘
node pipeline/run-gate2.mjs --model deepseek-v4-pro --base-url https://api.deepseek.com

# 全书：13 个源文件逐个跑，产出一份聚合回执 + 污染隔离检查（卡 09）
node pipeline/run-book.mjs --layer2 deepseek --concurrency 4 \
  --llm-model deepseek-v4-pro --llm-base-url https://api.deepseek.com \
  --judge-model deepseek-v4-pro --judge-base-url https://api.deepseek.com
node pipeline/run-book.mjs --layer2 stub            # 替身路径，零调用、离线可复跑
```

> **⚠ 漏掉 `--layer2 deepseek` 会静默覆盖真实产物。** `--layer2` 缺省是 `stub`，而**替身路径不检查已有产出**——
> 它会直接用 20 个替身对象（每个锚点一个）覆写 `pipeline/knowledge/<file>.objects.json`。
> 旧的一份会被归档进 `pipeline/knowledge/history/`，所以可恢复、不会永久丢失，但**你会先拿到一份假的产出**。
> 实测踩到过：换回复用真实产物后，一条漏了该开关的验证命令把 33 个真实对象换成了 20 个替身对象
> （从 history 按 sha 复原，见 `pipeline/registry/tier-probe/producer-default-3.objects.json`）。
> 真实路径的 `--rerun` 语义（缺省复用已落盘对象）**不适用于替身路径**。

常用开关：

| 开关 | 作用 |
|---|---|
| `--rerun` | 显式重跑第 2 层（**会重新花钱**；缺省复用已落盘对象） |
| `--judge` | 在重判路径上只重扫判定者，不重跑第 2 层 |
| `--no-judge` | 关掉判定者（回执会写明门禁只完成了一半） |
| `--judge-all` | 对所有对象都调判定者（含已被确定性判据拒绝的），产出两组判据的交叉表 |
| `--judge-model <id>` | 判定者路由独立于第 2 层，可单点覆盖 |
| `--llm-reasoning-effort <档>` | 生产者层推理档位：`low` / `high` / `max`。**缺省不发该字段**（跟随服务端默认），与「显式选了某档」在回执里可区分 |
| `--judge-reasoning-effort <档>` | 判定者层推理档位，独立于生产者；缺省继承生产者的档位 |
| `--max-anchor-bytes <n>` | 单个锚点的正文预算（缺省 24000 字节）：超过它才按**段落边界**切分。全书最大锚点 16,718 字节，故缺省下**无锚点被切分** |

推理档位也可用 `ANY2SKILLS_LLM_REASONING_EFFORT` / `ANY2SKILLS_JUDGE_REASONING_EFFORT` 设置。
非法取值**抛错而非静默回落**——静默忽略一个拼错的档位，会让一次「以为降档了」的对照跑出「其实没降」的结果。
两层各自可拨是刻意的：ADR-009 要求定档时同时评估两层。

退出码：`0` 全部通过；`3` 有对象被拒（流水线本身成功执行）；`4` 运行失败。
`3` 与 `4` 必须可区分——前者是内容问题，后者是工程问题。

### 全书运行（`run-book`，卡 09）

把一个目录下的全部源文件跑一遍，产出一份**聚合回执**（`book-receipt/v2`），并机械地证明
链路全程没读过盲测基准目录。

| 开关 | 作用 |
|---|---|
| `--concurrency <1..8>` | 文件级并发。上限 8 不是性能调优，是**别把自己打成限流** |
| `--layer2 stub\|deepseek` | 同 `run.mjs`；`stub` 为零调用路径 |
| `--dry-run` | 只枚举与打印，不跑 |
| `--json` | 聚合回执打到 stdout |
| `--repo-root <dir>` | 仓库根（用于无歧义地解析源目录与账本目录） |
| `--no-ledger` | 关掉访问账本。仍可运行，但回执写明账本缺席，`--verify-isolation` 会据此拒绝出结论 |
| `--from <book-receipt.json> [--file <key>]` | 不重跑，只从既有聚合回执出报表 |
| `--verify-isolation <book-receipt.json>` | 只复跑隔离检查，不重跑任何提取 |

`run.mjs` 的生产者/判定者开关可原样透传。

**隔离是落在代码里的，不靠使用者的纪律。** `run-book.mjs` 默认把自己用
`--require pipeline/tools/fs-ledger.cjs` 重新拉起（「账本自举」），并给每个子进程注入
`DSH_FS_LEDGER` 指向本文件账本；跑完再由 `--verify-isolation` 逐份账本断言
`benchmark/` 内**内容**访问为 0（只问路径的 `realpath`/`stat` 调用单列，不计入）与 `skills/` 写入为 0。

**单个文件失败不会中止整本书。** 某文件退出码为 `4` 时，其余文件照跑，聚合回执里逐文件记退出码，
顶层退出码取最坏值（见 `run-book.mjs` 的收敛规则）。第 2 层已完成的锚点会落 `<file>.layer2-raw.partial.json`，
**下一次运行自动从该处续跑**——失败的代价限于当次在飞的那个锚点。

## 第 3 层的理由码（封闭词表）

真源是 `pipeline/tools/verifier.mjs` 的 `REASON_CODES`；回执里的 `reasonCodes.vocabulary`
从该真源生成，不另抄一份（手抄的词表会在新增理由码时静默过期）。
码的粒度与**修复责任方**对齐：

| 理由码 | 含义 | 修复方 |
|---|---|---|
| `REFERENCE_MISSING` | 无 `sourceRefs`。无豁免 | 第 2 层输出契约 |
| `IDENTIFIER_INVALID` | 对象 id 不合既有正则 | 第 2 层输出契约 |
| `REFERENCE_UNRESOLVED` | 出处解析不到第 1 层锚点 | 第 1 层锚点索引 |
| `SOURCE_VERSION_DRIFT` | 依赖的锚点内容哈希已变 | 重跑第 1 或第 2 层 |
| `SCHEMA_INVALID` | 不合该类型的 schema | 第 2 层提示词 / 输出契约 |
| `QUOTE_MISSING` | 未携带 `evidenceQuote` | 第 2 层输出契约 |
| `QUOTE_MISMATCH` | 引文未命中锚点区间 | 第 2 层（最可能改写了原文） |
| `JUDGE_NOT_SUPPORTED` | 判定者判为**不支撑** | 第 2 层输入组织方式（引文选错了） |
| `JUDGE_INSUFFICIENT` | 判定者判为**不充分** | 锚点切分（证据不足）或第 2 层（主张写得比证据宽） |

### `QUOTE_MISSING` 为什么单列一条码

规格 D7 只规定了五类理由码的粒度，没有这一项。本层把它单列，理由是它的**修复动作**与
`QUOTE_MISMATCH` 不同：

- `QUOTE_MISSING` = 对象**根本没带**引文 → 改输出契约（要求必须带）；
- `QUOTE_MISMATCH` = 带了引文但**对不上原文** → 改归纳方式（别改写原文）。

前者是「没给」，后者是「给错了」。若合并成一条，回执的拒绝分布就无法区分
「提示词漏了字段要求」与「模型改写了原文」——而这两件事一个改 schema、一个改提示词措辞。

### 引文同时承担两个用途

`evidenceQuote` 不只是「防编造凭证」，它同时是**语义证据**——判定者核对「该引文是否支撑
该对象的主张」时看的就是它。两个用途必须同时成立：

1. **防编造**：连续、逐字的原文片段，在锚点区间内逐字命中；
2. **语义证据**：主张里的每一条断言都要能从它里面读出来；**主张不得断言引文之外的内容**。

短引文不足以承载主张时二选一：把引文写长到能承载，或把主张收窄到引文能承载的粒度。
长度上限（400 字）放在**提示词侧**，不进 schema、也不做机器判据——上限是调参，契约不该随之漂移。

> 这条口径是卡 05 的真实运行暴露后补上的。此前提示词只写了用途 1（且限 120 字），
> 于是判定者接入后 37 个对象里 12 个被判「不充分」，全是同一个模式：主张断言得比引文更多。
> 详见 [`docs/adr/ADR-011-evidence-quote-dual-purpose.md`](docs/adr/ADR-011-evidence-quote-dual-purpose.md)。

### 引文比对为什么忽略 markdown 标记与空白

模型复述的是**渲染后的文本**，而判据比的是 markdown 源。最初实测（两轮 `chapter4.md` 的
全部 9 条 `QUOTE_MISMATCH`）：逐字符比对后差异**只有 `**`**（相似度 0.90–0.98），
去掉标记后 9 条全部命中，**没有一条是改写或编造**。维持字节相等会让被判死的对象里有 16%
死于排版标记而非知识问题（规格 D7 所说需要被检测出来的 R6）。

后续不再用「一章的样本」支撑第二次放宽，而是取**盘上已有的全部对象产出**做全量归因：
12 份对象集 / 398 个对象（含跨章的 `antipatterns`），把每一条拒绝**穷举补丁子集**取最小成因。
结论是 15 条拒绝**全部**只是这类渲染差异，**0 条**是改写或编造——因此归一化扩到
**渲染后不可见的四类标记 + 空白整体忽略**（强调 / 引用块 `>` / 行内代码 `` ` `` / 反斜杠转义）。
复算脚本与逐条明细：`analysis/quote-gate-measure.mjs`；决策全文见
[`docs/adr/ADR-018-quote-normalization-widening.md`](docs/adr/ADR-018-quote-normalization-widening.md)。

**有意不放宽的一类**是中文弯引号 ↔ ASCII 直引号：那是字符替换而非零宽差异，
同批测量里的那 2 条至今仍被拒。放宽幅度是**有界**的，边界由测试逐条钉住：
`pipeline/tools/test/verifier-quote.test.mjs` 证明下划线不碰、内部删掉任何一个非空白字、
同义改写、凭空编造、以及只有空白的引文，一律仍被拒。回执逐对象记录 `quoteComparison`
（`strict` / `acceptedBy` / `normalization` / `scope`），因此「是靠归一化放过的」在审计时
看得见，不必翻代码。

## 判定者（第 3 层的第二组判据）

设计决策全文见 [`docs/adr/ADR-010-judge-design.md`](docs/adr/ADR-010-judge-design.md)。三条要点：

1. **同模型、独立实例，路由独立可配。** 可证明的那半（结构隔离）由代码保证，
   不可证明的那半（不同家族降低同类错误）留成配置口子等数据。回执记录
   `sameModelAsProducer`，使「同模型自审」在审计时可见。
2. **只有「支撑」算通过。** 不充分与不支撑都拒绝，但分两条理由码——两者修法不同。
3. **输入是构造的，不是删的。** 判定者输入恰好三个键（`claim` / `quote` / `anchorText`），
   由 `object-contract.CLAIM_FIELDS` 逐类型列举主张字段。守卫是**白名单**（多一个键即报错）：
   黑名单只能拦住想得到的泄漏，拦不住「将来新增的字段让判定者视野静默扩大」。

隔离不是声明，是被测试证明的：`pipeline/tools/test/judge-isolation.test.mjs` 驱动真实链路，
把哨兵埋在生产者的提示词与输出里三个必须不回流的位置，断言判定者**实际收到的请求**
一个哨兵都没有；并配有正向对照（断言判定者确实收到了主张、引文与锚点原文），
以免「不含哨兵」退化成「根本没发请求」。

## 未启用判定者时的诚实性

若某次运行未应用判定者判据（替身路径、`--no-judge`、重判路径缺省、或注入传输不完整），
回执的 `verificationGate` 会写明本次门禁**只完成了确定性那一半**。
此时 `counts.passed` 的含义随之改变，读回执的人据此决定要不要复核。

## 复用旧产出时，它会告诉你产出它的是哪一版提示词

不带 `--rerun` 运行时，流水线复用已落盘的对象。若那些对象是由**另一个版本的第 2 层提示词**
产出的，stderr 会打出 `[提示词漂移]` 告警并**并排列出两个指纹**，回执的 `reuseObservation`
里也有这份观察。

**不硬拒**是有意的：提示词变了与源版本变了性质不同——源变了对象**失效**（`sourceRefs` 指不到
东西了），提示词变了对象**仍然有效、只是旧了**。硬拒会让任何提示词微调都强制全章重跑。
理由全文见 [`docs/adr/ADR-013-prompt-drift-warn-and-reuse.md`](docs/adr/ADR-013-prompt-drift-warn-and-reuse.md)。

> 边界：纯回放路径**不写盘**（盘上的回执是产出者的记录，不该随「谁读了一遍」而变），
> 因此漂移观察只在 stderr 与 `--json` 输出里，审计平面上看不到。

## 覆盖数：哪些锚点没产出对象（卡 07）

回执的 `coverage` 是一个**固定字段**，不用去明细里翻 `objectCount: 0`：

```json
"coverage": {
  "indexAnchors": 20, "processedAnchors": 20, "processedKnown": true, "coveredAnchors": 19,
  "withoutObjects": { "count": 1, "anchors": ["chapter4#h2-8"] },
  "unresolvedReferenceAnchors": [],
  "perLevel": { "h2": { "index": 9, "covered": 8, "without": 1 } }
}
```

**它由「对象 × 索引」反推，不读 `perAnchor`。** 理由是一条实测缺陷：冻结产物复用分支与
**重判路径**上的 `perAnchor` 是空数组，于是「哪个锚点没产出」在那条路径上整体消失——而重判
正是「同一批对象、只看换尺子之后结论怎么变」时最常走的路。判据落在对象与索引上，每条路径都算得出来。

**「被处理」不是猜的**：`processedAnchors` 取自逐锚点明细的条数（本次真的为哪些锚点发过调用）。
替身/夹具路径不按锚点调用，此时它是 `null`、`processedKnown` 为 `false`，`coverage.reading`
会写明这份清单答的是「没有任何对象指向它」而不是「被处理但产出 0」——**字段名不撒谎**。

**读法是「要人看清单」，不是「看阈值」。** 实测 8 次真实运行，**每一次**都恰好有 1–2 个锚点零产出，
且**从来没重复过同一个**：`h2-9`（思考题）6 次、`h2-8`（本章小结）2 次、`h3-7`（多模态感知，305 字节）1 次。
末节不承载知识对象是**正确的零产出**，而一个正文节出现在清单里则几乎一定是漏抽——两者的区别
只能靠人看。定阈值要等卡 09 的全书分布。

同段的 `layer2.usage` 给出按章的调用与 token **及逐锚点明细**，并做一次对账：
`layer2.usage.calls ?= model.calls − model.failedCalls`（后者是 HTTP 尝试次数，含重试；
取不到用量时 `matches` 是 `null` 而不是 `true`——「不知道」不是「对得上」）。

切分与容量的完整推导、字节→token 的实测换算、以及第 9 条验收措辞的更正，见
[`docs/adr/ADR-017-anchor-slicing-and-input-budget.md`](docs/adr/ADR-017-anchor-slicing-and-input-budget.md)。

## 判定者判据的测量精度（实测，2026-10-08）

判定者不是一把刻度精确的尺。**同档两臂对照**（同一批对象、同一提示词指纹、只重复跑一次）
实测：37 个对象里有 **5 个**判决翻转（**13.5%**）。同一批对象的检出数在三臂间为 13 / 10 / 10。

读取任何「判定者判了多少条」时都要带上这个带宽：单次运行的拒绝数**不是**一个稳定量。
量它的工具是 `pipeline/tools/tier-probe.mjs`（见下）。

## 推理档位的对照工具

```bash
# 固定一批对象，只拨档位，看判决怎么变
node pipeline/tools/tier-probe.mjs \
  --objects pipeline/knowledge/history/chapter4.a257afe6.objects.json \
  --anchors pipeline/knowledge/chapter4.anchors.json \
  --tiers high,high,low \        # 同档跑两臂 = 噪声底；异档 = 档位效应
  --judge-model deepseek-v4-pro --judge-base-url https://api.deepseek.com
```

判据是**逐对象判决的差异与方向**，不是拒绝率：降档的危险形式是丢检出，
而单看某一档的拒绝率看不出来（一个全判「支撑」的判定者，在多半是好的集合上拒绝率完全正常）。
方向标签 `X-only` 表示「X 检出、另一臂放过」——**只有这个方向能支持「不该降档」**。

**同档跑两臂是必需的，不是可选的。** 没有噪声底，任何「档位 A 与档位 B 差 N 条」
都无法判断 N 是档位效应还是噪声。本工具默认不做这件事，因为它不知道你想比什么；
但读到任何差异前，请先跑一次 `--tiers high,high`。

## 反模式的跨章综合（卡 06）

反模式是本书最高价值的产物，而它**在原文里不成节存在**（全书「常见陷阱」字面 **0 命中**，
显式失败小节仅 **13 处**且高度集中在 chapter10，而目标量级是 22 个 skill × 6–8 条 ≈ 130–176 条）。
因此它不是抽出来的，是**综合出来的**，且输入必须**按主题组织、而非按章节顺序**。

三步，每步的产物都落盘、都可用哈希核对：

```bash
# ① 第 1 层：全书锚点索引（确定性、零模型成本）→ pipeline/knowledge/*.anchors.json
for f in sources/ai-agent-book-zh/book/*.md; do node pipeline/tools/anchor-index.mjs "$f"; done

# ② 主题提案：一次**目录级**调用（只给标题与首行摘录，不给正文）→ pipeline/knowledge/themes.json
node pipeline/propose-themes.mjs --dry-run                     # 只建目录、报告输入规模，不调模型
node pipeline/propose-themes.mjs --model <id> --base-url <url>

# ③ 跨章综合：一个主题一次调用 → 多锚点 sourceRefs + 每条出处自带引文
node pipeline/synthesize-antipatterns.mjs --list               # 只列主题，不调模型
node pipeline/synthesize-antipatterns.mjs --themes T02,T12 \
  --model <id> --base-url <url>
```

综合 CLI 的常用开关：`--no-judge`（关掉判定者，**不建议**——本轮最想量的量就是它）、
`--max-tokens`、`--max-patterns`、`--no-resume`。
**边跑边落盘**：每完成一个主题当场写一次原始响应；重跑时同 `runId` 的主题**免费重放**
（物化、合并、标记都是确定性的，只有调模型那一步花钱）。`runId` 含主题集合、提示词指纹、
目录哈希、模型与是否判定——任一变化都不复用。

**跨章是可验证的事实，不是自述。** 一条反模式可以同时引用第 5 章与第 7 章，
而**每条 `sourceRef` 自带一段逐字引文**，第 3 层拿它与**那一条出处自己的锚点区间**比对
（见 `verdicts[].refQuoteComparisons`）。只验第一条是不够的：多写一条出处不花成本，
不逐条验就等于没验。理由码**不新增**——它与顶层引文未命中同族（修复方都是「归纳时改写了原文」），
靠 `at = sourceRefs/i` 区分，避免把一个缺陷记成两笔。

**三个标记**（`marks`，与拒绝码表**分开**：它们描述的是「对象通过了，但支撑到什么程度」，
混进拒绝码表会让「被拒」与「通过了但只靠一章」在统计里长得一样）：

| 标记 | 含义 |
|---|---|
| `CROSS_CHAPTER_SUPPORTED` | `sourceRefs` 覆盖 ≥2 个章节 |
| `SINGLE_CHAPTER_ONLY` | `sourceRefs` 只覆盖 1 个章节 |
| `CROSS_CHAPTER_CLAIM_UNSUPPORTED` | 引用 ≥2 个锚点、去重后却只落在 1 章，且主题输入跨 ≥2 章——**「抄取冒充综合」的检出点** |

**合并规则**：同一主题内 `corrective` **精确相等**才合并（卡 06 明令不预设相似度阈值，
故近似不构成合并理由）。跨主题的精确重复**只报告不合并**——强行合并会抹掉主题归属，
而主题归属正是这一卡的组织方式本身。

**不设阈值**：本卡不以任何跨章占比门槛作为验收条件。分布（总数、≥2 章条数、跨章占比、
被引用章节分布）只报数，交由人看过真实产出后决定阈值。

## 已知约束

- **推理档位**：两层各自可拨（`--llm-reasoning-effort` / `--judge-reasoning-effort`），
  缺省**不发该字段**（跟随服务端默认）。生效值与来源都进回执（`model.reasoningEffort` 与
  `model.configSource.reasoningEffort`）。定档结论见
  [`docs/adr/ADR-015-reasoning-tier-decision.md`](docs/adr/ADR-015-reasoning-tier-decision.md)：
  **两层都不拨**——唯一可分辨的效应是降档省 **42.2%** 推理 token（同档噪声带 12.8%）；
  质量面测不出差异，但**也证明不了无差异**，而 ADR-009 的门槛是「证明不掉质」。
- **推理开销**：第 2 层的输出 token 里约 92.6% 是思维链（实测 chapter4）。
- **零产出锚点**（卡 07 已修可见性，**分布本身仍是未决问题**）：一个锚点可能被调用、但产出 0 个对象。
  此前**回执对此零信号**（不计数、不告警、无理由码）；现在它是固定字段 `coverage.withoutObjects`
  （计数 + 清单 + 按层级分布），在复用路径与重判路径上同样存在。
  **但「零产出多少算多」仍然没有阈值**——实测 8 次真实运行每次都有 1–2 个，且每次不是同一个
  （`h2-9` 6 次 / `h2-8` 2 次 / `h3-7` 1 次），末节的零产出与正文节的漏抽在数字上无法区分。
  原始发现见 [`ADR-015`](docs/adr/ADR-015-reasoning-tier-decision.md) 的「发现一」，
  处置与复算口径见 [`ADR-017`](docs/adr/ADR-017-anchor-slicing-and-input-budget.md)。
- **同档噪声带**：任何「A 比 B 差 N 条」的结论，都必须先给出同档重复跑的对照，
  否则 N 可能是噪声。实测：判定者同档两臂 13.5% 判决翻转；生产者同档三臂推理 token 波动 12.8%
  （`h2-8` 这个锚点的产出在 0 与 2 之间摆动，全程同档）。
- **推理正文刻意不落盘**：它是生产者的思维链，判定者不得看到；写到盘上等于留了一条回流路径。
  只记长度（`reasoningChars`）。
- **短路使判定者无法推翻确定性判据的拒绝。** 逻辑上与「两组均须通过」等价（合取满足短路求值），
  代价是「确定性判据是否过严」（R6）仍需人工看 `quoteComparison` 才能检出。
- **多锚点对象的引文逐条验；判定者的视野已于 `judge-prompt/v2` 扩到全部锚点区间。**
  旧契约（卡 05 的 `JUDGE_INPUT_KEYS`）是「主张 + 一条引文 + **那一个**锚点的原文」，
  于是把两章结论**合并**成更大断言的反模式，主引文一个人扛不住，判定者会（正确地）判不充分
  ——ADR-011 记录的 AntiPattern 100% 不充分就是这条路的终点。**这个「是否该让判定者看到全部
  证据」的口径问题已经实测定夺**，见 [`ADR-022`](docs/adr/ADR-022-judge-vision-all-anchors.md)：
  判定者现在看对象声明的全部锚点区间，判定对象也从「主引文」改为「锚点区间」（区间 ⊇ 引文，
  因此对单锚点对象同样放宽）。副作用是**「证据必须点名」在判定环节失去约束力**，
  代价已量化：2 条主张仅凭区间即被接受，其支撑落在生产者所引片段之外。
  **合成层 §3 已随之对齐**（ADR-022 决策 7）：生产者过去被要求「把主张收窄到主锚点能承载的粒度」，
  那是照着旧判定者的输入写的，判定者放宽后就成了一条**比判据更紧**的自我限制。对齐后实测
  跨章占比 4/16 → 7/14、引用中位数 1 → 2、主张中位字数 83 → 95，而**主引文字数几乎没变**
  （104.9 → 106.2）——放宽发生在主张一侧，不是靠拉长证据引文。
- **跨章对象 id 是「位置序号」，不是内容身份。** `synthesizedIdFor(themeId, seq)` 把 id 派生为
  `<前缀>-<主题>-<序号>`，所以同一个 `AP-SYNTH-T12-06` 在两批里是两条不同的反模式。
  任何「同 id 的对象被改写了」式的读法都是错的——`pipeline/tools/compare-object-sets.mjs`
  给出的对照里，**聚合可比、逐条不可比**。
- **跨章综合的 raw 与判定产物用两个**不同的**身份命名**（ADR-022 决策 6）。
  raw 只由生产者侧输入决定（主题集合 + 生产者提示词指纹 + 目录哈希 + 模型），回执与判定表再叠加
  判据身份与 `PIPELINE_VERSION`。分开的理由是硬的：续跑只认 `prior.runId === 本次身份`，
  把判据身份塞进那一个 id 就等于**每次改判据都要重买全部主题的原始响应**，与
  `replayThemeFromRaw`「付过钱的产出不得因下游改动而重花一次」的设计意图相反。
  装配器取判定表也改为**按身份匹配**（取不到才回退 mtime，并把 `identityMatch: false` 记进契约）。
- **shell 视角的 `stat` 大小可能是错的（环境层，不是仓库缺陷）。** 实测有 7 个文件被
  `ls`/`stat` 报出比真实内容**多 4096 字节**的大小，`read` 工具因此按报出的大小分配缓冲、
  尾部被补零、判成 binary 而拒读。**内容从未损坏**：`git hash-object` 与工作区逐字节一致，
  Node 侧 `stat.size == readFileSync().length` 对全部 141 个受控文件成立。
  用「同内容重写」可修复，修完必须核对 blob 哈希不变：
  `node -e "const b=require('fs').readFileSync(p); require('fs').writeFileSync(p,b)"`。
- **别用 `cmd | tee log` 读退出码。** 管道只保留最后一环的退出码，一次崩溃会被报成 `exit 0`
  ——实测踩到过，而且当时正是一次真崩溃。要么 `set -o pipefail`，要么不要接管道。
- **输出被截断会被报成「JSON 解析失败」，除非显式区分。** 思考模式下推理与正文**共用**同一份
  输出额度，额度卡在推理上时的表象是 JSON 未闭合。综合模块现在检测 `finish_reason=length`
  并把它报成**预算问题**（附原始响应，可从 partial 文件取回、无需重新付费）。
  实测：T12（6 章 / 39 KB 输入）在 16000 额度下被截断。
- **「响应不是 JSON」有两种成因，错误串长得一样，必须靠原文区分。** 2026-10-11 全书首跑
  6/13 个文件退出码 4，报错全是 `Unexpected token 'x', "…"`，一度被归因为「模型在字符串里
  写了字面换行」。**那个归因是错的**：6 份原始响应经 `JSON.parse` 全部合法——是解析器把它们
  切坏了。旧实现的围栏正则是**未锚定**的 `/```(?:json)?\s*([\s\S]*?)```/`，而技术书稿里几乎每个
  锚点都含代码块，于是 JSON 字符串**内部**必然出现一对 ```` ``` ````；这个正则从响应头部一路匹配到
  字符串内那个围栏的结束符，把一大段中间内容当成「围栏壳」剥掉，剩下的残片自然不是 JSON
  （`Unexpected token 'b', "bash\ngit "` 里的 `'b'` 就是被切剩的 `bash` 首字母）。
  同一份正则当时**抄在四个解析器里**（第 2 层 / 判定者 / 主题提案 / 跨章综合），因此修复方式是
  提取 `pipeline/tools/model-json.mjs` 为唯一实现：先试**整份原样**，再试**锚定**围栏，最后才
  退到首 `{` → 末 `}`。判定者那一处最危险——它的输入就是锚点原文，含代码块的概率与第 2 层
  同样高，一个本该裁决为「支撑」的响应会被判成「解析失败」，而两者在人工复核时同样容易被跳过。
  **不做语义修补**的立场不变：真坏的 JSON（字符串里真有裸换行）仍然被拒，
  `pipeline/tools/test/model-json.test.mjs` 两边都钉住了。见
  [`ADR-023`](docs/adr/ADR-023-unanchored-fence-regex.md)。
- **聚合回执的判定者读数分三个字段，别把「没全跑」读成「没跑」。** `book-receipt/v2` 起，
  `totals.judge.enabled` = **至少一个**文件真的过了判定者，`allFilesJudged` = **每个**文件都过了，
  `filesJudged` = 过了的文件数。`v1` 的旧口径是「每个文件都过了」都塞在 `enabled` 里——
  实测混合回放（12 个文件跑判定者、1 个回放）时它会给出 `enabled:false` + `calls:560` 的读数，
  报告行据此印出「未启用」。报告行现在的判据是 `calls > 0`（见 `judgeSummaryLine`）。
  **v1 与 v2 回执都在盘上，跨版本引用该字段时必须带版本。**
- **「章内反模式」的统计不含跨章合成产物。** `pipeline/knowledge/antipatterns.objects.json`
  是卡 06 的合成产物，单独成块（`antipatterns.crossChapter`）。2026-10-12 前的实现把它也扫进
  `fromLayer2`，于是同一个对象被报两次、且「章内」里混着 `AP-SYNTH-*` 的跨章 id——
  首跑公布的「章内 28」与第二次跑的「章内 58」都因此虚高，真值是 **14** 与 **44**
  （跨章恒为 0，逐章提取按定义单锚点）。`full-book-run.test.mjs` 已用夹具钉住这条边界。
