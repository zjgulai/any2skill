# 11：环 3 语义聚类与 SkillCandidate（内容单元 → 候选）

**要构建什么：**把 593 个门禁一通过的知识对象切成**内容单元**（同章 + 同问题空间），再把内容单元聚成**候选 skill**，落盘 `clusters.json` 与 `skill-candidates.json`——并让**至少一个候选真的经环 4 装出 SKILL.md**。这一步把「对象能装配成 skill」的链路从「手工指定一个文档子树」推进到「由划分算法决定切哪里」。

**为什么这一卡非独立不可（实测）：**

- `clusters.json` / `skill-candidates.json` 在盘上**不存在**（ADR-019 开工时逐项 `[ -e ]` 检查，环 3–5 的产物全缺）。
- 环 4 当前只认 `--root-anchor`（一个文档子树），全盘唯一发布的 skill 是手工挑的 `chapter4#h2-2`——**「切哪里」这个决策至今没有任何机制产出**，是链路中间断掉的一环（ADR-019 决策 2 已声明「真正的语义聚类属环 3，本版不假装实现了它」）。
- 门禁二（环 5，卡 12）的「≥2 个 skill 争抢同一场景 → 粒度太碎」判据，需要一个**真实的划分**作为被检验对象；没有环 3 的产出，门禁二只能对着一个 skill 空转。
- ADR-007 的对照诊断（原书 22 skill / 10 章 ≈ **2.2 skill/章**）要有实际划分数字才能做。

**被谁阻塞：**09（已达成：13/13 完成、593 个通过对象在盘、隔离三轮验证通过）。**无阻塞，可开工。**

**原料规模（2026-10-12 回执口径，`book-07faf309c5a1`）：**对象 604（通过 593 / 拒绝 11）；逐文件 5–82 条；类型分布 Concept 265 / EngineeringRule 231 / AntiPattern 44 / Heuristic 31 / MentalModel 10 / DecisionModel 8 / Case 7 / Metric 5 / Playbook 3。

**状态：**设计已拍板（[`ADR-024`](../adr/ADR-024-ring3-implementation-form.md)，2026-10-12）；未开工。

## 规格指针（真源，不在本卡复述）

| 路径 | 读它的理由 |
|---|---|
| [`ADR-007`](../adr/ADR-007-skill-partition-semantic-clustering.md) | 划分原则：纯语义派生、**数量是结果不是配额**、门禁反向修正划分、**必须记录聚类依据**（使划分可复核） |
| [`ADR-004`](../adr/ADR-004-skill-granularity-and-skeleton.md) | 三层粒度：对象 →（5–15 条，同章 + 同问题空间）内容单元 →（3–8 个）skill；数字均为**建议值**（ADR-021 修订后的口径） |
| [`ADR-019`](../adr/ADR-019-ring4-deterministic-skill-assembly.md) | 环 4 的接口现状与「机械近似 vs 真语义」的分工声明；只消费门禁一判过「通过」的对象 |
| [`00-mvp-plan.md`](../specs/00-mvp-plan.md) §2.1 / §4.2 | 五环接口图；`SkillCandidate` 五字段 |
| ADR-013 / ADR-014 / ADR-017 | 身份、复用与续跑、输入预算的既有纪律（环 3 照用，不另立） |

## 已拍板（2026-10-12，决策全文与理由见 [`ADR-024`](../adr/ADR-024-ring3-implementation-form.md)）

1. **聚类策略：章内 LLM + 章节骨架确定性。** 按章切分（上界 13 个章级调用），章内把对象压成「id + 类型 + 一句话主张 + 锚点」喂模型，产出内容单元划分 + 每单元的聚类依据；**跨章合并 v1 不做**（留给门禁二的样测反馈——正是 ADR-007「让门禁反向修正划分」的用法）。
2. **环 4 增「按簇装配」入口。** 簇记录显式锚点集与对象集；环 4 读 `clusters.json` 的簇定义装配，复用现有装配管线与门禁一。**本卡内实现**——没有它，「对象 → skill」的端到端仍不可证伪。
3. **跨章综合物按 ADR-007 约定算出结论并落盘**（≥3 个独立场景且不属任何单章 → 独立成候选；否则分发进各 skill 的「常见陷阱」段），发布与否与门禁二一起定。

## 验收

- [ ] `pipeline/knowledge/clusters.json` 落盘：两级（内容单元 / 簇），每级含成员对象 id 与**聚类依据**（因何聚在一起），划分可复核
- [ ] **零静默丢弃**：每个门禁一通过的对象恰属于一个内容单元；未归类者进显式清单并带理由（口径承卡 09「一个都不静默跳过」）
- [ ] `pipeline/registry/skill-candidates.json` 落盘：`skillId` / `sourceObjects[]` / `trigger` / `chapterRefs[]` / `promotionState`（字段名照 MVP 计划 §4.2，不加私有别名）
- [ ] **端到端可证伪点**：至少一个候选经环 4 装出 SKILL.md 并通过门禁一（即：上面第 2 条接口扩展被真正实现，而不是只出数据）
- [ ] 事后偏差诊断：实际候选数 vs 2.2 skill/章 的对照表（**不设目标**；差异显著时按 ADR-007 出专项分析）
- [ ] 跨章综合物处置结论落盘（含依据）
- [ ] 身份与复用：输入身份进指纹（对象集哈希 + 提示词指纹 + 模型）；同输入复用不重买；提示词改动身份必变（ADR-013 / ADR-014 既有立场）
- [ ] 成本有界：模型调用次数与 token 进产物/回执；单章超预算时的切分或降级策略有测试（承 ADR-017 的预算纪律）
- [ ] 隔离不破：环 3 全程不读 `benchmark/`（用卡 09 的账本检查跑一遍）
- [ ] 测试：全部离线（LLM 路径用替身或录制样本）；上面每一条都有对应用例

## 核实方式（开工前先跑）

```bash
cd /Users/lute/Project/any2skills

# 原料在盘（604 / 593）
node -e 'const r=require("./pipeline/registry/book-07faf309c5a1.book-receipt.json");console.log(r.totals.objects, r.totals.passed)'

# 环 3 产物尚不存在（期望两条 ENOENT）
ls pipeline/knowledge/clusters.json pipeline/registry/skill-candidates.json 2>&1

# 环 4 当前只认 root-anchor
grep -n "root-anchor" pipeline/build-skill.mjs | head -3

# 单章规模（支撑输入预算的担忧）
node -e 'const o=require("./pipeline/knowledge/chapter7.objects.json");const a=Array.isArray(o)?o:o.objects;console.log(a.length, JSON.stringify(o).length+"B")'
```
