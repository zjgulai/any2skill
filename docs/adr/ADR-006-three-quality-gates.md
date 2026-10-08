# ADR-006 · 质量门禁：三道独立门禁，构建者不得自评

- 状态：已接受
- 日期：2026-10-08
- 决策者：用户（拍板「A」）
- 关联：ADR-004、ADR-005

## 背景

从知识对象到可发布 skill 需要一个「凭什么算达标」的判定机制。

**两个外部背书：**

1. **原书自身的实践中包含「提议者-审核者」（proposer-reviewer）模式。** 原文实测位置：
   - `chapter10.md:228` —— 专节 `#### 提议者-审核者范式`
   - `chapter4.md:282` —— `**提议者-审核者：独立模型的安全审查。**`（分「事前审批」与「事后验证」两种机制）
   - **`chapter3.md:524`** —— 「两个 Agent 应优先使用**能力相近但来自不同家族**的模型……不同的训练数据、偏好和推理习惯可降低两者在同一处犯同类错误的概率；能力则不宜悬殊」。**这是「不同家族」表述的唯一出处，不在 chapter4。**
   - `chapter4.md:308` 补充辨析：提议者-审核者审查开放式思考故需能力相近；Sidecar 判简单分类问题故可用轻量模型——**审查对象不同，对审查者的能力要求也不同**。
   - `chapter4.md:310` 还给出配套机制「**拒绝熔断器**」：连续多次拒绝应转人工而非无限重试。

   ⚠️ 更正留痕：本 ADR 初稿把「来自不同家族」的出处写成 chapter4，**原文如此、实测为假、现已更正为 chapter3.md:524**。

2. **arXiv:2605.23899**（已核实存在：*From Raw Experience to Skill Consumption: A Systematic Study of Model-Generated Agent Skills*，Huang et al.，2026-05-22）。其 utility-grounded 评估框架的核心结论：
   - model-generated skills **平均有益，但存在非平凡的 negative transfer**。
   - **extractor 与 consumer 表现不一致**（一个模型可以是强提取者却是弱消费者，反之亦然）。
   - **skill utility 与模型规模、基线任务强度无关**。
   - 论文最终把发现落成一个 **meta-skill** 用于引导提取走向与真实效用相关的特征，**显著降低负迁移**。

⚠️ **引用纪律**：nuwa-skill 自述「LLM 自评 skill 质量准确率仅 46.4%，引自 SkillLens 论文（arXiv 2605.23899）」——**该数字在论文摘要中不存在，属 nuwa 自述、未独立核实**。后续引用「答题 agent ≠ 评分 agent」这一**结论**时，以原书 proposer-reviewer 模式与上述 utility-grounded 结论为依据，**不得**引用 46.4% 这个数字。

**传导出的两条设计约束：**
- 门禁**必须独立于生产者**（不得自评自证）。
- 门禁**不能只查结构，必须测效用**——否则无法发现 negative transfer（skill 看起来连贯、触发正常，实际让 agent 变差）。

## 决策

设**三道独立门禁**，全部由独立于生产者的执行者运行：

### 门禁一：契约与证据门禁（确定性，全量必过）
- 运行者：**确定性脚本**（非 agent）。
- 检查项：
  1. JSON Schema 校验（ADR-003 的 7 种 + `EngineeringRule` + `AntiPattern`，共 **9** 种；
     `SkillCandidate` 属环 3，本规格不产出、无 schema）
  2. `identifier` 格式（对齐 Kb2Agent 的 `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$`）
  3. `sourceRefs` **必须可解析**，且指向位置**确实包含**该对象宣称的内容（ADR-005 第 3 层）
  4. `SKILL.md` frontmatter 硬限制：`name` ≤64 字符（仅小写字母/数字/连字符，禁含 `anthropic`/`claude`）、`description` ≤1024 字符
  5. 6 段骨架完整性（ADR-004）
  6. 体积阈值 ≤12 KB（超出须已启用 `references/` 溢出）
- 判定：**不通过即拒绝**，无豁免。

### 门禁二：触发门禁（盲测，抽样必过）
- 运行者：**盲测 agent**，只拿到 `name` + `description`，**不提供正文、不提供技能清单**。
- 检查项：
  1. 给定真实场景描述，能否命中正确的 skill
  2. 给定无关场景，**是否误触发**（误触发率）
  3. 多个 skill 是否争抢同一场景（ADR-004 的「粒度太碎」症状）
