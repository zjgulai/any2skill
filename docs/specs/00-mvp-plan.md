# any2skills · MVP 完整方案（讨论决策稿）

> 状态：**待用户确认共识**
> 日期：2026-10-08
> 决策记录：`docs/adr/ADR-001` ~ `ADR-007`
> 源剖析报告：`analysis/05-source-analysis.md`（1818 行 / 146,972 字节）

---

## 0. 一句话定义

**any2skills 是一个编译器**：把「任意内容源」编译成「可执行的 Agent Skill」。首轮信息源是《深入理解 AI Agent》（李博杰著）中文正文。

它与「让大模型直接读文档写 skill」的区别只有一条：**中间存在一个机器可判定的 IR（结构化知识层）**，因此「这条 skill 规则出自书里哪一句」永远可答，「凭什么算达标」永远可复核。

---

## 1. 七个已锁定的决策（决策树全景）

| # | ADR | 决策 | 被否决的核心方案 |
|---|---|---|---|
| 1 | [ADR-001](adr/ADR-001-mvp-scope-full-book.md) | MVP = 全 10 章；原书 22 个 skill 物理隔离进 `benchmark/`，只作盲测基准 | 首批 4 章（样本不足，无法证伪泛化性） |
| 2 | [ADR-002](adr/ADR-002-project-structure-dual-plane.md) | 双平面：外层 Claude 合规（`.claude-plugin/` + `skills/`）+ 内层 Kb2Agent 治理（`pipeline/`） | 纯 Claude 结构（治理无约束力）/ 纯 Kb2Agent（**且实测它不含目录规范**） |
| 3 | [ADR-003](adr/ADR-003-ir-knowledge-object-model.md) | IR = Kb2Agent 7 类型原样 + 新增 `EngineeringRule` / `AntiPattern` / `SkillCandidate` | 7 类型+nuwa 全套（表达DNA 等对技术书是空字段，会逼模型编内容） |
| 4 | [ADR-004](adr/ADR-004-skill-granularity-and-skeleton.md) | 骨架锁原书 6 段；单文件默认；契约放侧车；粒度=内容单元聚类 | 强制双文件（破坏自包含）/ 多文件模块化（无统一模板反而增加维护成本） |
| 5 | [ADR-005](adr/ADR-005-extraction-engine-three-stage.md) | 三段式自建：确定性结构层 → LLM 综合层 → 机器验证层 | 真跑 Hyper-Extract（**不能离线**、输出结构不匹配、抽不出 `AntiPattern`） |
| 6 | [ADR-006](adr/ADR-006-three-quality-gates.md) | 三道独立门禁：契约证据 / 触发盲测 / 效用 A/B；**构建者不得自评** | 只做结构门禁（放行 negative transfer） |
| 7 | [ADR-007](adr/ADR-007-skill-partition-semantic-clustering.md) | 语义聚类派生，**数量是结果不是配额**；门禁反向修正划分 | 以原书 22 个为目标（**与 ADR-001 冲突，流程上不可执行**） |

### 决策间的依赖关系

```text
ADR-001（污染隔离：benchmark 只读）
   ├─→ ADR-007（所以划分必须语义派生，不能照抄）
   └─→ ADR-006（所以基准比对者必须独立于构建者）
ADR-002（双平面结构）
   ├─→ ADR-004（所以契约放 pipeline/registry 侧车，不进 SKILL.md）
   └─→ ADR-003（所以 IR 落在 pipeline/knowledge）
ADR-005（三段式）
   ├─→ ADR-003（第 2 层产出 IR 对象）
   └─→ ADR-006（第 3 层就是门禁一）
```

---

## 2. 五环流水线（你原始需求的五个环节如何落地）

