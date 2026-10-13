# 02 · 基准比对报告：产出 vs 原书 22 个 skill（MVP 验收 4）

- 执行者：独立于构建者的 agent 实例（按 `docs/tickets/15-benchmark-comparison.md` 比对协议执行，不携带构建过程上下文）
- 执行日期：2026-10-13
- 被比对物：产出冻结面 `pipeline/registry/freeze-2026-10-13T11-52-41.json`（13 文件，git commit `c52856d822cd085b56baf8754db9e7f022ddf9d6`）
- 对照物：`benchmark/upstream-skills/`（只读镜像，上游 pin commit `dbc046eb896ac4e39aa19c7774c8bf49583b89a6`，见 `benchmark/upstream-skills/MIRROR-MANIFEST.md`）
- 引用纪律：本报告全部数字标注来源；不引用 ADR-006 明令禁用的未核实数字（「46.4%」）

---

## 0. 冻结校验（开工）

```
命令：node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T11-52-41.json
结果：通过——13 个文件与 freeze-2026-10-13T11-52-41.json 逐一致。
```

收尾复跑结果见 §6。比对全程只读：未修改任何产出、`benchmark/` 内文件、冻结文件。

对照物完整性自查（本报告实测）：`benchmark/upstream-skills/` 盘上共 24 个文件
（22 个 `<name>/SKILL.md` + `README.md` + `MIRROR-MANIFEST.md`）；22 个 SKILL.md
逐文件 sha256 与 `MIRROR-MANIFEST.md` 清单比对 **22/22 一致**（本报告以
`shasum -a 256` 复算）。README.md 哈希 `sha256:37837709…` 亦与清单一致。

---

## 1. 数量与粒度

### 1.1 计数对照

| 侧 | 口径 | 数量 | 来源 |
|---|---|---:|---|
| 原书 | 发布 skill | **22** | `benchmark/upstream-skills/` 实测 22 个 `SKILL.md`，逐文件哈希对 `MIRROR-MANIFEST.md` 22/22 一致 |
| 我方 | 已发布 skill | **2** | `skills/chapter4-tool-design-principles/SKILL.md`（5,923 B）、`skills/chapter4-single-tool-design/SKILL.md`（9,538 B）；`find skills -name SKILL.md` 实测仅此两个 |
| 我方 | 候选划分（重切后，当前权威） | **29** | `pipeline/registry/skill-candidates.json` 的 `candidates.length`（实测 29，全部 `promotionState:"candidate"`） |
| 我方 | 重切前候选（历史） | 40 | 归档 `pipeline/registry/history/skill-candidates.98842f73.json`（实测 40）；重切由 `pipeline/registry/resplit-plan.json`（11 对，`approved:true`）执行 |
| 我方 | 内容单元 | 115 | `pipeline/knowledge/clusters.json` 全部 `chapters[].units` 实测合计 115 |
| 我方 | 知识对象（抽取） | 604 | 13 个 `pipeline/knowledge/<file>.objects.json` 数组长度实测合计 |
| 我方 | 知识对象（进聚类） | 593 | `pipeline/knowledge/clusters.json` → `skill-candidates.json` 的 `diagnostics.byFile[].objects` 合计（两者同为 593；604−593=11 条差额未逐条核源，`pipeline/knowledge/history/` 下存在多个对象文件历史版本，不影响本报告结论） |
| 我方 | 跨章反模式对象 | 14 | `pipeline/knowledge/antipatterns.objects.json`（`objects.length`，runId `run-6bc0e8a0e8b9`） |

粒度对照：

