# 14：门禁三 · 效用 A/B（环 5 下半，最后一道门禁）

**要构建什么：**给**已发布的 skill** 做第一次效用实测——同一批代表性任务，分别在
**「无该 skill」与「有该 skill」**两种条件下执行，比较任务表现；产出配对对照表与判定，
把 **negative transfer（有 skill 反而更差）** 变成可检出、可拒绝的事实。
这是三道门禁里唯一能检出「skill 有害」的机制（ADR-006：**唯一必须存在的非结构门禁**），
也是 [`ADR-021`](../adr/ADR-021-section-item-counts-advisory.md) 风险标记等了两个月的下游。

**为什么这一卡非独立不可（实测）：**

- **风险标记至今无消费者**：两个已发布 skill 的契约都带
  `PITFALL_COVERAGE_BELOW_ADVISORY`（`chapter4-tool-design-principles` 8 对象、
  `chapter4-single-tool-design` 20 对象）——ADR-021 把它们路由到「门禁三抽样重点」，
  而门禁三不存在，这条路由一直是空转。
- **门禁一/二都说不出口的那句话**：门禁一说「合不合规」，门禁二说「找不找得到」；
  「有没有用、会不会有害」只有门禁三能答（`verify-skill.mjs` 文件头划的界）。
- MVP 验收标准第 3 条明文要求：门禁三**至少检出或排除一次 negative transfer**。

**被谁阻塞：**12（已达成）——门禁三测**已发布物**，而发布物已就位（2 个）。
**无阻塞。**

**状态：**三处已拍板（[`ADR-027`](../adr/ADR-027-gate3-implementation-form.md)，2026-10-13，
含一处实现级收紧：检查单改声明式、不执行生成代码）；未开工。

## 规格指针（真源，不在本卡复述）

| 路径 | 读它的理由 |
|---|---|
| [`ADR-006`](../adr/ADR-006-three-quality-gates.md) 门禁三一节 | 定义（消费者 agent、A/B、抽样、negative transfer 必须拒绝）与三条硬约束 |
| [`ADR-021`](../adr/ADR-021-section-item-counts-advisory.md) | 高风险定义（覆盖不足 → 门禁三）与「风险标记必须落盘、不得只打日志」的约束 |
| [`ADR-022`](../adr/ADR-022-judge-vision-all-anchors.md) 未决 1 | **噪声底纪律**：任何「A 比 B 差」的结论，先对照既有噪声估计——本卡的判定规则必须把它写进机制 |
| arXiv:2605.23899（ADR-006 已核实） | negative transfer 非平凡且与模型规模无关 → 不能靠「换强模型」代替实测 |
| `skills/` 下两个已发布产物 + 各自 `skill-contract.json` | 被测物与它们的风险标记 |

## 已拍板（2026-10-13，决策全文与理由见 [`ADR-027`](../adr/ADR-027-gate3-implementation-form.md)）

1. **任务形态 = 自包含可验证任务**：任务生成器产出 K=6 个任务（`task.md` + 夹具 + 检查单）；
   消费者臂产出 `{"files": {...}}` 由台架物化进临时沙箱；**评分 = 检查单求值**，不靠主观打分。
   **实现级收紧（ADR-027 决策 2）**：检查单是**声明式 JSON**、由本仓固定求值器执行——
   不执行模型生成的代码（把「执行生成代码」这一新风险面挡在 v1 外）。
2. **判定规则 = 一次退化事件 → 复跑确认 → 复现即拒**；不复现记噪声（ADR-022 未决 1 的
   噪声底纪律落到机制上）；两臂都失败记「任务无效」并可见。
3. **抽样 = 两个已发布 skill × K=6 × 2 臂**（≈36 次调用）；未发布的合并候选不进。

## 验收

- [ ] **A/B 两臂同任务同夹具**：配对表逐任务落盘（臂、产物、检查结果、差异方向）
- [ ] **检查器确定性**：同一产物重复判分结果相同；检查器损坏时测试能发现（可失败的反证）
- [ ] **独立性**：任务生成、两臂执行、判分为三个独立上下文；构建者不参与任何一臂的评分
- [ ] **判定规则按拍板落地并有测试**：退化事件 → 复跑 → 拒/记噪声，三条路径都有用例
- [ ] **门禁三报告落盘**（`gate3-report.json`）：逐任务对照 + 每 skill 的判定
      （通过 / 低效用 / **拒绝（negative transfer）**）+ 成本账
- [ ] **风险标记第一次有了下游**：被测 skill 的 `PITFALL_COVERAGE_BELOW_ADVISORY`
      在报告里显式引用（抽样理由），路由闭环
- [ ] 隔离不破：全程不读 `benchmark/`（账本工具跑一遍）
- [ ] 测试：全部离线（执行调用用替身；检查器为真跑的本机脚本）；上面每一条都有对应用例
- [ ] README 状态终稿（三道门禁全建成的口径）+ 卡 13 遗留议题的指向

## 核实方式（开工前先跑）

```bash
cd /Users/lute/Project/any2skills

# 两个已发布 skill 与它们的风险标记（抽样理由）
for s in chapter4-tool-design-principles chapter4-single-tool-design; do
  node -e 'const c=require("./pipeline/registry/build/'"$s"'/skill-contract.json");console.log("'"$s"'", (c.riskFlags||[]).map(r=>r.flag).join(","))'
done

# 门禁三尚不存在（期望 ENOENT）
ls pipeline/registry/gate3-report.json 2>&1

# 高风险定义原文
grep -n "高风险定义为" docs/adr/ADR-006-three-quality-gates.md
```
