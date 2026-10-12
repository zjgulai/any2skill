# ADR-019 · 环 4 首版：确定性装配 + 门禁一 skill 侧（tracer bullet 的结论）

- 状态：已接受（首版）；**「配套代码」段与 7 个契约字段的处置待用户拍板**
- 日期：2026-10-09
- 决策者：用户（拍板「打一发端到端 tracer bullet」）
- 关联：ADR-001（基准隔离）、ADR-002（双平面）、ADR-004（骨架与契约侧车）、ADR-006（三道门禁）、ADR-007（划分）、ADR-016（跨章反模式）

## 背景

项目叫 any2skills，而在此之前**盘上一个 skill 都没有**。

实测口径：`find . -path ./node_modules -prune -o -name "SKILL.md" -print | wc -l` → **0**。
逐个 `[ -e ]` 检查，环 3–5 的产物全部缺失：`clusters.json` / `skill-candidates.json` /
`promotions.json` / `rejections.json` / `.claude-plugin/` / `skills/` / `agents/` /
`docs/specs/02-benchmark-report.md`；`benchmark/` 是**空目录**；
`sources/ai-agent-book-zh/skills/` 下只有一份 3,783 字节的 README.md（上游书仓的说明）。

后果是 `docs/specs/00-mvp-plan.md` §10 验收标准的第 1 条「链路完整：一个 skill 从
`sources/` 正文到 `skills/` 成品」为 **0%**，而项目最大的未验证假设——
**「类型化知识对象能装配成可执行 skill」**——至今零证据。
此前全部投入落在环 1–2 与门禁一的内部精度上（含本会话的 ADR-018）。

## 决策

**1. 环 4 第一版不引入任何模型调用。**
本环节要回答的是「**对象里到底有什么**」，不是「能不能写出一篇读起来通顺的 skill」。
一旦引入 LLM 补写，缺口会被生成内容填平、骨架看起来完整，而「环 2 的字段够不够」
这个问题就永远得不到答案。骨架里有几段本质是散文，模型按契约确实会进环 4——
但进场时点要等到本文测出「哪些字段能填、哪些段完全没有来源」之后。

**2. 簇派生用文档结构子树，不是语义聚类。**
`deriveCluster` 取根锚点及其后所有层级更深的锚点，直到同层或更浅者出现。
这是 ADR-004「同章 + 同问题空间」的一个**机械近似**：它不判断语义，只认 `level` 与文档顺序。
真正的语义聚类属环 3，本版不假装实现了它。

**3. 装配产物落暂存区，不直接进 `skills/`。**
`pipeline/registry/build/<slug>/`（暂存）→ 门禁一 → 通过才拷进 `skills/<slug>/`（发布区）。
依据 ADR-002 的平面隔离：发布区只接收通过门禁的产物。
「装配成功」与「通过门禁」在本实现里是两件被刻意分开的事。

**4. 只消费门禁一判过「通过」的对象。**
判定依据是最新一份 `run-*.receipt.json` 的 `objectVerdicts[].status === 'pass'`；
跨章反模式走**它自己那次运行**的判定表（`run-*.antipattern-verdicts.json`）。
没有回执时**拒绝装配**——「没有判定记录」不等于「都通过了」。

**5. 段条目数是一处真实的解释歧义，两种口径都实现。**
ADR-006 把门禁一第 5 项写作「6 段骨架**完整性**（ADR-004）」，而 ADR-004 的
「必须遵守的约束」一节**只**列了 frontmatter 硬限、6 段顺序与名称、深度阅读回链——
**没有**把「何时使用 5–8 条」「常见陷阱 6–8 条」列为硬约束，那两句出现在骨架的形状描述里。
本实现默认 strict，并同时给出 presence-only 口径的结果，使「拒绝到底取决于口径，
还是取决于内容硬缺口」在回执里可分辨。

**6. 填不出就留空并记缺口，不编内容。**
`## 配套代码` 段在信息源没有来源时留空，缺口写进契约的 `gaps` 数组。
留空的段落里**不得出现任何替代性文字**——「看似完整」比「看起来缺」更危险，已由测试钉住。

## 实测发现

> 口径：本章所有数字均来自本轮实跑命令，未使用推算或估算。
> 复算入口见文末「核实方式」。

### 发现 1 · 骨架 6 段里，2 段在本项目信息源下不可满足或语义不符

