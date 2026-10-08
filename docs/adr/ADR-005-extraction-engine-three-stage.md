# ADR-005 · 提取引擎：自建三段式架构，借用 Hyper-Extract 的知识结构设计而非其运行时

- 状态：已接受
- 日期：2026-10-08
- 决策者：用户（拍板「A」）
- 关联：ADR-003、ADR-004、ADR-006

## 背景

用户原始诉求为「使用 Hyper-Extract 的核心能力构建 Transform unstructured text into structured knowledge」。需要判定：是把它作为运行时引擎接入，还是只取其设计。

**对 Hyper-Extract 的实测复核（本 ADR 全部数字为本次实测）：**

| 复核项 | README 声称 | 实测 | 结论 |
|---|---|---|---|
| YAML 模板数 | `80+ presets`（出现 3 次） | `templates/**/*.yaml` = **40**（`tree.truncated=false`） | **声称不成立**，不得引用 80+ |
| 覆盖域数 | `across 6 domains` | 实测 **7 域**：general 13 / tcm 5 / medicine 5 / legal 5 / industry 5 / finance 5 / education 2 | **声称不成立**，不得引用 6 domains |
| 知识结构数 | 9 种 | `types/__init__.py` 实测导出 **9 个** AutoType + `BaseAutoType` | 成立 |
| 能否离线 | 未说明 | `utils/client.py` 第 1 行：`"""Client Factory - Create OpenAI LLM and Embedder clients from config.`，硬 `import langchain_core.embeddings`；各 provider 均需 `api_key`/`base_url` | **不能离线**，双重硬依赖 |
| 免 LLM 的结构 | 未说明 | `types/__init__.py` 文档字符串明确 `AutoDocument`：**"No LLM extraction; stores and searches chunks"** | 9 种里**仅 1 种**免 LLM |
| License | — | `LICENSE` 文件 = **Apache 2.0**；但 GitHub API 报 `NOASSERTION` | 以 LICENSE 文件为准，**该不一致应予记录** |

**9 种 AutoType（实测原文摘录）**：`AutoDocument`（Text Chunks）/ `AutoModel`（Single Object）/ `AutoList`（List[Item]）/ `AutoSet`（Set[Item]）/ `AutoGraph`（Nodes+Edges）/ `AutoHypergraph`（Nodes+Hyperedges）/ `AutoTemporalGraph`（Graph+Time）/ `AutoSpatialGraph`（Graph+Space）/ `AutoSpatioTemporalGraph`（Graph+Time+Space）。

**决定性缺陷（本项目特有）**：Hyper-Extract 的抽取范式是「对文本块做结构化抽取，再按 key 合并/去重」。它**没有跨文档块的综合环节**。而 ADR-003 的实测证据表明，本书最高价值的内容 `AntiPattern` 恰恰是**跨章综合的产物**——全书「常见陷阱」字面 **0 命中**，显式失败小节仅 **13 处**且集中 chapter10（7）+chapter5（1）+chapter7（3）+chapter8（2），而原书 22 个 skill **每一个**都有「常见陷阱」小节（6–8 条）。⇒ 该引擎在结构上抽不出本项目最需要的对象。

## 决策

采用**三段式架构**，自建提取器；Hyper-Extract 作为**设计输入**而非运行时依赖。

### 第 1 层：确定性结构层（不使用 LLM）

解析 `sources/ai-agent-book-zh/book/*.md` 的标题层级（`##` / `###` / `####`）、代码块、仓库路径引用、数字点，产出**章节/小节锚点索引**。

实测该层可行的依据：本书标题结构规整，如 `chapter4.md` 的 `## 工具设计的通用原则` 下辖 `### 能力的表达形式：专用工具、通用执行器与 Skill`（38 行）/ `### 工具描述的艺术`（70 行）/ `### 参数传递的保真性`（88 行）。

职责：为 `sourceRefs` 提供**物理锚点**。这是全链路可溯源的底座。

### 第 2 层：LLM 综合层

读章节正文，按 ADR-003 的 schema 产出**类型化知识对象**，每个对象**强制携带 `sourceRefs`**。

- `AntiPattern` 在该层执行**跨章综合**（按主题组织输入，而非按章节）。
- 该层是**唯一使用 LLM 且非确定性**的层。

### 第 3 层：机器验证层（不使用 LLM）

逐对象执行：`sourceRefs` 指向的位置**必须真的包含**该对象宣称的内容；schema 校验必须通过；`identifier` 格式必须合法。

职责：**兜住第 2 层的非确定性**。不通过即丢弃该对象。

