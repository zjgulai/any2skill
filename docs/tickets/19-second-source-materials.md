# 19：第二源补素材——产物按源命名空间 + 反模式章抽取

**要构建什么：**把卡 18 段③ 的两个前置缺口补上，让第二源（rust-book-cn）**在真实仓库里
（不再依赖隔离根）**跑到发布门径脚下：① 环 3 产物**按源命名空间**（`clusters.<key>.json` 等）；
② 补抽该源的反模式/错误处理章，让陷阱段有来源。

**为什么非独立不可（实测）：**卡 18 段③——第二源全链只能跑在 `/tmp` 隔离根里
（`clusters.json`/`skill-candidates.json` 是单源固定路径，真实仓库跑会覆写第一源的
划分产物与冻结基线）；且 ownership 切片的三个候选**全部**因 `## 常见陷阱` 与
`## 配套代码` 两段为空被门禁一拒。

**状态：**完成（2026-10-14）。**剩余一处待拍板：**`## 配套代码` 段的处置（见文末选项）。

## 交付

**① 按源命名空间（提交 `14cfe3d`）**

- 缺省键文件名**逐字节不变**（第一源冻结/比对/引用一概不动）；其他源加 `.<key>` 后缀。
- 助手 `clustersRelPath` / `clustersPartialRelPath` / `candidatesRelPath`（partial 以
  `.partial.json` 结尾以命中 .gitignore），四个 IO 函数与全部消费者
  （propose-clusters / build-skill / run-gate2 / apply-resplit）穿透 `--source-key`。

**② 反模式章抽取（完成）**

- 4 文件逐文件独立账本：`ch09-03`（6 锚点→9 对象）、`ch12-03`（13→21）、`ch17-03`（10→15）、
  `ch18-02`（1→2）——合计 **47 对象全过门禁一**，账本 552 条（126/183/158/85）。
- **AntiPattern 真实产出 5 个**（ch09-03×1、ch12-03×3、ch17-03×1）——对象类型的跨源迁移
  拿到第二证据（第一源有此类型，第二源在反模式章亦抽出，不是第一源的偶然）。

**③ 实仓全量环 3（完成，第一源零接触）**

- 8 章就绪面（ownership 切片 4 + 反模式 4）→ 16 单元 → **候选 6 个**；
  覆盖：门禁通过 50，未归类 0，未解析 id 0，重复归属 0，无候选单元 0。
- 产物落 **`pipeline/knowledge/clusters.rust-book-cn.json`**、
  **`pipeline/registry/skill-candidates.rust-book-cn.json`**；第一源 13 章被**可见跳过**。
- 零接触证据：`git status` 第一源产物无改动；卡 14 的 MVP 冻结（45 文件）在全部工作后
  仍 `--verify` 逐一致。
- 已知诊断不涉功能：`diagnosticsOf` 的 `/^chapter\d+$/` 对 `ch04-01-…` 式章名计 0（卡 18 已记）。

**④ 命名空间补漏（提交 `0df8ad6`、`67559b1`）——本卡又抓到两处**

- **跨章反模式池是固定文件名**：`build-skill` 的环 4 装配会把**第一源**的
  `antipatterns.objects.json` 读进第二源 skill 的陷阱段（装配层实漏）；`propose-clusters`
  的跨章块与 `run-book` 的反模式分布同样跨源串池（实仓 rust 环 3 的跨章块报了第一源的
  14 条结论——日志层实证）。修：`crossChapterObjectsFile`/`isCrossChapterObjectsFile`
  助手（缺省名逐字不变），三处消费点按源取池；`run-book` 分布表另按回执 `source.path`
  归属过滤。回归 3 条（助手等价性/装配池泄漏/分布归属过滤）。
- **环 4 输出 `clusterSource` 写死 `'clusters.json'`**：改为 `clustersRelPath(sourceKey)`；
  空池时不再按 mtime 翻到第一源判定表（消除噪声告警），npm test 560 通过 / 0 失败。
- **刻意不做（记录不半开）：** `synthesize-antipatterns.mjs`（跨章合成）与 `themes.json`
  主题目录强绑定，目录未按源命名——给它开 `--source-key` 会把**第一源的合成内容写进
  rust 名下**，比不开更糟。第二源的跨章合成待「主题目录按源命名」后开放（结构待办）。

