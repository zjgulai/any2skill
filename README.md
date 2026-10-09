# any2skills

Any content → executable Agent Skills. MVP pipeline.

**当前状态**：环 1–2 已跑通（源文件 → 锚点索引 → 知识对象 → 机器验证，含独立判定者）。
环 3（语义聚类）、环 4（构建）、环 5（门禁二/三）尚未构建。

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
npm test                                    # 321 项，零网络、零凭据

# 替身路径：零凭据、零网络、确定性产出（第 3 层的判定者判据不启用）
node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md

# 真实路径：需要模型凭据；产出真实对象，并调用判定者
node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md \
  --layer2 deepseek --llm-model deepseek-v4-pro --llm-base-url https://api.deepseek.com
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
- **多锚点对象的引文逐条验，但判定者目前仍只看主锚点。** 判定者的输入契约（卡 05 的
  `JUDGE_INPUT_KEYS`）是「主张 + 一条引文 + **那一个**锚点的原文」。因此一条把两章结论**合并**成
  更大断言的反模式，主引文一个人扛不住，判定者会（正确地）判不充分——ADR-011 记录的
  AntiPattern 100% 不充分就是这条路的终点。综合提示词据此要求**主张收窄到主引文能承载的粒度**，
  其余章节作佐证。**是否该让判定者看到全部证据，是一个待实测决定的口径问题**（见 ADR-016）。
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
