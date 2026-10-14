# 22：跨章反模式合成按源命名——主题目录/清单/合成产物三件套

**要构建什么（目标）：**解开卡 19 记录的结构缺口（`synthesize-antipatterns` 与第一源的
`themes.json` 强绑定、对第二源**刻意未开** `--source-key`），让第二源获得自己的
**跨章反模式池**（ADR-016 机制：AntiPattern 是跨章综合物）。目标效果：为「陷阱段空」的
候选（ch04-02、ch06-01、ch06-02、ch18-02、ch02-00）供来源——卡 21 实测规律：教科书写法
不在章内供给反面教材，跨章合成是设计内正解。

**为什么非独立不可：**三件套（anchor-catalog / themes / antipatterns.objects）都是**单源固定路径**，
且合成器的输入链（清单 → 目录 → 各文件锚点索引）任一环按源参数化不全都会串源或 ENOENT。

**状态：**完成（2026-10-14）——发布区 12 → **16**（合成解锁 4 个 + 4 个已发布物按新装配重建）。

## 结果（截至门禁三前）

- **主题提案**：12 主题、全部跨 ≥2 章；T04（自定义类型与模式匹配，13 章）覆盖 ch05/ch06 全部被拒章、
  T01（所有权借用生命周期，11 章）覆盖 ch04-02、T02（错误处理）覆盖 ch09-03——提案质量即命中缺口章。
- **合成**：12 主题全绿，95 条原始（每主题 7–8 条）→ 判定：**76 过 / 19 拒**
  （JUDGE_INSUFFICIENT 14、JUDGE_NOT_SUPPORTED 4、QUOTE_MISMATCH 1）。
  产物 `antipatterns.rust-book-cn.objects.json`（95 条全存）+ 判定表，身份自洽（run-fd491f2468f0）。
- **门禁一重跑（缺口候选）**：ch04-02 ✅（跨章 AP 3）、ch06-01 ✅（1）、ch06-02 ✅（3）、
  ch18-02 ✅（1）——**4 个解锁**；ch02-00 仍 ❌（跨章 AP 0，T10 未以它为成员）、
  ch09-03 仍 ❌（其缺口是"实践模式/无 Concept"，合成不产对象类型——不同缺口类）。
- **陈旧化与重建**：跨章 AP 注入改变已发布物的装配——4/5 个已发布 rust skill 陈旧
  （ch17-03 无重叠不变）。全部重建（含 4 个新发布）→ 发布区 **12 → 16**，9 个 rust skill 字节一致。
- **口径错误修正**：`antipattern-verdict-report` 声称「被拒对象不在对象集文件里（只装通过的）」——
  实测证伪（19/19 条被拒对象在文件里；章级对象文件同口径）。文档两处 + 把错误文本钉成回归的
  测试一条，全部按真实口径修正。

## 交付（代码）

- `catalogRelPath(sourceKey)` / `themesRelPath(sourceKey)` 助手（缺省键逐字节不变）。
- `propose-themes.mjs --source-key`：目录按 `sourceBookRoot(key)` 建、按源写盘；
  顺带修实漏：`buildAnchorCatalog` 的守卫没带 per-source 根（第二源被守卫自己挡在门外）。
- `synthesize-antipatterns.mjs --source-key`：读命名空间清单/目录，产物写
  `crossChapterObjectsFile(key)`；回执 `themes.manifestPath` 记实际路径。
- 环 1 实漏：文献源全 105 文件的锚点索引**只落盘了 16 个**（catalog 是内存现算的）——
  补跑 `writeAnchorIndex` ×89（确定性、零模型）。

## 门禁三（9 个 rust 发布物全量，含 4 个重建与 4 个新发）

| skill | 判定 | 改进 | 确认退化 | 噪声 | 无效任务 |
|---|---|---:|---:|---:|---:|
| ch05-01-defining-structs-s1 | **passed** | 1 | 0 | 2 | 1 |
| ch12-03-…-s1 | **passed** | 1 | 0 | 0 | 0 |
| ch04-02-references-and-borrowing-s1 | low-utility | 0 | 0 | 0 | 0 |
| ch04-03-slices-s1 | low-utility | 0 | 0 | 0 | 1 |
| ch05-03-method-syntax-s1 | low-utility | 0 | 0 | 0 | 1 |
| ch06-01-defining-an-enum-s1 | low-utility | 0 | 0 | 0 | 0 |
| ch06-02-match-s1 | low-utility | 0 | 0 | 0 | 0 |
| ch17-03-…-s1 | low-utility | 0 | 0 | 1 | 1 |
| ch18-02-refutability-s1 | low-utility | 0 | 0 | 0 | 3 |

**0 确认退化**；7 个 low-utility 全为「任务要么双过要么双败」的如实标记（ADR-006 降级不拒绝）。
新解锁的 4 个内容正确但效用未实测出增量——**如实记录，不美化**：合成解锁的是**准入**
（陷阱段有来源→过门禁一），不是**效用**（门禁三说了算，而门禁三说它们目前测不出增量）。

冻结：FROZEN_PATHS +3（合成三件套）→ 新冻结 **93 文件**逐一致；45 基线仍逐一致。
账本：主题 658 / 合成 443 / 门禁三 2346 条，全 0 外部；日志与账本归档 history。

## 验收

- [x] 三助手等价性回归（缺省逐字不变/其他源加后缀）
- [x] rust 合成产物与判定表落盘且身份自洽（runId run-fd491f2468f0 声明一致）
- [x] 陷阱空候选判决变化如实：4 解锁 / 2 仍拒（ch02-00 无覆盖、ch09-03 属另一缺口类）
- [x] 第一源零接触（45 基线冻结仍逐一致；守卫修复不触内容）
- [x] 账本复核（0 外部）+ 卡记录提交