- 原书：22 个 / 10 正文章 ≈ 2.2 skill/章（`docs/adr/ADR-007-skill-partition-semantic-clustering.md` 实测记录）；单文件体积 7,318–16,568 字节、中位 10,710.5 字节（本报告 `wc -c` 实测；`docs/adr/ADR-004-skill-granularity-and-skeleton.md` 记录「最小 7,318、最大 16,568、中位约 10,900、合计 244,653」与此一致，合计口径含 README 时为 248,436，见 `MIRROR-MANIFEST.md` 两处交叉核对）。
- 我方：29 个候选，单候选聚合对象数 7–68、中位 19（`skill-candidates.json` 实测）；候选间存在对象共认领——29 候选 `sourceObjects` 合计 663，去重后 593，即 70 个对象被 ≥2 个候选同时认领（本报告对 `skill-candidates.json` 去重实测），与门禁二「场景共认领」现象在对象层同源。
- 重切轨迹：40 → 29（`clusters.json` 的 `resplit` 块：`merges` 11 条、`removed` 11 条，`appliedAt 2026-10-13T10:34:28.435Z`；每对带 `stablePair`/`strictScenarioIds` 依据，计划文件 `pipeline/registry/resplit-plan.json` 逐对可查）。

### 1.2 差异归因（ADR-007 专项，不得归因「质量不够」）

「22（原书）→ 2（我方发布）」的差距按 ADR-007 要求做专项归因，逐层给出产物证据：

**归因一（主因）：发布门径尚未打通到其余候选——发布区只收门禁一通过者，而目前只有 chapter4 系走完过全流程。**

- 发布机制：`pipeline/build-skill.mjs` 只在门禁一通过时把 SKILL.md 拷入 `skills/`（该文件头注释与 L666–L671：`published: verdict.passed ? … : null`；发布区只接收通过门禁的产物，ADR-002 平面隔离）。
- 覆盖事实：`pipeline/registry/build/` 下只有 2 个 skill 目录（两个已发布者），即其余 27 个候选从未走完（或从未提交）环 4 装配 + 门禁一。
- 重切后的实测：11 个吸收者经环 4 重建、门禁一复跑，**1 通过（chapter4-s1 → `chapter4-single-tool-design` 重新发布）、10 被拒**，拒因逐条记录（体积 8 / 配套代码来源 9），未调任何口径——来源：`docs/tickets/13-ring3-resplit-from-gate2.md` 构建记录表（chapter7-s1 24,950 B、chapter10-s1 20,369 B、chapter2-s3 16,286 B 等超 12 KB；非 chapter4 系 `SECTION_EMPTY`）。
- 结论：10 个合并候选被拒是**两条既有约束在更大簇上被压到**（ADR-004 体积阈值、ADR-020 来源缺口），不是提取质量下降。

**归因二（主因）：信息源结构性缺口——「配套代码」段只有 chapter4 有来源。**

- `sources/ai-agent-book-zh/code/` 下仅镜像了 `chapter4/`（ADR-020 决策：只镜像上游 chapter4，commit `dbc046e`），其余章的候选装配时「配套代码」段必然 `SECTION_EMPTY`——原书 22 个则**全部**有跨全仓的配套代码路径。这是**来源覆盖缺口**，非提取能力问题（ADR-020 背景节原文：「没有任何 skill 能发布——这不是聚类选择的结果，是信息源层面的缺口」，当时仅 chapter4 修复）。
- 对象模型亦无「锚点 → 代码目录」映射字段，章级列举是唯一口径（`pipeline/registry/build/chapter4-tool-design-principles/skill-contract.json` 的 `gaps` 中 `SECTION_SOURCE_GRANULARITY_COARSE` 条目自述）。

**归因三：体积阈值严于原书自身实践。**

- 我方阈值 ≤12,288 字节（ADR-004，按原书中位数偏上取值）。但原书 22 个中 **5 个超此阈**（本报告实测：bad-case-to-dpo 12,302、agent-evolution 13,492、knowledge-org 13,716、post-training-strategy 15,788、agent-evaluation 16,568）。即原书作者自身不守 12 KB；我方重切后的大簇（最大 24,950 B）若在原书口径下未必被拒。该阈值是已接受的工程决策，但**作为数量差异的成因必须如实计**：它把「合并后的大候选」系统性挡在发布门外。

**归因四：数量本身 29 vs 22——划分原则不同，且我方覆盖了原书未设 skill 的内容。**