簇 `chapter4#h2-2`「工具设计的通用原则」（4 个锚点 / 8 个对象）装出的产物，
体积 3,155 / 12,288 字节，各段条目数：

| 骨架段 | 条目数 | 来源 | 判定 |
|---|---:|---|---|
| 何时使用 | 5 | `EngineeringRule.appliesWhen` / `Heuristic.trigger` | 部分（见发现 4） |
| 核心原则 | 3 | `EngineeringRule.statement` + `rationale` | 可用 |
| 实践模式 | 2 | `Concept.definition` + `examples` | **语义不符** |
| 常见陷阱 | 1 | `AntiPattern` | **数量不足**（见发现 2） |
| 配套代码 | 0 | **无来源** | **不可满足** |
| 深度阅读 | 4 | `sourceRefs` | 可用 |

- **配套代码段**：实测 `sources/ai-agent-book-zh/` 下只有 `book/` 与 `skills/` 两个目录，
  没有配套代码目录。对象模型里没有任何字段承载「仓库相对路径 + 每个目录一句话说明」。
  这不是「暂时没做」，是**按当前信息源不可满足**。
- **实践模式段**：由 `Concept` 的**定义与示例**填充，而骨架要求的是**可操作的模式**
  （编号子节、含表格）。条目数达标不代表语义达标——**这类缺口靠计数查不出来**，
  故本实现为它单设一个不能由计数推导的缺口码。

### 发现 2 · 「常见陷阱 6–8 条」在章级粒度上无解

对 chapter4 的每个二级锚点簇，以及整章，实测「可用反模式数」（簇内 `AntiPattern`
+ 引用了本簇锚点且门禁通过了的跨章 `AntiPattern`）：

| 簇 | 对象数 | 簇内 AP | 跨章 AP（通过） | 合计 | ≥6？ |
|---|---:|---:|---:|---:|---|
| chapter4#h2-1 工具的分类 | 2 | 0 | 0 | 0 | 否 |
| chapter4#h2-2 工具设计的通用原则 | 8 | 1 | 0 | 1 | 否 |
| chapter4#h2-3 工具生态 | 2 | 0 | 0 | 0 | 否 |
| chapter4#h2-4 工具太多怎么办 | 8 | 1 | 0 | 1 | 否 |
| chapter4#h2-5 感知工具 | 9 | 0 | 0 | 0 | 否 |
| chapter4#h2-6 执行工具 | 2 | 0 | 2 | 2 | 否 |
| chapter4#h2-7 协作工具 | 2 | 0 | 0 | 0 | 否 |
| chapter4#h2-8 本章小结 | 2 | 0 | 0 | 0 | 否 |
| chapter4#h2-9 思考题 | 2 | 1 | 0 | 1 | 否 |
| **整章 chapter4** | **39** | **3** | **2** | **5** | **否** |

**整章也只有 5 条，差 1 条。** 而 ADR-004 要求 skill 粒度是「每章约 2.2 个」——
在这一粒度上，常见陷阱段距 6 条更远。

### 发现 3 · 跨章反模式池在本簇颗粒无收，且原因不是「没有」

跨章反模式池 16 条，门禁通过 11 条。**引用了本簇锚点的有 2 条，两条都被拒**：

- `AP-SYNTH-T02-03`（引 `chapter4#h3-2` 工具描述的艺术）→ `JUDGE_INSUFFICIENT`
- `AP-SYNTH-T02-04`（引 `chapter4#h3-3` 参数传递的保真性）→ `JUDGE_INSUFFICIENT`

⚠️ 第一版装配器把这两个原因**显示成了同一个**：它拿 chapter4 的回执去判反模式，
而反模式的 id（`AP-SYNTH-*`）根本不在那份回执里，于是 2 条被当成「不存在」——
输出里「本主题没有反模式」与「有但被拒」长得一模一样。已修，且新增测试钉住
「跨章反模式走它自己那次运行的判定表」。

### 发现 4 · `appliesWhen` 不总是触发条件

`CHAPTER4-H3-3-ENGINEERINGRULE-02` 的 `appliesWhen` 实测为：
「当确实需要对输入进行规范化处理（如统一编码格式）时，**必须**在工具描述中加以说明，
并在工具返回中明确告知模型。」——这是「条件 + 要求」的复合句，后半句是规则不是触发。
装进「何时使用」段后，该段条数达标而内容错位，**计数查不出来**。
本实现单设一个**启发式**缺口码（含「必须/不得/应当/应该」的可疑条目）把它挑出来，
明确标注为启发式、不导致门禁失败，并记下它的局限（真实触发条件里也可能含「必须」）。

