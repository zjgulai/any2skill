# 04 · Nowledge Mem 记忆系统与知识图谱落地方案

- 状态：已批准（2026-10-31；Space 命名经用户确认定 `any2skills`）
- 关联：ADR-033（项目级决策）、执行卡 33–37（`docs/tickets/`）、
  `artifacts/any2skills_ontology_patch.json`、`tools/dev/distill-memories-to-nmem.mjs`
- 来源：SOP《智能体记忆系统与知识图谱构建规范》v2.0（Nowledge Mem 底座）

## 1. 目标与非目标

**目标**：为 any2skills 建立专属 Nowledge Mem 记忆底座——专属 Space、Agent 身份、两条常驻守门规则、四层 22 条蒸馏记忆（首批 16 + 二批 6，Q4 拍板 2026-10-31）、5 份 Library 真源、空间本体（10 对象类型 + 8 关系类型）、11 条显式图谱关系，以及读侧 recall / 写侧蒸馏两向集成，满足 SOP 八条验收基线。

**非目标**：

- 不做实体抽取（nmem 0.10.111 无 `entities create`，`ontology apply` 只声明词汇不生成实体；图谱走「记忆节点 + 显式 link」路线，类型化实体策略另立后续票）。
- 不改 pipeline 门禁链路；nmem 相关代码只放 `pipeline/tools/`（工具面）与 `tools/dev/`（开发面），生成链路不 import，`npm test` 保持零网络、零凭据。
- 不升级 nmem 0.10.111 → 0.10.112（升级后须重跑 recall 测试与 `nmem status` 校验，另行决定）。
- 不处理 default 空间两条旧记忆的归档/迁移（独立票，见 §7 开放问题 Q1）。

## 2. 组件决定总览

| 组件 | 决定 | 依据 |
|---|---|---|
| Space | `any2skills` /「Any2Skills 技能生产线（Know）」，strict | 用户拍板（2026-10-31）；与 default/pr-agent/si-agent/kb-consultant-agent 互相隔离 |
| Agent | `any2skills-steward` /「Any2Skills 生产线守门人」/ role `skill-pipeline-steward` | 「守门人」贴合三道门禁与证据链守门职责 |
| Rules | 2 条：`any2skills_core_persona`（priority 100）+ `any2skills_repo_boundary`（priority 90），scope=space | SOP 第 2 步 |
| Memories | 22 条四层：L1 5 / L2 6 / L3 7 / L4 4 | SOP 认知金字塔；聚合蒸馏，不逐条灌 1089 对象 |
| Library | 5 份真源，统一 `.markdown` 后缀归档 | SOP 第 3 步；规避 MIME 陷阱 |
| Ontology | 10 objectTypes + 8 linkTypes，`--scope space` 应用 | SOP 第 5 步；kb 先例实测 space scope 为整体替换 |
| 图谱 | 16 记忆节点 + 11 条显式 `memories link` 边 | 0.10.111 无实体自动生成；`graph expand` 可多跳 |
| 集成 | recall util（3s 超时降级）+ distiller（默认 dry-run）+ env 固化 + `mem:verify` | SOP 第 6 步；生命线原则 |
| 写入门禁 | G1 四域批准（A 基座 / B 记忆 / C Library / D 本体）后才有 nmem 写 | 本仓「先落盘、待定协议」惯例的移植 |

## 3. 四层记忆蒸馏清单（16 条）

层级口径：L1 核心准则（decision / 1.0 / timeless）；L2 业务口径（fact / 0.9 / timeless）；L3 避坑实证（learning / 0.85 / timeless）；L4 沉淀纪要（context / 0.8·0.75 / past）。ID 规则：`any2skills-l<层>-<序号>`，全部带 `source` 指向仓库内出处。

