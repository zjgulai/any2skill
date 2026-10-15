# Agent 全栈工程师 · 技能套件导航（19 个任务技能）

本页按工作阶段组织 `skills/` 下的 19 个技能，供按任务查找。**本页不是技能**
（无 frontmatter、不参与触发）；边界与证据状态以
[ADR-031](../adr/ADR-031-task-skill-suite-reorganization.md) 与
`pipeline/registry/task-suite-status.v1.json` 为准。

> **证据状态（先读这一句）：** 19 个技能全部通过结构门禁（门禁一），
> **效用评估为 unassessed-after-recomposition**——重组使旧的效用测量不再对应这批
> 名称/描述/正文（ADR-030 证据边界）。未测 ≠ 已测出，引用它们做决策时按「结构合规、
> 效用未评」对待。

## 需求与设计阶段

| 任务 | 技能 |
|---|---|
| 划清 Agent 的观察/动作边界与职责分层 | `define-agent-boundaries` |
| 面向 Agent 的工具接口设计（粒度/描述/返回/分页/截断） | `design-agent-tools` |
| 用结构体、方法与枚举建模 Rust 领域类型 | `model-rust-domain-types` |
| 用泛型、trait 与 trait object 设计 Rust 抽象 | `design-rust-abstractions` |
| 用所有权安全地实现 Rust 状态模式 | `implement-rust-state-pattern` |

## 构建与安全阶段

| 任务 | 技能 |
|---|---|
| 护栏分层、防注入、不可逆操作把关、服务端真值 | `secure-agent-actions` |
| 渲染验证与安全交付生成产物（界面/SQL/代码） | `validate-generated-artifacts` |
| 诊断并修复 Rust 借用/切片/生命周期错误 | `diagnose-rust-borrows` |
| 文本与键值集合的 UTF-8 安全与所有权处理 | `process-rust-text-and-hashmaps` |
| 递归类型、析构时序与单线程内部可变性 | `manage-rust-memory-and-mutability` |
| Rust 并发：线程/通道/Arc<Mutex> | `coordinate-rust-threads` |
| Rust CLI 拆分与 Result 错误传递 | `structure-rust-cli` |

## 运行与协作阶段

| 任务 | 技能 |
|---|---|
| 状态栏、压缩、缓存前缀与预算的上下文治理 | `manage-agent-context` |
| 多 Agent 拓扑、任务协议、冲突与失败模式 | `coordinate-agent-work` |
| 用模式匹配处理枚举变体与可反驳模式 | `match-rust-variants` |
| 闭包创建、捕获约束与缓存 | `compose-rust-closures` |
| 运行、筛选与串行化 Rust 测试 | `run-rust-tests` |

## 验证与进化阶段

| 任务 | 技能 |
|---|---|
| 「模型不能自批完成」的独立验证机制 | `verify-agent-completion` |
| 从失败轨迹生成可回滚的指令补丁 | `update-agent-instructions` |

## 覆盖缺口（诚实声明）

本套件**不包含**：前端组件库/设计系统、Python/TypeScript 项目脚手架、RAG 与向量检索、
模型网关、云部署与可观测性、跨组织协议的完整实现。这些方向在源素材中无对应内容，
未虚标（`task-suite.test.mjs` 有断言钉住描述不得出现此类声明）。Rust 技能**显式限定
为 Rust**，不冒充跨语言能力。

## 改动这套技能的入口

1. 边界调整 → 改 `pipeline/curation/task-skill-suite.v1.json`（对象所有权；测试会验
   并集与不相交）。
2. 步骤/输入/交付物调整 → 改 `pipeline/curation/workflows/<slug>.json`（编辑层）。
3. 重建：`node pipeline/build-task-suite.mjs`（staging）；`npm test` 过后续跑
   `node pipeline/publish-task-suite.mjs`（幂等；已迁移态为 no-op）。
4. 追溯旧章节技能：`pipeline/registry/task-suite-lineage.v1.json` + 归档
   `pipeline/registry/legacy-published/chapter-suite-v1/skills/`（逐字节保留）。