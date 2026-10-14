# 20：第二源首发——rust 3 候选走完发布路径

**要构建什么（目标）：**让 rust-book-cn 的 3 个候选（ch12-03-improving-error-handling-and-modularity-s1、
ch12-03-…-s2、ch17-03-oo-design-patterns-s1）从「过门禁一」走到**发布区**，并留下与第一源
同口径的门禁二/三记录——「any」（任何书 → skills）主张的最硬证据。

**为什么非独立不可：**卡 19 只把第二源带到门禁一脚下的**干跑**；发布路径（skills/ 落盘、
门禁二候选级记录、门禁三发布物级记录、冻结纳入）每一步都会碰第一源冻结面上的产物——
而门禁二/三的产物路径此前是**单源固定名**（与卡 19 前的 clusters 同病）。

**状态：**完成（2026-10-14）——2 个 rust skill 入发布区（1 个门禁三 passed、1 个 low-utility 如实记录）。

## 构建记录（2026-10-14，真实段）

### 门禁二（候选级，两读数 + 稳定对）

- 6 候选 × (3 命中场景) + 20 无关场景；**0 漏触发、0 误触发**（两读数一致）。
- list：4 通过 / 2 冲突；strict：3 通过 / 3 冲突。
- 动作清单（两读数都给同一结论）：`ch12-03-s1 ↔ ch12-03-s2` 相互共认领（各 2 场景）
  → **稳定合并对**（[`gate2-stable.rust-book-cn.json`](../../pipeline/registry/gate2-stable.rust-book-cn.json)：
  stable 1 / listOnly 0 / strictOnly 1）。strictOnly 弱信号（ch09-03-s1|ch12-03-s2）不构成依据。
- 代价与事故如实记录：首启未带 `--require`（账本缺失）而重启、二启 `--require` 裸相对路径被
  当包名解析（`./` 前缀修复）、三启（list 正式）中途一次「空内容」瞬时失败（非可重试路径，
  按设计走续跑）；**场景与已作答经 partial 全部复用，重复付费为 0**——但首启约 3 分钟的
  场景生成未落入任何账本（重启后账本覆盖其余全部调用）。

### 重切（合并，零模型调用）

- 用户拍板「先合并再发布」。`resplit-plan.rust-book-cn.json`（approved）→ `apply-resplit --source-key rust-book-cn`：
  s2 并入 s1（21 对象、零静默丢失断言过），候选 6 → 5。
- **这一改动使卡 19 的 47 文件冻结对两份 rust 产物出漂移——逐条核实恰为这两个文件**
  （clusters.rust-book-cn.json / skill-candidates.rust-book-cn.json），即合并本身；其余 45 个与
  卡 19 冻结、卡 14 基线冻结均逐一致。漂移已由本卡新冻结（62 文件）解释并取代。

### 发布 + 门禁三（发布物级）

- 发布 2 个（门禁一过：s1 合并后 8543B / ch17-03-s1 6719B，均无需溢出）。
- 门禁三（ADR-027 口径）：

| skill | 判定 | 改进 | 确认退化 | 噪声 | 无效任务 | 依据 |
|---|---|---:|---:|---:|---:|---|
| ch12-03-…-s1 | **passed** | 1 | 0 | 0 | 2 | t5 有 skill 臂严格更优 |
| ch17-03-…-s1 | **low-utility** | 0 | 0 | 1 | 1 | t6 退化事件复跑**不复现**→记噪声；无改进无确认退化（ADR-006 降级标记，不拒绝） |

- 孤立账本：list 489 / strict 483 / gate3 715 条记录，**基准目录外 0**。
  （三个账本与三份运行日志归档 `pipeline/registry/history/rust-realgit-2026-10-14/`。）

### 冻结

- FROZEN_PATHS +9（rust 环 3/重切/门禁二/三产物）→ 新冻结 **62 个文件**逐一致；
  旧 45 文件基线仍逐一致；卡 19 的 47 文件冻结的漂移恰为上述两份（已解释）。

## 前置：门禁二/三按源命名空间（已完成，提交见卡 20（一））

- gate2：`gate2-scenarios.<key>.json` / `gate2-report[.strict].<key>.json` /
  `gate2-answers[.mode].<key>.partial.json` / `gate2-stable.<key>.json`（缺省键逐字不变）。
- gate3：`gate3-tasks.<key>.json` / `gate3-report.<key>.json` / partial 同理；
  **被测物按源归属过滤**（契约 `provenance.sourceFile`）——两源的书不同，效用结论不可互相代表。
- 顺手修掉两处漏网：gate2 的候选**清单**读的还是固定 `skill-candidates.json`；
  错误信息里的路径现在按源打印。
- 回归 2 条；`npm test` 562 通过 / 0 失败。

## 验收

- [x] rust skill 在发布区（**2 个**而非 3 个——用户拍板先合并 s1+s2 再发布，见构建记录）
- [x] 门禁二两份读数 + 稳定对落盘（rust 命名空间）；第一源产物零接触
- [x] 门禁三报告覆盖 2 个 rust 发布物；退化事件按 ADR-006 复跑路径处理（t6 不复现→噪声）
- [x] 第一源零接触（45 文件基线冻结仍逐一致 + git status）
- [x] 隔离账本非空且断言通过（0 基准目录外；首启无账本段落如实记录）

## 核实方式

```bash
ls skills/ch12-03-improving-error-handling-and-modularity-s1/SKILL.md \
   skills/ch12-03-improving-error-handling-and-modularity-s2/SKILL.md \
   skills/ch17-03-oo-design-patterns-s1/SKILL.md
ls pipeline/knowledge/gate2-scenarios.rust-book-cn.json pipeline/registry/gate2-report.rust-book-cn.json \
   pipeline/registry/gate2-report.strict.rust-book-cn.json pipeline/registry/gate2-stable.rust-book-cn.json \
   pipeline/knowledge/gate3-tasks.rust-book-cn.json pipeline/registry/gate3-report.rust-book-cn.json
node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T16-14-59.json   # 旧基线仍逐一致
```