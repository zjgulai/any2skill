# 13：按门禁二反馈重切划分（ADR-007 回路的最后一段）

**要构建什么：**把门禁二两读数里的**稳定信号**变成对划分的实际修正，并验证修正真的消解了信号：
① 把「两读数对照」从一次性分析变成可复跑的工具与落盘产物；② 建一个**确定性合并/降级执行器**
（纯结构操作，不重新调用聚类模型）；③ 执行批准后的修正清单，重建受影响的候选（环 4 + 门禁一），
并跑**第三次门禁二（strict 口径）**看稳定对是否消解——**回路只有被量到才叫闭合**。

**为什么这一卡非独立不可（实测）：**

- ADR-007 的修正表（争抢→合并、零命中→并入或降级）此前没有执行者：门禁二报告按 ADR-026
  明确「只出清单不执行」。清单已经在盘上：`gate2-report.strict.json` 的稳定对与动作。
- 两读数的**交集分析目前是一次性命令**（当时用 `node -e` 现算），不可在本仓复跑——
  修正决策不能建立在一段没有身份、没有测试的临时计算上。
- 修正执行需要一个**能写划分、能归档旧版本、能交代依据**的执行器：手工改 `clusters.json`
  会让「谁改的、凭什么改、改前是什么」全部消失，而这正是本项目反复拒绝的事。

**被谁阻塞：**12（已达成：两读数 + 87 稳定对 + 1 零命中 + 动作清单在盘）。**无阻塞。**

**状态：**两处已拍板（2026-10-13）；**执行计划已落在 `pipeline/registry/resplit-plan.json`（`approved:false`，待批准）**。

## 规格指针（真源，不在本卡复述）

| 路径 | 读它的理由 |
|---|---|
| [`ADR-007`](../adr/ADR-007-skill-partition-semantic-clustering.md) | 修正表原文与「退回环 3」的语义；必须记录**聚类依据**（本卡的依据 = 门禁二场景证据） |
| [`ADR-024`](../adr/ADR-024-ring3-implementation-form.md) 决策 1 / 未决 | 跨章合并 v1 刻意未做、明确留给门禁二反馈——现在反馈到了，要不要执行是本次拍板之一 |
| [`ADR-026`](../adr/ADR-026-gate2-implementation-form.md) | 「动作清单不等于执行」的边界；本卡是那个执行 |
| `pipeline/registry/gate2-report.strict.json` / `gate2-report.json` | 两个读数的原始判定；稳定对的来源 |
| [`卡 12`](12-gate2-trigger-blind-test.md)「校准结论」 | 87 对存活 / 68 对格式产物 / 分级的完整清单 |

## 交付物（三件）

1. **对照工具**：`gate2-compare`（纯函数 + CLI）：输入两份报告，输出
   `gate2-stable.json`——稳定对 / 仅宽松口径 / 仅严格口径三分，附每对的场景数（两读数各计）。
   ad-hoc 计算退场；表里的 87/68/5 变成可复跑断言。
2. **重切执行器**：`apply-resplit`（确定性，零模型调用）。输入一份**批准后的修正清单**
   （机器可读，逐条：`{action: merge|demote, target, into?, basis}`），执行：
   - **merge**：`into` 吸收 `target` 的 units 与对象（**并入语义**，不新建身份——被吸收者的
     触发场景证据与门禁一状态沿 `into` 延续；`target` 从候选表移除，理由入档）；
   - **demote**：候选退出（不装配、不发布），理由入档；
   - 旧 `clusters.json` / `skill-candidates.json` **先归档**（`knowledge/history/` 与
     `registry/history/` 的既有习惯），新版本写 `resplit` 块交代：改了什么、依据哪几对场景。
3. **闭环验证**：受影响候选走环 4 重建 + 门禁一复跑；再跑**第三次门禁二（strict 口径）**，
   验收指标：**被修正的稳定对在新读数里消解**（不再共认领）或如实记录为什么没消解。

## 已拍板与执行计划（2026-10-13）

**拍板**：① 修正范围 = **全量含跨章**（用户拍板，覆盖卡初稿的「v1 只做同章」推荐）；
② 闭环验证 = **含第三次门禁二（strict 全量重读）**。

### 画图时发现的硬事实：共认领不是等价关系

87 个稳定对构成的图，**连通分量是一个 38/40 个候选的巨型分量**——照「合并组」字面执行
会把整本书塌成一个 skill。因此执行形态改为：**在「strict 场景数 ≥2 且两读数都存」的
强边上做不相交最强配对**（每个候选至多被吸收一次），吸收者按「对象数 → 严格命中数 →
字典序」确定。这是本次执行的规则，写在计划文件的 `rule` 字段里。