- ADR-007 明确「数量是结果而非配额，2.2/章仅用于事后偏差诊断」；禁止照抄原书边界（读 `benchmark/` 即污染对照，ADR-001）。
- 我方 29 个候选中 **7 个落在原书没有设 skill 的主题上**（引言、参考答案×2、语音交互、机器人操作、Agent 社会与经济、执行路径与框架选择，见 §2 反向清单）——原书 22 个没有覆盖全书全部内容；剔除这 7 个后我方「可与原书对位」的候选为 22 个，与原书 22 个**数量恰好持平**（两条独立路径的数字重合，仅作观察、不作达标宣称，承 ADR-007「收敛即证据」的克制表述）。
- 粒度仍偏细的证据：门禁二第三读数（重切后 strict 口径）中 **46 个冲突组（46/87 个场景存在共认领）**（`pipeline/registry/gate2-report.strict.json` 的 `conflictGroups` 实测 46 组、每组一个 `scenarioId`）；另按 `perCandidate[].coClaimedScenarios` 汇总去重为 51 个场景（含 5 个候选自身未命中但被其他候选认领的场景，如 `chapter2-s3-sc3` 被 `reference-answers-s2` 认领——`missedScenariosClaimedBy` 字段），两种口径并存、以报告字段原文为准。第二读数（重切前 40 候选，strict 口径归档）为 78 组/120 场景（`pipeline/registry/history/gate2-report.strict.5f6d90d4.json` 的 `conflictGroups` 实测 78；宽松读数 `gate2-report.json` 为 96 组）。重切（卡 13）对共认领是**部分消解、未归零**（strict 口径 78→46，`docs/tickets/13-ring3-resplit-from-gate2.md`「第三读数结果」表），且卡 13 已如实记录「合并的边际收益已到顶，下一层是收敛描述」。

**归因结论（一句话）**：22 → 2 的发布差距首先由**发布门径（只对 chapter4 打通过）**与**来源缺口（配套代码仅 chapter4 有镜像）**解释，其次由 12 KB 体积阈值与候选间共认领（粒度偏细）叠加；**没有任何一层归因需要诉诸「提取质量不够」**。29 与 22 的候选数差异主要由内容覆盖面不同（我方多覆盖 7 个原书未设 skill 的主题）与切分原则不同（语义聚类 vs 人工综合）解释。

---

## 2. 主题映射表

**映射方法**：原书侧以 `benchmark/upstream-skills/README.md` 两张表的「对应章节」列 + 各 `SKILL.md` 正文为据；我方侧以 `pipeline/registry/skill-candidates.json` 各候选的 `chapterRefs` + `anchors`（锚点前缀，锚点标题经 `pipeline/knowledge/<file>.anchors.json` 核对）为据。允许「无对应 / 多对一 / 一对多」，逐格写依据。跨章候选以 `chapterRefs` 标注。

**正向覆盖率：22/22**——原书每个 skill 在我方候选中都能找到锚点级依据的对应候选；**不存在「原书有而我方完全无对应」的主题**。

**映射类型统计**（本报告逐行归类实测）：专属一对一 8、多对一 6、一对多 8。