## 理由

1. **与原书的工程模式同构。** 本书明确主张「提议者-审核者」（proposer-reviewer）分离，且强调提议者与审核者应「来自不同家族但能力相近」。三段式正是这一模式的实现：第 2 层提议（宽）、第 3 层验证（严）。
2. **与 arXiv:2605.23899 的结论同构。** 该论文（已核实存在，*From Raw Experience to Skill Consumption*，2026-05-22）建立 utility-grounded 评估框架，结论之一是 **skill utility 与模型规模、基线任务强度无关**——意味着不能靠换更强模型保证质量，必须做**独立验证**。这支持把验证独立成层而非依赖第 2 层自省。
3. **失败可归因。** 非确定性被限制在单层且被机器验证兜住：产出错误时能明确区分「结构层锚点错」/「综合层抽错」/「验证层漏放」，而非笼统归因。
4. **诚实兑现「使用其核心能力」。** Hyper-Extract 真正的核心贡献是**知识结构的分解思路**（什么知识该用什么形状承载）、YAML 模板的声明式设计、增量演进与溯源机制。这些作为设计输入被采纳；其运行时依赖（LLM + embedder + 向量索引）不背进项目。

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| **B · 真跑 Hyper-Extract 出图** | 按页计费产生真实成本；输出（9 种结构 + 向量索引）与 ADR-003 的 IR 不匹配，需再写双向映射层；`AntiPattern` 依然抽不出（其范式不含跨块综合）；外部依赖 + 非确定性使「链路是否跑通」**无法归因** |
| **C · 纯 LLM 直出（读章节直接写 skill）** | 跳过结构化知识层，放弃 ADR-003 的全部可审计性；「这条规则出自书里哪一句」不可答。这正是 any2skills 要解决的反模式 |
| **D · 纯确定性提取，完全不用 LLM** | 实测已否证：13 个显式失败小节 ≠ 22 个 skill × 6–8 条反模式（约 130–176 条）。规则无法产出综合物，覆盖率严重不足 |

## 后果

**正面**
- 全链路可归因、可复现（第 1、3 层确定性，第 2 层被兜住）。
- 零外部运行时依赖，无按页成本，可离线重跑。
- `AntiPattern` 的跨章综合有显式归属层。

**负面 / 代价**
- 第 2 层的综合质量决定最高价值产物的质量，需专门设计输入组织方式（按主题而非按章节喂入）。
- 放弃 Hyper-Extract 现成的增量/溯源/向量检索能力，需自行实现 `sourceRefs` 校验（工作量可控，因第 1 层已产出锚点索引）。

**必须遵守的约束**
- **禁止引用 Hyper-Extract 的「80+ templates」「6 domains」**——实测为 40 与 7。
- 引用其 License 时以 `LICENSE` 文件（Apache-2.0）为准，并注明 GitHub API 报 `NOASSERTION` 的不一致。
- 第 3 层的验证**必须独立于第 2 层**，不得由同一 agent 自评（依据 ADR-006：答题 agent ≠ 评分 agent）。
- Hyper-Extract 可作为**可选旁路适配器**（对 1–2 章做对照实验），但**不得成为主干依赖**。

## 核实方式

```bash
R=yifanfeng97/Hyper-Extract
# 模板数实测 40（README 声称 80+）
curl -s "https://api.github.com/repos/$R/git/trees/main?recursive=1" \
  | jq -r '.tree[]|select(.path|test("templates/.*\\.yaml$"))|.path' | wc -l
# 域分布实测 7
curl -s "https://api.github.com/repos/$R/git/trees/main?recursive=1" \
  | jq -r '.tree[]|select(.path|test("templates/.*\\.yaml$"))|.path' \
  | sed -E 's|^hyperextract/templates/presets/([^/]+)/.*|\1|' | sort | uniq -c
# 离线硬依赖证据
curl -sfL "https://raw.githubusercontent.com/$R/main/hyperextract/utils/client.py" | head -1
curl -sfL "https://raw.githubusercontent.com/$R/main/hyperextract/utils/client.py" | grep -n 'langchain_core.embeddings'
# 9 种 AutoType + AutoDocument 免 LLM 声明
curl -sfL "https://raw.githubusercontent.com/$R/main/hyperextract/types/__init__.py" | head -20
# License 不一致
curl -s "https://api.github.com/repos/$R" | jq -r '.license.spdx_id'   # NOASSERTION
curl -sfL "https://raw.githubusercontent.com/$R/main/LICENSE" | head -2  # Apache License 2.0
```