| 环 | 你的原始诉求 | 本项目实现 | 关键 ADR |
|---|---|---|---|
| **1** | ai-agent-book 中文 md，作为被做成 skills 的对象信息源 | ✅ 已落盘 `sources/ai-agent-book-zh/book/`，13 个文件 / 1.1 MB | — |
| **2** | 用 Hyper-Extract 核心能力做 unstructured text → structured knowledge | **取其知识结构设计，自建三段式提取器**（因其不能离线、9 种结构仅 1 种免 LLM、且抽不出跨章综合物） | ADR-005 |
| **3** | 用 Kb2Agent 梳理要构建哪些 skill、如何管理 | 取其 **7 类型 + 门禁契约**（`skill.schema.json` 的 10 项 required、`forbiddenClaims`、`const: false` 锁）；**但不取其层号**（仓库内自相矛盾）与目录规范（**实测不存在**） | ADR-002、003 |
| **4** | 用 book2skills 的核心能力构建 skill | 取其**落地流水线形态**（book2skills 实测 38 个 skill / 8 种目录形态）；骨架则采用**原书 6 段**（22/22 命中，证据强于 book2skills 的无统一模板） | ADR-004 |
| **5** | 参照 nuwa-skill + Claude 构建 skill 的方法论 | 借 nuwa 的**质量控制机制**（独立评审、逐维度扣分理由）→ 落为三道门禁；借 Claude 官方**三层渐进披露与硬限制**→ 落为 frontmatter/体积约束 | ADR-004、006 |

### 2.1 五环的接口（数据在哪一层交接）

```text
环1  sources/ai-agent-book-zh/book/*.md
      │
      ▼ 确定性结构层（无 LLM）
     小节锚点索引  →→ pipeline/knowledge/anchors.json
      │
      ▼ LLM 综合层（唯一非确定性层）
     知识对象（8 类型，强制带 sourceRefs） →→ pipeline/knowledge/objects.jsonl
      │
      ▼ 机器验证层（无 LLM，= 门禁一）
     验证通过的对象 → 被拒对象 + 拒绝理由
      │
      ▼ 环3 语义聚类
     内容单元 → cluster 记录（含聚类依据）
      │
      ▼ SkillCandidate（含 sourceObjects[] / trigger / promotionState）
     pipeline/registry/skill-candidates.json
      │
      ▼ 环4 构建
     skills/<name>/SKILL.md（6 段骨架，单文件）
      │
      ▼ 环5 门禁二（触发盲测）+ 门禁三（效用 A/B）
     通过 → 写入 pipeline/registry/promotions.json（晋升回执）
     拒绝 → 回到环3 重新切分
```

---

## 3. 目录结构（ADR-002 落地）

```text
any2skills/
├─ .claude-plugin/            # 平面一：Claude 合规层（对外、可发布）
│  ├─ plugin.json
│  └─ marketplace.json
├─ skills/                    # 已发布成品（只读区，只接收晋升通过的产物）
│  └─ <skill-name>/
│     ├─ SKILL.md             # 必需；frontmatter 仅 name + description
│     └─ references/          # 仅当正文 >12 KB 时启用（溢出阀）
├─ agents/                    # 独立评审者（门禁二盲测、门禁三消费者、基准比对者）
├─ pipeline/                  # 平面二：治理层（内部、不发布）
│  ├─ knowledge/              # IR：anchors.json / objects.jsonl / clusters.json
│  ├─ registry/               # skill-candidates.json / promotions.json / rejections.json
│  ├─ schemas/                # 8 种知识对象 + skill 契约的 JSON Schema
│  └─ tools/                  # 三段式提取器与门禁脚本
├─ benchmark/                 # 只读：原书 22 个 skill，盲测用（禁止进入生成链路）
├─ sources/ai-agent-book-zh/  # 信息源（已就位）
├─ analysis/                  # 源剖析报告
└─ docs/{adr,specs,tickets}/  # 决策 / 规格 / 任务卡
```

**平面隔离规则（强制）**
- `skills/` 只读发布区，只接收门禁通过的产物
- `pipeline/` 只写中间态，内容不进发布物
- `benchmark/` 只读，**生成链路任何环节不得读取**