| # | 原书 skill | README 章节映射 | 我方对应候选 | 类型 | 依据（我方锚点） |
|---|---|---|---|---|---|
| 1 | context-engineering | ch2 | chapter2-s2「提示词与 Skills 编排」＋ chapter10-s1（吸收原 chapter2-s1） | 一对多 | chapter2-s2 anchors：chapter2#h2-4（提示工程）、h3-12…h3-17、h2-5（动态提示词与 Agent Skills）、h3-19…h3-22；chapter10-s1 含 chapter2#h1-1、h2-1、h3-1…h3-10（上下文构成与核心循环） |
| 2 | kv-cache-design | ch2 | chapter10-s1（吸收原 chapter2-s1 的 KV Cache 部分） | 多对一 | chapter10-s1 的 chapter2 anchors 含 h2-3（KV Cache 友好的上下文设计）、h3-6…h3-11（Chat Template / KV Cache 原理 / 双层缓存 / 缓存架构约束 / 可编辑笔记） |
| 3 | context-compression | ch2 | chapter2-s3「运行时上下文治理与安全」 | 多对一 | chapter2-s3 anchors 含 h2-7（上下文压缩策略）、h3-27…h3-32（分层压缩 / 隔离优于压缩） |
| 4 | agent-state-bar | ch2 | chapter2-s3 | 多对一 | chapter2-s3 anchors 含 h2-6（Agent 状态栏）、h3-23…h3-26 |
| 5 | memory-system | ch3 | chapter3-s1「用户记忆体系设计」 | 专属一对一 | chapter3-s1 anchors 含 h2-1（用户记忆系统）、h3-1…h3-8（层次/格式/压缩/脱敏） |
| 6 | rag-pipeline | ch3 | chapter3-s2「RAG检索链路构建」 | 专属一对一 | chapter3-s2 anchors 含 h2-2（RAG 基础）、h3-9…h3-12（分块/稠密/稀疏/混合）、h3-16（智能体化 RAG）、h3-17（上下文感知检索） |
| 7 | knowledge-org | ch3 | chapter3-s2（主）＋ chapter3-s1（多模态记忆） | 一对多 | chapter3-s2 anchors 含 h2-3（超越扁平文本）、h3-13…h3-15（结构化索引/文件系统范式/更新）；chapter3#h3-19（前沿探索：多模态记忆）落 chapter3-s1 |
| 8 | tool-design | ch4 | 已发布 chapter4-tool-design-principles ＋ chapter4-s1「单工具设计与审查」 | 一对多 | 前者 gate-receipt `clusterTitle:工具设计的通用原则`、根锚点 chapter4#h2-2 等 4 锚点；后者 anchors 含 h2-1（工具的分类）、h2-2、h2-5（感知工具）、h3-1…h3-3、h4-1…h4-3（多模态路径） |
| 9 | tool-discovery | ch4 | chapter4-s3「大规模工具组织与发现」 | 专属一对一 | chapter4-s3 anchors 含 h2-4（工具太多怎么办）、h3-4…h3-6（按需加载/主动发现/Skills） |
| 10 | mcp-skill-hub | ch4 | chapter2-s3（吸收原 chapter4-s2） | 多对一 | chapter2-s3 跨章 anchors 含 chapter4#h2-3（工具生态：MCP 与 Skill Hub）——resplit 第 10 对（`chapter2-s3 ← chapter4-s2`，`clusters.json` resplit.merges） |
| 11 | coding-agent-harness | ch5 + ch1 | chapter5-s1 ＋ chapter5-s2（ch5）＋ chapter1-s1（ch1 护栏/Harness） | 一对多 | chapter5-s1 anchors 含 h1-1、h3-1…h3-3（Coding 内核/整体流程）；chapter5-s2 含 h3-4…h3-9（技巧/搜索/编辑/安全）；chapter1-s1 含 chapter1#h2-2（Harness 工程）、h3-10（护栏与安全性）、h4-7/h4-8（护栏类型/人工干预） |
| 12 | error-recovery | ch5 | chapter5-s2「Agent 工程落地与可靠性」 | 多对一 | chapter5-s2 anchors 含 chapter5#h3-5（故障与错误恢复） |
| 13 | async-event-agent | ch6 | chapter6-s1「事件驱动 Agent 架构」 | 专属一对一 | chapter6-s1 anchors 含 h2-2（异步与事件驱动）、h3-1…h3-9（事件触发/用户沟通工具/原生异步） |
| 14 | computer-use | ch6 | chapter6-s3「Computer Use 智能体」 | 专属一对一 | chapter6-s3 anchors 含 h2-4（Computer Use）、h3-16…h3-20（动作空间/视觉定位/世界模型/移动端） |
| 15 | agent-evaluation | ch7 | chapter7-s1（主）＋ chapter7-s3（内部评估基础设施） | 一对多 | chapter7-s1 anchors 覆盖 h1-1、h2-1…h2-5、h3-1…h3-19 等 37 锚点；chapter7-s3 含 h2-10（从外部评估到内部评估）、h3-25…h3-30（消融/AB/特性开关） |
| 16 | eval-dataset-design | ch7 | chapter7-s1 | 多对一 | chapter7-s1 anchors 含 h2-4（评估数据集的设计）、h3-7（基准横向对照）、h3-9（难度划分）、h3-10（数据泄漏）、h3-12（评估集来源） |
| 17 | post-training-strategy | ch8 | chapter8-s1「后训练路径规划与数据准备」 | 专属一对一 | chapter8-s1 anchors 含 h1-1、h2-1（四阶段全景）、h2-7（何时选择 Mid-training/SFT/RL）、h2-4…h2-6 |
| 18 | reward-design | ch8 | chapter8-s2「RL训练与奖励环境搭建」 | 专属一对一 | chapter8-s2 anchors 含 h2-12（奖励设计）、h3-15…h3-18（奖励来源/时机/形式/RLVP）、h2-8…h2-11（RL 与环境） |
| 19 | bad-case-to-dpo | ch8 + ch9 | chapter8-s3「训练诊断与评估数据利用」 | 专属一对一 | chapter8-s3 anchors 含 h2-14（从问题案例到后训练）、h3-21…h3-23（过早结束/中文引号/编辑失败三案例） |
| 20 | agent-evolution | ch9 | chapter9-s2 ＋ chapter9-s3 ＋ chapter9-s4 | 一对多 | chapter9-s2 anchors 含 chapter9#h2-2（四种方法）、h3-1…h3-5 ＋ afterword#h1-1…h2-2（resplit 第 11 对跨章吸收）；chapter9-s3 含 h2-1、h3-3、h3-6、h4-1…h4-2；chapter9-s4 含 h3-7（安全边界）、h3-8（睡眠学习）、h4-3 |
| 21 | multi-agent-design | ch10 | chapter10-s1 ＋ chapter10-s3 | 一对多 | chapter10-s1 anchors 含 h2-2（何时优于单 Agent）、h2-3/h2-4（共享/不共享上下文）、h3-1…h3-8；chapter10-s3 含 h3-5（对等协作）、h4-1…h4-5（Loop 工程/提议者-审核者/辩论/头脑风暴/专家小组）、h3-6…h3-8 |
| 22 | loop-engineering | ch10（配套代码取 ch5） | chapter10-s3（主） | 多对一 | chapter10-s3 anchors 含 chapter10#h4-1（Loop 工程）；原书该 skill 的「验证器」主题另见 chapter7-s1（chapter7#h3-8 验证器） |