## 环 4 判决（6 候选干跑，门禁一）

| 候选 | 陷阱段 | 剩余拒因（门禁一） |
| --- | --- | --- |
| ch09-03-…-s1 | ✅ 1 条 | `## 实践模式`（该章对象无 Concept）+ `## 配套代码` |
| ch12-03-…-s1 | ✅ 1 条 | **仅** `## 配套代码` |
| ch12-03-…-s2 | ✅ 2 条 | **仅** `## 配套代码` |
| ch17-03-…-s1 | ✅ 1 条 | **仅** `## 配套代码` |
| ch18-02-…-s1 | ❌ 0 条（章内真无反模式） | `## 常见陷阱` + `## 配套代码` |
| ch02-00-…-s1 | ❌ 0 条（教程章，无 AntiPattern） | `## 常见陷阱` + `## 配套代码` |

**结论：**

- **陷阱段修复生效**：4/6 候选的陷阱段由空填上——「补素材」假设成立；剩 2 个是章内
  **真无**反模式（内容缺口，非管线缺口，与卡 18 记录的两处内容缺口同类）。
- **拒因收敛**：3/6 候选的唯一剩余拒因 = `## 配套代码`。这正是卡 18 预言的收敛点。
- **`## 配套代码` 的性质（骨架假设 vs 来源缺口）：** 双重。
  1. **来源侧**：rust 书的示例代码在上游另一仓库（`rust-lang/book` 的 listings），本源
     `sources/rust-book-cn/code/` 不存在；且其代码是**行内清单**（listing）而非目录化项目。
  2. **骨架侧**：骨架要求「仓库相对路径 + 每个目录一句话说明」，而对象模型
     **没有任何字段承载代码指针**（门禁一同时报 `SECTION_NO_SOURCE`——"本段在信息源中
     没有对应字段"）。第一源能过，是它的 `code/chapterN/` 轻镜像恰好吻合
     `collectCodePointers` 的「目录+README」约定——**是巧合，不是机制**。
     即：配套代码段对信息源的**目录形态**有隐含假设，第二个源揭穿了它。

## 验收

- [x] 命名空间：缺省等价 + 后缀 + partial 后缀约束
- [x] 反模式抽取：47 对象全过；AntiPattern 5 个（类型迁移第二证据）
- [x] 实仓（非隔离根）rust 环 3：写 `clusters.rust-book-cn.json`，第一源零接触
- [x] rust 候选环 4 判决：陷阱段填上 4/6；3 个候选 **唯一**剩「配套代码」
- [x] 配套代码段性质写清（上节）
- [x] 冻结面更新（+2 文件 → 47）并重新冻结；**旧基线 45 文件仍逐一致**
- [x] 隔离账本复核：本批真实运行 4 账本 552 条（归档 `registry/history/rust-realgit-2026-10-14/`）
- [ ] **待拍板：** `## 配套代码` 段处置（选项见下）

## 待拍板：`## 配套代码` 段的处置选项

- **A. 源条件骨架**：骨架把「配套代码」段标记为**可选**（当且仅当源提供可消费的代码目录
  时要求；否则该段出「来源说明」而非空段）。改的是骨架合同 + 门禁一的段要求表。
- **B. 补第二源代码镜像**：从 `rust-lang/book` 镜像 listings 到 `sources/rust-book-cn/code/`，
  并加一层「行内清单 → 目录化」的转换（不便宜，且要定义「一章一目录」的拆法）。
- **C. 对象模型加字段**：给对象模型加「代码指针」类字段（如 `CodePointer` 对象类型），
  让代码段由对象驱动而非目录约定。动的是对象模型（第 2 层提示词与判据），最贵。

（倾向 A：它把「巧合」变成「显式条件」——第一源不受影响，第二源拿到如实的「本段无来源」；
B 的成本大头在转换层，C 动的是已冻结的九类对象模型。等拍板。）

## 核实方式

```bash
cd /Users/lute/Project/any2skills
ls pipeline/knowledge/clusters.rust-book-cn.json pipeline/registry/skill-candidates.rust-book-cn.json
node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-14T04-56-40.json   # 47 文件
node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T16-14-59.json   # 45 文件（第一源未动）
node pipeline/build-skill.mjs --cluster ch12-03-improving-error-handling-and-modularity-s1 --source-key rust-book-cn --dry-run --json
```
