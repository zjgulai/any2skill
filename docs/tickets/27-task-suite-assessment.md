# 27：任务套件评测——门禁二目录模式 + 门禁三全量一轮

**要构建什么：**终结 19 个任务技能的 `unassessed-after-recomposition` 状态。
口径全文在 [ADR-032](../adr/ADR-032-task-suite-assessment.md)。

**状态：**完成（2026-10-15/16）——发布面 **19 → 17 → 15**；最终 **6 passed / 9 low-utility /
2 rejected**；评测记录 `pipeline/registry/task-suite-assessment.v1.json`。

## 执行记录

### 门禁二（套件目录模式，两轮 × 两读数）

| 轮次 | 候选 | list 判定 | strict 判定 | 稳定对 | 录取 |
|---|---:|---|---|---|---|
| 预合并 | 19 | 5 过 / 14 争抢 | 4 过 / 15 争抢 | 11 条，4 条 strict≥2 | 2 对合并 |
| 合并后 | 17 | 7 过 / 10 争抢 | — | 6 条，**0 条达线** | 无 |

**全程 0 漏触发、0 无关场景误触发**（20 无关场景 × 2 轮）。可发现性结论：**明显收敛
但未完全收敛**——旧套件首轮是 40/40 全争抢、96 冲突组；新套件首轮 5 过 / 14 争抢、
18 冲突组，说明任务命名+精确描述有效，但共享领域词汇（"边界""约束"）天然引起共认领。

**合并（用户拍板「两对都合，联名重写」）**：
- `define-agent-boundaries-and-safeguards` ← define + secure（strict 3/3 最强边）；
- `coordinate-agent-work-and-verification` ← coordinate + verify（strict 2/1）；
- 被并者逐字节归档 `legacy-published/task-suite-v1-premerge/`；测试期望同步（17）。
- 合并后残留稳定边 6 条全部 strict=1——**合并轮闭合**。

### 门禁三（两源全量，一轮）

| 源 | passed | low-utility | rejected | 确认退化 |
|---|---:|---:|---:|---:|
| 第一源（6 个） | 4（manage-agent-context 改进 4、update-agent-instructions 3、coordinate-…-verification 1、validate-generated-artifacts 1） | 2 | 0 | 0 |
| rust（11 个） | 2（run-rust-tests 改进 4、process-rust-text-and-hashmaps 1） | 7 | 2 | 2 |

**两个确认负迁移已下架**（ADR-006，REJECTION.md 全证据）：
- `implement-rust-state-pattern`：t6 双路线任务里枚举路线命名被改写（缺 `enum State`），
  复跑复现——**第三例**「技能词汇覆盖任务字面」族失效；
- `match-rust-variants`：t6 分支输出写法被改写（缺指定 `println!` 片段），复跑复现——**第四例**。

### 与旧套件的对照（如实）

- **头差变厚了**：第一源 4/6 passed（旧套件 4/8）；`manage-agent-context` 与
  `run-rust-tests` 各 4 个改进——**任务骨架的「执行步骤」段显然带来可测增益**（与 H1
  「常规任务无头差」并不矛盾：骨架把“怎么做”显式化了，而旧正文只有"是什么"）。
- **负迁移率**：15+2 中 2 例（约 12%），与旧套件全周期同量级；失效族第四次复现
  「技能词汇覆盖任务字面」——**已可命名**：这四个 skill 都是「有强既有词汇的技法类」，
  它们的词汇在任务给出确切写法时造成漂移。修订方向（「任务给定确切写法时逐字照用」
  写进该类技能边界）记录在首次 REJECTION.md，修订与复评**另立卡**。

### 落盘与状态

- `task-suite-assessment.v1.json`（两轮门禁二读数 + 门禁三逐成员 + 拒绝记录 + 归档指针）；
- `task-suite-status.v1.json`：trigger/utility 两项由 unassessed 更新为 assessed；
- 冻结 **255 文件**；`npm test` **572/0**。

### 如实缺口

- 预合并读数已随报告覆盖归档进 history（assessment 文件里指了路径与哈希）；
- low-utility 9 个按 ADR-030 披露路线留区（README/导航文档将披露）；
- 拒绝两例的来源对象保持可用但**不得未修订原样复活**（REJECTION.md 已写）。