### 执行计划（`pipeline/registry/resplit-plan.json`，11 对，4 对跨章）

| 吸收者 (into) | 被并入 (target) | strict / list | 吸收者对象数 | 备注 |
|---|---|---|---|---|
| chapter10-s3 协作模式编排 | chapter10-s2 可靠性验证与失效治理 | 2 / 5 | 22（hits 3 vs 0） | 零命中者的去处即此 |
| chapter1-s2 执行路径与框架选择 | chapter1-s4 评估验证与能力更新 | 2 / 4 | 15 | |
| chapter9-s3 可验证业务与流程提炼 | chapter9-s1 轨迹经验提取 | 2 / 4 | 8 | |
| chapter4-s1 单工具设计与审查 | chapter4-s4 多模态感知与内容读取 | 2 / 4 | 13 | s4 的双信号之一在此兑现 |
| chapter7-s1 评估系统设计搭建 | chapter7-s2 评估结果分析与诊断 | 2 / 4 | 40 | 合并后 75 对象——体量风险由门禁一实测 |
| chapter1-s1 Agent基础与边界设计 | chapter1-s3 安全治理与高风险控制 | 2 / 3 | 21 | |
| chapter5-s3 代码生成应用与规则正确性 | reference-answers-s1 运行安全与工具治理 | 2 / 3 | 18 | 跨章 |
| chapter10-s1 架构设计多 Agent 系统 | chapter2-s1 上下文框架与执行基础 | 2 / 2 | 25 | 跨章 |
| chapter3-s1 用户记忆体系设计 | chapter3-s3 知识治理与领域建模 | 2 / 2 | 21 | |
| chapter2-s3 运行时上下文治理与安全 | chapter4-s2 工具供应链与执行治理 | 2 / 2 | 24 | 跨章 |
| chapter9-s2 学习载体与自进化更新 | afterword-s1 后记核心框架与策略 | 2 / 1 | 10 | 跨章 |

每对的场景级依据（`strictScenarioIds` / `listScenarioIds`）在计划文件里逐对可查。
**跨章 4 对需要一个前置实现**：环 4 的簇模式现在拒多章候选（`loadClusterCandidate` /
`loadAssemblyInputs` 都是单章）——它是本卡的实际工作量之一。

## 验收

- [ ] `gate2-compare` 落盘 `gate2-stable.json`：稳定对 / 仅宽松 / 仅严格三分，数量与卡 12 记录一致（87/68/5），有测试
- [ ] 修正清单是**机器可读的独立文件**，逐条带依据（哪几对场景、来自哪个读数）——不是一段脚本里的硬编码
- [ ] 执行器确定性：同清单 + 同输入 → 同产物；旧划分先归档；新划分带 `resplit` 交代块
- [ ] **零静默丢失**：被合并者的每个对象在新划分里恰属于一个单元；被降级者的对象去向显式（并入方或退出理由）
- [ ] 受影响候选经环 4 重建、门禁一复跑：结果如实（通过则发布，被拒则记录拒因——不为了让流程好看而调口径）
- [ ] **第三次门禁二（strict）**：被修正的稳定对消解情况逐对报告（消解/未消解/新出现）
- [ ] 隔离不破：全程不读 `benchmark/`（账本工具跑一遍）；重建与重读的成本如实记账
- [ ] 测试：对照工具与执行器全离线；本卡不新增任何「改判据」类改动
- [ ] README 状态更新 + 卡 12「动作清单」各条标注执行去向（执行/缓办/理由）

## 构建记录（2026-10-13）

### 离线段（已提交 `0b0c145`）

- `--compare`：两读数三分对照产品化，真实数据复算 **87/68/5** 与卡 12 一致；
  产物 `pipeline/registry/gate2-stable.json`。
- 环 4 多章支持：`loadClusterAssemblyInputs`（候选 `chapterRefs` 各章合流后走同一过滤，
  单章是长度为 1 的特例、无分叉）；`loadClusterCandidate` 单元跨章收集 + `chapterRefs` 显式化；
  provenance 增 `clusterChapterRefs`。门禁二候选加载切到同一函数。
- `apply-resplit`：三条硬校验（approved / 配对不相交 / 零静默丢失）、内容哈希归档、`resplit` 块。
- 测试新增 9 条；`npm test` **530 通过 / 0 失败**。

### 执行（2026-10-13）

