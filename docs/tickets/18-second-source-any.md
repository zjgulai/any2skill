# 18：第二信息源验证「any」

**要构建什么：**把流水线从「只认这本书」改造为**认源键**，并用第二个信息源
（[`rust-lang-cn/book-cn`](https://github.com/rust-lang-cn/book-cn)，《Rust 程序设计语言》中文，
mdBook 结构）**分段实跑**，回答项目名的另一半：**any 是否成立**。
三类隐藏假设会被一次性打出来：**路径写死**（实测见下）、**结构粒度**（文件=章的假设）、
**领域迁移**（9 类对象与反模式在编程语言领域是否还有量）。

**为什么非独立不可（实测）：**

- 源路径写死清单（本轮侦察）：`build-skill.mjs` ×4（两个入口的 `sourceRel` 与 `codeRootRel`）、
  `anchor-index.mjs` 的 `DEFAULT_SOURCE_ROOT`、`propose-clusters.mjs` 的 `SOURCE_ROOT_REL`——
  全部指向 `sources/ai-agent-book-zh/`。第二个源在这些点上**必然撞墙**，而不是「可能撞墙」。
- 选 rust-cn 的刻意性：它是**节级粒度**（~100 个 .md，一个文件≈一小节，而第一源一个文件=一章）。
  「文件=章」的假设散布在回执身份、环 3 的章级聚类、环 4 的 code 镜像路径等环节——
  这套结构在第一源上从未被质疑过。
- 候选源侦察记录：`progit2-zh` 的正文是 **AsciiDoc**（`.asc`），解析器只认 markdown，**排除**；
  `hello-algo` 结构更接近第一源（章目录+md），作备选。

**被谁阻塞：**无（MVP 已收尾；上游仓库可达已验证）。

**状态：**未开工（分段推进：① 多源参数化 → ② 环 1 全量 + 环 2 抽样 → ③ 看结果定全链切片）。

## 拍板（2026-10-14）

1. 第二源 = **rust-lang-cn/book-cn**（节级粒度、领域远）。
2. 深度 = **分段验证**：先参数化（离线）、再环 1 全量（零成本）+ 环 2 抽样真跑（3–5 文件、
   几十次调用），全链切片视抽样结果另批。

## 三段的验收

**段 ①：多源参数化（离线，不破坏第一源）**

- [ ] 出源键/源根机制（`sources/<key>/book`、`sources/<key>/code`），全部写死点逐一参数化
- [ ] **第一源回归**：默认行为逐字节不变（全套测试 + 任取一个既有产物重建比对）
- [ ] 第二源可被环 1 与环 2 直接消费（无需改核心解析器）

**段 ②：结构泛化实跑（花小钱）**

- [ ] 镜像 rust-cn 的 `src/**/*.md`（blobless + 逐文件哈希 + MANIFEST，照 §16 口径）
- [ ] 环 1 全量：文件数/锚点数/层级分布/零锚点文件清单；与第一源的分布对照
- [ ] 环 2 抽样 3–5 个文件（覆盖：普通节、含大代码块、附录/表格密集），真跑并给出：
      对象产出、类型分布、引文门禁通过率、失败形态（若有）
- [ ] 结论：哪些假设被打破、哪些环节需要真实改造（不改的也写明「为什么没撞上」）

**段 ③（视 ② 结果另批）**

- [ ] 选一个切片（如 ownership 一章的 4 个文件）跑环 3→环 4/门禁一，看能否出 SKILL.md

## 核实方式（开工前先跑）

```bash
cd /Users/lute/Project/any2skills
grep -rn "ai-agent-book-zh" pipeline/*.mjs pipeline/tools/*.mjs | grep -v test    # 写死点清单（本卡段 ① 的靶子）
npm test                                                                          # 起点：553 通过
node -e 'const s=require("./pipeline/registry/gate3-report.json");console.log("当前发布面:",require("fs").readdirSync("skills").length,"个 skill")'
```
