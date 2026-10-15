# 拒绝记录 · match-rust-variants「用模式匹配处理 Rust 变体与可反驳模式」

**判定**：`rejected`（negative transfer 复现）——ADR-006 门禁三硬约束：**必须拒绝**。
本项目**第四个**确认的 negative transfer；任务套件评测（卡 27/ADR-032）产出。

## 证据

- 报告：`pipeline/registry/gate3-report.rust-book-cn.json`（`skills[]` 中本 slug 的 verdict 块）
- 任务 `match-rust-variants-t6`：定义 `Command { Quit, Help, Run(String), List }` 与两个函数；
  检查单按字面要求断言输出格式，包括 `Run(program) => println!("running {program}")`
  与「`List =>` 不得出现」（通配分支要求放在最后）。
- **首轮**：无 skill 臂**过**；有 skill 臂**败**——缺少片段
  `Run(program) => println!("running {program}")`（该分支的输出写法被改写）。
- **复跑（同题同夹具重采样）**：无 skill 臂再**过**；有 skill 臂再**败**（同一缺失片段）
  → 按 ADR-027 决策 3 的复跑制，判定为**确认退化**而非噪声。
- 同任务对全景（t1–t6）：双过 5、**确认退化 1（t6 复跑复现）**——0 改进亦无碍判定：
  确认退化一票否决（ADR-006）。

## 处置

- 已从发布区移出（`pipeline/registry/rejected/match-rust-variants/`，
  **移动而非删除**，可恢复）；构建区记录保留。
- 清单的 `rejected` 段保留其所有权记录，并集可验不破。
- 机制说明（如实）：该 skill 教「穷举 match / 通配最后 / if let 位置规则」，实测中把
  任务显式规定的**分支输出写法**带离了字面要求——与另外三个拒绝同一族失效
  （**技能词汇覆盖任务字面**）。这是本族失效在四例中的第三次复现（chapter3-s1、
  ch13-02-iterators-s1、implement-rust-state-pattern、本例）——「任务给定了确切写法时
  逐字照用」已可作为修订该族正文的既知方向，但修订与复评另立卡，不在本轮执行。
- 后续：修订正文后可重跑门禁三复评；在此之前不回到发布区。来源对象（ch06-02 + ch18-02）
  保持可用但不得未修订原样复活。
