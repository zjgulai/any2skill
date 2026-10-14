# 19：第二源补素材——产物按源命名空间 + 反模式章抽取

**要构建什么：**把卡 18 段③ 的两个前置缺口补上，让第二源（rust-book-cn）**在真实仓库里
（不再依赖隔离根）**跑到发布门径脚下：① 环 3 产物**按源命名空间**（`clusters.<key>.json` 等）；
② 补抽该源的反模式/错误处理章，让陷阱段有来源。

**为什么非独立不可（实测）：**卡 18 段③——第二源全链只能跑在 `/tmp` 隔离根里
（`clusters.json`/`skill-candidates.json` 是单源固定路径，真实仓库跑会覆写第一源的
划分产物与冻结基线）；且 ownership 切片的三个候选**全部**因 `## 常见陷阱` 与
`## 配套代码` 两段为空被门禁一拒。

**状态：**进行中（命名空间已完成，反模式抽取运行中，2026-10-14）。

## 交付

**① 按源命名空间（已完成，提交 `14cfe3d`）**

- 缺省键文件名**逐字节不变**（第一源冻结/比对/引用一概不动）；其他源加 `.<key>` 后缀。
- 助手 `clustersRelPath` / `clustersPartialRelPath` / `candidatesRelPath`（partial 以
  `.partial.json` 结尾以命中 .gitignore），四个 IO 函数与全部消费者
  （propose-clusters / build-skill / run-gate2 / apply-resplit）穿透 `--source-key`。
- 测试：助手等价性与写入行为；`npm test` 558 通过 / 0 失败。

**② 反模式章抽取（进行中）**

- 选 4 个文件：`ch09-03-to-panic-or-not-to-panic`、`ch12-03-improving-error-handling…`、
  `ch17-03-oo-design-patterns`、`ch18-02-refutability`——它们承载该书的「坏做法/权衡」内容。
- 逐文件**独立账本**（卡 18 的教训：绝不共用账本路径）。

## 验收

- [ ] 命名空间：缺省等价 + 后缀 + partial 后缀约束（已完成）
- [ ] 反模式抽取：对象产出与类型分布入卡；AntiPattern 是否在该源**真实产出**（类型迁移的第二证据）
- [ ] 真实仓库（非隔离根）跑 rust 全量环 3：写 `clusters.rust-book-cn.json`，**第一源零接触**
- [ ] rust 候选的环 4 门禁判决：陷阱段是否填上、剩余拒因是否收敛到**唯一一段**
- [ ] 若收敛到「配套代码」：把该段的性质写清（骨架假设 vs 来源缺口）并给处置选项（需拍板）
- [ ] 冻结面更新（把 rust 的两份产物纳入）并重新冻结
- [ ] 隔离账本复核（本批所有真实运行）

## 核实方式

```bash
cd /Users/lute/Project/any2skills
node -e 'import("./pipeline/tools/cluster-proposer.mjs").then(m=>{console.log(m.clustersRelPath(),"|",m.clustersRelPath("rust-book-cn"))})'
ls pipeline/knowledge/clusters.rust-book-cn.json pipeline/registry/skill-candidates.rust-book-cn.json   # 环 3 跑完后
grep -c 'objectType": *"AntiPattern"' pipeline/knowledge/ch09-03-to-panic-or-not-to-panic.objects.json 2>/dev/null || true
```