**反向清单：我方 7 个候选在原书 22 个 skill 中无对应主题**（原书对这些内容未设 skill）：

| 我方候选 | 主题 | 锚点依据 |
|---|---|---|
| chapter1-s2「执行路径与框架选择」 | ch1 工作流/自主选择与框架对比 | chapter1#h3-8（如何选择模型）、h3-9（编排模式）、h4-3…h4-6 |
| chapter6-s2「语音实时交互」 | ch6 语音（级联/全双工/快慢思考） | chapter6#h2-3、h3-10…h3-15、h4-1…h4-5 |
| chapter6-s4「机器人操作智能体」 | ch6 机器人（XLeRobot/VLA） | chapter6#h2-5、h3-21…h3-27 |
| chapter10-s4「涌现与社会经济系统」 | ch10 Agent 社会（AI 小镇/经济/博弈） | chapter10#h2-6、h3-15…h3-20 |
| introduction-s1「引言入门与全局导航」 | 引言 | introduction#h1-1、h2-1…h2-3 |
| reference-answers-s2「上下文检索与评估设计」 | 思考题参考答案（跨章复练） | reference-answers#h2-1…h2-3、h2-7、h2-8 |
| reference-answers-s3「参考答案综合复习」 | 思考题参考答案（全量复习） | reference-answers#h1-1、h2-1…h2-10 |

（另：chapter9-s2 吸收的 afterword 单元、chapter5-s3 吸收的 reference-answers 单元属跨章补充来源，原书 skill 无直接对位。）

