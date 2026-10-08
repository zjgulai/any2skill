# ADR-001 · MVP 范围：全 10 章 / 22 个 skill，原书自带 skill 不进生成链路

- 状态：已接受
- 日期：2026-10-08
- 决策者：用户（拍板「B」）
- 关联：ADR-002、ADR-003

## 背景

any2skills 的目标是把任意内容编译为可执行 Agent Skill。首个信息源是 `bojieli/ai-agent-book`（李博杰《深入理解 AI Agent》）。

实测该仓库的资产（`curl https://api.github.com/repos/bojieli/ai-agent-book/contents/skills`，22 项）：

| 资产 | 实测值 |
|---|---|
| 中文正文章节 | `book/` 下 13 个 MD（introduction + chapter1–10 + afterword + reference-answers），合计 1.1 MB |
| 原书配套 skill | `skills/` 下 **22 个**目录，与 README 声称的「10 章内容蒸馏为 22 个开发 skill」一致 |
| 章节覆盖 | 22 个 skill 覆盖全部 10 章 |

关键事实：**原书已经自带完整的人工 skill 成品**。这既是最独特的信息源红利（免费的高质量对照组），也是最大的污染风险（流水线若读它，等于抄答案而非编译）。

## 决策

1. MVP 范围定为**全 10 章、22 个 skill**（而非首批 4 章）。
2. 原书自带的 22 个 skill **物理隔离，完全不进生成链路**——生成链路只读 `book/*.md` 正文。
3. 隔离后的原书 skill 转作**事后盲测基准（golden benchmark）**，用于回答「我们的流水线产出是否达到人工水平」。

## 理由

- 全量范围能暴露流水线在**判据软/硬不同章节**上的表现差异，这是首批 4 章无法证伪的；而这一差异恰是「能否泛化到任意内容源」的核心问题。
- 22 个 skill 提供了**零成本的对照组**。这是本书作为信息源最独特的红利，放弃可惜。
- 物理隔离（正文 `book/` 与基准 `benchmark/` 分目录、基准只读）是让对照组有效的**前提**；一旦基准泄入生成链路，它既不再是基准，产出也不再是编译结果。

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 首批 4 章 / 4 个 skill（ch2 上下文、ch3 记忆检索、ch4 工具、ch5 Coding Agent） | 样本量小，无法证明对「软性章节」（ch7 评估/ch8 训练/ch9 进化/ch10 多智能体）同样有效；判据软硬差异这一最有价值的观察维度被排除 |
| 单章最小闭环（只做 ch4 工具设计） | 样本为 1，无法判断泛化性 |
| 照搬原书 `skills/` 作起点、只补差异 | 这不是 MVP 链路，而是「验证搬运工具」；any2skills 的核心价值（从原始内容自动编译 skill）完全未被验证 |

## 后果

**正面**
- 获得 22 个高质量对照基准，可量化「流水线产出 vs 人工产出」的差距。
- 全章节覆盖使泛化性问题在首轮即暴露，避免后期推翻架构。

**负面 / 代价**
- 工作量约为首批 4 章方案的 5–6 倍。
- ch7–ch10 判据偏软，首轮就需要面对「流水线缺陷」与「章节本身模糊」的归因混淆。**缓解**：每个环节必须留下结构化的中间产物与门禁回执，使失败可归因到具体环节，而非笼统归因于「这章不好蒸馏」。

**必须遵守的约束**
- 生成链路的任何环节（提取 / 图谱 / 目录规划 / 构建）**不得读取** `benchmark/` 下的原书 skill。
- 基准比对只在**全部产出冻结之后**执行，且比对者与构建者必须是不同 agent（见 ADR-004）。

## 核实方式

```bash
# 原书 skill 数量（实测 22）
curl -s https://api.github.com/repos/bojieli/ai-agent-book/contents/skills | jq -r '.[]|select(.type=="dir")|.name' | wc -l
# README 声称
curl -sfL https://raw.githubusercontent.com/bojieli/ai-agent-book/main/skills/README.md | grep -o '蒸馏为 [0-9]* 个开发 skill'
# 中文正文行数/体积
wc -c sources/ai-agent-book-zh/book/*.md
```