### 发现 5 · ADR-004 的契约侧车有 7 个字段在当前对象模型下没有来源

`inputContract` / `outputContract` / `tools` / `steps` / `stopConditions` / `rollback` / `tests`。
其中 `tests` 按 ADR-004 要求 ≥2。

⚠️ 第一版把这 7 项里的 `tests` 写成 `minItems: 2` 塞进 schema，结果**每一份产出的契约
都不合法**——那会把「这个 skill 还没法测」（内容缺口）与「这份契约写坏了」（格式缺陷）
压成同一个错误，而两者的处理方式完全不同。已改为：schema 只查形状，缺口由
`CONTRACT_FIELD_UNSUPPORTED` 在 `gaps` 里逐条记录。

### 发现 6 · `sources/` 树内躺着原书 22 个 skill 的名字与触发条件（污染风险）

`sources/ai-agent-book-zh/skills/README.md` 实测列了 **22** 条 skill 名 + 触发场景
（`grep -c "^| \`"` → 22）。而 ADR-007 要求划分必须**语义派生、不得照抄**原书 22 个。

好消息：锚点目录只覆盖 `book/` 下 13 个文件，`skills/README.md` **不在其中**，
故当前生成链路不读它。坏消息：它在 `sources/` 树内，任何一处 `sources/**` 的 glob
都会把它捞进来。**建议把 `skills/` 移出 `sources/`**（或移进只读的 `benchmark/`），
本 ADR 不擅自移动信息源。

### 发现 7 · 「深度阅读」回链口径与 ADR-004 的表述有别

ADR-004 写的是回链 `book/chapterN.md`，而本实现回链
`sources/ai-agent-book-zh/book/chapterN.md`（仓库根相对路径），因为后者才是仓库里真实存在
且可解析的路径。两者指同一文件，但**字面不同**；门禁一按实际路径校验。
这一处口径差异记在此处，不静默改 ADR——若要统一，应显式修订 ADR-004 的措辞。

## 结论

**tracer bullet 的目的达到了，但答案不是「通过」。**

- 端到端链路**已打通**：对象 → 装配 → 门禁 → 回执，四跳都有落盘产物，可复现。
- 产物**停在暂存区**：门禁一不通过，理由码 `SECTION_EMPTY`（配套代码段为空）
  与 `SECTION_COUNT_OUT_OF_RANGE`（常见陷阱 1 < 6）。
- **拒绝不取决于口径**：换成宽松口径（条目数不入判据）**仍然不通过**，
  因为配套代码段为空这一条与条目数无关。已由测试钉住，任何人不得靠悄悄放宽口径把它变成通过。
- **在所有簇上都过不了**：配套代码段在每一个簇都是 0，因为它是信息源层面的缺口，
  不是聚类选择的结果。

## 未决（需用户拍板，本 ADR 不代作决定）

1. ~~**「配套代码」段怎么办**~~ → **已决**：用户拍板扩充信息源，
   已镜像上游 `chapter4/` 配套代码并逐文件哈希校验，见 [ADR-020](ADR-020-source-expansion-chapter4-code.md)。
   该段现已可填，`SECTION_EMPTY` 从门禁结论中消失。
2. **「常见陷阱 6–8 条」怎么办**（现已成**唯一**障碍）：把整章 5 条作为新基线（修订 ADR-004 的形状描述）／
   放宽到跨章主题粒度（但那与「2.2 skill/章」冲突）／其它。
3. **契约侧车 7 个字段**：哪些属环 5 该由消费者补、哪些该删、哪些该在环 2 加字段。
4. **`sources/` 下的原书 skills README 是否移出**（发现 6）。ADR-020 又给 `sources/` 添了 `code/`，
   这个问题只会更值得处理。

## 追加记录（2026-10-09，晚于本文正文）

用户拍板扩充信息源，配套代码已镜像进 `sources/ai-agent-book-zh/code/chapter4/`
（851 文件 / 9,515,005 字节，逐文件哈希校验 851/851 一致），决策与口径见
[ADR-020](ADR-020-source-expansion-chapter4-code.md)。

**正文里的结论因此变了，此处不改写原文，只标注差异：**