---

## 4. IR 对象模型（ADR-003 落地）

### 4.1 复用 Kb2Agent 的 7 类型（原样，不改字段）

| 类型 | 必填字段（实测原文） |
|---|---|
| `Concept` | `canonicalTerm` / `aliases` / `definition` / `examples` |
| `Metric` | `name` / `formula` / `inputs` / `unit` / `window` / `failureModes` |
| `MentalModel` | `trigger` / `inputs` / `reasoning` / **`limits`** / **`counterexample`** |
| `DecisionModel` | `inputs` / `branches` / `outputs` / `unknownPolicy` / `stopConditions` / `reviewState` |
| `Heuristic` | `trigger` / `recommendation` / `confidence` / `exceptions` |
| `Case` | `title` / `context` / `facts` / `decisions` / `outcome` / **`evidenceRefs`** / `limitations` / `dataClass` |
| `Playbook` | `title` / `prerequisites` / `steps` / `checks` / `rollback` / `approval` |

### 4.2 新增 3 个书籍型对象

| 类型 | 字段 | 为什么不能塞进已有的 |
|---|---|---|
| `EngineeringRule` | `statement` / `rationale` / `appliesWhen` / `violation` / `chapterRef` | `Heuristic` 带 `confidence: 0–1`，语义是**概率性经验**；本书大量内容是**硬规则**（「工具对应目标，不对应 API 端点」），标 0.8 置信度是失真 |
| `AntiPattern` | `pattern` / `harm` / `corrective` / `evidence` / `chapterRef` | 实测证明它是本书最高价值且**必须跨章综合**的产物（见 §7.1），须独立类型 + 独立流程 |
| `SkillCandidate` | `skillId` / `sourceObjects[]` / `trigger` / `chapterRefs[]` / `promotionState` | 这是环 3 的核心产物；没有它，目录规划只能是一张凭空写的表格 |

### 4.3 公共契约（复用 `common.schema.json`）

`identifier`（正则 `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$`）/ `hash`（`sha256:` 前缀）/ `evidenceGrade` / `status` / `freshness` / `risk` / `sourceLocator` / `baseObject`。

**强制约束**：每个知识对象必须携带 `sourceRefs`，指向 `sources/ai-agent-book-zh/book/chapterN.md` 的章/节锚点。**无 `sourceRefs` 的对象不得进入下一环节。**

### 4.4 三者边界判据（防提取时乱分类）

- 可证伪且无概率 → `EngineeringRule`
- 有置信度或例外 → `Heuristic`
- 多分支选择且需输入输出契约 → `DecisionModel`

---

## 5. Skill 产物规范（ADR-004 落地）

### 5.1 frontmatter 硬限制（Claude 官方，已核实）

- `name` ≤64 字符；**仅**小写字母、数字、连字符；禁含 `anthropic` / `claude`；禁 XML 标签
- `description` ≤1024 字符；非空；禁 XML 标签；必须同时说明**做什么**与**何时用**

### 5.2 正文 6 段骨架（原书 22/22 实测命中，顺序与名称不得改动）

```text
# <主题标题>
## 何时使用          ← 列表，5–8 条用户场景/触发条件
## 核心原则          ← 加粗小标题 + 解释；列书的判断规则
## 实践模式          ← 主体；可再分 ### 1..N 编号子节，含表格
## 常见陷阱          ← 列表，6–8 条反模式（来自 AntiPattern 对象）
## 配套代码          ← 路径 + 每目录一句话说明
## 深度阅读          ← 回链 book/chapterN.md + 书中小节名
```

### 5.3 体积与溢出

- 目标 ≤**12 KB**（原书中位约 10.9 KB 偏上）
- 超出时把「实践模式」深层细节移入 `references/`，SKILL.md 保留 6 段骨架与指针
- 依据：官方建议正文 <5k tokens