| ID | 层 | 标题 | unit_type | source |
|---|---|---|---|---|
| any2skills-l1-01 | L1 | 证据可回查是最高红线：无 sourceRefs 不得进入下一环节 | decision | ADR-003/005 |
| any2skills-l1-02 | L1 | 构建者不得自评，三道门禁必须独立 | decision | ADR-006/027 |
| any2skills-l1-03 | L1 | 诚实披露优先于漂亮指标：三态如实标注 | decision | ADR-030/015 |
| any2skills-l1-04 | L1 | 零静默与平面隔离：不静默覆盖、不静默丢失、不静默忽略 | decision | ADR-001/002/006 |
| any2skills-l2-01 | L2 | 产品定义与当前资产基线（含「截至」限定） | fact | README + 成果总结 |
| any2skills-l2-02 | L2 | 两个信息源与粒度（chapter4 = 851 镜像文件 + 1 清单） | fact | specs/01 + MIRROR-MANIFEST |
| any2skills-l2-03 | L2 | 三道门禁分工与 16,568 字节体积阈值 | fact | ADR-006/027/028 |
| any2skills-l2-04 | L2 | 多源命名空间纪律：缺省源逐字节不变，其他源加 `.<key>` 后缀 | fact | playbook + 成果总结 |
| any2skills-l3-01 | L3 | `--layer2` 缺省 stub 会静默覆盖真实对象 | learning | README 案 + runbook |
| any2skills-l3-02 | L3 | 非 dry-run 的 build 就是发布 | learning | 卡 19 |
| any2skills-l3-03 | L3 | 账本必须每进程独立，账本缺席不等于没有访问 | learning | 卡 09 / ADR-001 |
| any2skills-l3-04 | L3 | 判定者只看主锚点会系统性误杀跨章对象 | learning | ADR-022 |
| any2skills-l3-05 | L3 | 非锚定围栏正则曾把合法 JSON 切坏 | learning | ADR-023 |
| any2skills-l3-06 | L3 | shell 的 stat 可能多报 4096 字节，别把内容未损坏误判成 binary | learning | README:480-485 |
| any2skills-l4-01 | L4 | 项目时间线与规模画像（快照，含日期与 commit 限定） | context | 成果总结 |
| any2skills-l4-02 | L4 | 双平面结构、运行入口与分发成熟度 | context | ADR-002 + 成果总结 |
| any2skills-l1-05 | L1 | 同档噪声带先于归因（13.5% 翻转率下限） | decision | ADR-015 |
| any2skills-l2-05 | L2 | 开关面审计口径：48 旗标 + 11 env + 行为门控 | fact | audits/flag-config-audit |
| any2skills-l2-06 | L2 | 提示词包试用状态：仅 01→02 真实验证 | fact | 成果总结 |
| any2skills-l3-07 | L3 | 历史拒绝 4 例处置口径（永久隔离/字面保真返区） | learning | registry/rejected + playbook |
| any2skills-l4-03 | L4 | 工程收口清单快照（截至 2026-10-31） | context | 成果总结 |

二批新增 4 条关系边（L3-07→L1-03、L4-03→L2-01、L2-06→L2-01、L1-05→L1-03），维护于 tools/dev/link-memories-to-nmem.mjs。记忆正文全文（含逐条 content）维护在 `tools/dev/distill-memories-to-nmem.mjs` 的 `MEMORIES` 数组中，为单一真源；本表只做索引。字数口径：content ≤300 字按去空白字符计；「句」以句号/问号/感叹号计。

## 4. 空间本体（10 objectTypes + 8 linkTypes）

对象类型：`SKILL`（任务型技能）、`SOURCE`（内容源）、`KNOWLEDGEOBJECT`（知识对象 IR）、`QUALITYGATE`（质量门禁）、`PIPELINESTAGE`（流水线阶段）、`ARTIFACT`（可复算产物）、`DECISION`（ADR 决策）、`TICKET`（执行卡）、`BENCHMARK`（只读基准）、`PROMPTMODULE`（提示词模块）。

关系类型：`DERIVES_FROM`（派生自）、`PASSES_GATE`（通过门禁）、`GOVERNED_BY`（受治理于）、`PRODUCES`（产出）、`NAMESPACED_UNDER`（按源命名）、`SUPERSEDES`（取代）、`IMPLEMENTS`（落实）、`BENCHMARKS`（基准对照）。

完整定义（含中文 displayName、描述与典型关系链）见 `artifacts/any2skills_ontology_patch.json`。

**实体化边界（如实声明）**：本方案只建立本体词汇与记忆级关系边，不产出类型化实体实例。桌面端 ⌘5 图谱的可视验收口径为「16 个记忆节点 + 11 条显式记忆 link，`graph expand --depth 2` 可多跳」，不宣称「类型化实体网络」。类型化实体（如 17 个 SKILL 实例）需评估 `ontology retype`（全局迁移风险）后另立票。

## 5. 执行计划（执行卡 33–37）

按「draft → 批准 → write → verify」三段式拆解，与仓库既有 01–32 执行卡连续编号。票间依赖：33 → 34 → 35 → 36 → 37。

| 卡 | 标题 | 类型 | 内容摘要 |
|---|---|---|---|
| 33 | nmem 落地脚本与草案（distiller / 本体 / Library 清单 / recall util / 规则与 WM 文本） | draft | 全部落盘，零 nmem 写；校验 16 条记忆的 unit_type/ID/字数；recall util 四路径测试 |
| 34 | G1 四域批准门 | 批准 | 用户按 A 基座 / B 记忆 16 条 / C Library 5 份 / D 本体 10+8 分域确认，各域留批准 marker |
| 35 | 建 Space / Agent / Rules / WM + 写入 16 条记忆 | write | G1-A/B 后执行；幂等（二次 apply +0）；三条检索 Top1 ≥ 0.70 |
| 36 | Library 归档 + 本体应用 + 11 条关系边 | write | G1-C/D 后执行；`.markdown` 后缀；apply 前后记录 global 基线；link 幂等 |
| 37 | SOP 八条验收 + 证据归档 + commit | verify | 验收映射表（见 §6）；`docs/audits/` 留证；规范化 commit |