---

## 3. 结构复核（六段骨架）

骨架定义：`docs/adr/ADR-004-skill-granularity-and-skeleton.md`——`## 何时使用 / ## 核心原则 / ## 实践模式 / ## 常见陷阱 / ## 配套代码 / ## 深度阅读` 六段固定顺序。

**原书侧：22/22 命中（本报告在镜像上逐文件实测）。**
命令：对 22 个 `benchmark/upstream-skills/*/SKILL.md` 逐个统计六个二级标题命中数，结果全部 6/6；与 ADR-004 的「实测 22/22 命中」记录一致。体积实测 7,318–16,568 字节（中位 10,710.5），22/22 单文件、无 `references/`（目录遍历实测，仅 SKILL.md 各一）。

**我方已发布侧：2/2 命中（本报告实测 + 门禁一记录）。**
- `skills/chapter4-tool-design-principles/SKILL.md`：六段位于第 8/16/30/44/56/65 行；门禁一回执 `pipeline/registry/build/chapter4-tool-design-principles/gate-receipt.json`：`verdict.passed=true`、5,923 B ≤ 12,288 B、段条目数 5/3/2/3/6/5。
- `skills/chapter4-single-tool-design/SKILL.md`：六段位于第 8/20/50/121/133/142 行；回执 `pipeline/registry/build/chapter4-single-tool-design/gate-receipt.json`：`verdict.passed=true`、9,538 B、段条目数 9/7/9/3/6/12。

**我方候选侧（按协议引用门禁报告产物，不重跑模型）：**
- 重切后 11 个吸收者重建判决：**1 通过 / 10 被拒**，拒因为 `SECTION_EMPTY`（配套代码无来源，9 个涉及）与 `SIZE_EXCEEDED`（超 12 KB，8 个涉及）——`docs/tickets/13-ring3-resplit-from-gate2.md` 构建记录表。注意：该表是目前拒因的**唯一**成文记录（`pipeline/registry/build/` 下只保留 2 个通过者的回执，见 §5 口径问题 4）。
- 两个已发布 skill 的契约均带风险标记 `PITFALL_COVERAGE_BELOW_ADVISORY`（常见陷阱 3 条 < 建议值 6）——`pipeline/registry/build/*/skill-contract.json` 的 `riskFlags` 与 `pipeline/registry/gate3-report.json` 的 `skills[].riskFlags`。
- 门禁二第三读数（strict，29 候选）：triggerPassed 1（chapter6-s2）/ triggerConflict 28 / 无关场景误触发 1/20（unrelated-sc17 被 chapter3-s1 认领，首次触发 `route-to-risk-sampling`）——`pipeline/registry/gate2-report.strict.json` 的 `totals` 与 `unrelated`。第二读数（list，40 候选）：0 passed / 40 conflict / 误触发 0/20——`pipeline/registry/gate2-report.json` 的 `totals`。
- 门禁三（效用 A/B，2 个已发布 skill）：chapter4-single-tool-design **passed**（改进 1=t3、确认退化 0、噪声 1=t6 复跑不复现、无效任务 1=t5）；chapter4-tool-design-principles **low-utility**（0/0/0/1）；均无确认退化，negative transfer 排除——`pipeline/registry/gate3-report.json` 的 `skills[].tasks[]` 逐任务 `without/with/rerun` 实测可复核；判定口径与「n 很小、弱信号」边界见 `docs/tickets/14-gate3-utility-ab.md` 结果表。

**命中率小结**：六段骨架形状命中率——原书 22/22，我方已发布 2/2；我方候选侧无「形状不达标」的被拒记录（拒因全部是体积/来源），形状之外的内容缺口以 `gaps`/`riskFlags` 形式在案（见 §4）。

---

## 4. 不可比项清单（质量边界）

以下各项双方**不可直接对齐**，比对结论不含对它们的跨侧推断：