- 判定：误触发与漏触发均须记录；同一场景被 ≥2 个 skill 争抢时，判定为**切分粒度缺陷**，退回环节 3 重新切分。

### 门禁三：效用门禁（消费者 A/B，抽样）
- 运行者：**消费者 agent**，独立于生产者与门禁二。
- 方法：对抽样 skill，设计代表性任务，**分别在「有该 skill」与「无该 skill」条件下执行**，比较任务表现。
- 判定：
  - 有 skill 显著优于无 skill → 通过
  - 无差异 → 标记为**低效用**（不拒绝，但降级）
  - **有 skill 反而更差 → 判定 negative transfer，拒绝**
- 范围：MVP 阶段对每个高风险 skill 抽样，**不要求全量**。高风险定义为门禁二出现误触发、或 `AntiPattern` 覆盖率低的 skill。

## 理由

- **三重独立性**保证三层失败模式各自可检出：门禁一查「合不合规」，门禁二查「找不找得到」，门禁三查「有没有用」。三者正交，任一缺失都会漏掉一整类缺陷。
- 门禁三直接对应论文发现的 **negative transfer**——这是唯一能检出「skill 有害」的机制，且它是**唯一必须存在的非结构门禁**。
- 门禁一与门禁二用确定性脚本 + 盲测 agent，成本可控；门禁三最贵，故降级为**抽样**而非全量。这样既覆盖了有害性检测，又不让 MVP 成本失控。
- 「构建者不得自评」同时满足原书的 proposer-reviewer 分离要求与论文的 extractor/consumer 不相关性结论。

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 只做门禁一（结构与证据） | 无法检出「触发不到」与「有害」两类缺陷；对一个会产出 22 个 skill 的流水线，误触发与 negative transfer 是主要风险 |
| 门禁一 + 门禁二，不做效用门禁 | 无法检出 negative transfer（论文明确其存在且非平凡）；「看起来连贯、实际有害」的 skill 会被发布 |
| 三道门禁全部全量执行 | MVP 阶段成本失控；效用门禁的成本与抽样规模的线性关系使其不适合全量 |

## 后果

**正面**
- 三层缺陷（不合规 / 找不到 / 有害）均有对应检出机制，且互为独立证据。
- 门禁三使「negative transfer」可被量化，这也是对 ADR-001 中盲测基准比对的有力补充。

**负面 / 代价**
- 门禁三需要为抽样 skill 设计代表性任务，是额外工作。
- 三道门禁的执行者需真实隔离（盲测 agent 不得看到正文与 skill 清单），隔离失败会使门禁失效——需要显式约束，不能靠约定。

**必须遵守的约束**
- **构建者不得评审自己的产出。** 门禁二的盲测 agent、门禁三的消费者 agent、以及 ADR-001 的基准比对者，必须是独立 agent 实例。
- 门禁二执行时**不得提供 skill 正文与完整 skill 清单**；只给 `name` + `description`。
- 门禁三发现 negative transfer 时**必须拒绝**，不得仅标注。
- 引用 nuwa 的方法论纪律时，**不得引用「46.4%」这一未核实数字**。

## 核实方式

> **更正留痕（2026-10-08，卡 05 期间）**：上方「门禁一」清单第 1 项原文为「ADR-003 的 **8 种**对象」，
> **实测为假**。ADR-003 采纳 7 种原类型并追加 3 个书籍型对象，其中 `SkillCandidate` 属环 3、
> 本规格不产出，故进入 schema 校验的是 9 种。已按实测改正，并说明 `SkillCandidate` 的去处。
> 核实方式：`node -e 'import("./pipeline/tools/object-contract.mjs").then(m=>console.log(m.OBJECT_TYPES.length))'` → 9。

```bash
# arXiv 论文存在性与题名（实测）
curl -sL "https://arxiv.org/abs/2605.23899" | grep -oE '"citation_title" content="[^"]*"'
# 摘要中不含 46.4%（实测检索）
curl -sL "https://arxiv.org/abs/2605.23899" | grep -c '46.4'   # 预期 0
# 原书 proposer-reviewer 模式（正文实测）
grep -n '提议者-审核者\|提议者与审核者\|不同家族' sources/ai-agent-book-zh/book/chapter4.md
# Kb2Agent identifier 正则
curl -sfL https://raw.githubusercontent.com/zjgulai/Kb2Agent/main/reference/schemas/common.schema.json | grep -A2 '"identifier"'
```
