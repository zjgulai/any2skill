# 拒绝记录 · implement-rust-state-pattern「用所有权安全地实现 Rust 状态模式」

**判定**：`rejected`（negative transfer 复现）——ADR-006 门禁三硬约束：**必须拒绝**。
本项目**第三个**确认的 negative transfer；任务套件评测（卡 27/ADR-032）产出。

## 证据

- 报告：`pipeline/registry/gate3-report.rust-book-cn.json`（`skills[]` 中本 slug 的 verdict 块）
- 任务 `implement-rust-state-pattern-t6`：创建 `trait_state.rs`、`enum_state.rs`、
  `comparison.md`——红绿灯状态机（trait 路线不允许跳过转换；枚举路线实现同一状态机），
  检查单按字面要求断言 `enum_state.rs` 含片段 `enum State`。
- **首轮**：无 skill 臂**过**；有 skill 臂**败**——`enum_state.rs` 缺少片段 `enum State`
  （枚举路线的命名被改写成了别的形状）。
- **复跑（同题同夹具重采样）**：无 skill 臂再**过**；有 skill 臂再**败**（同一缺失片段）
  → 按 ADR-027 决策 3 的复跑制，判定为**确认退化**而非噪声。
- 同任务对全景（t1–t6）：双过 2、改进 1（t5）、双败 1（t2）、噪声 1（t3 复跑不复现）、
  **确认退化 1（t6 复跑复现）**——确认退化一票否决（ADR-006）。

## 处置

- 已从发布区移出（`pipeline/registry/rejected/implement-rust-state-pattern/`，
  **移动而非删除**，可恢复）；构建区记录保留（`pipeline/registry/build/<slug>/`）。
- 清单（`pipeline/curation/task-skill-suite.v1.json`）的 `rejected` 段保留其所有权记录，
  并集可验不破。
- 机制说明（如实、不替它开脱也不夸大）：该 skill 系统讲授「trait 对象 + Box + take」的
  OO 状态模式，实测中把双路线任务里**枚举路线的命名**带离了任务显式要求——与前两个
  拒绝（chapter3-s1 字段命名、ch13-02 代码片段字面）同一族失效：**技能的既有词汇会
  覆盖任务的字面规定**。n=2 的复现是判定依据；样本量小仍是事实。
- 后续：若修订正文（如把「任务给出了确切命名时逐字照用」写进技能边界）可重跑门禁三
  复评；在此之前不回到发布区。其来源对象（ch17-03 的 15 个）在对象平面保持可用，
  但不得未修订原样复活。
