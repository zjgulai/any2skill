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

**状态：**已达成（2026-10-13）——三道门禁至此全部建成并实测；结果与口径边界见文末真实段记录。
设计决策见 [`ADR-027`](../adr/ADR-027-gate3-implementation-form.md)（含一处实现级收紧：
检查单改声明式、不执行生成代码）。

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

- [x] **A/B 两臂同任务同夹具**：`gate3-report.json` 逐任务落盘配对表（两臂的检查结果、复跑、差异方向）
- [x] **检查器确定性**：求值是纯函数（读文件 + 逐条判定）；坏检查（正则编译失败）只判该条失败，有测试
- [x] **独立性**：任务生成 / 两臂执行 / 判分三个独立上下文（判分为确定性求值器、零模型）；
      无 skill 臂的题面有哨兵反证的测试
- [x] **判定规则落地并有测试**：退化 → 复跑 → 拒/记噪声/无效任务/Pending 五条路径都有用例；
      **真实运行演练了「退化→复跑→不复现→记噪声」全链路**（t6）
- [x] **门禁三报告落盘**：2 个 skill 的判定 + 逐任务对照 + 成本账
      （生成 4,676+15,281；执行 31,753+117,138 token）
- [x] **风险标记第一次有了下游**：两 skill 的 `PITFALL_COVERAGE_BELOW_ADVISORY` 在报告的抽样理由里显式引用
- [x] 隔离不破：账本 678 条访问，`benchmark/` 内容访问 0、`skills/` 写入 0，`assertIsolation` 通过
- [x] 测试：16 条全离线（替身调用 + 真跑的检查器求值）；`npm test` 547 通过 / 0 失败
- [x] README 状态终稿（三道门禁全建成）；卡 13 遗留议题在 README 与卡内均有指向

## 构建记录（2026-10-13，真实段）

### 结果

| skill | 判定 | 改进 | 确认退化 | 噪声 | 无效任务 |
|---|---|---:|---:|---:|---:|
| chapter4-single-tool-design | **passed** | 1（t3） | 0 | 1（t6） | 1（t5） |
| chapter4-tool-design-principles | **low-utility** | 0 | 0 | 0 | 1（t1） |

- **MVP 验收第 3 条达成**：「门禁三至少检出或排除一次 negative transfer」——本轮**排除**：
  两 skill 均无确认退化；且 t6 的退化事件经复跑后不复现、按机制记噪声——
  **复跑制本身被真实用例完整演练了一遍**。
- t3（改进）：设计安全删除工具的任务，无 skill 臂没接住、有 skill 臂通过。
- t6（噪声）：设计多模态分析工具，首轮「无过/有败」，复跑后两臂都过。
- 两个**无效任务**（两臂都败）都栽在同一种检查上：要求输出**逐字包含**术语
  （「静默注入」「真实调用示例」），两臂大概率用了别的措辞——这是**检查单表达力**的
  首批实测数据（ADR-027 未决 1），不是 skill 效用的信号。

### 如实记录的口径边界

- **n 很小**（K=6、每 skill 一个无效任务）：passed/low-utility 都是弱信号，
  只说明「方向上没有危害」，不足以宣称显著更优。
- **low-utility 的降级动作未定义**（ADR-006 要求「降级」、ADR-027 未决 2 留给后续）：
  本轮只记录判定，未执行任何降级。
- 自包含任务测的是方向性差异，不是真实场景绝对表现（报告 `note` 已写明）。

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