| 正文所述（当时为真） | 现在 |
|---|---|
| 拒因两条：`SECTION_EMPTY` + `SECTION_COUNT_OUT_OF_RANGE` | 只剩 `SECTION_COUNT_OUT_OF_RANGE` |
| 宽松口径下**仍不通过**，故拒绝不取决于口径 | **宽松口径下通过**，故拒绝**现在取决于**条目数口径 |
| 6 段中「配套代码」段零来源 | 6 段**全部有来源**，该段 6 条（本章 6 个代码目录） |

一条不变：**当前仍没有任何 skill 被发布**，`skills/` 仍为空——
因为严格口径下仍被拒，而放宽口径是一个需要显式拍板的决定，不由实现代作。

`skill-gate.test.mjs` 的「tracer bullet 的结论」一节已随之显式修订（同时保留
「无配套代码时两种口径都拒」的分支），改动理由写在测试内注释里。

## 追加记录（2026-10-12，晚于 ADR-020/021/022）

「未决」有两条在此期间已被拍板，本文正文不改写，仅在此标注差异：

| 正文所述（当时为真） | 现在 |
|---|---|
| 未决 2：「常见陷阱 6–8 条」是**唯一**障碍 | **已决**（[`ADR-021`](ADR-021-section-item-counts-advisory.md)）：条目数降为建议值 `advisoryMin/advisoryMax`，低于建议值只记缺口 + 推风险标记，不产生拒因。门禁一由此全过，`skills/chapter4-tool-design-principles/SKILL.md` 已发布（此前全盘 SKILL.md 为 0） |
| 决策 5：双口径（strict / presence-only）**都实现** | **开关已作废并移除**（ADR-021 决策 5）——留一个不再改变结论的开关只会让后来者以为它还有用 |
| 未决 4：`sources/` 下的原书 skills README 是否移出 | **已决并执行**（2026-10-12，用户拍板「移进 `benchmark/`」）：`git mv` 至 `benchmark/upstream-skills/README.md`，附 `MIRROR-MANIFEST.md`（哈希与缺件口径）。上游 22 个 skill 目录本体**仍未镜像**——验收 4 的对照物仍缺 |

仍未决：契约侧车 7 个字段（未决 3）——2026-10-12 用户拍板**留缺口到环 5** 再定夺（它们正是环 5 消费者的输入面，现在删将来还要加回来）。

## 核实方式

```bash
cd /Users/lute/Project/any2skills

# 发现 0：全盘 SKILL.md 计数（含本次产物前）
find . -path ./node_modules -prune -o -name "SKILL.md" -print | wc -l

# 本次装配（只读不写）：无模型调用
node pipeline/build-skill.mjs --root-anchor chapter4#h2-2 \
  --slug chapter4-tool-design-principles --title "工具设计的通用原则" --dry-run

# 发现 1/5：各段条目数与 11 条缺口
node --input-type=module -e '
import fs from "node:fs";
const c=JSON.parse(fs.readFileSync("pipeline/registry/build/chapter4-tool-design-principles/skill-contract.json","utf8"));
console.log(c.sectionCounts); console.log(c.gaps.length);
'

# 发现 2：各簇与整章的反模式可得性（表格数字的来源）
# 见本次会话实跑的 node 脚本；核心是 deriveCluster + collectCrossChapterAntipatterns 的组合

# 发现 3：跨章反模式的判定表
node --input-type=module -e '
import fs from "node:fs";
const v=JSON.parse(fs.readFileSync("pipeline/registry/run-5d72a0637d50.antipattern-verdicts.json","utf8"));
for(const x of v.verdicts) console.log(x.objectId, x.status, x.reasonCode||"");
'

# 发现 6：污染面
find sources -type f ! -path "*/book/*"          # → sources/ai-agent-book-zh/skills/README.md
grep -c "^| \`" sources/ai-agent-book-zh/skills/README.md   # → 22

# 回归测试（含「两种口径都不通过」的钉子）
npm test
```

## 影响

- 新增 `pipeline/build-skill.mjs`、`pipeline/tools/skill-builder.mjs`、
  `pipeline/tools/verify-skill.mjs`、`pipeline/schemas/skill.schema.json`。
- 新增测试 39 项（321 → 369 的最后一跳；本轮之前为 326，本次 +43 后为 369）。
- **被测的结论本身进了测试**：`skill-gate.test.mjs` 的「tracer bullet 的结论」一节
  断言该产物在两种口径下都被拒、且拒因是配套代码段为空。要改结论必须显式改测试并给理由。
- `skills/` 仍为空——这是当前真实状态的如实反映，不是遗漏。
