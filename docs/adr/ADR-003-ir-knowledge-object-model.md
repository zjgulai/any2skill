# ADR-003 · 中间表示（IR）：采纳 Kb2Agent 7 类型为核，追加 3 个书籍型对象

- 状态：已接受
- 日期：2026-10-08
- 决策者：用户（拍板「A」）
- 关联：ADR-002、ADR-004

## 背景

整条链路是「书 → 结构化知识 → skill 目录规划 → skill 成品」。中间的**结构化知识层（IR）**是链路的腰：若知识不被表达成机器可判定的形状，后两个环节（目录规划、质量门禁）只能靠模型凭感觉，「可审计的编译过程」无从谈起。

需要选定 IR 的对象模型。两个候选权威口径：

**口径一：Kb2Agent（已核实原文 `reference/schemas/knowledge-object.schema.json`）**

7 种知识对象，每种有硬性必填字段：

| 类型 | 必填字段 |
|---|---|
| `Concept` | `canonicalTerm` / `aliases` / `definition` / `examples` |
| `Metric` | `name` / `formula` / `inputs` / `unit` / `window` / `failureModes` |
| `MentalModel` | `trigger` / `inputs` / `reasoning` / **`limits`** / **`counterexample`** |
| `DecisionModel` | `inputs` / `branches` / `outputs` / `unknownPolicy` / `stopConditions` / `reviewState` |
| `Heuristic` | `trigger` / `recommendation` / `confidence` / `exceptions` |
| `Case` | `title` / `context` / `facts` / `decisions` / `outcome` / `evidenceRefs` / `limitations` / `dataClass` |
| `Playbook` | `title` / `prerequisites` / `steps` / `checks` / `rollback` / `approval` |

注意 `MentalModel` 强制要求 `limits`（失效边界）与 `counterexample`（反例）——这一约束直接堵死「只说好处不说边界」。

`common.schema.json` 提供可复用的公共契约：`identifier` / `hash`（`sha256:` 前缀）/ `evidenceGrade` / `status` / `freshness` / `risk` / `sourceLocator` / `baseObject`。其中 `baseObject` 强制每个知识对象携带 `id` / `objectType` / `revision` / `status` / `createdAt` / **`sourceRefs`**。

**口径二：nuwa-skill（已核实原文 `references/skill-template.md`）**

人物/主题蒸馏范式：心智模型 / 决策启发式 / 表达DNA / 时间线 / 价值观与反模式 / 智识谱系 / 诚实边界。

**本书正文的实际承载能力（实测，口径：`sources/ai-agent-book-zh/book/*.md` 12 个正文文件的标题行）**

| 检索模式 | 实测命中 |
|---|---|
| 显式失败/错误小节（`陷阱\|反模式\|失败\|误区\|错误`） | **13 个标题行**，分布：chapter10 共 7、chapter5 共 1、chapter7 共 3、chapter8 共 2；其余章节 **0** |
| 「常见陷阱」字面 | **全书 0 命中**——该小节名是原书 skill 作者归纳的产物，非书中原有结构 |

⚠️ **重要发现**：`AntiPattern` **不能靠检索专门的失败小节来提取**。全书显式失败小节仅 13 处、高度集中在 chapter10，而原书 22 个 skill **每一个**都有「常见陷阱」小节（6–8 条）。这说明作者做的是**跨章综合**（把散落各章的警告归纳成反模式清单），不是提取。⇒ 流水线必须有**显式综合步骤**，这是对「简单抽取即可」这一假设的实证否定。

## 决策

采纳 Kb2Agent 的 7 种对象类型为核（**不改造**），追加 3 个书籍型对象：

### 1. 保留：7 种原类型原样采用
不复用其**层号**（见 ADR-002：Kb2Agent 仓库内层号自相矛盾，Skill 在三处分别是 L3/L5/L5），只复用**对象定义与字段契约**。

### 2. 新增 `EngineeringRule` —— 可证伪的工程规则
| 字段 | 说明 |
|---|---|
| `statement` | 规则陈述（如「不得静默截断」） |
| `rationale` | 为什么成立 |
| `appliesWhen` | 适用条件 |
| `violation` | 违反后的可观察后果 |
| `chapterRef` | 来源章节锚点 |

**为什么不塞进 `Heuristic`**：`Heuristic` 带 `confidence: number`（0–1），语义上是**概率性经验**；而本书大量内容是**硬规则**（「工具对应目标，不对应 API 端点」「静默截断是危险的」），把硬规则标上 0.8 的置信度是语义失真。