## 6. SOP 验收基线 → 执行映射

| # | SOP 验收项 | 对应执行 | 证据 |
|---|---|---|---|
| 1 | `spaces list` 显式列出且 strict | 卡 35 | `nmem --json spaces list` 输出 |
| 2 | `agents list` 存在且默认 Space 正确 | 卡 35 | agents JSON |
| 3 | `nmem context --space` 完整输出 Space/Rules/WM | 卡 35 | context bundle JSON |
| 4 | `library list` 状态达标、错误 0 | 卡 36 | `sources[].state` ∈ {indexed, extracted}、total=5、error 空 |
| 5 | 桌面端 ⌘5 图谱可见 | 卡 36 + 37 | 按本方案口径：≥16 节点 / ≥11 边 / 截图路径 |
| 6 | 语义检索 Top1 ≥ 0.70 | 卡 35 | 三条完整中文 query 解析 `memories[0].score` |
| 7 | recall 测试全绿（真实检索 + 超时降级） | 卡 33 + 37 | `test_any2skills_nmem_recall.mjs`：fake 四路径 + `NMEM_E2E=1` 真实检索与超时；SOP 的 `.py` 在本仓等价落为 `.mjs` |
| 8 | 规范化 git commit | 卡 37 | commit hash |

**口径与风险边界**（来自批评者实测，全部已吸收进票面）：

- nmem CLI 实测版本 0.10.111；`memories add` 是确定性 upsert（`--id` 幂等）；`memories update` 会使 link add 稳定 422，入库后不改，必要时 delete+同 ID 重建。
- `ontology apply --scope space` 必须显式 `--space-id`，且为整体替换；patch 显式声明全部 8 个 linkTypes，不依赖 global 复用。global 基线用 `nmem --json ontology show --space-id default` 前后各存一份。
- 规则写入：rules 用 `--scope space --space any2skills`；memories/library 用 `--space`；ontology 用 `--space-id`。逐命令写法以卡 33 的命令表为准。
- Library 验收以 `library list.sources[].state` 为准（0.10.111 实测常见 `extracted`，`--state` 枚举不含它，不要拿 `--state extracted` 过滤）。
- `working-memory edit -m` 是整篇覆盖；规则命令默认 `--scope global`，必须显式 space。
- 凭据口径：只经环境变量或 `$DSH_HOME/.credentials.yaml` refs 读取，不写入仓库/记忆/回执。

## 7. 开放问题（待用户拍板，不阻塞卡 33/34）

- **Q1 default 空间旧记忆处理**：**已拍板并执行（2026-10-31）**。`d3a1a91a`（指向已改名的旧报告路径）与 `a646a825`（「尚无专属 Space」）均已 `memories deprecate`（不删除，原因中注明承接记忆 any2skills-l2-01 / any2skills-event-01）。注意：`--replacement` 的 EVOLVES 边不允许跨 Space（default → any2skills 返回 500），跨 Space 承接只能写进 reason。
- **Q2 根 AGENTS.md / CLAUDE.md 是否新增记忆协议指针**：**已拍板并执行（2026-10-31）**。新增根 `AGENTS.md`（四条硬约定 + 指针，协议正文单源仍在 `docs/guides/nmem-memory-protocol.md`）；未新增 CLAUDE.md（Claude Code 会读取 AGENTS.md，无需双文件）。
- **Q3 reports/ 入库**：Library 要归档的成果总结目前未入库（`?? reports/`）。建议卡 36 之前先 commit `reports/Know-项目成果总结-20261031.md`，保证 Library 源有 Git provenance；不 commit 则在 manifest 标注「源未入库」并记 sha256。
- **Q4 记忆条数扩展**：16 条为首批；「同档噪声带」「prompt 包 03–10 未试用」「flag audit 48 旗标」等可选立条，按检索命中情况二批补充。

## 8. 成本与影响面

- 新增仓库文件：`docs/specs/04`、`docs/adr/ADR-033`、执行卡 33–37、`tools/dev/distill-memories-to-nmem.mjs`、`tools/dev/validate-memories.mjs`、`tools/dev/link-memories-to-nmem.mjs`、`pipeline/tools/nmem-recall.mjs`、`pipeline/tools/test/test_any2skills_nmem_recall.mjs`、`artifacts/any2skills_ontology_patch.json`、`docs/guides/nmem-memory-protocol.md`、批准 marker 与证据归档。
- nmem 侧写入（G1 后）：1 space、1 agent、2 rules、1 WM、16 memories、11 links、5 library docs、1 space ontology。
- `npm test` 保持零网络零凭据；门禁/生成链路不 import nmem 代码。
