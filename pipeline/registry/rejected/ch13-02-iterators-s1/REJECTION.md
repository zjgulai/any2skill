# 拒绝记录 · ch13-02-iterators-s1「实现自定义迭代器／标准迭代器处理序列（合并体）」

**判定**：`rejected`（negative transfer 复现）——ADR-006 门禁三硬约束：**必须拒绝**。
这是本项目**第二个**确认的 negative transfer；也是**第一个在第二源（rust-book-cn）检出**的，
以及**第一个由合并体（apply-resplit）成为发布物后被拒**的。

## 证据

- 报告：`pipeline/registry/gate3-report.rust-book-cn.json`（`skills[]` 中
  slug=`ch13-02-iterators-s1` 的 verdict 块，runId 见该报告的 `tasksFile` 批）。
- 任务 `ch13-02-iterators-s1-t5`：创建 `zip_pairs.rs`——两个给定向量，
  `a.iter().zip(b.iter())` 配对、`collect::<Vec<_>>()` 收集、打印；检查单要求
  文件存在 + 四个必须出现的代码片段。
- **首轮**：无 skill 臂**过**；有 skill 臂**败**——文件存在、`zip`/`println!` 等片段都在，
  **缺 `.collect::<Vec<_>>()` 片段**（收集写法被改写成了别的形式）。
- **复跑（同题同夹具重采样）**：无 skill 臂再**过**；有 skill 臂再**败**（同一缺失片段）
  → 按 ADR-027 决策 3 的复跑制，判定为**确认退化**而非噪声。

## 处置

- 已从发布区移出（`pipeline/registry/rejected/ch13-02-iterators-s1/`，**移动而非删除**，可恢复）。
- 构建区记录保留（`pipeline/registry/build/ch13-02-iterators-s1/`，与 chapter3-s1 先例一致；
  重建核对：重建产物与原发布件**逐字节相同**，此后删除发布副本）。
- 机制说明（如实、不替它开脱也不夸大）：该 skill 讲迭代器与 `collect` 的用法，
  实测中把输出里 `collect` 的**写法**带离了任务显式要求的 turbofish 形式——
  与 chapter3-s1 同一族失效（词汇体系覆盖任务显式要求），只是这次落在**代码片段字面**上。
  n=2 的复现是判定依据；样本量小仍是事实。
- 后续：若修订正文（如把「任务给定了确切写法时逐字照用」写进正文）可重跑门禁三复评；
  在此之前它不回到发布区。同一波发布的重叠候选 `ch13-01-closures-s1/s2` 与
  `ch13-02-iterators-s1` 的被并者 `ch13-02-iterators-s2` 不随之受罚——后者已因合并
  不再独立存在，前者的门禁三为 passed（改进 1，无确认退化）。