### 3. 新增 `AntiPattern` —— 书中警告的失败做法
| 字段 | 说明 |
|---|---|
| `pattern` | 失败做法 |
| `harm` | 造成的损害 |
| `corrective` | 正确做法 |
| `evidence` | 书中证据（含 `sourceRefs`） |
| `chapterRef` | 来源章节锚点 |

**依据**：实测证明反模式是本书最高价值、也是最需要**跨章综合**的产物（见上表），必须有独立类型承载，且有独立流程生成。

### 4. 新增 `SkillCandidate` —— 从知识对象到 skill 的晋升凭据
| 字段 | 说明 |
|---|---|
| `skillId` | 目标 skill 标识 |
| `sourceObjects[]` | 支撑该 skill 的知识对象 id 列表 |
| `trigger` | 触发条件 |
| `chapterRefs[]` | 覆盖章节 |
| `promotionState` | 晋升状态（对齐 Kb2Agent 的 `status` 枚举） |

**依据**：这是「环节 3（梳理需要构建哪些 skill）」的核心产物，也是 ADR-002 中「晋升动作」的凭据。没有它，目录规划只能是一张凭空写的表格。

## 理由

- 复用已验证骨架，省掉最贵的部分：证据引用 `sourceRefs`、证据分级 `evidenceGrade`、新鲜度 `freshness`、标识符规范 `identifier`、风险契约 `risk`。
- 三处扩展**每一个都有本书的真实载体**，且都服务于「技术书 → 工程 skill」这条特有路径。
- 最关键的收益：**每个知识对象强制携带 `sourceRefs`（指向书的章/节锚点）**，于是「这条 skill 规则出自书里哪一句」永远可答。这一条决定了质量门禁能否做成机器判定。

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 原样采纳 7 类型，不扩展 | `AntiPattern` 只能硬塞 `Case` 或 `Heuristic`，语义失真；`SkillCandidate` 无处安放，环节 3 失去凭据层 |
| 7 类型 + nuwa 全套（10 类） | nuwa 的**表达DNA / 智识谱系 / 时间线**对技术书是**空字段**，schema 会强制模型为不存在的维度编内容——正是「看起来完整、实际在编造」的典型来源，违反本项目 AGENTS.md 第 8 条纪律 |
| 完全自研 IR | 丢掉已验证的模型，重新发明「证据引用 / 证据分级 / 新鲜度 / 风险」这些已解决问题的轮子，首轮工作量翻倍且质量不会更好 |

## 后果

**正面**
- 全链路天生可溯源。
- 「什么时候不该用」由 schema 强制（`MentalModel.limits` + `counterexample` + `AntiPattern`），堵住 AI 生成 skill 最常见的致命缺口。

**负面 / 代价**
- 需自维护 3 个 schema（约 100 行 JSON Schema）。
- 必须写清 `EngineeringRule` / `Heuristic` / `DecisionModel` 三者的**边界判据**，否则提取阶段会乱分类。**边界约定**：可证伪且无概率 → `EngineeringRule`；有置信度或例外 → `Heuristic`；多分支选择且需输入输出契约 → `DecisionModel`。

## 必须遵守的约束

- **禁止引用 Kb2Agent 的层号**（L0–L6），一律使用本项目自建编号表。
- 每个知识对象**必须携带 `sourceRefs`**，指向 `sources/ai-agent-book-zh/book/chapterN.md` 的章/节锚点。无 `sourceRefs` 的对象不得进入下一环节。

## 核实方式

```bash
# Kb2Agent 7 类型原文
curl -sfL https://raw.githubusercontent.com/zjgulai/Kb2Agent/main/reference/schemas/knowledge-object.schema.json
curl -sfL https://raw.githubusercontent.com/zjgulai/Kb2Agent/main/reference/schemas/common.schema.json
# nuwa 模板原文
curl -sfL https://raw.githubusercontent.com/chaincyf/nuwa-skill/main/references/skill-template.md
# 本书显式失败小节（实测 13 个标题行）
cd sources/ai-agent-book-zh/book && grep -rnE '^#{2,4} .*(陷阱|反模式|失败|误区|错误)' *.md
# 「常见陷阱」全书零命中
grep -rn '常见陷阱' sources/ai-agent-book-zh/book/ ; echo "exit=$?  (1 = 零命中)"
```