### 5.4 契约侧车（不进 SKILL.md）

`inputContract` / `outputContract` / `tools` / `steps` / `stopConditions` / `rollback` / `tests`（≥2）/ `promotionDecisionRef` / `sourceRefs` / `evidenceGrade` / `freshness`
→ 存放于 `pipeline/registry/`。理由：官方 1024 字符硬限让混装根本装不下，且会同时毁掉可读性与可信任性。

---

## 6. 三道质量门禁（ADR-006 落地）

| 门禁 | 运行者 | 检查项 | 判定 |
|---|---|---|---|
| **一 · 契约与证据**（全量必过） | 确定性脚本（非 agent） | schema 校验 / `identifier` 格式 / **`sourceRefs` 必须可解析且指向位置确实含该内容** / frontmatter 硬限制 / 6 段完整性 / 体积阈值 | 不通过即拒绝，无豁免 |
| **二 · 触发**（抽样必过） | **盲测 agent**，只给 `name`+`description`，不给正文、不给 skill 清单 | 命中正确 skill？无关场景误触发？≥2 个 skill 争抢同一场景？ | 争抢 → **粒度太碎**，退回环 3 合并；零命中 → 并入邻近 skill 或降级为 `references/` |
| **三 · 效用**（抽样） | **消费者 agent**，独立于生产者与门禁二 | 同一任务在「有该 skill」与「无该 skill」条件下对比 | 更优 → 通过；无差异 → 低效用（降级）；**更差 → negative transfer，拒绝** |

**门禁三的依据**：已核实论文 *From Raw Experience to Skill Consumption*（arXiv:2605.23899，2026-05-22）发现 model-generated skills **平均有益但存在非平凡的 negative transfer**，且 **utility 与模型规模、基线任务强度无关**——所以不能靠换更强模型保证质量，必须做效用实测。

**不许自评**：构建者、门禁二、门禁三、基准比对者必须是**不同 agent 实例**。依据：原书 proposer-reviewer 模式（`chapter3.md:524`「能力相近但来自不同家族」）+ 上述论文的 extractor/consumer 不相关性。

---

## 7. 实测证据汇总（本方案所有关键数字的来源）

### 7.1 关键发现：`AntiPattern` 是综合物，不是提取物

| 检索项（口径：`sources/ai-agent-book-zh/book/*.md` 标题行） | 实测 |
|---|---|
| 「常见陷阱」字面 | **全书 0 命中** |
| 显式失败/错误小节 | **13 个标题行**：chapter10 共 7、chapter5 共 1、chapter7 共 3、chapter8 共 2；其余章节 **0** |
| 原书 22 个 skill 的「常见陷阱」段 | **22/22 命中**，各段 6–8 条 |

⇒ 13 个显式小节 ≠ 22×6–8 ≈ 130–176 条反模式。**作者做的是跨章综合。** 这是 ADR-005 选择三段式（而非纯抽取）的实证依据，也是 ADR-008 前必须解决的核心环节。

### 7.2 原书 skill 实测基线（盲测对照用）

| 指标 | 实测值 |
|---|---|
| 数量 | 22（与 README 声称一致） |
| 6 段骨架命中 | **22/22，逐段各 22/22** |
| 深度阅读段回链 `book/chapterN.md` | **22/22** |
| `references/` 使用数 | **0** |
| 字节数 | 7,318 – 16,568（中位约 10,900） |
| 行数 | 80 – 129 |
| `skills/` 下文件类型 | **仅** `README.md` ×1 + `SKILL.md` ×22 |

### 7.3 信息源实测

**总览：13 个文件 / 1.1 MB。** 逐章实测（口径统一：`wc -c` 与 `grep -cE '^## '`）：