- 计划批准落痕：`approved:true` + `approvedBy:"user（对话批准：全量含跨章 11 对原样执行）"`。
- `apply-resplit` 实跑：**11 对合并应用，候选 40 → 29**；归档
  `knowledge/history/clusters.1323557f.json` 与 `registry/history/skill-candidates.98842f73.json`；
  两份新产物带 `resplit` 块（合并记录 + 移除清单 + 计划哈希）。
- 跨章 4 对落成：`chapter10-s1 ← chapter2-s1`（49 对象）、`chapter2-s3 ← chapter4-s2`（33）、
  `chapter5-s3 ← reference-answers-s1`（29）、`chapter9-s2 ← afterword-s1`（15）。

### 重建判决（11 个吸收者走环 4 + 门禁一）

| 吸收者 | 对象 | 体积 | 门禁一 | 备注 |
|---|---:|---:|---|---|
| **chapter4-s1** | 20 | 9,538 | **通过** | 已按原 slug 重新发布：`chapter4-single-tool-design` 7,146 → **9,538 字节** |
| chapter10-s3 | 36 | 13,451 | 拒：SECTION_EMPTY + SIZE_EXCEEDED | 合并后超 12KB |
| chapter1-s2 | 18 | 7,660 | 拒：SECTION_EMPTY | 配套代码段无来源（只有 chapter4 有镜像，ADR-020 的已知缺口） |
| chapter9-s3 | 14 | 5,182 | 拒：SECTION_EMPTY | 同上 |
| chapter7-s1 | 68 | 24,950 | 拒：SECTION_EMPTY + SIZE_EXCEEDED | 最大合并体，体积是最重的问题 |
| chapter1-s1 | 30 | 12,995 | 拒：同上 | |
| chapter5-s3 | 29 | 13,141 | 拒：同上 | |
| chapter10-s1 | 49 | 20,369 | 拒：同上 | |
| chapter3-s1 | 34 | 13,660 | 拒：同上 | |
| chapter2-s3 | 33 | 16,286 | 拒：**仅 SIZE_EXCEEDED** | 吸收了 chapter4-s2 → 带上了 chapter4 的配套代码段（跨章候选继承来源的意外好处） |
| chapter9-s2 | 15 | 6,034 | 拒：SECTION_EMPTY | |

**读法**：合并消解争抢的代价被门禁一量化了——**8/11 撞体积上限、9/11 缺配套代码来源**。
这不是「合并错了」，是两条已记录的既有约束在更大簇上第一次被同时压到（ADR-019 的体积阈值、
ADR-020 只镜像了 chapter4 的来源缺口）。下一步若要让合并候选发布，得先决定：缩小合并粒度、
允许溢出到 `references/`、或补镜像其余章的配套代码——三条都超出本卡，记为后续议题。

### 第三读数与证据归档

- 第二次严格读数的报告与答案账本已按内容哈希归档进 `registry/history/`
  （`gate2-report.strict.5f6d90d4.json` / `gate2-answers.strict.cc16820b.json`）——
  **不静默覆盖**；「报告覆盖应机制化为自动归档」记为后续改进项。
- 第三次严格读数（重切后目录）：11 个变更候选重生成场景、其余复用；盲测场景数
  29×3 + 20 = 107。验收指标：11 对被修正的稳定对是否消解（结果见下节）。

## 核实方式（开工前先跑）

```bash
cd /Users/lute/Project/any2skills

# 两读数与动作清单在盘
node -e 'const s=require("./pipeline/registry/gate2-report.strict.json");const l=require("./pipeline/registry/gate2-report.json");console.log("strict/ list actions:", s.actions.length, l.actions.length)'

# 稳定对交集当前是一次性计算（本卡要把它产品化）——复算一遍
node -e '
const L=require("./pipeline/registry/gate2-report.json"), S=require("./pipeline/registry/gate2-report.strict.json");
const pairs=(r)=>{const m=new Set();for(const c of r.perCandidate)for(const s of c.scenarios)for(const t of s.triggered)if(t!==c.skillId)m.add([c.skillId,t].sort().join("|"));return m};
const PL=pairs(L), PS=pairs(S);
console.log("稳定",[...PS].filter(x=>PL.has(x)).length,"仅宽松",[...PL].filter(x=>!PS.has(x)).length,"仅严格",[...PS].filter(x=>!PL.has(x)).length);
'   # 期望 87 68 5

# 两个单点信号的原始证据
node -e 'const s=require("./pipeline/registry/gate2-report.strict.json");const m=s.perCandidate.find(c=>c.skillId==="chapter10-s2");console.log(m.promotionState, m.scenarios.map(x=>x.triggered.join(",")).join(" / "))'
```