1. **写作方式**：原书 22 个是作者人工写作（本书作者本人蒸馏）；我方是自动提取（LLM 三段式 + 门禁）。同一「六段骨架」下语义密度不可比——我方侧已实测自证：`chapter4-tool-design-principles` 契约 `gaps` 记录 `SECTION_FIELD_SEMANTICS_MISMATCH`（「实践模式」段由术语定义填充，骨架要求的是可操作模式，「条目数达标不代表语义达标」）。
2. **跨章取用自由度**：原书作者可自由跨章取材（其 skill 配套代码常跨章引用，如 loop-engineering 用 ch5 代码、bad-case-to-dpo 横跨 ch8+ch9）；我方对象按章抽取，跨章合并是门禁二反馈后两轮才发生的事（`clusters.json` resplit：11 对中 4 对跨章；反模式跨章综合 14 条对象、其中 7 条仍为 `independent-candidate-pending-gate2` 挂起——`skill-candidates.json` 的 `crossChapterDisposition`）。跨章能力不在同一起跑线。
3. **反模式量级**：原书「常见陷阱」6–8 条出自人工综合；我方对 chapter4 整章实测可用反模式仅 5 条（ADR-021 统计表），两个已发布 skill 各 3 条并带 `PITFALL_COVERAGE_BELOW_ADVISORY` 风险标记。建议值 6 在自动提取下当前不可达（ADR-021 已把它降为建议值并明确「原书那 6–8 条出自人工写作，自动提取达不到该量级」）。
4. **契约侧车**：我方 skill 契约 7 个字段（inputContract/outputContract/tools/steps/stopConditions/rollback/tests）在对象模型中无来源（`skill-contract.json` gaps 中 7 条 `CONTRACT_FIELD_UNSUPPORTED`）；原书 skill 无契约形态。契约完整度不可互比。
5. **效用证据形态不同**：原书 skill 无 A/B 效用数据；我方门禁三给出 passed/low-utility 判定，但 K=6 的样本是**弱信号**（`docs/tickets/14-gate3-utility-ab.md` 口径边界自述），且测的是「方向性效用差异」而非绝对表现（`gate3-report.json` note 字段）。不能以门禁三结论推断原书 skill 优劣，反之亦然。
6. **体积约束不对等**：原书 5/22 超过我方 12 KB 阈值仍为合格交付物；我方产物被同阈值硬约束（`SIZE_EXCEEDED` 拒因）。同一尺寸在不同侧含义不同（§1.2 归因三）。
7. **触发验证不对等**：我方候选的 trigger 经门禁二盲测（3 场景/候选 + 20 无关场景）；原书 description 未经任何盲测。我方「trigger-conflict」状态（29 个中 28 个 strict 口径）衡量的是过认领问题，原书侧无对应测量，无法比较触发精度。
8. **发布语义不同**：原书 22 个全部处于「已交付」状态；我方 27/29 候选处于「未走完发布门径」状态（§1.2 归因一）——「候选未发布」不等于「不达标」，反之已发布 2 个也不代表其余候选质量更低（多数被拒者拒因是来源/体积而非内容）。

---

## 5. 口径问题与证据缺口（执行中发现，如实记录）

