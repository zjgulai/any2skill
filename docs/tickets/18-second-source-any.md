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

**状态：**段① ② 已完成（2026-10-14，记录在文末）；**段③ 待拍板**（先做环3按源过滤改造，再选切片跑环4/门禁一）。

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

## 构建记录（2026-10-14）

### 段① 多源参数化（提交 b64e81a / c2c2b35）

- `anchor-index`：`DEFAULT_SOURCE_KEY` + `sourceBookRoot/sourceCodeRoot` 助手为**单一真源**；
  路径守卫本就支持 `sourceRoot` 覆盖，本次把它真正接上。
- 全部写死点参数化：`run.mjs`（CLI_FLAGS + 守卫 + 用法）、`run-book`（消费并从子进程透传
  `--source-key`）、`propose-clusters`、`build-skill`（含 `loadClusterAssemblyInputs`）、`run-gate2`。
- **第一源回归**：默认键行为不变（三条 dry-run 烟测 + 555 测试全绿）；烟测顺带抓到一个
  `--json` 路径掩盖的残留引用（人肉输出里的 `codeRootRel`，已修 c2c2b35）。
- 新增测试：源键助手 + 守卫按源键放行/不匹配仍拒（`source-key.test.mjs`，2 条）。

### 段② 结构泛化实跑

**镜像**：rust-lang-cn/book-cn @ `cde74c44`（blobless + sparse-checkout src），
**105 个 .md / 1,055,581 字节**，逐文件哈希在 `sources/rust-book-cn/MIRROR-MANIFEST.md`。

**环 1 全量（零成本，105 文件）**：**513 个锚点、层级 1–5、零解析失败、零零锚点文件**——
解析器对第二源结构**零改造即通**。粒度对照：每文件锚点中位 **4**（节级）vs 第一源 **25.8**（章级）。

**环 2 抽样（4 文件真跑）**：`ch02-00`（代码教程 18 锚）/ `ch04-01`（概念 10 锚）/
`appendix-02`（表格 3 锚）/ `ch15-04`（短节 3 锚）：

| 口径 | 值 |
|---|---|
| 对象产出 | **55**（29 / 17 / 3 / 6） |
| 门禁一 | **100% 通过，零拒绝** |
| 判定者 | **100% supported**（29/17/3/6，零 insufficient） |
| 类型分布 | Concept 32 / EngineeringRule 20 / Heuristic 2 / AntiPattern 1 |
| 抽检 | ownership 的定义忠实、引文逐字（markdown 强调保留）、锚点可解析 |

类型分布自洽：语言教科书概念偏重；AntiPattern 仅 1 条是因为反模式集中在**未抽样**的章
（错误处理/设计模式章）——领域信号，不是抽取失败。

### 撞墙清单（哪些假设被打破——实测，不是猜测）

| 环节 | 结果 |
|---|---|
| 环 1 / 环 2 | **参数化后即通，零改造**（这就是段①的全部工作量） |
| **下游枚举（环 3 输入 / 主题目录）** | **实锤混源**：`propose-clusters` 的枚举源无关——任一源键下，另一半文件的回执都找不到（实测：默认键下列出 rust 文件并报「缺 ai-agent-book-zh 的回执」）。knowledge 平面跨源混流是段③前的**必备改造**：按回执的 `source.path` 归属过滤 |
| `diagnosticsOf` 的 `/^chapter\d+$/` | rust 文件名是 `ch04-01-…` → 2.2/章诊断计 0（纯诊断，无功能影响，如实记录） |
| 配套代码段 | `sources/rust-book-cn/code/` 不存在 → 段③若装配 rust skill，`SECTION_EMPTY` 大概率复现——**代码镜像与源强耦合**是已知限制的第二次显形 |

### 隔离（含一条方法错误自查）

- 首轮抽样的账本被外层 `node -e` 覆盖（共用同一 `DSH_FS_LEDGER` 路径）→ 读到 **0 条**。
  按本仓纪律，**0 条不是证据、是方法错误**——用**回放**（零模型调用）逐文件独立账本路径复取：
  **4 份 / 265 条 / benchmark 内容访问 0**，证据成立。
- 教训已可入陷阱清单：**绝不共用账本路径做循环运行**。

### 成本

第 2 层 34 次调用（35857+112698 / 19713+68393 / 7416+13845 / 6712+21503）；
判定者 57 次。
