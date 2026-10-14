# 21：第二源第二波——所有权补全 + 数据结构建模章（ch04/ch05/ch06）

**要构建什么（目标）：**把 rust 源的可发布候选面从 8 个已抽文件扩到 16 个：
本波补抽 **ch04-02（引用与借用）、ch04-03（切片）、ch05-01/02/03（结构体三节）、
ch06-01/02/03（枚举/match/if let）** 8 个文件——主题上构成「所有权 + 数据结构建模」两条连续弧，
与已抽的 ch04-01 接成完整的所有权主题。

**为什么是这 8 个而不是全量 97：**分段推进（卡 18 以来的既定节奏）；本批 ≈93KB 正文
（对照：反模式 4 章 84KB → 47 对象 / 30 锚点 / ~31 次调用），规模可控、主题连贯。
`ch04-00` 是 346B 的章引言（无内容）——跳过。

**状态：**进行中（2026-10-14）。

## 步骤

1. [ ] 环 2 抽取（8 文件，逐文件独立账本；deepseek 生产 + 判定者）
2. [ ] 环 3 按源重跑（旧 8 章输入身份一致 → 0 调用复用；新 8 章付费）——
       **注意**：重跑会重生成 clusters/candidates，卡 20 的 resplit 合并（s2→s1）随之消失，
       需在本波重跑后**重新应用**合并计划（更新版 plan）
3. [ ] 环 4 门禁一干跑全体新候选；确定本波可发布集
4. [ ] 门禁二（新候选；旧候选按输入身份复用场景与作答）
5. [ ] 发布 + 门禁三（与卡 20 同一路径）
6. [ ] 冻结更新（重跑后 clusters/candidates 漂移 = 本波预期变更；逐条核实恰为相关文件）
7. [ ] 卡记录 + 提交

## 验收

- [ ] 8 文件全绿（对象/回执入盘；账本非零；失败即续跑补齐）
- [ ] 环 3 重跑：旧 8 章 0 调用复用（日志可证），新候选入表
- [ ] 合并计划重新应用，s1↔s2 合并语义与卡 20 一致（零静默丢失断言过）
- [ ] 新候选门禁一判决；发布面如实（过几个发几个，拒因入卡）
- [ ] 第一源零接触（45 文件基线仍逐一致）
- [ ] 冻结核验 + 账本复核 + 本卡记录提交

## 核实方式

```bash
for f in ch04-02-references-and-borrowing ch04-03-slices ch05-01-defining-structs \
         ch05-02-example-structs ch05-03-method-syntax ch06-01-defining-an-enum \
         ch06-02-match ch06-03-if-let; do
  node -e 'const d=JSON.parse(require("fs").readFileSync("pipeline/knowledge/'"$f"'.objects.json","utf8"));console.log("'"$f"'",(Array.isArray(d)?d:d.objects).length)'
done
node pipeline/propose-clusters.mjs --source-key rust-book-cn --dry-run | tail -5
node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T16-14-59.json
```