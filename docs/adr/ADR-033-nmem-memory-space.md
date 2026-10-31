# ADR-033 · 为 any2skills 建立专属 Nowledge Mem 记忆空间与知识图谱

- 状态：已接受（2026-10-31）
- 决策者：用户（确认 Space 命名 `any2skills`；G1 四域批准后才有 nmem 写入）
- 关联：`docs/specs/04-nmem-memory-kg-plan.md`（落地方案与验收映射）、
  执行卡 33–37、ADR-002（双平面结构——本决策沿用其边界：nmem 代码只在工具面与开发面）、
  ADR-030（诚实披露——low-utility 口径进 L1 记忆）

## 背景

项目已完成 MVP（两源全链跑通、17 技能在发布区、32 ADR），但项目知识只存在于盘上文档：
跨会话的口径漂移已经开始出现——default 空间的两条旧记忆指向已改名的报告路径、
记录「尚无专属 Space」。SOP《智能体记忆系统与知识图谱构建规范》v2.0 提供了基于
Nowledge Mem 的四层记忆治理方法论（物理隔离 / 认知金字塔 / 领域本体 / 读写闭环），
已在 pr-agent、si-agent、kb-consultant-agent 三个空间落地过。

## 决策

1. **建专属 Space `any2skills`**（strict 模式，显示名「Any2Skills 技能生产线（Know）」），
   与既有四空间物理隔离；Agent 身份 `any2skills-steward`（生产线守门人）。
2. **记忆走四层金字塔**：L1 核心准则（decision/1.0，证据可回查、门禁独立、诚实披露、零静默）、
   L2 业务口径（fact/0.9）、L3 避坑实证（learning/0.85）、L4 沉淀纪要（context/past）。
   首批 16 条聚合蒸馏，**不逐条灌入** 1089 知识对象与 273 条出处引用（SOP 经验：聚合优先）。
3. **图谱走「记忆节点 + 显式 link」路线，不做实体抽取**。实测 nmem 0.10.111：
   `entities` 无 create，`ontology apply` 只声明词汇不生成实例（kb 先例
   `extraction.active=false`、407 实体仍是默认类型）。空间本体（10 objectTypes +
   8 linkTypes）作为词汇层建立，实例化路径依赖后续评估 `ontology retype`（有全局迁移风险）另立票。
4. **读写闭环落地在本仓的工具面与开发面**：读侧 `pipeline/tools/nmem-recall.mjs`
   （3 秒超时、异常降级空串、min_score 0.70，只被会话调用）；写侧
   `tools/dev/distill-memories-to-nmem.mjs`（默认 dry-run，显式 `--apply` 才写）。
   生成链路与门禁不 import nmem 代码，`npm test` 保持零网络、零凭据。
5. **nmem 写入需要批准门**：所有写操作按「draft 落盘 → G1 四域批准
   （A space/agent/rules/WM、B 记忆、C Library、D 本体）→ write → verify」执行，
   未获批准只允许 dry-run。这是卡 32「先落盘 + 待定协议」惯例在记忆域的移植。

## 被否决的方案

- **复用 default 空间**：跨项目污染（SOP 第一维），且 default 已有 129 条异质记忆。
- **全量灌入知识对象**：1089 条碎片会稀释检索相关度（SOP 复盘 §5.1）。
- **直接全局 `ontology apply`**：`--scope global` 是全局写入；space scope 整体替换
  影响面限于本空间，且 patch 显式声明全部 linkTypes，不依赖 global 复用。

## 后果

- 正面：项目口径（三道门禁、三态判定、多源命名空间、六条避坑）随会话自动注入；
  ⌘5 可见 16 节点 + 11 边的显式记忆图谱，`graph expand` 可多跳。
- 代价：每次记忆维护需要同步 `distill-memories-to-nmem.mjs` 与 ADR/README，双真源
  以脚本为单一真源（记忆正文只在该脚本维护）。
- 风险：`ontology apply` space scope 无 dry-run 且整体替换——apply 前必须先存
  global 与 space 的 effective JSON 基线；`memories update` 会让 link add 稳定 422，
  入库后不改，必要时 delete + 同 ID 重建。

## 核实方式

SOP 八条验收基线，映射见 `docs/specs/04-nmem-memory-kg-plan.md` §6；
执行证据归档 `docs/audits/any2skills-nmem-acceptance-*.json`。