| 文件 | 字节 | `##` | `###` |
|---|---:|---:|---:|
| introduction.md | 19,439 | 4 | 0 |
| chapter1.md | 82,813 | 5 | 11 |
| **chapter2.md** | **130,806** | **11** | 32 |
| chapter3.md | 100,023 | 5 | 19 |
| chapter4.md | 71,664 | **9** | 7 |
| chapter5.md | 113,700 | 4 | 15 |
| chapter6.md | 93,559 | 7 | 27 |
| chapter7.md | 109,424 | 13 | 31 |
| chapter8.md | 136,717 | 17 | 23 |
| chapter9.md | 62,756 | 5 | 8 |
| chapter10.md | 101,683 | 8 | 20 |
| afterword.md | 10,495 | 2 | 0 |
| reference-answers.md | 69,703 | 10 | 0 |

⚠️ 更正留痕：本节初稿把 `chapter4.md` 的 `##` 数写作 8，**原文如此、实测为假**——实测为 **9**（7 个内容小节 + `## 本章小结` + `## 思考题`）。上表为复核后口径。

**支撑 ADR-007「每章固定 1 个 skill 不可行」的关键两行**：`chapter2.md` 130,806 字节 / 11 个 `##`（含 KV Cache / 提示工程 / 动态提示词与 Skills / Agent 状态栏 / 上下文压缩五块独立主题）；`chapter8.md` 136,717 字节 / 17 个 `##`。

**结构化程度的含义**：`###` 总数 193（各章加总），是确定性结构层（ADR-005 第 1 层）产出小节锚点的物理基础。

### 7.4 Hyper-Extract 实测复核（含 README 假声称）

| 项 | README 声称 | 实测 |
|---|---|---|
| YAML 模板数 | `80+ presets` ×3 | **40** |
| 覆盖域数 | `across 6 domains` | **7**（general 13 / tcm 5 / medicine 5 / legal 5 / industry 5 / finance 5 / education 2） |
| 能否离线 | 未说明 | **不能**（`utils/client.py` 第 1 行即 LLM+Embedder factory，硬 import `langchain_core.embeddings`） |
| 免 LLM 的结构 | 未说明 | 9 种里**仅 `AutoDocument` 1 种** |
| License | — | `LICENSE` 文件 = Apache-2.0；但 GitHub API 报 `NOASSERTION`（**不一致，须记录**） |

⚠️ 引用纪律：**不得**引用「80+ templates」「6 domains」。

### 7.5 Kb2Agent 实测复核（含对原始前提的更正）

| 项 | 结论 |
|---|---|
| 是否规定 skill 目录布局 | **不规定**。369 个 blob 中路径含 `SKILL.md` 的 **0 个**，含 `skills/` 的 **0 个**。它把 Skill 定义为 **JSON 对象** |
| 层号是否可信 | **不可信，仓库内自相矛盾**：`Skill` 三处三种层号（目录表 L3 / schema title L5 / `terms.json` L5）；`TaskPackage` 同型冲突（L4/L6/L6）；校验器无层号断言 |
| 分层权威文档 | `docs/architecture/m1-a-schema-catalog.md`（**不是** `mkd-design-spec.md`——UI 规格；**不是** `mkd-information-architecture.md`——站点 IA） |

⇒ 本项目**自建编号表**，禁止引用 Kb2Agent 层号。

### 7.6 引用纪律（负向清单）

| 禁止引用 | 原因 |
|---|---|
| Hyper-Extract「80+ templates」「6 domains」 | 实测为 40 / 7 |
| nuwa「LLM 自评准确率 46.4%」 | 该数字**在 arXiv:2605.23899 摘要与全文中 0 命中**（实测），属 nuwa 自述、未核实 |
| Kb2Agent 的 L0–L6 层号 | 仓库内自相矛盾 |
| 「Kb2Agent 是 skill 目录规范权威」 | 实测它不含任何目录规范 |

---

## 8. 交付物清单