1. **镜像文件数两种口径**：卡 15 前置表写「23 文件哈希在册」，核实命令期望 `ls | wc -l` = 24。实测盘上 24 个文件 = MIRROR-MANIFEST 的 23 行哈希清单（README + 22 SKILL.md）+ MANIFEST 自身（不在哈希清单内）。两种说法各自成立，但读卡人易混淆，建议后续统一表述。
2. **clusters.json 与 skill-candidates.json 候选口径不同**：`clusters.json` 主体（`diagnostics.candidateCount`）仍是重切前 40 候选口径（其 `createdAt 2026-10-13T02:54:58`，重切 `appliedAt 10:34:28`），29 的权威来源是 `skill-candidates.json`（resplit 后落盘，含 `resplit` 交代块）。读 clusters.json 数候选会得 40。引用时必须指明文件。
3. **门禁二报告三份快照的候选集不同**：`gate2-report.json`（第二读数，宽松口径）是 40 候选 × 120 场景、conflictGroups 96；归档 `registry/history/gate2-report.strict.5f6d90d4.json`（第二读数，strict 口径）是 40 候选 × 120 场景、conflictGroups 78；`gate2-report.strict.json`（第三读数，重切后）是 29 候选 × 87 场景、conflictGroups 46。跨读数不可逐候选相减，两读数三分对照以 `gate2-stable.json`（stable 87 / listOnly 68 / strictOnly 5，实测）为桥；卡 13 记录的「78→46」取的是 strict 口径两组 conflictGroups。
4. **10 个被拒合并候选的拒因无机器可读归档**：`pipeline/registry/build/` 只保留 2 个通过者的回执；「1 过 10 拒」及逐条拒因（体积/来源）目前唯一成文处是 `docs/tickets/13-ring3-resplit-from-gate2.md` 构建记录表（文字）。建议后续把门禁一拒绝回执产品化归档。
5. **场景集文件哈希与报告记录不一致**：盘上 `pipeline/knowledge/gate2-scenarios.json` sha256 为 `a23fb5b0…`（冻结面亦为此值），而 `gate2-report.json` 记录 `af4cd859…`、`gate2-report.strict.json` 记录 `e393c0c8…`——两读数各自引用的场景集快照与当前盘上文件不互证（第三读数前后场景集有再生成动作）。本报告的我方侧结论全部取自报告产物的 `totals/perCandidate` 字段，不依赖该文件，故不影响比对有效性；但「报告 scenarioSetSha256 与冻结盘上文件不一致」本身是待澄清的口径缺口。
6. **抽取对象 604 vs 进聚类 593 的差额（11 条）**未逐条核源（各 objects.json 在 `pipeline/knowledge/history/` 存在多版本）。本报告两数并列、各标来源，未做跨数推断。
7. **`clusters.json` diagnostics.reference.observedSkills=35** 是「10 个正文章」口径（不含 introduction/afterword/reference-answers 候选），与 22（原书全量）、29/40（我方全文件口径）均不可直接比。本报告未引用该数作结论。

---

## 6. 收尾校验（未修改被比对物的证据）

```
命令：node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T11-52-41.json
结果：通过——13 个文件与 freeze-2026-10-13T11-52-41.json 逐一致。（报告落盘后复跑）
```

两次校验（开工 §0、收尾本节）均通过：比对前后冻结面逐文件哈希一致，未发生任何漂移。

`git status --porcelain` 摘要（收尾时实测）：共 60 个未跟踪条目（`??`），其中 59 个位于 `pipeline/` 下（构建会话遗留的运行回执/对象文件/历史归档，开工前已存在，本会话未触碰、未修改），**本会话唯一新增为 `docs/specs/02-benchmark-report.md`**；无任何已跟踪文件被修改（无 `M`/`D` 条目）。

---

## 7. 复核命令（供第三方验证本报告）

```bash
cd /Users/lute/Project/any2skills

# 冻结校验（开工与收尾各一次）
node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T11-52-41.json

# 原书 22 个与哈希
ls benchmark/upstream-skills | wc -l          # 24（22 SKILL.md 目录 + README + MANIFEST）
find benchmark/upstream-skills -name SKILL.md | wc -l   # 22

# 我方发布物与候选
find skills -name SKILL.md | wc -l            # 2
node -e 'const c=require("./pipeline/registry/skill-candidates.json");console.log(c.candidates.length)'  # 29
node -e 'const c=require("./pipeline/knowledge/clusters.json");console.log(c.resplit.merges.length,c.resplit.removed.length)'  # 11 11

# 门禁产物关键数
node -e 'const s=require("./pipeline/registry/gate2-report.strict.json");console.log(JSON.stringify(s.totals))'
node -e 'const l=require("./pipeline/registry/gate2-report.json");console.log(JSON.stringify(l.totals))'
node -e 'const g=require("./pipeline/registry/gate3-report.json");for(const s of g.skills)console.log(s.slug,JSON.stringify(s.riskFlags))'
```
