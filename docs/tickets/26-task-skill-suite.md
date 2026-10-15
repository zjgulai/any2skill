# 26：岗位技能套件重组——30 个章节技能 → 19 个任务技能

**要构建什么：**按用户（Agent 全栈工程师）拍板的「重组为岗位技能体系 / 多语言按任务组织」，
把 30 个章节编号发布物重组为 19 个任务型技能 + 1 份岗位导航文档，并让发布、溯源、
历史证据在迁移全程可核。决策全文在 [ADR-031](../adr/ADR-031-task-skill-suite-reorganization.md)。

**状态：**完成（2026-10-15）——发布面 30 → **19**；旧 30 逐字节归档；测试 571/0。

## 构建记录（全部实测数字，可复算）

### 命名与边界（用户可见的落点）

`pipeline/curation/task-skill-suite.v1.json` —— 19 个成员的 slug/标题/旧 slug 映射/
**精确 owned 对象与 AP**。8 个 Agent 工程工作流（英文动宾 slug + 中文任务名）：
`define-agent-boundaries` / `secure-agent-actions` / `manage-agent-context` /
`design-agent-tools`（两 ch4 合并去重）/ `validate-generated-artifacts` /
`coordinate-agent-work` / `verify-agent-completion` / `update-agent-instructions`；
11 个 Rust 实现工作流：`diagnose-rust-borrows` / `model-rust-domain-types` /
`match-rust-variants` / `process-rust-text-and-hashmaps` / `design-rust-abstractions` /
`compose-rust-closures` / `manage-rust-memory-and-mutability` / `coordinate-rust-threads` /
`structure-rust-cli` / `run-rust-tests` / `implement-rust-state-pattern`。

四个章节做了逐对象拆分（chapter1/chapter2/chapter5/chapter10 → 8 个 Agent 成员）；
拆分映射在清单生成脚本里机械校验「每个对象恰好一个主人」，并集相等两源分别通过：
**第一源 164/164、rust 254/254**。

### 装配机制

- `pipeline/tools/task-skill-builder.mjs`：清单装载、逐对象门禁核验（回执通过集 +
  跨章判定表 runId 身份）、纯函数渲染（两遍逐字节相同）、来源/编排分离、
  出处回链。溢出阀：逐锚点全列超限时改按文件聚合（本轮 19 个全部 full 即可，
  最大 11,251B < 16,568B）。
- `pipeline/build-task-suite.mjs`：staging 构建 CLI（`--publish` 另门控；
  缺省绝不触碰 `skills/`）。
- `verify-skill.mjs` 增加 `skeleton` 参数与 `numbered` 计数（缺省行为逐字节不变——
  旧测试全绿即证）；`build-task-suite.mjs` 与门禁共用同一校验器实现。

### 迁移（原子切换）

- `pipeline/publish-task-suite.mjs`：预检（19 全过门禁一才动盘）→ 迁移前逐文件哈希 →
  归档（30 个目录逐字节移入 `legacy-published/chapter-suite-v1/skills/`，移动后复验
  **32 文件 0 不一致**）→ 发布 19 → 写 lineage（30→19 映射）与 status。
- **幂等实测**：二次运行 no-op（「已迁移（幂等 no-op）」）；测试
  `task-suite.test.mjs` 增「仓库处于已迁移态」断言（活动面=套件 19、归档面=旧 30、
  旧 slug 无触发桩）。
- **旧冻结语义**：迁移前 152 文件冻结验证通过（迁前证据）；迁移后旧冻结对 `skills/**`
  报 **32 处漂移，逐条核对恰为被迁移的 30 个 SKILL.md + 2 个 references 文件**——
  由 lineage 归档哈希接管可证性（ADR-031 决策五）。

### 验证与验收

- `task-suite.test.mjs` 8 项：清单唯一性/引用齐备/rejected 隔离；两源并集相等与
  主对象不相交；AP 并集相等（允许共享，与主对象刻意不同）；19 成员逐个装载过门禁；
  工作流完整性；两遍渲染逐字节相同；描述诚实性（通用不虚标、Rust 显式写 Rust——
  本项当场抓到 2 处描述漏词并修正）；已迁移态。
- 发布面通用断言重写（skill-gate.test.mjs）：**每个**发布物哈希=契约 markdownHash
  且按各自骨架过门禁一——比原先单 slug 断言更强，新旧两套并存期均可用。
- 门禁三干跑对新套件正常：第一源 8 + rust 11 = 19（两源过滤各自正确）。
- `npm test` **571 通过 / 0 失败**；新冻结 **250 文件**逐一致。

### 如实缺口（不掩盖）

- **门禁二/三对任务套件的付费评估未跑**：status = `unassessed-after-recomposition`
  （ADR-031 决策四）；重测由用户显式发起，发起时先立评估口径 ADR。
- 门禁二「套件目录模式」未实现（重测发起时一并设计）。
- 旧冻结不再对新发布面可验证（历史语义，ADR-031 决策五已记录）。