| # | 交付物 | 路径 | 验收 |
|---|---|---|---|
| 1 | 中文正文信息源 | `sources/ai-agent-book-zh/book/` | ✅ 已落盘（13 文件 / 1.1 MB） |
| 2 | 源剖析报告 | `analysis/05-source-analysis.md` | ✅ 已落盘（1818 行 / 146,972 字节） |
| 3 | 决策记录 ADR-001~007 | `docs/adr/` | ✅ 7 份已落盘 |
| 4 | 本方案 | `docs/specs/00-mvp-plan.md` | 待你确认共识 |
| 5 | 技术规格 | `docs/specs/01-pipeline-spec.md` | 待 `/to spec` 产出 |
| 6 | 8 种对象的 JSON Schema | `pipeline/schemas/*.json` | schema 可编译、含正负例 |
| 7 | 三段式提取器 | `pipeline/tools/` | 第 1、3 层确定性可复现 |
| 8 | 门禁脚本 + 独立评审 agent | `pipeline/tools/` + `agents/` | 门禁一全量通过；门禁二三抽样留回执 |
| 9 | 成品 skill 集 | `skills/<name>/SKILL.md` | 逐条过门禁一，抽样过门禁二三 |
| 10 | 盲测比对报告 | `docs/specs/02-benchmark-report.md` | 与 `benchmark/` 22 个对照，差异须解释 |
| 11 | 执行任务卡 | `docs/tickets/` | 待 `/to tickets` 产出 |

---

## 9. 风险登记

| # | 风险 | 触发信号 | 缓解 |
|---|---|---|---|
| R1 | `AntiPattern` 跨章综合质量不足 | 实测覆盖率远低于 130–176 条基线 | 按**主题而非章节**组织第 2 层输入；门禁三抽样重点覆盖 `AntiPattern` 依赖的 skill |
| R2 | 效用门禁成本失控 | 抽样 skill 数超预期 | 抽样而非全量；高风险优先（误触发或反模式覆盖率低者） |
| R3 | 划分粒度定错导致两侧返工 | 门禁二出现争抢或零命中 | 门禁反向修正（ADR-007），不在划分阶段追求一次到位 |
| R4 | 盲测隔离失败（评审者看到正文/清单） | 评审者产出异常精准 | 评审者 prompt 只注入 `name`+`description`；隔离方式写入代码而非约定 |
| R5 | 第 2 层 LLM 非确定性导致重跑结果漂移 | 同一输入两次产出差异大 | 第 1、3 层确定性；第 2 层产出落盘固化，重跑须显式指定 |
| R6 | 第 3 层验证过严，误杀有效对象 | 拒绝率高且理由牵强 | 拒绝必须留结构化理由；抽样人工复核拒绝理由 |
| R7 | ch7–ch10 判据偏软，归因混淆 | 该四章产出质量显著低 | 每环节留结构化中间产物与回执，使失败可归因到具体环节而非「这章不好」 |

---

## 10. 验收标准（MVP 算跑通的判据）

1. **链路完整**：一个 skill 从 `sources/` 正文到 `skills/` 成品，中间每一跳都有落盘产物，且可复现。
2. **可溯源**：任取成品 skill 任取一条规则，能反查到 `book/chapterN.md` 的具体位置。
3. **门禁有效**：门禁一全量通过；门禁二有争抢/零命中的实测记录（证明它真的能发现问题，而非总是通过）；门禁三至少检出或排除一次 negative transfer。
4. **差异可解释**：与 `benchmark/` 22 个对照后，若数量或覆盖显著不同，须给出原因分析。
5. **隔离可验证**：能证明生成链路未读取 `benchmark/`。

---

## 11. 请你确认的共识点

1. 七个 ADR 的决策是否全部认可？有无需要推翻或修改的？
2. 方案文档是否可作为后续 `/to spec` 的输入基线？
3. 是否有遗漏的环节或你原本期望但本方案未覆盖的部分？

确认后我按顺序执行：`/to spec`（规格）→ `/to tickets`（带阻塞依赖的任务卡）→ `/implement`（落地初始化）。
