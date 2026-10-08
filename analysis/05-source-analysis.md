# 五个源仓库深度剖析

> 分析时间：2026-10-08（实测命令：`date "+%Y-%m-%d %H:%M:%S %Z"` → `2026-10-08 11:40:18 CST`）
> 方法：GitHub REST API（`/repos`、`/git/trees?recursive=1`）+ `git clone --depth 1` + `raw.githubusercontent.com`，全部为本次实测读取；未使用任何二次转述来源。
> 认证：`gh auth status` → `Logged in to github.com account zjgulai`，token scopes `gist, read:org, repo, workflow`。

---

## 0. 分析范围与口径

### 0.1 实际读取的文件清单（本报告所有结论的证据边界）

**仓库元数据（5/5，实测 `curl https://api.github.com/repos/<repo>`）**

| 仓库 | default_branch | size(KB) | pushed_at | stars | license |
|---|---|---:|---|---:|---|
| `bojieli/ai-agent-book` | main | 774242 | 2026-10-08T03:38:53Z | 52815 | Apache-2.0 |
| `yifanfeng97/Hyper-Extract` | main | 37325 | 2026-09-29T13:33:32Z | 4078 | NOASSERTION |
| `zjgulai/Kb2Agent` | main | 7510 | 2026-08-18T03:21:14Z | 2 | 无 |
| `simbajigege/book2skills` | main | 2729 | 2026-08-26T02:39:29Z | 184 | MIT |
| `alchaincyf/nuwa-skill` | main | 38622 | 2026-08-25T03:02:26Z | 33765 | MIT |

**完整文件树（5/5，`/git/trees/<branch>?recursive=1`，五棵树 `truncated` 均为 `false`）**

| 仓库 | 树条目数 |
|---|---:|
| ai-agent-book | 12619 |
| Hyper-Extract | 664 |
| Kb2Agent | 425 |
| book2skills | 497 |
| nuwa-skill | 212 |

**逐文件读取（本地落盘后读取）**

- `ai-agent-book`：`skills/README.md` + 全部 22 个 `skills/*/SKILL.md`（raw 下载至 `/tmp/srcrepos/aab/skills/`，合计 248436 B，其中 README 3783 B）；`book/` 目录清单；`chapter1..chapter10` 目录清单；`chapter1/EXPERIMENT_LEDGER.md` 路径核对。
- `Hyper-Extract`：`git clone --depth 1` 全仓。读取 `pyproject.toml`、`README.md`（前 140 行）、`hyperextract/types/__init__.py`（全文）、`hyperextract/templates/presets/finance/earnings_summary.yaml`（全文）、`hyperextract/templates/presets/general/base_graph.yaml`（全文）、`hyperextract/mcp_server.py`（注册段 + 函数名全量 grep）、`hyperextract/cli/cli.py`（命令注册全量 grep + `parse` 签名）、`hyperextract/utils/client.py`（provider 段 grep）、`hyperextract/utils/template_engine/gallery.py`（前 60 行）、`hyperextract-skills/SKILL.md`（全文）、`.env.example`（全文）、`hyperextract/templates/README.md`（模板目录表 grep）。
- `Kb2Agent`：`git clone --depth 1` 全仓。读取 `docs/architecture/mkd-design-spec.md`（全文 90 行）、`docs/architecture/mkd-information-architecture.md`（全文 104 行）、`docs/architecture/m1-a-schema-catalog.md`（全文 53 行）、`reference/schemas/` 下 14 个 schema 的 title 与 8 个重点 schema 全文（`common`、`knowledge-object`、`skill`、`task-package`、`action-package`、`evidence`、`governance`、`evaluation`）、`reference/ontology/` 三个 JSON 全文、`reference/fixtures/positive/amazon-ads-reference-package.json`、`reference/fixtures/negative/invalid-e3-skill.json`、`knowledge-system/capability-map.json`（13 条能力 + schema 全文）、`knowledge-system/schemas/capability-map.schema.json`（全文）、`knowledge-system/product-decisions.json`（全文）、`knowledge-system/acceptance.yml`（全文）、`package.json`（scripts 全量）、`scripts/check-evidence.mjs`、`scripts/check-reference-contracts.mjs`、`scripts/claim-registry.mjs`（关键断言 grep）。
- `book2skills`：`git clone --depth 1` 全仓。读取 `CONTRIBUTING.md`（全文 98 行）、`README.md`（前 120 行）、`skills-lock.json`（全文）、`skills/analyzing-financial-statements/SKILL.md`（全文 180 行）、`skills/intelligent-investor-graham/SKILL.md`（全文 172 行）、全部 38 个 skill 目录的形态枚举（实测 `for d in skills/*/`）、全部 `SKILL.md` 行数（实测 `wc -l`）、2 个 `subskills/*/module.md` 与 1 个 `references/case_library.md`、1 个 `quotes/*.md` 的骨架。
- `nuwa-skill`：raw 逐个下载 150 个文件至 `/tmp/srcrepos/nuwa/`。读取 `references/extraction-framework.md`（全文 151 行）、`references/fidelity-scorecard.md`（全文 63 行）、`references/skill-template.md`（全文 117 行）、`SKILL.md`（682 行，读取 heading 骨架 + 第 30–60、523–600、599–660 行段）、`examples/naval-perspective/FIDELITY.md`（全文）、`examples/x-mastery-mentor/FIDELITY.md`（全文）、`scripts/quality_check.py`（前 60 行 + 函数名全量）。

### 0.2 未覆盖 / 未穷尽的部分（诚实边界）

1. **ai-agent-book 的 15 个语言目录、`web-astro/`、`slides/`、`cursor-chats/` 内部内容未逐个读取**，仅按树条目计数。
2. **ai-agent-book 的 chapter 代码未实际 clone 执行**（仓库 756 MB，仅读了目录树与 skill 中的描述性引用）。因此「章节代码能跑通」**未被验证**，本报告只记录代码目录的**存在与命名**。
3. **Hyper-Extract 未实际安装、未调用真 LLM**，CLI 输出格式来自 `cli.py` 源码阅读，非运行结果。模板数量矛盾（见 2.5）中的「40 vs 80+」为文件系统实测计数。
4. **Kb2Agent 未运行 `npm run docs:qa` 或 `reference:contracts`**（需 node_modules），门禁行为来自脚本源码与验收文件阅读，非运行回执。
5. **nuwa-skill 的 15 个 `examples/*/SKILL.md` 未逐个全文阅读**，只读了 2 个 `FIDELITY.md` 与模板文件。各 example 的实际模型数量由 `FIDELITY.md` 自述，**未逐个数过**。
6. 本报告未覆盖任何仓库的 git commit 历史、PR/Issue、Releases 资产。
7. **未穷尽**：`skills/*/SKILL.md` 之外是否还有 skill 定义散落在其他路径——对 ai-agent-book 用 `path.startswith('skills/')` 过滤（命中 45 条），对 book2skills 用 `skills/*/` 枚举（38 个）；两者都只覆盖了各自仓库的约定目录，未做全仓文件名扫描。

### 0.3 自查更正留痕（初稿数字：原文如此，实测为假，已改正）

本节记录本报告撰写过程中**自己发现并已改正**的 4 处不实数字，保留痕迹以便复核，不做静默删除。全部由「写完后重跑校验命令」发现。

| # | 位置 | 初稿原文如此 | 实测结果 | 已改正为 | 复核命令 |
|---|---|---|---|---|---|
| 1 | §4.2 book2skills 目录形态分类 | 「单文件型 12 / quotes 型 11 / subskills+quotes 型 6 / subskills 型 3 / references 型 5 / references+scripts 型 3 / scripts 型 1」，共 7 种、合计 41（≠38，内部即不自洽） | 单文件型 **6** / quotes 型 **14** / subskills+quotes 型 **5** / references 型 **4** / references+scripts 型 **3** / subskills 型 **3** / references+quotes 型 **2** / scripts 型 **1**，共 **8** 种、合计 **38** ✓ | 已按实测全量成员名单重写 §4.2 与 §6.1/§6.3/F10 | `for d in skills/*/; do r=""; [ -e "$d/references" ] && r="${r}R"; [ -e "$d/subskills" ] && r="${r}S"; [ -e "$d/scripts" ] && r="${r}C"; [ -e "$d/quotes" ] && r="${r}Q"; printf "%-12s %s\n" "$r" "$(basename $d)"; done \| sort` |
| 2 | §4.2 / §5.1 / §6.3 / F10 | 「38 个里 30 个有功能性部件」；「nuwa SKILL.md 298–541 行」 | 有功能性部件 **32/38**；nuwa `examples/*/SKILL.md` 为 **343–541 行**（298 是 `sun-yuchen-perspective/README.md` 的行数，被误当作 SKILL.md 最小值） | 已改为 32/38 与 343–541，并补出「3 个超 500 行」 | `for d in skills/*/; do for x in references subskills scripts quotes; do [ -e "$d$x" ] && { echo x; break; }; done; done \| wc -l`；`wc -l examples/*/SKILL.md \| sort -n` |
| 3 | §6.1 Hyper-Extract 行 | 「SKILL.md + references/ + cases/，6/7 有 references/」 | `hyperextract-skills/` 下子 skill **6 个**，有 `references/` 的 **4 个**（graph-designer、record-designer、template-optimizer、yaml-validator），其中 2 个另带 `cases/` | 已改为 4/6 | `cd hyperextract-skills && for d in */; do [ -e "$d/references" ] && echo x; done \| wc -l` |
| 4 | §2.5 / F4 | 只指出「80+ templates」不符，未核对域数 | README 写 `across 6 domains`，实测 `ls -d hyperextract/templates/presets/*/ \| wc -l` → **7**（education/finance/general/industry/legal/medicine/tcm） | §2.5 补出「附带第二处不符」，F4 补出「也不得引用 6 domains」 | `ls -d hyperextract/templates/presets/*/ \| wc -l` |

**教训（与本项目的方法论纪律同源）**：第 1 处的错误形态是**先凭浏览印象填表、未做程序化计数**；第 2 处的错误是**把相邻文件的行数张冠李戴**；第 3 处是**用「大多数」代替计数**；第 4 处是**核对了主指标（模板数）就停手，漏掉了同一句话里的次指标（域数）**。三处都属于「估算被写成了实测的样子」。

---

## 1. ai-agent-book（信息源）

### 1.1 资产清单（实测数字）

**仓库总览**

| 指标 | 实测值 | 实测命令 |
|---|---:|---|
| 树条目总数 | 12619 | `/git/trees/main?recursive=1` |
| `skills/` 条目 | 45（22 个目录 + 22 个 SKILL.md + 1 个 README.md） | 同上，`path.startswith('skills/')` |
| `skills/` 总体积 | 242.6 KB（248436 B − 3783 B README） | 本地落盘后 `cat *.md \| wc -c` |
| 单个 SKILL.md 体积区间 | 7318 B – 16568 B | 同上 |
| `chapter1..chapter10` 文件数 | 8216 | 树条目按顶层前缀聚合 |
| `chapter1..chapter10` 体积 | 1117.9 MB | 同上（`sum(size)`） |
| chapter 真实子目录数 | 110 | 排除各章顶层 `README.*.md` 后的二级目录 |
| `EXPERIMENT_LEDGER.md` 数 | 8（chapter1–chapter8，chapter9/10 无） | `path.endswith('EXPERIMENT_LEDGER.md')` |
| `book/` 正文章节 | 10 个 `chapterN.md` + `introduction.md` + `afterword.md` + `reference-answers.md` | 树条目 |
| `book/` 图资产 | 132 个 SVG + 3 个 PNG（含 1.5 MB 的 `attention-visualization.png` 被 fig2-7.png 复用同尺寸） | `path.startswith('book/images/')` |
| 本书语言版本数 | 15（`book`、`book-ar/en/es/he/hu/id/ja/ko/ptbr/ru/ta/tr/vi/zhtw`） | 顶层目录聚合 |
| 顶层 README 语言版本 | 11 | `path.startswith('README') and count('/')==0` |
| `tests/` 文件 | 92 | 树条目 |
| `docs/` 文件 | 37 | 树条目 |
| `web-astro/` 文件 | 141 | 树条目 |
| `slides/` 文件 | 97 | 树条目 |

**按章正文字数（`book/chapterN.md` 字节数，实测）**

| 章 | 字节 | 章 | 字节 |
|---|---:|---|---:|
| chapter1 | 82813 | chapter6 | 93559 |
| chapter2 | 130806 | chapter7 | 109424 |
| chapter3 | 100023 | chapter8 | 136717 |
| chapter4 | 71664 | chapter9 | 62756 |
| chapter5 | 113700 | chapter10 | 101683 |

**按章代码目录（真实二级子目录名，实测）**

| 章 | 子目录数 | 子目录 |
|---|---:|---|
| chapter1 | 5 | context, image-gen-workflow, learning-from-experience, search-codegen, web-search-agent |
| chapter2 | 8 | agent-skills-ppt, attention_visualization, context-compression, kv-cache, local_llm_serving, prompt-engineering, prompt-injection, system-hint |
| chapter3 | 14 | agentic-rag, agentic-rag-for-user-memory, contextual-retrieval, contextual-retrieval-for-user-memory, dense-embedding, log-sanitization, mem0, memobase, retrieval-pipeline, sparse-embedding, structured-index, structured-knowledge-extraction, user-memory, user-memory-evaluation |
| chapter4 | 6 | active-tool-discovery, active-tool-selection, collaboration-tools, execution-tools, multimodal-agent, perception-tools |
| chapter5 | 16 | adaptive-log-parser, agent-creator, cad-vs-diffusion, code-for-logic, code-for-math, coding-agent, conversational-ui, dynamic-form, erp-agent, log-diagnosis, paper-to-ppt, paper-to-video, permission-embedded-data-objects, provider-failover, small-model-codified-rules, video-edit |
| chapter6 | 13 | agent-with-event-trigger, astra-async-steering, async-agent, claude-computer-use-native, computer-use-open-model, controllable-tts, end-to-end-speech, gemini-xlerobot-navigation, live-audio, phone-agent, rgb-sim2real-grasping, streaming-speech, xlerobot-teleoperation |
| chapter7 | 12 | agent-cost-analysis, android-world, elo-leaderboard, experiment-7-2-human-benchmark, model-action-threshold, model-benchmark, openvla-robotwin2-eval, public-health-reporting-eval, tau2-bench-eval, tts-quality-eval, user-memory-policy-eval, user-memory-system-evaluation |
| chapter8 | 18 | AWorld-train, AdaptThink, Intuitor, MiniMind-pretrain, MultilingualReasoning, RLVP, SimpleVLA-RL, SpatialReasoning, continued-pretraining, cot-distillation, curly-quote-sft, exact-copy-sft, orpheus, premature-completion-dpo, prompt-distillation, retool, sesame, speech-sft-experiment |
| chapter9 | 10 | ai-style-skill, browser-use-rpa, harness-safety-gate, hermes-self-evolution, prompt-auto-optimization, self-evolution-eval, self-evolving-tools, self-modifying-agent, tau2-escalation-experience, trajectory-verifier |
| chapter10 | 8 | autonomous-phone-registration, book-translation, generative-agents, multi-role-transfer, parallel-web-research, staged-system-prompt, talkact-reproduction, voice-werewolf |

> **口径更正**：若按「顶层条目」粗数，chapter3 会显示为 30、chapter5 为 30、chapter8 为 32——那是把 13–14 个 `README.<lang>.md` 与其目录混在一起数了。本报告统一采用**排除顶层 README 后的真实二级子目录**口径。

### 1.2 skill 格式范式

**这是五个仓库里格式最严格的一个：22/22 完全一致，零例外。**

**frontmatter 只有两个字段**（实测：对 22 个文件做正则提取，`frontmatter keys: {'name': 22, 'description': 22}`）：

```yaml
---
name: mcp-skill-hub
description: 为 Agent 接入第三方能力时使用——决定走 MCP 协议还是 Skill Hub 分发、搭建或选用 MCP 服务器、设计工具/资源/提示三类原语、评估引入第三方能力的 token 成本与安全风险、审查工具描述投毒与同名工具遮蔽、锁定服务器版本与配置最小权限凭证时查阅。含 MCP 客户端-服务器架构、传输层选型与供应链缓解清单。
---
```

- `name` = 目录名，kebab-case。
- `description` = **一段式触发说明**，结构固定为「[场景]时使用——[能力枚举]」；部分 skill 追加「触发词：A、B、C。」（实测：`agent-evolution`、`async-event-agent`、`bad-case-to-dpo`、`computer-use`、`post-training-strategy`、`reward-design` 共 6 个含「触发词：」）。**22 个里 16 个不含「触发词：」**，说明这不是必填项。
- `description` 有 2 个使用了 YAML `>-` 折叠块（`async-event-agent`、`computer-use`），其余 20 个为单行。

**正文骨架：严格 6 段，顺序固定**（实测：对 22 个文件提取全部 `## ` 标题后比对期望序列，脚本输出 `all 22 conform to exact 6-section order`）：

```
# <主题标题>

## 何时使用          ← 列表，5–8 条用户场景/触发条件
## 核心原则          ← 加粗小标题 + 一段解释；列书的判断规则
## 实践模式          ← 主体；可再分 ### 1..N 编号子节，含表格
## 常见陷阱          ← 列表，6–8 条反模式
## 配套代码          ← 仓库相对路径 + 每个目录一句话说明
## 深度阅读          ← `book/chapterN.md` + 书中小节名
```

| 段 | 命中数 |
|---|---:|
| `## 何时使用` | 22/22 |
| `## 核心原则` | 22/22 |
| `## 实践模式` | 22/22 |
| `## 常见陷阱` | 22/22 |
| `## 配套代码` | 22/22 |
| `## 深度阅读` | 22/22 |

**篇幅**：7318–16568 B，折合 80–129 行。**没有 references/、没有 scripts/、没有 subskills/——每个 skill 就是一个自包含的 `SKILL.md` 单文件。** 这一条由仓库自己写死在 `skills/README.md` 第 47–52 行：

> - 每个 skill 是单文件 `SKILL.md`，自包含，可独立使用
> - skill 内所有路径相对仓库根（如 `chapter4/active-tool-discovery/`、`book/chapter4.md`），方便回到原书与实验代码深入
> - 内容为书中知识的蒸馏（判断规则、步骤、关键数字），非书段摘抄

**是否引用章节代码：是，且是双向引用。** 「配套代码」段指向 `chapterN/<子目录>/`，「深度阅读」段指向 `book/chapterN.md`。实测统计「深度阅读」段中 `book/chapterN.md` 的引用次数：

```
agent-evaluation.md        8 次(ch7)      eval-dataset-design.md    2 次(ch7)
post-training-strategy.md  8 次(ch8)      multi-agent-design.md     5 次(ch10)
reward-design.md           5 次(ch8+ch9)  context-engineering.md    4 次(ch2)
agent-evolution.md         3 次(ch9)      error-recovery.md         2 次(ch5+ch1)
bad-case-to-dpo.md         4 次(ch8+ch9)  async-event-agent.md      2 次(ch6)
coding-agent-harness.md    2 次(ch5+ch1)  computer-use.md           2 次(ch6)
loop-engineering.md        2 次(ch10)     其余 9 个                各 1 次
```

**22/22 全部在「深度阅读」中回链 `book/chapterN.md`**——无一例外。

「配套代码」段还给出**可执行命令**，这是 book2skills / nuwa 都没有的（摘录 `agent-state-bar.md`）：

```
- `chapter2/system-hint/` — 实验 2-9（agent-status-bar 框架）：实现时间戳、工具计数器、TODO 列表、
  详细错误、系统状态五种状态栏技术，可独立开关；`python main.py --mode preview` 无需 API key 即可
  对比有无状态栏时模型看到的上下文差异；`python run_experiment_2_8.py` 跑冻结的对照实验。
```

### 1.3 章节↔skill 映射

映射关系**写在 skill 内部，不在中心注册表**。`skills/README.md` 给出汇总表（实测 `skills/README.md` 第 15–45 行），我按「深度阅读」段的实测回链做了交叉校验，`skills/README.md` 表与 SKILL.md 正文**一致**（唯一差异：`loop-engineering` 在 README 表标 `ch10`，实际「深度阅读」引用 `book/chapter10.md` 两次，一致）。

| 章 | skill 数 | skill 列表 |
|---|---:|---|
| ch1 | （作为补充） | 被 `coding-agent-harness`、`error-recovery` 二次引用 |
| ch2 | 4 | context-engineering, kv-cache-design, context-compression, agent-state-bar |
| ch3 | 3 | memory-system, rag-pipeline, knowledge-org |
| ch4 | 3 | tool-design, tool-discovery, mcp-skill-hub |
| ch5 | 3 | coding-agent-harness, error-recovery, +（`loop-engineering` 的代码在 ch5） |
| ch6 | 2 | async-event-agent, computer-use |
| ch7 | 2 | agent-evaluation, eval-dataset-design |
| ch8 | 3 | post-training-strategy, reward-design, bad-case-to-dpo |
| ch9 | 1 | agent-evolution（`bad-case-to-dpo`、`reward-design` 二次引用） |
| ch10 | 2 | multi-agent-design, loop-engineering |

**结构观察（推断）**：22 个 skill 覆盖 10 章，即**平均 2.2 个 skill/章**，且**一一对应到章内的实验小节**（如 `context-compression` ↔ 实验 2-10、`agent-state-bar` ↔ 实验 2-9）。skill 的粒度是「**一章内的一个技术主题**」，而不是「一章一个 skill」。书的组织是「第一部分（如何构建 Agent，ch1–ch6）+ 第二部分（如何提升能力，ch7–ch10）」，skill README 也原样沿用了这个二分。

**代码资产与 skill 引用密度**：110 个代码子目录 vs 22 个 skill，即**平均每个 skill 引用 3.4 个代码目录**（实测「配套代码」段路径计数）。

### 1.4 对本项目的可用性与缺口

**可直接复用**

1. **6 段骨架**是本项目 skill 模板最现成的候选：`何时使用 / 核心原则 / 实践模式 / 常见陷阱 / 配套代码 / 深度阅读`。它同时解决了「触发条件」「知识正文」「反模式」「溯源回链」四个需求，且已被 22 个实例验证一致性。
2. **「深度阅读」回链原书章节**的做法，直接对应本项目的「书籍→技能」可溯源性要求。
3. **「配套代码」段给出可执行命令 + 仓库相对路径**——本项目若产出可运行技能，这是最该抄的一段。
4. **路径相对仓库根**的约定（README 第 50 行明写），使 skill 可脱离仓库上下文回跳。
5. **`name` 即目录名、kebab-case** 的约定，与 book2skills 一致（见 4.3），可作为跨源共识采纳。

**缺口**

1. **无 governance / 无版本字段**：frontmatter 只有 `name`/`description`，没有 version、status、owner、eLevel、license。本报告第 3 节的 Kb2Agent 正是补这块的。
2. **无 references/ 分层**：单文件自包含在小体量（≤17 KB）成立，但本项目若做「一本书 → 多技能」且单技能超 500 行，单文件会失效（book2skills 的 500 行上限与 references/ 分层即是反证，见 4.3）。
3. **无验收机制**：没有测试、没有评分卡、没有晋升门禁。质量完全靠作者自律。
4. **本书是「作者自己写的书 → 作者自己蒸馏的 skill」**，不存在跨作者的忠实度问题；本项目若是「他人的书 → 我方蒸馏」，`核心原则` 段的「忠实于原文」就无法靠作者身份保证，需要引入 nuwa 的保真度评分卡（见 5.2）或 Kb2Agent 的证据等级（见 3.3）。
5. **「22 个 skill」这个数字在任务描述里被写成「22-24」**——实测**确定为 22**（22 个目录、22 个 SKILL.md）。
6. **章节代码的可用性未被验证**：110 个代码目录中，8 章有 `EXPERIMENT_LEDGER.md`（chapter9/10 无），ledger 体积 4620–11711 B。但本报告未 clone 执行，**「代码能跑通」未核实**。

---

## 2. Hyper-Extract（知识提取引擎）

### 2.1 核心能力实测

- **包版本**：`pyproject.toml` → `version = "0.10.5"`，`requires-python = ">=3.11"`，`license = "Apache-2.0"`（注意与 GitHub API 的 `NOASSERTION` 不同——GitHub 未识别，LICENSE 文件是 Apache-2.0）。
- **代码规模**（实测 `find hyperextract -name '*.py' | wc -l` → 69 个文件，`find ... -exec cat {} + | wc -l` → 20462 行）；测试 `tests/*.py` 76 个文件。
- **两个 console entry point**（`pyproject.toml` `[project.scripts]`）：

```toml
he = "hyperextract.cli:app"
he-mcp = "hyperextract.mcp_server:main"
```

- **CLI 顶层命令**（实测 `grep "^@app.command\|app.add_typer" hyperextract/cli/cli.py`）：

| 命令 | 注册行 | 说明 |
|---|---:|---|
| `he list`（typer 子应用） | 42 | 列出模板/文档 |
| `he config`（typer 子应用） | 43 | provider 配置 |
| `he template`（typer 子应用） | 44 | 模板管理 |
| `he parse` | 253 | 抽取入口 |
| `he show` | 460 | 可视化 |
| `he export obsidian\|graphml\|jsonld\|cypher\|csv` | 508/611/674/731/790 | 五种导出 |
| `he info` | 854 | 审计/来源账本 |
| `he search` | 1023 | 检索 |
| `he tag` | 1155 | 打标签、按 scope 检索 |
| `he talk` | 1210 | 对话 |
| `he feed` | 1381 | 增量投喂 + 旧事实回滚 |
| `he build-index` | 1499 | 建索引 |
| `he clean` / `he remove` | 1561 / 1610 | 清理 / 按 document 删 |

**抽取方法（`hyperextract/methods/`，实测文件清单）**

- `typical/`：`atom.py`(27944 B)、`itext2kg.py`、`itext2kg_star.py`、`kg_gen.py`
- `rag/`：`chunk_rag.py`、`cog_rag.py`(20230 B)、`graph_rag.py`(22758 B)、`hyper_rag.py`、`hypergraph_rag.py`(12575 B)、`light_rag.py`
- `registry.py`(4591 B)

### 2.2 数据模型（9 种结构）

源自 `hyperextract/types/__init__.py` 的模块 docstring（原文表格，实测逐字摘录）：

```
| Class | Structure | Core Use Case | Key Feature |
| **`AutoDocument`** | Text Chunks | Raw corpus retrieval | No LLM extraction; stores and searches chunks |
| **`AutoModel`** | Single Object | Document Summaries, Metadata | Merges all chunks into ONE consistent object |
| **`AutoList`** | List[Item] | Event Logs, Todo Lists | Appends items from all chunks commonly |
| **`AutoSet`** | Set[Item] | Entity Registries, Glossaries | Deduplicates items by key & merges details |
| **`AutoGraph`** | Nodes + Edges | Social Networks, Concept Maps | Enforces structural consistency (Node-Edge) |
| **`AutoHypergraph`** | Nodes + Hyperedges | Complex Events, Narratives | Edges connect 2+ nodes (N-ary relations) |
| **`AutoTemporalGraph`** | Graph + Time | Timelines, History, News | Resolves relative time ("yesterday") |
| **`AutoSpatialGraph`** | Graph + Space | Physical Spaces, 3D Mapping | Resolves relative location ("nearby") |
| **`AutoSpatioTemporalGraph`** | Graph + Time + Space | Event Networks, Travel | Resolves both time & location context |
```

`__all__` 导出确认（实测 `types/__init__.py` `__all__` 列表）：`AutoDocument, AutoGraph, AutoHypergraph, AutoList, AutoModel, AutoSet, AutoSpatialGraph, AutoSpatioTemporalGraph, AutoTemporalGraph, BaseAutoType, DocumentData, TextChunk`。

**分组（原文的四段划分）**：
1. Scalar & Document：`AutoDocument`（**不做 LLM 抽取**，仅分块+检索）、`AutoModel`（一篇文档→一个对象）
2. Collection：`AutoList`（可含重复、保序）、`AutoSet`（按唯一键去重合并）
3. Graph：`AutoGraph`（二元关系）、`AutoHypergraph`（N 元关系）
4. Context-Aware Graph：`AutoTemporalGraph`、`AutoSpatialGraph`、`AutoSpatioTemporalGraph`（后三者把「观察上下文」当前时间/位置注入 prompt 以解析相对表述）

**每种类型对应一个 YAML `type:` 值**：`document / model / list / set / graph / hypergraph / temporal_graph / spatial_graph / spatio_temporal_graph`。

### 2.3 模板 schema（贴真实 YAML）

**以下为 `hyperextract/templates/presets/finance/earnings_summary.yaml` 全文（实测 cat，一字未改）：**

```yaml
language: [zh, en]

name: earnings_summary
type: model
tags: [finance, earnings, investor-relations]

description:
  zh: '财报会议摘要模板 - 从财报电话会议记录中提取公司业绩、预期对比和前瞻指引'
  en: 'Earnings Call Summary Template - Extract company performance, consensus comparison, and guidance from earnings call transcripts'

output:
  description:
    zh: '财报会议的核心内容和关键信息'
    en: 'Core content and key information from earnings calls'
  fields:
    - name: company_name
      type: str
      description:
        zh: '公司名称'
        en: 'Company name'
      required: true
    - name: quarter
      type: str
      description:
        zh: '财报季度，格式如"2024Q3"'
        en: 'Reporting quarter in format like "2024Q3"'
      required: true
    - name: reported_revenue
      type: str
      description:
        zh: '报告期实际营收'
        en: 'Reported revenue for the period'
      required: true
    - name: reported_eps
      type: str
      description:
        zh: '报告期实际每股收益'
        en: 'Reported earnings per share'
      required: true
    - name: revenue_vs_consensus
      type: str
      description:
        zh: '营收与市场预期的对比'
        en: 'Revenue comparison with market consensus'
      required: true
    - name: eps_vs_consensus
      type: str
      description:
        zh: '每股收益与市场预期的对比'
        en: 'EPS comparison with market consensus'
      required: true
    - name: guidance_revenue
      type: str
      description:
        zh: '营收前瞻指引'
        en: 'Revenue guidance'
      required: false
    - name: guidance_eps
      type: str
      description:
        zh: '每股收益前瞻指引'
        en: 'EPS guidance'
      required: false
    - name: overall_tone
      type: str
      description:
        zh: '管理层整体语调：积极/中性/消极'
        en: 'Overall management tone: positive/neutral/negative'
      required: true
    - name: key_highlights
      type: list
      description:
        zh: '本次会议的主要亮点'
        en: 'Key highlights from this call'
      required: false
    - name: key_concerns
      type: list
      description:
        zh: '本次会议的主要关切问题'
        en: 'Key concerns raised in this call'
      required: false

guideline:
  target:
    zh: '你是一位专业的投研分析师，负责从财报电话会议记录中准确提取业绩数据和关键信息。'
    en: 'You are a professional investment research analyst responsible for accurately extracting performance data and key information from earnings call transcripts.'
  rules:
    zh:
      - '提取精确的营收和EPS数字，确保与财报一致'
      - '对比数据应反映与市场共识预期的差异'
      - '前瞻指引应区分营收指引和EPS指引'
      - '语调评估应基于管理层措辞和信心程度'
      - '亮点和关切应提炼自会议讨论的核心议题'
    en:
      - 'Extract precise revenue and EPS figures, ensuring consistency with financial reports'
      - 'Comparison data should reflect the difference from market consensus expectations'
      - 'Guidance should distinguish between revenue and EPS guidance'
      - 'Tone assessment should be based on management language and confidence level'
      - 'Highlights and concerns should distill the core topics discussed in the call'

identifiers: {}

display:
  label: '{company_name} {quarter}'
```

**图类型模板的差异（`general/base_graph.yaml` 关键段，实测摘录）**——`output` 下从 `fields` 变为 `entities`/`relations` 两个子块，并新增 `identifiers` + `options`：

```yaml
name: graph
type: graph
tags: [general, graph]
output:
  entities:
    description: {zh: '文本中可独立识别、可参与关系连接的实体节点。', en: '...'}
    fields:
    - name: name
      type: str
      description: {zh: '实体名称，使用文本中最明确、最稳定的称呼。', ...}
    - name: type
      type: str
      ...
    - name: description
      type: str
      required: false
  relations:
    fields:
    - name: source      # 必须对应已提取实体的名称
    - name: target
    - name: type
    - name: description
      required: false
guideline:
  target: {zh: '你是一位知识抽取与知识图谱构建专家。...'}
  rules_for_entities:
    zh: [...]
  rules_for_relations:
    zh:
    - '仅在文本明确表达两个实体之间存在语义联系时创建关系，不要凭常识补充隐含关系。'
    - '避免重复关系；若同一对实体存在多种不同关系，可分别记录。'
    - '优先使用文本中明确出现的关系词，不要过度抽象化。'
identifiers:
  entity_id: name
  relation_id: '{source}|{type}|{target}'
  relation_members:
    source: source
    target: target
options:
  extraction_mode: two_stage
display:
  entity_label: '{name} ({type})'
  relation_label: '{type}'
```

**模板 YAML 的顶层 schema（从 40 个模板实测归纳，非官方文档声明）**

| 键 | 出现范围 | 含义 |
|---|---|---|
| `language` | 全部 | `[zh, en]` 双语数组 |
| `name` | 全部 | 模板名 |
| `type` | 全部 | 9 种 AutoType 之一 |
| `tags` | 全部 | 用于 `Gallery.list(filter_by_tag=...)` |
| `description.{zh,en}` | 全部 | 双语说明 |
| `output.description` + `output.fields`（record 类）或 `output.entities`/`output.relations`（graph 类） | 全部 | 抽取目标结构 |
| `guideline.target` + `guideline.rules`（或 `rules_for_entities`/`rules_for_relations`） | 全部 | 注入 LLM 的 prompt 片段 |
| `identifiers` | graph 类非空；model 类为 `{}` | 主键与关系端点表达式 |
| `options.extraction_mode` | 部分 | 如 `two_stage` |
| `display.label` / `display.entity_label` / `display.relation_label` | 全部 | 展示格式模板 |

### 2.4 调用方式与依赖

**CLI（README「30-Second Quick Start」实测摘录）**

```bash
uv tool install hyperextract          # 或 pipx install hyperextract

# 配置 provider（二选一或混搭）
he config init -p openai -k YOUR_OPENAI_API_KEY
he config llm -p deepseek -k YOUR_DEEPSEEK_API_KEY
he config embedder -p openai -k YOUR_OPENAI_API_KEY

# 抽取 → 检索 → 展示 → 导出
he parse examples/en/tesla.md -t general/biography_graph -o ./output/ -l en
he search ./output/ "What are Tesla's major achievements?"
he show ./output/
he export obsidian ./output/ -o ./vault/
he feed ./output/ updated-tesla.md --source tesla.md   # 增量：旧事实自动回滚
he tag ./output/ --source tesla.md --add biography
he search ./output/ "inventions" --tag biography
he info ./output/ --sources
```

**`he parse` 完整签名（实测 `cli.py` 第 253–278 行）**

```python
def parse(
    input: str              # 文件 / 目录 / '-' 读 stdin
    output: str             # --output, -o  （必填）
    template: str | None    # --template, -t （省略则交互式选择）
    method: str | None      # --method, -m  （如 light_rag, hyper_rag）
    lang: str | None        # --lang, -l   （zh/en；知识模板必填，方法模板可选默认 en）
    force: bool             # --force, -f  （强制覆盖）
    no_index: bool          # --no-index   （跳过建检索索引）
    source: str | None      # --source     （文档 id，用于后续按 document 回滚）
)
```

**Python API（README 摘录）**

```python
from hyperextract.utils.template_engine import Gallery, TemplateFactory
template = TemplateFactory.create(config, llm, embedder)
result = template.parse("Your document text here...")
all_templates = Gallery.list()
graph_templates = Gallery.list(filter_by_type="graph")
finance_templates = Gallery.list(filter_by_tag="finance")
```

**MCP：提供，且有一个独立入口。** 实测 `hyperextract/mcp_server.py` 第 419–440 行：

```python
def build_server():
    try:  # mcp 1.x
        from mcp.server.fastmcp import FastMCP
        server = FastMCP(SERVER_NAME)
    except ImportError:  # mcp 2.x: FastMCP was renamed to MCPServer
        from mcp.server.mcpserver import MCPServer
        server = MCPServer(SERVER_NAME)
    for fn in (list_templates, info, search, ask, export_obsidian,
               export_graphml, export_csv, export_jsonld, export_cypher):
        server.tool()(fn)
    return server

def main() -> None:
    build_server().run()     # stdio
```

→ **9 个 MCP 工具**：`list_templates, info, search, ask, export_obsidian, export_graphml, export_csv, export_jsonld, export_cypher`。传输为 **stdio**（`build_server().run()`）。MCP 依赖为 **optional extra**：`pip install "hyperextract[mcp]"`（`mcp>=1.2.0,<3`）。

**外部服务依赖（必须，不可绕过）**

| 依赖 | 是否必需 | 证据 |
|---|---|---|
| **LLM provider** | 必需（除 `AutoDocument`） | `he config llm -p ...`；`create_llm(config)` 在 `utils/client.py` |
| **Embedder provider** | 必需（检索/检索类方法） | `he config embedder -p ...`；`_get_clients()` → `tuple[BaseChatModel, Embeddings]` |
| 支持的 provider | `openai / bailian / deepseek / anthropic / google / vllm / orcarouter` | `PROVIDER_PRESETS`（`client.py` 第 31 行）；`examples/providers/` 下 7 个 demo：anthropic, bailian, deepseek, google, openai, orcarouter, vllm |
| 原生（非 OpenAI 兼容）LLM | `anthropic/claude`、`google/gemini` | `ANTHROPIC_PROVIDERS`、`GOOGLE_PROVIDERS`、`_NATIVE_LLM_PROVIDERS`（`client.py` 第 99–106 行） |
| 文档转换（PDF/DOCX/PPTX/XLSX） | 可选 extra | `ingest = ["markitdown[pdf,docx,pptx,xlsx]>=0.1.4"]`；`markitdown` 被放在 `[dependency-groups] dev` 而非 core，注释为 `# document conversion backend for readers.py (kept in dev so CI tests it)` |

**能否离线？——能，但只有一条窄路径。** 实测结论：

1. **`AutoDocument`（`type: document`）不做 LLM 抽取**（模块 docstring 原文：`No LLM extraction; stores and searches chunks`），但**仍需要 embedder** 才能 `search`——`_get_clients()` 强制返回 `(BaseChatModel, Embeddings)` 二元组。
2. **本地 vLLM 可消除外部网络依赖**（README 原文示例）：
   ```bash
   he config llm -p vllm -u http://localhost:8000/v1 -k dummy -m Qwen/Qwen3.5-9B
   he config embedder -p vllm -u http://localhost:8001/v1 -k dummy -m BAAI/bge-m3
   ```
   这是**自托管**，不是「无 provider」。README 自述 `Local vLLM (free, on-premise)`，并注明 `local vLLM is free but needs a GPU`。
3. **FAISS 是本地依赖**（`faiss-cpu>=1.13.2`），检索索引本身离线可跑。
4. 实测在 `cli.py` 中 grep `offline|no_llm` → **无命中**（唯一相关命中是 `remove` 命令的 `dry_run`，语义是「只打印删除提案不落盘」，与抽取无关）。→ **不存在「无 LLM 抽取」的离线模式。**

**`hyperextract-skills/`（7 个 skill，实测文件清单）**

| skill | 文件 | 说明 |
|---|---|---|
| 顶层 `SKILL.md` | 2609 B | 路由入口；工作流 `User → brainstorm → designer → validator → multilingual` |
| `brainstorm/` | SKILL.md | 需求探索、定类型 |
| `record-designer/` | SKILL.md + `cases/`(3 YAML) + `references/`(field.md, identifier.md) | model/list/set 类设计 |
| `graph-designer/` | SKILL.md + `cases/`(3 YAML) + `references/`(dimensions, entity, hypergraph, relation) | graph/hypergraph/temporal/spatial 类设计 |
| `yaml-validator/` | SKILL.md + `references/`(rules-errors, rules-identifiers, rules-syntax, rules-types) | YAML 校验 |
| `multilingual/` | SKILL.md | 双语支持 |
| `template-optimizer/` | SKILL.md + `references/`(rules-consistency, rules-field-count, rules-hypergraph-grouping, rules-multilingual, rules-naming) | 模板优化 |

顶层 SKILL.md 的 frontmatter 形态（实测全文）：

```yaml
---
name: hyper-extract
description: |
  Hyper-Extract Knowledge Template Designer for structured knowledge extraction.
  Use when user wants to: design YAML templates, extract structured knowledge, create knowledge graphs.
  Available skills: brainstorm, record-designer, graph-designer, yaml-validator, multilingual.
  Trigger: User mentions template design, extraction, knowledge graph, or YAML configuration.
---
```

→ 注意**只有 `name` 和 `description`**（与 ai-agent-book 相同的极简 frontmatter），`description` 用 `|` 块标量，且**在 description 里内联了子 skill 清单与触发词**——这是一种「把路由表塞进 description」的省文件写法。

### 2.5 集成风险与缺口

1. **🔴 模板数量声明与实际不符（可复现）。** README 三处声称 `80+`：
   - `README.md:316` — `- **Templates** — 80+ presets across 6 domains. Zero-code setup.`
   - `README.md:350` — `- [Browse all 80+ templates](./hyperextract/templates/presets/)`
   - `README.md:369` — `| Template Gallery | [80+ presets](./hyperextract/templates/presets/) |`
   - `README_ZH.md:350/369` — `浏览全部 80+ 模板` / `80+ 预设模板`

   **实测计数：**
   ```bash
   $ find he/hyperextract/templates/presets -name '*.yaml' | wc -l
   40
   $ grep -o 'presets/[a-z]*/[a-z_]*\.yaml' hyperextract/templates/README.md | sort -u | wc -l
   39
   ```
   → **目录内实存 40 个 YAML，仓库自带模板目录表只列了 39 个**（README 漏列 1 个）。7 个域的实测分布：`education 2 / finance 5 / general 13 / industry 5 / legal 5 / medicine 5 / tcm 5`（实测 `find`）。**「80+」未能核实，实测为 40。** 若按「模板 × 2 语言」计也只有 80，但文件系统上是 40 个 YAML 文件，`Gallery.list()` 按文件枚举。**结论：声称的 80+ 与实测 40 相差一倍，集成时不得引用 80+。**
   **附带第二处不符**：README 原文写 `across 6 domains`，实测 `ls -d hyperextract/templates/presets/*/ | wc -l` → **7 个域**（education 2 / finance 5 / general 13 / industry 5 / legal 5 / medicine 5 / tcm 5 = 40）。域数也被低报。
2. **`Gallery.get()` 的 docstring 与实现不符**（`utils/template_engine/gallery.py` 第 38–40 行原文）：`Only templates in the "general/" domain are supported. Other domains are not supported.` —— 但 `he parse -t finance/earnings_summary` 在 README 官方示例中是被支持的（`-t general/biography_graph` 也带域前缀）。这是**过期 docstring**，不是真实限制（`Gallery.get` 实现在路径含 `/` 时直接查 `_configs`）。
3. **无 README，靠 docs 站**：`docs/` 下英文 100+ md、中文同构，但仓库根 `README.md` 14216 B 与 `README_ZH.md` 13971 B 为主要入口。文档与代码分离，文档可能滞后（第 1 条即是实例）。
4. **强耦合 LangChain**：`langchain>=1.2.6`、`langchain-community`、`langchain-openai`，加上 `ontomem>=0.6.1`、`ontosight>=0.1.8`、`semhash>=0.4.1`。**`ontomem` 与 `ontosight` 是本仓库作者的自研包**（未在 README 中说明），属于**不可控的上游依赖**，集成风险评估中应单列。
5. **license 在 GitHub 上显示为 `NOASSERTION`**，实际 LICENSE 是 Apache-2.0。若本项目要做合规引用，应以 LICENSE 文件为准并记录该差异。
6. **抽取结果依赖 LLM，无确定性保证**：模板只约束 prompt 与字段 schema，`tests/` 中大量测试是 mock（`tests/mocks.py`、`tests/utils/test_client.py` 29435 B）。`tests/integration/test_real_extraction.py` 存在但需真 key。→ **「同一输入产出同一结构」不成立**，本项目的证据机制不能直接采信其输出。
7. **MCP 是 stdio + optional extra**，非默认安装路径。若本项目要在 DSH 中挂载，需显式装 `hyperextract[mcp]`。
8. **本项目若只取「数据结构分类」而不装引擎**：9 种 AutoType 是一份可独立借鉴的**目标结构分类法**（尤其是 `AutoModel` 一篇→一对象 vs `AutoSet` 去重集合 vs `AutoHypergraph` N 元关系 的区分），且 `type:` 枚举值可直接复用为自研 schema 的 type 字段。

---

## 3. Kb2Agent（skill 目录规范与治理）

### 3.0 重要前提更正

**任务描述里的两处指向与实际仓库不符，须先更正：**

1. **`docs/architecture/mkd-design-spec.md` 不是知识分层文档，而是 UI 设计规格。** 全文 90 行，章节为「视觉方向 / 色彩与字体 / 页面构图 / 动效 / 组件状态 / 关键视口验收 / 可访问性规格 / 原型证据边界」。它只在一处涉及层级：组件状态表里的 `| Evidence badge | L0 / L1 / LO-S / L2 / L3 / L4 |` 与 `| Maturity badge | draft / replayable / live-candidate / accepted / blocked |`（第 64–65 行）。
2. **`docs/architecture/mkd-information-architecture.md` 是站点信息架构（sitemap/用户流程/响应式），同样不是分层文档。** 唯一层级线索在第 34 行：`| Knowledge Map | 哪些对象和关系进入任务上下文？ | L0–L6 闭包 | ... |`。

**真正的分层权威文件是 `docs/architecture/m1-a-schema-catalog.md`（全文 53 行）**，由 `knowledge-system/capability-map.json` 的 `CAP-LAB-SCHEMA.evidenceRefs` 明确指向（实测）。本节以它为准。

**任务描述要求产出的「一个 skill 目录该有哪些文件」——Kb2Agent 没有这项规定。** 实测：在 Kb2Agent 全仓（排除 `docs/knowledge/` 讲义目录）grep `SKILL.md` → **零命中**。它定义的是 **Skill 作为一个 JSON 对象**（`reference/schemas/skill.schema.json`），不是磁盘目录布局。末尾 3.4 节会明确说明这一点及替代来源。

### 3.1 知识分层模型

**结论：仓库内部存在三套互不相同的 L 编号体系，同一份材料里同时出现，且校验器只强制其中一部分。以下是实测全文对照。**

**体系 (a)：`docs/architecture/m1-a-schema-catalog.md` 第 13–25 行的对象链表（唯一的完整 7 层定义）**

| 层 | 主要对象 | Schema | 进入下一层的必要条件 |
|---|---|---|---|
| L0 | SourceArtifact / SourceRevision / StructuralElement | `source.schema.json` | revision、hash、来源与结构定位完整 |
| L1 | EvidenceFragment / Claim | `evidence.schema.json` | locator 可解析、支持与冲突引用可追溯 |
| L2 | Concept / Metric / DecisionModel / Case / Playbook | `knowledge-object.schema.json` | 类型化、版本化、关系端点合法 |
| L3 | Skill | `skill.schema.json` | PromotionDecision 存在，首案最高 E2 |
| L4 | TaskPackage | `task-package.schema.json` | Skill、对象闭包和 EvaluationContract 均可解析 |
| L5 | ActionPackage / RunTrace | `action-package.schema.json` / `run-trace.schema.json` | 固定 fixture 可重放，事件输入输出闭合 |
| L6 | KnowledgeReceipt / ReleaseSnapshot | `knowledge-receipt.schema.json` / `release-snapshot.schema.json` | 评估引用、trace、manifest hash 一致 |

**体系 (b)：schema 文件自身的 `title` 字段（实测 `python3 -c "...json.load(f).get('title')"` 遍历全部 schema）**

| schema 文件 | title |
|---|---|
| `source.schema.json` | `MKD L0 Source Objects` |
| `evidence.schema.json` | `MKD L1 Evidence Objects` |
| `knowledge-object.schema.json` | `MKD L2-L4 Knowledge Objects` |
| `skill.schema.json` | **`MKD L5 Skill`** |
| `task-package.schema.json` | **`MKD L6 TaskPackage`** |
| `action-package.schema.json` | `MKD Decision ActionPackage`（无层号） |
| `knowledge-receipt.schema.json` | `MKD KnowledgeReceipt`（无层号） |
| `release-snapshot.schema.json` | `MKD Immutable ReleaseSnapshot`（无层号） |

**体系 (c)：`reference/ontology/terms.json` 的 `layer` 字段（实测全文）**

```json
{ "id": "TERM-SOURCE-ARTIFACT",  "zh": "来源资产",  "en": "SourceArtifact",  "layer": "L0" },
{ "id": "TERM-EVIDENCE-FRAGMENT","zh": "证据片段",  "en": "EvidenceFragment","layer": "L1" },
{ "id": "TERM-DECISION-MODEL",   "zh": "决策模型",  "en": "DecisionModel",   "layer": "L3" },
{ "id": "TERM-SKILL",            "zh": "技能契约",  "en": "Skill",           "layer": "L5" },
{ "id": "TERM-TASK-PACKAGE",     "zh": "任务包",    "en": "TaskPackage",     "layer": "L6" },
{ "id": "TERM-ACTION-PACKAGE",   "zh": "决策行动包","en": "ActionPackage",   "layer": "output" },
{ "id": "TERM-KNOWLEDGE-RECEIPT","zh": "知识回执",  "en": "KnowledgeReceipt","layer": "output" }
```

**三套体系的分歧点（实测对照）**

| 对象 | (a) 目录表 | (b) schema title | (c) terms.json |
|---|---|---|---|
| SourceArtifact | L0 | L0 | L0 |
| EvidenceFragment | L1 | L1 | L1 |
| Concept/Metric/**DecisionModel**/Case/Playbook | L2 | **L2-L4** | **L3**（仅 DecisionModel 有条目） |
| Skill | **L3** | **L5** | **L5** |
| TaskPackage | **L4** | **L6** | **L6** |
| ActionPackage / RunTrace | **L5** | 无层号 | `output` |
| KnowledgeReceipt / ReleaseSnapshot | **L6** | 无层号 | `output` |

**唯一自洽的解读（推断，标注为推断）**：似乎是 (a) 是**生成序列**（对象链的推进次序），(c) 是**抽象深度**（DecisionModel 被当作与知识对象不同层的抽象），(b) 是**schema 文件的归类标签**。但仓库从未写文档说明这三者为何不同，**且 `check-reference-contracts.mjs` 中没有任何断言校验层号**（实测：该脚本 422 行输出仅 `Evidence ceiling: L2 fixture/dry-run; ...`，层号断言零命中）。→ **集成时不得引用任何单一层号作为规范，本报告统一采用体系 (a) 的目录表并显式标注来源。**

**与分层正交的还有两套独立等级系统（这两套是严格定义且有校验的）：**

**证据等级 `evidenceGrade`（`common.schema.json` `$defs.evidenceGrade`，6 值枚举）**
```json
"evidenceGrade": {
  "enum": ["L0-unverified", "L1-public-or-runtime", "LO-S-synthetic",
           "L2-fixture-or-dry-run", "L3-production-read-only", "L4-authorized-live"]
}
```
语义（来自 `knowledge-system-audit.md` 第 164–165 行与 `capability-map.json`）：`L0 未验证`（只有限制和下一动作，**不得升级成熟度**）、`L1 一手公开/只读观察`（**证明公开来源或当前仓库事实，不证明实施完成**）、`L2 fixture/dry-run`、`L3 生产只读`、`L4 授权在线`、`LO-S synthetic`（公网演示的合成数据专用，见 `mkd-design-spec.md` 第 90 行「原型中的 Amazon Ads 数据是 `LO-S synthetic`」）。

**执行等级 `eLevel`（`common.schema.json` `$defs.eLevel` / `publicELevel` + `reference/ontology/permissions.json`）**
```json
{ "$defs": { "eLevel": {"enum": ["E0","E1","E2","E3","E4"]},
             "publicELevel": {"enum": ["E0","E1","E2"]} } }
```
`permissions.json` 全文：
```json
{ "levels": [
    { "level": "E0", "description": "只读解释，无工具调用",           "public": true  },
    { "level": "E1", "description": "只读检索",                       "public": true  },
    { "level": "E2", "description": "只读检索、受控计算、行动草案",   "public": true  },
    { "level": "E3", "description": "可逆外部写入",                   "public": false },
    { "level": "E4", "description": "高影响或不可逆外部动作",         "public": false } ],
  "publicMaximum": "E2",
  "publicToolModes": ["read", "calculate", "draft"],
  "externalWrite": false,
  "canonicalKnowledgeWrite": false }
```

→ **关键机制：公开面只能到 E2。** `skill.schema.json` 与 `task-package.schema.json` 都只允许 `publicELevel`（E0–E2），**E3/E4 在 schema 层就被排除**。反例 fixture 也正是打这个点：`reference/fixtures/negative/invalid-e3-skill.json` 全文是
```json
{ "operations": [ ... { "operation": "replace", "path": "/skills/0/eLevel", "value": "E3" } ] }
```
—— 把 `eLevel` 改成 `E3` 就是一个**必须被拒绝的负例**。这是「禁止机制」的第一层（schema 层）。

### 3.2 知识对象类型

**顶层对象链（体系 (a)）共 20 个对象类型，分布如下（实测各 schema 的 `oneOf` / `objectType` const）：**

**L0 — `source.schema.json`（title: `MKD L0 Source Objects`）**
| 对象 | required |
|---|---|
| `SourceArtifact` | `title, format, language, contentHash, license`（`license` 内层 required `state, redistribution`） |
| `SourceRevision` | `sourceArtifactId, asOf, contentHash` |
| `StructuralElement` | `sourceRevisionId, elementType, locator, contentHash, text` |

**L1 — `evidence.schema.json`（title: `MKD L1 Evidence Objects`）**
| 对象 | required |
|---|---|
| `EvidenceFragment` | `summary, locator, grade`（另有可选 `verbatimExcerpt`，**`maxLength: 800`**） |
| `Claim` | `statement, supportRefs, contradictionRefs, applicability, claimStatus`；`claimStatus ∈ {supported, contested, unknown, expired}` |

> 注意 `Claim` 有 **`contradictionRefs`（必填但可为空数组）+ `unknown` 状态**——「冲突」与「未知」是一等公民，不是异常。

**L2 — `knowledge-object.schema.json`（title: `MKD L2-L4 Knowledge Objects`）共 7 种**

| 对象 | required 字段 | 要点 |
|---|---|---|
| `Concept` | `canonicalTerm, aliases, definition, examples` | `definition` ≥12 字；`aliases` 去重 |
| `Metric` | `name, formula, inputs, unit, window, failureModes` | **强制 `failureModes`（指标失效模式）** |
| `MentalModel` | `trigger, inputs, reasoning, limits, counterexample` | **强制 `counterexample`（反例）** ——与 nuwa 的「三重验证」同源思路 |
| `DecisionModel` | `inputs, branches, outputs, unknownPolicy, stopConditions, reviewState` | `branches[].{when,then}`；`unknownPolicy` ≥8 字；`reviewState ∈ {pending-domain-review, domain-approved}` |
| `Heuristic` | `trigger, recommendation, confidence, exceptions` | `confidence` 为 `0–1` 数值 |
| `Case` | `title, context, facts, decisions, outcome, evidenceRefs, limitations, dataClass` | `dataClass ∈ {synthetic, deidentified-real, authorized-real}` |
| `Playbook` | `title, prerequisites, steps, checks, rollback, approval` | 强制 `rollback`（**无回滚不成为 Playbook**） |

**L3 — `Skill`（`skill.schema.json`，title `MKD L5 Skill`）**，required 10 项：
```json
["name","inputContract","outputContract","tools","steps","eLevel",
 "stopConditions","rollback","tests","promotionDecisionRef"]
```
（此 JSON 数组为实测逐字摘录；完整结构见 3.3）

**L4/L6 — `TaskPackage`（`task-package.schema.json`）**，required 8 项：
```json
["name","taskContract","requiredClosure","skillRef","outputSchemaRef",
 "evaluationRefs","eLevel","publicInput"]
```
其中 `requiredClosure` 是**对象闭包预算**：`{objectIds[], allowedRelations[], maxDepth(1–4), maxObjects(1–100)}`——即「一个任务最多能拉进多少知识对象、走多深的图」被写死在契约里。`publicInput` 强制 `freeText: false`、`fileUpload: false`、`urlInput: false`（**公开面三个输入通道全部关闭**，只允许 `allowedParameters` 白名单）。

**L5 — `ActionPackage` / `RunTrace`**
- `ActionPackage` required 15 项，含 `facts[], inferences[], unknowns[], options[], recommendation, calculations[], risks[], stopConditions[], approvalRequirements[], evidenceRefs[], status`。`status ∈ {draft-for-review, blocked-insufficient-input, approved-for-manual-execution}`（**没有 "executed"**）。`options[].externalWrite` 强制 `const: false`。`calculations[].resultState ∈ {exact, range, formula-only, blocked}`。
- `RunTrace` required：`traceId, runId, mode, events, status, externalCalls, sideEffects`；`events[]` required `eventId, stage, kind, startedAt, durationMs, status, inputRefs, outputRefs`。

**L6 — `KnowledgeReceipt` / `ReleaseSnapshot`**
- `KnowledgeReceipt` required 16 项：`receiptId, runId, mode, evidenceGrade, snapshot, taskPackage, skill, model, prompt, tools, traceRef, evaluationRefs, artifactHashes, externalCalls, sideEffects, issuedAt`。
- `ReleaseSnapshot` required 8 项：`snapshotId, version, objectIds, relationIds, canonicalization, manifestHash, createdAt, immutable`。

**辅助对象 — `governance.schema.json`（title: `MKD Supporting Governance Objects`）共 8 种**
`Policy`（`enforcement ∈ {advisory, blocking}`）、`FreshnessRule`（`maxAgeDays` + `onExpiry ∈ {warn, block-context, block-task}`）、`PermissionRule`（`maxELevel` + `allowedToolModes` + `externalWrite: false`）、`Ownership`（`roleRefs` **minItems=4, maxItems=4**）、`PromotionDecision`、`Acceptance`（`roleRefs` 同样**恰好 4 个**、`productionReady: const false`）、`Observation`（`freeText: const false`）、`KnowledgeCandidate`（`canonicalWrite: const false`）。

**辅助对象 — `evaluation.schema.json`（title: `MKD Evaluation Contracts`）共 2 种**
- `EvaluationContract` required `targetRef, datasetRef, graders, thresholds, negativeRequirements`；**`graders` minItems=2**，取值 `{schema, citation, task-success, permission, human-domain}`；**`negativeRequirements` 必填（没有负例不算评估契约）**；`thresholds[].approvalState ∈ {illustrative, approved}`。
- `GoldenTask` required `taskPackageRef, category, input, expected, dataClass`；`category ∈ {positive, negative, adversarial}`；`expected.status` 只能是 `{draft-for-review, blocked-insufficient-input}`；**`expected.maxExternalCalls: const 0`、`maxSideEffects: const 0`、`dataClass: const "synthetic"`**。

**关系白名单 — `reference/ontology/relations.json`（12 条，实测全文的 type 列表）**
`derived_from`、`supports`、`contradicts`、`defines`、`requires`、`applies_to`、`implements`、`uses_metric`、`validated_by`、`supersedes`（`sameType: true, acyclic: true`）、`blocked_by`、`produces`。
每条都带 `from[]`/`to[]` 端点类型白名单。`m1-a-schema-catalog.md` 第 29–35 行原文说明校验器同时阻止：悬空引用与类型不一致、不允许的 `fromType → toType`、`supersedes` 有向环、**`Case 绕过 KnowledgeCandidate / PromotionDecision 直接产生 Skill`**、snapshot 的 canonical hash 不一致。

### 3.3 skill 生命周期与门禁

**核心机制：任何 Skill 都必须挂一个 `promotionDecisionRef`。**

`skill.schema.json` 的 required 数组里 `promotionDecisionRef` 是**必填**（`{ "$ref": ".../common.schema.json#/$defs/identifier" }`），而 `identifier` 的 pattern 是 `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$` —— 即**必须是一个大写连字符 ID**。

正例 fixture 中它是这样落地的（`reference/fixtures/positive/amazon-ads-reference-package.json` 的 `skills[0]` 全文，实测摘录）：

```json
{
 "id": "SKILL-AMZ-ACOS-DRAFT",
 "objectType": "Skill",
 "revision": 1,
 "status": "candidate",
 "createdAt": "2026-08-09T00:00:00Z",
 "sourceRefs": ["PLAYBOOK-AMZ-ACOS-CHECK"],
 "name": "Draft ACOS diagnostic action package",
 "inputContract":  { "schemaRef": "https://mkd.local/schemas/task-package.schema.json" },
 "outputContract": { "schemaRef": "https://mkd.local/schemas/action-package.schema.json" },
 "tools": [
  { "toolId": "TOOL-READ-SNAPSHOT",     "mode": "read",      "sideEffect": false },
  { "toolId": "TOOL-CALCULATE-METRIC",  "mode": "calculate", "sideEffect": false },
  { "toolId": "TOOL-DRAFT-ACTION",      "mode": "draft",     "sideEffect": false }
 ],
 "steps": [
  "load required closure",
  "validate metric inputs",
  "rank supported hypotheses",
  "draft manual checks"
 ],
 "eLevel": "E2",
 "stopConditions": [
  "required metric inputs are missing",
  "evidence is expired or contradictory"
 ],
 "rollback": [
  "discard generated draft",
  "retain immutable replay receipt"
 ],
 "tests": ["GOLDEN-AMZ-ACOS-POSITIVE", "GOLDEN-AMZ-ACOS-MISSING-INPUT"],
 "promotionDecisionRef": "PROMOTION-AMZ-ACOS-SKILL"
}
```

**校验器强制（`scripts/check-reference-contracts.mjs` 实测）**

| 行 | 断言 |
|---:|---|
| 136 | `requireRef(skill.promotionDecisionRef, 'PromotionDecision', skill.id)` — 该 ref 必须解析到一个真实存在的 `PromotionDecision` 对象 |
| 157 | `errors.push({ code: 'CASE_SKILL_PROMOTION_FORBIDDEN', message: \`${relation.relationId} bypasses KnowledgeCandidate and PromotionDecision\` })` — **Case 直接产 Skill 被硬拒绝** |
| 284 | `const forbidden = new Set(decisions.implementationAuthorization.forbiddenWithoutNewAuthorization)` |
| 286 | `if (!forbidden.has(action)) throw new Error(\`authorization registry does not fail closed for ${action}\`)` — **授权表必须「失败关闭」：`forbiddenWithoutNewAuthorization` 必须真的包含该动作** |
| 353 | `if (adapter.promotionGate?.bulkMigrationAllowed !== false \|\| adapter.promotionGate?.automaticAcceptanceAllowed !== false) { ... }` — 适配器必须显式声明**禁止批量迁移、禁止自动验收** |
| 422 | 输出收尾：`Evidence ceiling: L2 fixture/dry-run; no provider call, production write, acceptance or deployment was performed.` |

**`PromotionDecision` 对象本体**（`governance.schema.json` `$defs.promotionDecision`）
```
required: candidateRef, targetType, decision, reviewerRoleRefs, reasons
targetType ∈ {Claim, Concept, Metric, DecisionModel, Case, Playbook, Skill, TaskPackage}
decision   ∈ {pending, approved, rejected}
reviewerRoleRefs: minItems 1（至少一个具名评审角色）
reasons:          minItems 1
```

**候选侧入口 `KnowledgeCandidate`**：required `observationRefs, proposedType, proposal, canonicalWrite`，**`canonicalWrite: const false`** —— 候选**在任何情况下都不能直接写规范库**。

**观测侧入口 `Observation`**：`category ∈ {wrong-source, stale, missing-input, unsafe-recommendation, schema-error}`，`severity ∈ {low, medium, high}`，**`freeText: const false`**。全链路是 `Observation → KnowledgeCandidate → PromotionDecision → Skill`，`canonicalWrite: false` 与 `Case_SKILL_PROMOTION_FORBIDDEN` 两处硬闸把这条链锁死。

**验收门禁（`acceptance`）**：`governance.schema.json` 的 `Acceptance` 要求 `roleRefs` **恰好 4 个**、`thresholdRefs` ≥1、`state ∈ {draft, approval-blocked, accepted}`、**`productionReady: const false`**。四角色制在 `Ownership` 里也是同样约束（`minItems: 4, maxItems: 4`），对应 `product-decisions.json` 的决策 `I2: 四角色独立验收`。

**验收合同实例（`knowledge-system/acceptance.yml`，3 条契约，实测全文要点）**

每条契约的字段骨架：
```yaml
- acceptanceId: ACC-SECURITY-001
  documentId: KS-SECURITY-COMPLIANCE
  targetMaturity: acceptance
  targetVerification: acceptance-tested
  acceptanceScope: repository-content
  productionReady: false
  dataset:
    datasetId: ADS-SECURITY-LOCAL-V1
    kind: synthetic-fixture
    authorizationState: synthetic-only
    authorizationEvidenceRef: null          # ← 空 = 授权证据缺失
  thresholds:
    - { thresholdId: ACT-SEC-PASS-RATE,      metric: passRate,      operator: gte, value: 1, status: illustrative, approvalEvidenceRef: null }
    - { thresholdId: ACT-SEC-EXTERNAL-CALLS, metric: externalCalls, operator: eq,  value: 0, status: illustrative, approvalEvidenceRef: null }
    - { thresholdId: ACT-SEC-SIDE-EFFECTS,   metric: sideEffects,   operator: eq,  value: 0, status: illustrative, approvalEvidenceRef: null }
  regression:
    command: node scripts/run-acceptance-fixtures.mjs --contract ACC-SECURITY-001
    baselineReceiptId: ACR-SECURITY-LOCAL-V1
    maxPassRateDrop: 0                        # ← 零退化容忍
  ownerRoleRefs: [ROLE-SEC-CONTENT, ROLE-SEC-EVIDENCE, ROLE-SEC-TEST, ROLE-SEC-APPROVER]
  finalReceipt: { state: missing, approverRoleId: ROLE-SEC-APPROVER, evidenceRef: null }
  declaredState: approval-blocked
  declaredDecision: blocked
  declaredBlockers:
    - DATASET_NOT_BUSINESS_AUTHORIZED
    - THRESHOLDS_NOT_APPROVED
    - OWNER_ACCEPTANCE_INCOMPLETE
    - FINAL_RECEIPT_MISSING
  nextEvidence: 绑定获授权业务样本与辖区控制表，由四类具名责任人接受职责并批准阈值，再签发仓库内容验收回执。
```

**三条契约（SECURITY / COST / EVALUATION）的 `declaredState` 全部是 `approval-blocked`、`declaredDecision` 全部是 `blocked`，四条 blocker 完全相同**（实测 `acceptance.yml` 三处一致）。即：**该项目的验收机制产出的是「三条都明确失败」的结果，而不是「通过」。** 这正是它的设计意图——`capability-map.json` 的 `CAP-GUIDE-REGISTRY.forbiddenClaims` 原文：

> `注册表结构完整不等于验收通过；12 个角色仍为 0 accepted，3 个契约仍为 approval-blocked。`

**阈值体系的关键设计**：每个 threshold 带 `status ∈ {illustrative, approved}` 与 `approvalEvidenceRef`。三条契约的全部 9 个阈值都是 `illustrative` + `approvalEvidenceRef: null` —— **「示意值」与「已批准值」在数据结构上就分开，且 null 是可追踪的缺口**。`evaluation.schema.json` 的 `thresholds[].approvalState` 同样只有 `{illustrative, approved}` 两值。

**反晋升（anti-promotion）机制**：`scripts/check-evidence.mjs` 第 29 行输出 `'Source, local evidence, status-to-grade and anti-promotion checks passed.'` —— 核心逻辑在 `scripts/claim-registry.mjs`（实测关键断言）：

| 行 | 规则 |
|---:|---|
| 525 | `if (['fixture','test'].includes(item.kind) && item.grade !== 'L2-fixture-or-dry-run')` → 报错：**fixture/test 类证据只能标 L2，不能标高** |
| 528 | `if (item.kind === 'read-only-audit' && item.grade !== 'L1-public-or-runtime')` → **只读审计只能标 L1** |
| 531 | `if (item.kind === 'acceptance-receipt' && item.grade !== 'L4-authorized-live')` → **验收回执必须 L4** |
| 589 | `warnings.push(\`${claim.claimId} is ${claim.verification} but already has provisional references; they do not raise its grade\`)` → **临时引用不得抬高等级** |
| 592–593 | 断言的 `evidenceGrade` 必须与其每条 evidence 的 grade 完全相等 |

→ 这是「**证据种类 → 允许的最高等级**」的硬映射表，配合 `docs:evidence` 脚本的**反越级检查**（`g2-2-ownership-evidence-audit.md:58`：`L0=0、L1=6、L2=6、L3/L4=0；反越级检查通过`），构成完整的防注水机制。

### 3.4 门禁与禁止声明机制

**这是 Kb2Agent 最有迁移价值的部分：`forbiddenClaims`（禁止声明）被写成 schema 必填字段。**

`knowledge-system/schemas/capability-map.schema.json`（实测）：`capabilities[].required` 包含
```json
["id","name","line","status","evidenceGrade","deployment","evidenceRefs","ownerGate","forbiddenClaims"]
```
且 `forbiddenClaims: { "type": "array", "minItems": 1, "uniqueItems": true, "items": {"type":"string","minLength":10} }`。

→ **每一项能力必须至少写一条「禁止声明」，且不得少于 10 个字符。** 这不是文档建议，是校验器会拒绝的空值。

**`capability-map.json` 顶层还有一个 `evidenceCeiling`（证据天花板）**，同样 required（`minLength: 10`）。实测值：
```
"evidenceCeiling": "L1 current read-only inspection plus repository-recorded L2 fixtures"
```
含义：**整个能力图谱的证据上限就是 L1 只读检查 + L2 仓库内 fixture，不得更高。**

**13 项能力的实测状态表：**

| id | line | status | evidenceGrade | forbiddenClaims 条数 |
|---|---|---|---:|---:|
| CAP-GUIDE-SITE | GUIDE | live | L3 | 2 |
| CAP-GUIDE-SEARCH | GUIDE | live | L3 | 1 |
| CAP-GUIDE-REGISTRY | GUIDE | draft | L2 | 1 |
| CAP-GUIDE-QA | GUIDE | replayable | L2 | 2 |
| CAP-LAB-SCHEMA | REFERENCE | accepted | L2 | 1 |
| CAP-LAB-GOLDEN | REFERENCE | accepted | L2 | 1 |
| CAP-LAB-AGENTLAB | REFERENCE | live | L3 | 1 |
| CAP-LAB-HYDRATION | REFERENCE | live | L3 | 1 |
| CAP-OPS-EDGE | REFERENCE | live | L4 | 1 |
| CAP-OPS-BACKUP | REFERENCE | accepted | L4 | 1 |
| CAP-PROVIDER-ADMISSION | REFERENCE | accepted | L2 | 2 |
| CAP-PROVIDER-LIVE-CALLS | REFERENCE | blocked | L4 | 1 |
| CAP-PROVIDER-LIVE-AGENT | REFERENCE | design-only | L0 | 2 |

枚举（schema 实测）：`status ∈ {live, accepted, replayable, draft, blocked, design-only}`；`evidenceGrade ∈ {L0, L1, LO-S, L2, L3, L4}`；`deployment ∈ {github-pages, tencent-cloud, both, none}`；`evidenceRefs[].kind ∈ {path, commit, url}`；`ownerGate` 为 `null` 或匹配 `^G[0-9][A-Za-z0-9-]*$`。

**禁止声明的真实文本（实测逐条摘录，节选 6 条最有代表性的）：**

> - `CAP-GUIDE-SITE`：「GitHub Pages 当前版本尚未包含 Mermaid hydration 修复，不得宣称两站同版本。」
> - `CAP-GUIDE-QA`：「GitHub Pages 工作流只消费 `docs:build`，完整 `docs:qa` 可被绕过（P0-10 未整改）。」
> - `CAP-LAB-SCHEMA`：「Schema 可校验不代表知识对象已从真实语料晋级；候选与 canonical 边界仍受人工晋级门禁约束。」
> - `CAP-LAB-GOLDEN`：「Synthetic/adversarial 任务通过不代表真实业务有效性；真实去敏案例不可得时业务有效性保持 blocked。」
> - `CAP-LAB-AGENTLAB`：「公开静态 Agent Lab 不代表 production/live Agent、真实 provider 调用或模型能力验证。」
> - `CAP-PROVIDER-LIVE-AGENT`（status=design-only, grade=L0）：「……」（该条 2 项 forbiddenClaims）

**第二层禁止机制：`implementationAuthorization.forbiddenWithoutNewAuthorization`（`knowledge-system/product-decisions.json` 实测全文）**

```json
"implementationAuthorization": {
  "state": "authorized-candidate-cloud",
  "authorizedAt": "2026-08-09",
  "phases": ["P0","P1","P2","P3","P4","P5","P6","P7","P8","P9"],
  "allowed": [ 29 项：isolated-worktree, product-contracts, schemas, fixtures,
      local-validation, synthetic-multiformat-corpus, deterministic-compiler,
      local-sqlite-index, e2-deterministic-agent, stdio-mcp-adapter,
      candidate-cloud-static-upload, candidate-nginx-validation, ... ],
  "forbiddenWithoutNewAuthorization": [
    "provider-call",
    "production-deploy",
    "canonical-knowledge-write",
    "external-send",
    "git-commit",
    "git-push",
    "package-publication"
  ]
}
```
schema 侧强制 `forbiddenWithoutNewAuthorization: { "type": "array", "minItems": 6 }`；校验器侧（`check-reference-contracts.mjs:284-286`）要求这个集合必须让每个动作「失败关闭」。

**第三层禁止机制：schema 里的 `const: false` 常量锁**（实测计数）
`externalWrite: false`（`PermissionRule`、`ActionPackage.options[]`）、`canonicalWrite: false`（`KnowledgeCandidate`）、`productionReady: false`（`Acceptance`）、`freeText: false`（`Observation`、`TaskPackage.publicInput`）、`fileUpload: false`、`urlInput: false`（`TaskPackage.publicInput`）、`maxExternalCalls: const 0` 与 `maxSideEffects: const 0`（`GoldenTask.expected`）、`sideEffect: const false`（每个 `Skill.tools[]`）。

→ **共三类「禁止」：能力级的 forbiddenClaims（声明）、授权级的 forbiddenWithoutNewAuthorization（动作清单）、对象级的 const false（结构锁）。** 三层互相独立，任一层都能单独阻止越界。

**这套机制对「不得执行 external-write 或 destructive 操作」的直接价值**：`ActionPackage.status` 枚举里**根本没有 "executed"**（只有 `draft-for-review / blocked-insufficient-input / approved-for-manual-execution`），`externalWrite` 在每个 option 上锁为 `false`，`PermissionRule.externalWrite` 也锁为 `false`。**「只能产出草案、由人工执行」是被 schema 强制的，不是靠提示词约束的。**

### 3.5 对本项目的可用性与缺口

**可直接复用（最高优先级）**

1. **`skill.schema.json` 的 10 项 required** 是本项目 skill 契约的现成基线：`name, inputContract, outputContract, tools, steps, eLevel, stopConditions, rollback, tests, promotionDecisionRef`。特别值得保留的 4 项：`stopConditions`（**何时必须停**）、`rollback`（**失败怎么退**）、`tests`（**minItems: 2**，至少两个测试 ID）、`promotionDecisionRef`（**没有晋升决定就不算 Skill**）。
2. **`tools[].mode ∈ {read, calculate, draft}` + `sideEffect: const false`** —— 与本项目「不得执行 external-write」的要求完全同构，可直接采纳为工具白名单三值枚举。
3. **`common.schema.json` 的 `evidenceGrade` 6 值枚举**（尤其 `LO-S-synthetic` 这个「公网演示合成数据」专用档）是证据分级的成熟方案。
4. **`identifier` 正则 `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$`** 与 `hash` 正则 `^sha256:[a-f0-9]{64}$` —— 可直接复用为 ID/hash 校验。
5. **`baseObject` 的 6 项 required**：`id, objectType, revision, status, createdAt, sourceRefs`，其中 `status ∈ {draft, candidate, approved, superseded, blocked}`、`supersedes`（单值）+ `freshness{asOf, reviewedAt, expiresAt, state}` —— **每个对象都自带版本、生命周期与新鲜度**。
6. **`forbiddenClaims` 作为 schema 必填字段**（minItems 1，≥10 字符）—— 这是本项目「禁止声明」最直接的实现方式。
7. **`thresholds[].approvalState ∈ {illustrative, approved}` + `approvalEvidenceRef`（可为 null）** —— 把「示意值」和「已批准值」在数据结构上分开，缺口用 null 显式可查。这条对任何「有指标的验收」都适用。
8. **`graders` minItems=2 且必须从 `{schema, citation, task-success, permission, human-domain}` 中取** —— 单一评分器不算评估契约。
9. **`negativeRequirements` 必填** —— 没有负例不算验收。
10. **`Observation → KnowledgeCandidate → PromotionDecision → Skill` 的单向链 + `canonicalWrite: false` + `CASE_SKILL_PROMOTION_FORBIDDEN`** —— 可直接抄为「新知识不得直接进规范库，必须经候选+晋升决定」。

**需要改造**

1. **层号必须重新定义。** 仓库内部三套编号冲突（见 3.1），本项目**不能直接引用 L0–L6**。建议：采纳体系 (a) 的**对象链思路**（来源→证据→知识对象→技能→任务→行动→回执），但**自建一份唯一编号表并写入自己的文档**，或干脆弃用 L 前缀、改用命名（如 `source / evidence / knowledge / skill / task / action / receipt`）。
2. **`eLevel` 的 E3/E4 被 schema 排除在公开面外**，本项目若需要「可逆外部写入」能力（如自动建文件），需要扩展 enum 并显式定义审批闭环，而不是照抄 `publicELevel`。
3. **`roleRefs` 硬编码 4 个**（`minItems: 4, maxItems: 4`）写死了「四角色独立验收」的组织假设。本项目若不采用四角色制，必须放宽为 `minItems: 2` 之类。
4. **`TaskPackage.publicInput` 三个通道全 false** 是「公网只读演示」的产品定位产物，本项目若需要文件上传能力需重做该字段。
5. **`dataClass` 只有 `{synthetic, deidentified-real, authorized-real}`** 三值。书籍内容（有版权的一手文本）不完全落在任一类里，可能需要加 `licensed-text` 或类似档位。

**不适用 / 缺口**

1. **🔴 Kb2Agent 不规定 skill 的磁盘目录布局。** 实测：全仓（排除 `docs/knowledge/` 讲义）grep `SKILL.md` **零命中**；grep `目录结构` **零命中**。它把 Skill 定义为**一个 JSON 对象**，不是「一个装着文件的文件夹」。→ **「一个 skill 目录该有哪些文件」这个问题的权威来源不在 Kb2Agent**，应转向 book2skills（见 4.2/4.3）与 nuwa（见 5.1）。
2. **完全没有 skill 的「自然语言正文」规范。** Kb2Agent 的 Skill 只有 `steps[]`（字符串数组）、`stopConditions[]`、`rollback[]`，没有「何时使用」「核心原则」「常见陷阱」这类叙述段落的位置。它是**运行契约**，不是**知识载体**——这与 ai-agent-book / book2skills / nuwa 恰好互补而不重叠。
3. **无 `description`/触发词字段。** 从 4 个源仓库看，`name` + 描述性触发条件是 skill 的通用必备项；Kb2Agent 的 `Skill.name` 只有 `minLength: 4`，没有触发语义。
4. **无版本兼容策略约定**：`revision`（integer ≥1）与 `supersedes`（单值 identifier）存在，但没有 migration / 兼容性声明字段。
5. **无 README**（GitHub 元数据 `description: "从知识到agent"` 是唯一描述），入门全靠 `docs/architecture/` 下 60+ 个 `g6-*/g7-*` 设计文档与 `.vitepress` 站点。**学习曲线陡峭**，且这些文档高度项目专属（腾讯云、特定模型、特定阶段编号），不可迁移。
6. **仓库仅 2 stars、无 license**（GitHub API 实测 `"license": null`）。→ **复用其 schema 文本前须先解决授权问题**；建议只借鉴**机制设计**（字段组合、枚举取值、三层禁止结构），不直接复制 JSON 文本。
7. **未运行验证**：`npm run docs:qa` 是 20+ 个检查的串联命令（实测 `package.json` scripts），本报告未执行，因此「这些门禁真的会拦下越级」来自脚本源码阅读 + 仓库自述的收据（`qa-receipt.md`、`g2-2-ownership-evidence-audit.md`），**未独立复现**。

---

## 4. book2skills（书籍→skill 落地流水线）

### 4.1 流水线步骤

**来源：`CONTRIBUTING.md` 全文 98 行（实测），5 步：**

| 步 | 标题 | 实测关键要求 |
|---|---|---|
| 1 | Choose a Book | 三条标准：**Highly practical**（含具体框架/判据/决策流程，非纯理论）、**Time-tested**（经典优先，**出版 ≥5 年**）、**Actionable**（方法论可蒸馏为 agent 可执行步骤）。开工前**必须先开 Issue 确认该书未被认领** |
| 2 | Read the Original Book | 原文加粗：**`You must read the complete original work.`** 「Skills based on summaries or secondhand materials will not be accepted.」阅读时重点提取四类：核心框架与评估标准、决策流程与判断规则、**作者明确反对的（"what not to do" is often as important as "what to do"）**、具体可执行步骤 |
| 3 | Create the Skill Folder | 目录骨架 + `SKILL.md` 格式 + YAML 注意事项（见 4.3） |
| 4 | Test | 必须在 Claude.ai 或 Claude Code 中实测：触发短语能正确唤起、**用 2–3 个真实问题测输出质量**、**PR 里至少附一张测试用例截图** |
| 5 | Submit a PR | 标题格式 **`Add skill: [Book Title] — [Author Name]`**；PR 描述须含书籍基本信息（书名/作者/出版年）、该 skill 能回答的 3 个示例问题、**是否读完原著（yes/no）** |

**贡献者前置条件（`README.md` 实测）**：`## 🤝 How to Contribute` 列出 4 种参与方式（提交书籍请求 / 贡献新 skill / 改进已有 skill / 传播）。`README.md` 的 Roadmap 中还列了 8 本「计划中」的书（含 The Intelligent Investor、One Up On Wall Street、Poor Charlie's Almanack、Good to Great、Zero to One 等），**状态全为 `- [ ]`（未完成）**。

**注意**：`README.md` 的 Skills List 表格只列了 2 个（`common-stocks-uncommon-profits`、`html-line-svg`），但 `skills/` 下**实存 38 个**（实测 `ls -d skills/*/ | wc -l` → 38）。→ **README 的清单严重滞后于仓库实际内容**，这是实测事实。

**流水线中没有的东西（缺口）**：没有自动化脚本（仓库内无 `scripts/`、无 CI 校验 skill 格式）、没有模板文件（`CONTRIBUTING.md` 里的骨架是内联代码块，不是可拷贝的模板文件）、没有质量评分卡。

### 4.2 目录形态分类（实测）

**实测方法**：`for d in skills/*/; do for x in SKILL.md references subskills scripts quotes README.md LICENSE; do [ -e "$d$x" ] && ...; done; done`，对 38 个目录逐一探测。

**实际形态统计：**

> **口径**：形态只看 `references/`、`subskills/`、`scripts/`、`quotes/` 四个**功能性部件**；`README.md` 与 `LICENSE` 是附带件，不参与分类。计数脚本：对 38 个目录逐一探测四个部件存在性并拼成签名串。

| 形态 | 定义 | 数量 | 成员（实测全量） |
|---|---|---:|---|
| **单文件型** | 仅 `SKILL.md`（+ 可选 README/LICENSE） | **6** | `folded-memory-implementation`, `harness-step1-create-agent-md`, `harness-step2-fill-docs`, `harness-step3-session-management`, `langchain-tool-builder`, `session-dream` |
| **quotes 型** | + `quotes/`（原书逐字引语） | **14** | `clash-cultures-investment-speculation-bogle`, `common-sense-index-investing-bogle`, `contagious-viral-content-berger`, `contract-drafting-and-review-guidance-china-law`, `investing-from-darwin`, `jab-jab-right-hook-vaynerchuk`, `munger-mental-models-worldly-wisdom`, `outsiders-ceo-capital-allocation-thorndike`, `perennial-seller-holiday`, `show-your-work-kleon`, `steal-like-an-artist-kleon`, `storybrand-messaging-framework`, `this-is-marketing-godin`, `war-of-art-pressfield` |
| **subskills + quotes 型** | + `subskills/` + `quotes/` | **5** | `business-adventures-analysis-brooks`, `creating-superfans-hodak`, `customers-yachts-wall-street-schwed`, `essays-in-persuasion-keynes`, `intelligent-investor-graham` |
| **references 型** | + `references/` | **4** | `agent-tool-builder`, `query-loop-implementation`, `skill-to-workflow`, `tool-permission-system` |
| **references + scripts 型** | + `references/` + `scripts/` | **3** | `agent-memory-implementation`, `html-line-svg`, `skill-creator` |
| **subskills 型（无 quotes）** | + `subskills/` | **3** | `analyzing-financial-statements`, `finacial-statement-reading`, `stock-picking-by-common-stocks-uncommon-profits` |
| **references + quotes 型** | + `references/` + `quotes/` | **2** | `most-important-thing-in-investing-howard-marks`, `seo-metadata-audit` |
| **scripts 型（无 references）** | + `scripts/` | **1** | `compact-memory-implementation` |
| | | **38** | 合计核对：6+14+5+4+3+3+2+1 = 38 ✓ |

**有至少一个功能性部件的 skill = 32/38**（实测同口径计数）；**只有 6 个是真正的单文件 skill**。

**实测的完整 38 目录形态清单（`目录名|存在的部件`）**：
```
agent-memory-implementation| SKILL.md references scripts README.md
agent-tool-builder| SKILL.md references README.md LICENSE
analyzing-financial-statements| SKILL.md subskills README.md
business-adventures-analysis-brooks| SKILL.md subskills quotes README.md
clash-cultures-investment-speculation-bogle| SKILL.md quotes README.md
common-sense-index-investing-bogle| SKILL.md quotes README.md
compact-memory-implementation| SKILL.md scripts README.md
contagious-viral-content-berger| SKILL.md quotes README.md
contract-drafting-and-review-guidance-china-law| SKILL.md quotes README.md
creating-superfans-hodak| SKILL.md subskills quotes README.md
customers-yachts-wall-street-schwed| SKILL.md subskills quotes README.md
essays-in-persuasion-keynes| SKILL.md subskills quotes README.md
finacial-statement-reading| SKILL.md subskills
folded-memory-implementation| SKILL.md README.md
harness-step1-create-agent-md| SKILL.md README.md LICENSE
harness-step2-fill-docs| SKILL.md README.md LICENSE
harness-step3-session-management| SKILL.md README.md LICENSE
html-line-svg| SKILL.md references scripts README.md LICENSE
intelligent-investor-graham| SKILL.md subskills quotes README.md
investing-from-darwin| SKILL.md quotes README.md
jab-jab-right-hook-vaynerchuk| SKILL.md quotes README.md
langchain-tool-builder| SKILL.md README.md LICENSE
most-important-thing-in-investing-howard-marks| SKILL.md references quotes README.md
munger-mental-models-worldly-wisdom| SKILL.md quotes README.md
outsiders-ceo-capital-allocation-thorndike| SKILL.md quotes README.md
perennial-seller-holiday| SKILL.md quotes README.md
query-loop-implementation| SKILL.md references README.md LICENSE
seo-metadata-audit| SKILL.md references quotes README.md
session-dream| SKILL.md README.md
show-your-work-kleon| SKILL.md quotes README.md
skill-creator| SKILL.md references scripts
skill-to-workflow| SKILL.md references
steal-like-an-artist-kleon| SKILL.md quotes README.md
stock-picking-by-common-stocks-uncommon-profits| SKILL.md subskills README.md
storybrand-messaging-framework| SKILL.md quotes README.md
this-is-marketing-godin| SKILL.md quotes README.md
tool-permission-system| SKILL.md references README.md LICENSE
war-of-art-pressfield| SKILL.md quotes README.md
```

> **口径说明**：`LICENSE`/`LICENSE.txt` 与 `README.md` 是**附带件**，不构成形态差异。上表的「形态」只看 `references/`、`subskills/`、`scripts/`、`quotes/` 四个**功能性部件**。另有 1 个异常件：`analyzing-financial-statements/analyzing-financial-statements.zip`（打包分发用）。

**subskills 模块型的内部结构（实测 2 例，完全同构）：**
```
<skill>/subskills/m<N>_<topic>/
    module.md                      ← 模块正文（含 执行流程/步骤/输出格式/Do Not）
    references/case_library.md     ← 该模块的案例引用表
```
- `analyzing-financial-statements`：6 个 subskill（m1_industry_analysis … m6_roic_analysis），`m1/module.md` 243 行。
- `intelligent-investor-graham`：7 个 subskill（m1_investment_vs_speculation … m7_enterprising_bargain_hunt），`m3/module.md` 105 行。
- **每个 subskill 都有自己的 `references/case_library.md`**（不是共用一个）。

**`references/case_library.md` 的确切格式（实测 `m3_margin_of_safety_pricing/references/case_library.md` 表头与前 4 行）：**
```markdown
# Reference Library: M3 Margin of Safety Pricing

| ID | Use When | Quote File | Anchor |
|---|---|---|---|
| REF-M3-001 | Explaining margin of safety as the central concept | `../../../quotes/value-investing-quotes.md` | `#margin-of-safety` |
| REF-M3-002 | Explaining price versus future value | `../../../quotes/value-investing-quotes.md` | `#the-future-value-depends-on-price` |
| REF-M3-003 | Explaining why price matters more than company admiration | `../../../quotes/value-investing-quotes.md` | `#price-matters-more` |
| REF-M3-004 | Deep bargain or NCAV discussion | `../../../quotes/market-philosophy-quotes.md` | `#net-current-asset-bargains` |
```
→ **是一张「引用 ID → 用途 → 引语文件相对路径 → 锚点」的映射表**，让 subskill 在回答时能机械地找到该引哪句原文。这是**可溯源性落到文件级锚点**的做法。

**`quotes/` 型的确切格式（实测 `intelligent-investor-graham/quotes/value-investing-quotes.md` 前 20 行）：**
```markdown
# The Intelligent Investor — Value Investing Quotes

Verbatim excerpts from *The Intelligent Investor* (Benjamin Graham, revised by Jason Zweig).

---

## buffett-endorses-graham

> "To invest successfully over a lifetime does not require a stratospheric IQ, unusual business insights, or inside information. What's needed is a sound intellectual framework for making decisions and the ability to keep emotions from corroding that framework."

—Warren Buffett, Preface to the Fourth Edition

*(Preface)*

---
```
→ **`##` 标题即是锚点 ID（kebab-case）**，正文是 blockquote 逐字原文 + 出处 + 章节。SKILL.md 的 `CITATION RULES` 段把锚点清单**显式列出**（见 4.3）。

### 4.3 质量标准与命名

**质量标准（`CONTRIBUTING.md` 的 5 行表格，实测逐字）：**

| Standard | Description（原文） |
|---|---|
| Faithful to source | Content can be traced to specific chapters; no views added that don't appear in the book |
| Actionable | Users receive specific judgments or recommendations, not vague generalities |
| Clear structure | Uses headings, tables, and lists to organize content for easy agent navigation |
| Valid YAML | `name` and `description` fields are correctly formatted and parseable |
| **Reasonable size** | **SKILL.md kept under 500 lines; detailed content goes in references/** |

**命名规范（`CONTRIBUTING.md` 实测逐字）：**
- Skill 目录名：**kebab-case**，推荐格式 **`{topic}-{book-keyword}`**，原文示例 `common-stocks-uncommon-profits`、`collins-good-to-great`
- `references/` 内文件名：描述性，原文示例 `framework.md`、`evaluation-criteria.md`、`common-mistakes.md`
- `name` 字段：**lowercase letters, numbers, hyphens, max 64 characters**
- **`name` 不能包含 `"anthropic"` 或 `"claude"`**（原文：`name cannot contain "anthropic" or "claude"`）

**YAML 规范（`CONTRIBUTING.md` 实测逐字）：**
- **不要在 `description` 里直接用双引号 `"` 或单引号 `'`**
- 推荐用 `>` 折叠块语法写多行 description
- 官方骨架：
```yaml
---
name: your-skill-name         # lowercase letters, numbers, hyphens, max 64 characters
description: >                # use folded block syntax to avoid quote issues
  Describe what this Skill does and when to trigger it.
  Include example trigger phrases. Be somewhat "proactive" so
  the agent knows to invoke it when encountering related problems.
---
```

**目录骨架（`CONTRIBUTING.md` 实测逐字）：**
```
skills/your-skill-name/
├── SKILL.md              # Required
└── references/           # Recommended, for detailed content
    ├── framework.md
    └── ...
```

**体积约束 → 实测符合度（`wc -l skills/*/SKILL.md`）：**

| 指标 | 实测值 |
|---|---|
| SKILL.md 数 | 38 |
| 总行数 | 8416 |
| 最小 | 54 行（`customers-yachts-wall-street-schwed`、`essays-in-persuasion-keynes`） |
| 最大 | 485 行（`skill-creator`） |
| **超过 500 行的** | **0 个** |
| 超过 300 行的 | 6 个（300, 333, 350, 352, 363, 367, 485 → 实为 7 个） |

→ **38/38 全部满足 500 行上限**，最接近的是 `skill-creator` 的 485 行。

**完整 SKILL.md 骨架 — 实例 1：`analyzing-financial-statements`（subskills 模块型，180 行）**

实测标题序列：
```
# Skill: 财报透视——识别上市公司资产、利润、现金流质量
  （frontmatter: name / description: > / license: >  ← 3 个字段）
  （紧接：知识来源、架构说明、ASCII 目录树）
## Skill 目的
## 调用时机
## 路由规则        ← 表格：用户问题类型 → 必须执行 → 可选执行
## 执行方式        ← 显式写 Read 指令：调用 M1 → Read subskills/m1_industry_analysis/module.md
## 多模块联合输出格式  ← 完整输出模板（含 M1..M6 段落骨架）
## Subskill 状态   ← 表格：Subskill | 路径 | 状态
## 署名规则        ← 强制在回复开头和结尾各加一行署名
```

摘录三段关键内容（实测原文）：

（a）**路由表**——把「用户问题」映射到「必跑哪些模块」：
```markdown
| 用户问题类型 | 必须执行 | 可选执行 |
|-------------|---------|---------|
| "这家公司财务健康吗？" / 综合分析 | M1 → M2 → M3 → M4 → M5 → M6 | — |
| "资产有没有问题？" / "有无造假风险？" | M1 → M2 | M5 |
| "利润是真实的吗？" | M1 → M3 | M4 |
| "是好公司吗？值得投资吗？" | M1 → M6 | M3、M5 |
```
（b）**执行规则**——4 条，其中两条是硬约束：
```markdown
3. 用户数据不足时先追问，不用假设填充数据
4. 单一问题不全跑，按路由表精确调用
```
（c）**署名规则**——**强制在回复开头与结尾各插一行**：
```markdown
**所有回复**，无论调用哪个模块、无论输出长短，必须在回复**开头**和**结尾**各加一行：
---
以下分析基于[《一本书读懂财报》skill](https://book2skills.com/zh/)，仅供学习，支持正版。
---
```

**完整 SKILL.md 骨架 — 实例 2：`intelligent-investor-graham`（subskills + quotes 型，172 行）**

实测标题序列：
```
# The Intelligent Investor — Skill (Benjamin Graham)
  （frontmatter: name / description（单行，无 >）/ license  ← 3 个字段）
  （紧接：Knowledge source、Architecture、ASCII 目录树）
## Skill Purpose
## When to Use This Skill      ← 8 条例句式触发问题
## CITATION RULES              ← 引语文件清单 + 引用格式 + 锚点映射 + 4 条规则
## Workflow Inventory          ← 9 列表格（含 Triage score / Should be subskill? / Reason）
## Routing Rules               ← 用户问题类型 → Must run → Optional run
## Execution Rules             ← 7 条
## Multi-Module Output Format  ← markdown 代码块内的输出模板
## Subskill Status             ← 表格
## Do Not                      ← 6 条禁令
```

摘录两段关键内容（实测原文）：

（a）**锚点映射**——把引语文件与锚点 ID 逐条列出：
```markdown
- `value-investing-quotes.md`: `#buffett-endorses-graham`, `#investment-vs-speculation`,
  `#margin-of-safety`, `#mr-market`, `#mr-market-servant`, `#defensive-portfolio-split`,
  `#price-matters-more`, `#graham-core-principles`, `#the-future-value-depends-on-price`,
  `#no-need-for-extraordinary`
- `market-philosophy-quotes.md`: `#market-is-a-pendulum`, `#earnings-can-be-manipulated`,
  `#avoid-ipos`, `#index-funds-best`, `#advisers-misaligned`, `#net-current-asset-bargains`,
  `#simplicity-beats-cleverness`, `#santayana-warning`
```
引用格式（含**反造假规则**）：
```markdown
**Rules:**
- Read the routed module's `references/case_library.md` for the relevant quote IDs.
- Include at least one citation per major section in substantive answers.
- Use only exact quotes from the quote files. Do not invent quotation text.
- If no exact quote fits, cite the closest anchor and state that the reasoning is a paraphrased Graham application.
```
（b）**`## Do Not` 段**——6 条禁令，是「作者明确反对的」那一步的落地：
```markdown
- Do not forecast the market or interest rates as the basis for a recommendation.
- Do not call an action "investment" unless analysis, principal safety, and adequate return have all been addressed.
- Do not excuse overpayment because the company is excellent, popular, or fast growing.
- Do not average a failed defensive checklist into a soft "mostly passes" verdict.
- Do not recommend leverage, all-in allocations, or panic selling under Graham's name.
- Do not provide personalized regulated financial advice; frame outputs as educational decision support.
```

**`skills-lock.json` 的锁机制（实测全文）：**

```json
{
  "version": 1,
  "skills": {
    "common-stocks-uncommon-profits": {
      "source": "simbajigege/book2skills",
      "sourceType": "github",
      "computedHash": "99cab072877925c1b9b121d6d4e2b25723848087cf468c854bf4e479a3997789"
    }
  }
}
```

**实测结论：**
- 结构为 `{version: 1, skills: {<skill-name>: {source, sourceType, computedHash}}}`。
- **只锁了 1 个 skill**（`common-stocks-uncommon-profits`），而 `skills/` 下有 **38 个目录**。→ **锁机制存在但远未覆盖**；`version: 1` 是唯一的格式版本声明。
- `computedHash` 是一个 **64 位十六进制字符串**（无 `sha256:` 前缀，与 Kb2Agent 的 `^sha256:[a-f0-9]{64}$` 不同），**算法未在仓库中说明**（未核实）。
- 无 `integrity`/`signature`/`publishedAt`/`version` 字段 —— **是「来源 + 内容指纹」的最小锁，不是完整的依赖锁。**

### 4.4 对本项目的可用性与缺口

**可直接复用**

1. **「一本书 → 一个 skill 目录」的形态分类法**（4.2 的 7 类）是实测归纳的产物，可直接作为本项目的形态选型依据：书的理论密度决定形态——纯框架类 → 单文件型；有大量原书引语价值 → quotes 型；有 6–7 个可独立执行的流程 → subskills 型；有可自动化计算 → scripts 型。
2. **`subskills/m<N>_<topic>/module.md` + `references/case_library.md`** 的两文件模块结构，配合「引用 ID → 用途 → 文件路径 → 锚点」映射表，是可溯源性最落地的设计。
3. **`quotes/` 用 `##` 标题作锚点 ID + SKILL.md 里显式列出锚点清单** —— 让「引哪句原文」可被机械执行且可被校验。
4. **`## Do Not` 段**（book2skills 已有，ai-agent-book 对应的是「常见陷阱」）—— 直接对应 `CONTRIBUTING.md` 第 2 步强调的「作者明确反对的」。
5. **`500 行上限 + 详细内容进 references/`** 的体积约束，与 ai-agent-book 的「单文件自包含」形成互补：**小体量单文件、大体量分层**，本项目可按此二分。
6. **命名 `{topic}-{book-keyword}`** —— 直接表达「主题 + 书」的复合身份，比纯书名或纯主题都更有信息量。实测 38 个目录名几乎全部遵循（唯二异常：`finacial-statement-reading` 拼写错误（应为 financial）、`html-line-svg` 是原创 skill 非书）。
7. **`skills-lock.json` 的「来源 + 内容指纹」最小锁** —— 低成本可采纳。
8. **`name` 不得含 `anthropic`/`claude`** 这条**平台兼容性约束**，是踩坑得到的规则，值得原样保留。

**需要改造**

1. **`license` 字段的处理方式不可直接抄。** 它把版权声明写进 `license: >` 折叠块（如「Skill distillation of 《一本书读懂财报》 by Xiao Xing (肖星) … For personal and educational use. Do not reproduce source passages verbatim.」），但**这是自然语言声明，不是机器可读的 license 标识**（无 SPDX）。本项目若需合规流转，应拆为 `license`（SPDX）+ `sourceWork`（书名/作者/年份/版本）+ `rights`（使用范围）三字段。
2. **38 个 skill 的 `description` 质量参差**。对比实测两例：`analyzing-financial-statements` 的 description 长达 10 行（含触发短语清单 + 中英双语触发词），而 `intelligent-investor-graham` 只有 2 行（`Use Graham value investing for Is this investment or speculation, defensive stock screens, margin of safety, Mr. Market, allocation, funds, IPOs.`）。→ **需要本项目自己补一份 description 写作规范**。
3. **`CONTRIBUTING.md` 的目录骨架只给了 `references/` 一种**，但实测仓库里 `subskills/`、`quotes/`、`scripts/` 三种形态都有。→ **规范落后于实践**，本项目若采纳需自行补齐四种形态的定义。
4. **`skills-lock.json` 只锁 1/38** —— 机制存在但不可依赖。本项目若要做完整性保证，需自己实现全量锁 + 算法说明。

**缺口**

1. **无自动化校验**：全仓无 `scripts/` 目录（顶层）、无 CI 工作流校验 skill 格式。`CONTRIBUTING.md` 要求的「500 行」「name 不含 anthropic」「YAML 可解析」全部靠人工 review。实测符合度 100%（0 个超 500 行）说明作者自律有效，但**机制缺失**。
2. **无保真度评分或验收回执**：`Faithful to source` 的标准写成了「Content can be traced to specific chapters」，但**没有任何文件记录某个 skill 实际追溯到哪些章**。与 nuwa 的 `FIDELITY.md`（每个 example 都有，15/15）形成鲜明对比。
3. **无「读完原著」的证据**：PR 模板要求填 `yes/no`（`CONTRIBUTING.md` 第 5 步），但结果是自述，无第三方核验。
4. **无版本/晋升机制**：无 version 字段、无 status 字段、无 supersedes。skill 更新只能靠 git 历史。
5. **无 `stopConditions` / `rollback` 的位置**。`## Do Not` 覆盖了一部分「不该做什么」，但**「何时必须停下来」与「错了怎么退」没有专门的段落**。这两项在 Kb2Agent 里是 Skill 的 required 字段（见 3.3）。
6. **`README.md` 与仓库实际严重不同步**（清单只列 2/38），且 `README.md` 的 Project Structure 示例只展示 `references/` 一种形态。→ 若从 README 入门会被误导。

---

## 5. nuwa-skill（skill 创建范式）

### 5.1 标准范式与模板骨架

**流水线（`SKILL.md` 682 行的 heading 骨架，实测）：**
```
Phase 0:   入口分流（直接路径 0A / 诊断路径 0B）
Phase 0.5: 创建 Skill 目录
Phase 1:   多源信息采集（并行 Agent Swarm，6 个 Agent）
Phase 1.5: 调研 Review 检查点
Phase 2:   框架提炼（Synthesis）
Phase 2.5: 提炼确认检查点
Phase 3:   Skill 构建
  └ 回答工作流（Agentic Protocol）：Step 1 问题分类 / Step 2 人物式研究 / Step 3 人物式回答
Phase 4:   质量验证
Phase 5:   双 Agent 精炼（标准后置工序）
更新已有 Skill
品味守则（速查）
  └ ❌ 反模式黑名单（绝不做的事）
特殊场景（活人vs历史人物 / 主题vs人物 / 中国vs西方 / 冷门人物 / 蒸馏自己）
最后 / 版本自检（静默）
```

**Phase 0A 的 6 项澄清 + 三档成本（实测摘录）**：确认人/主题、聚焦方向、用途、新建 or 更新、本地语料、**蒸馏档位**。档位表：

| 档位 | 调研规模 | 适用场景 | 成本量级 |
|---|---|---|---|
| 快速 | 3 个维度（著作+对话+表达），每维度限 5 个来源 | 先试效果 / 冷门人物 / 预算敏感 | 约标准档 1/3 |
| **标准（默认）** | 6 个维度完整调研 | 大多数场景 | 中等；换更轻量模型可显著降低 |
| 深度 | 6 维度 + 一手素材全量下载（书籍/字幕/长文存档） | 打算开源发布的精品 Skill | 最高 |

**目录骨架（`examples/` 实测，两种变体）**
```
# 变体 A：6 文件 research 型（karpathy / ilya / paul-graham / steve-jobs / trump / zhang-yiming / …）
<name>-perspective/
├── SKILL.md
├── FIDELITY.md                        ← 保真度评分卡（出厂质检报告）
└── references/
    └── research/
        ├── 01-writings.md
        ├── 02-conversations.md
        ├── 03-expression-dna.md
        ├── 04-external-views.md
        ├── 05-decisions.md
        └── 06-timeline.md

# 变体 B：扁平中文调研型（elon-musk / feynman / munger / naval / taleb / …）
<name>-perspective/
├── SKILL.md
├── FIDELITY.md
└── references/
    ├── research.md                    ← 或 <人名>思想体系调研-<日期>.md 等
    ├── <人名>表达风格调研.md
    ├── <人名>重大决策调研-<日期>.md
    └── ...

# 变体 C：主题型（x-mastery-mentor，唯一一个非人物 skill）
x-mastery-mentor/
├── SKILL.md
├── FIDELITY.md
└── references/
    ├── research/01-writing-methods.md … 06-cases-antipatterns.md
    ├── algorithm-niche.md
    ├── growth-monetization.md
    ├── mental-models-heuristics.md
    ├── quality-analytics.md
    └── writing-workshop.md
```

**实测计数**：`examples/` 下 **15 个 skill 目录**，**15/15 都有 `FIDELITY.md`**（100% 覆盖，与 book2skills 的 0 覆盖形成极端对比）。`references/` 下只有 3 个文件：`extraction-framework.md`、`fidelity-scorecard.md`、`skill-template.md`。

**`references/skill-template.md` 的模板骨架（Phase 3 构建时读取填充，实测标题序列）：**
```
frontmatter: name: [person]-perspective
             description: |    ← 内含「来源数量」「N 个心智模型」「N 条决策启发式」占位
# [人名] · 思维操作系统
> [一句最能代表此人思维方式的原话]
## 角色扮演规则（最重要）
## 身份卡              （我是谁 / 我的起点 / 我现在在做什么）
## 核心心智模型         （### 模型1..N，每个含 一句话 / 证据 / 应用 / 局限）
## 决策启发式           （1..N，每条含 应用场景 / 案例）
## 表达DNA             （句式 / 词汇 / 节奏 / 幽默 / 确定性 / 引用习惯）
## 人物时间线（关键节点）（表格 时间|事件|对我思维的影响 + 最新动态）
## 价值观与反模式        （我追求的 / 我拒绝的 / 我自己也没想清楚的）
## 智识谱系
## 诚实边界
## 附录：调研来源        （一手来源 / 二手来源 / 关键引用）
> 本Skill由 [女娲 · Skill造人术](...) 生成 / 创建者：[花叔](...)
```

**模板中最具迁移价值的一节 — `## 角色扮演规则（最重要）`（实测逐字摘录）：**
```markdown
- 用「我」而非「[人名]会认为...」
- 遇到不确定的问题，用此人会有的犹豫方式犹豫（而非跳出角色说「这超出了Skill范围」）
- **免责声明仅首次激活时说一次**，后续对话不再重复
- **未表态主题标推断**：遇到此人从未公开表态的领域，先说明「这是框架推断，非本人立场」再展开；
  若本人真实态度是结构性沉默（不谈这类话题），就忠实呈现那个沉默，不要替他生成精巧折衷
- **关键引用可分辨**：产出中引用此人招牌句或关键事实时附极简出处，
  让「本人原话 vs 框架推断」在文中可分辨（至少全篇一次）
**退出角色**：用户说「退出」「切回正常」「不用扮演了」时恢复正常模式
```

**实测的 `SKILL.md` 体量**：15 个 example 的 `SKILL.md` 为 **343–541 行**（实测 `wc -l examples/*/SKILL.md | sort -n`：最小 `x-mastery-mentor` 343 行，最大 `sun-yuchen-perspective` 541 行；合计 6840 行）。对比 book2skills 的 54–485 行（设 500 行上限），nuwa **无体量上限约束**——实测有 **3 个超过 500 行**（`sun-yuchen` 541、`karpathy` 501、`naval` 501）。
顶层方法论 `SKILL.md` 本体 682 行；`references/` 三件共 331 行（`extraction-framework.md` 151 + `fidelity-scorecard.md` 63 + `skill-template.md` 117）。

### 5.2 质量控制机制

**四层机制，逐层实测：**

**第 1 层 — 心智模型的三重验证（`references/extraction-framework.md` 第 5–33 行，实测逐字）**

一个论点要被认定为「心智模型」而非「随口一说」，必须通过三重验证：

| # | 验证 | 判据 | 原文例 |
|---|---|---|---|
| 1 | **跨域复现** | 同一个思维框架出现在此人讨论的**至少 2 个不同领域** | 纳瓦尔的「杠杆」：财富创造 / 个人成长 / 职业选择 → 跨 3 域 |
| 2 | **有生成力** | 能用这个模型**推断此人对新问题的可能立场** | 芒格的「逆向思维」：面对「如何成功」→ 先想「如何确保失败」 |
| 3 | **有排他性** | **不是所有聪明人都会这样想**，体现此人独特视角 | 「反脆弱」是塔勒布的 |

**判定规则（原文）：**
```
**如果一个观点只通过了1重验证** → 降级为「决策启发式」而非「心智模型」
**如果一个观点0重验证都没过** → 可能只是此人在特定场景说的话，不纳入
```

→ **这是一个「足够的证据量 → 对象类型」的降级机制**，与 Kb2Agent 的「证据种类 → 最高等级」映射异曲同工，但更轻量、无需 schema。

**第 2 层 — 质量自检清单（`extraction-framework.md` 第 124–151 行，全 5 组）**

| 组 | 检查项（原文逐字） |
|---|---|
| 心智模型 | 每个模型都有至少 2 个不同领域的证据？/ 模型数量在 **3-7 个**之间？（太少=太浅，太多=没提炼）/ 每个模型都有明确的应用场景和局限？/ 模型之间有张力但不矛盾？ |
| 表达DNA | 读起来有辨识度，不像通用 AI？/ 没有过度模仿变成 caricature？/ 抓住了核心特征而非表面模仿？ |
| 决策启发式 | 每条规则都有具体案例支撑？/ 可以被新情况触发（不只适用于原始案例）？ |
| 诚实边界 | 明确写了做不到什么？/ 标注了信息源和调研时间？/ 承认了信息不足的维度？ |
| 整体 | 用此人的眼睛看一个新问题，能得到有价值的视角？/ 不是此人原话的拼凑，而是框架的运行？/ **删掉名字后，还能认出这是谁的思维方式？** |

**第 3 层 — Phase 4 通过标准（`SKILL.md` 第 523–560 行，实测逐字表格）**

Phase 4 用**子 agent**执行 3 项测试（4.1 已知测试 Sanity Check / 4.2 边缘测试 Edge Case / 4.3 风格测试 Voice Check），通过标准：

| 检查项 | 通过标准 | 不通过信号 |
|---|---|---|
| 心智模型数量 | 3-7 个，每个有来源证据 | <3 或 >10 |
| 每个模型的局限性 | 明确写出失效条件 | 只写优点 |
| 表达DNA辨识度 | 读 100 字能认出是谁 | 像通用 ChatGPT |
| 诚实边界 | **至少 3 条具体局限** | 只有「不能替代本人」 |
| 内在张力 | **至少 2 对矛盾** | 观点高度一致（太假） |
| 一手来源占比 | **>50%** | 主要依赖二手转述 |

且带**迭代上限**（原文）：`Phase 2→4 最多循环 2 次。如果 2 轮后仍有不通过项，在诚实边界中标注薄弱维度，交付当前最优版本而非无限打磨。`

**第 4 层 — 保真度评分卡（`references/fidelity-scorecard.md`，五维度 100 分，实测逐字）**

| # | 维度 | 分值 | 测什么 | 怎么测 |
|---|---|---:|---|---|
| 1 | 立场一致性 | 30 | 对人物公开表态过的问题，skill 的回答方向是否一致 | 3 道已知立场题，每题 10 分：方向和细节都对=10，方向对细节偏=6，立场偏离=0 |
| 2 | 风格辨识度 | 20 | 不看名字，能否从表达认出是谁 | 评分 agent 盲读回答：句式、用词、类比方式是否有该人物的指纹，还是通用 AI 腔 |
| 3 | 边缘诚实度 | 20 | 遇到人物没公开谈过的问题，是标注推断还是斩钉截铁编造 | 1 道超范围题：明确声明「这是基于框架的推断」并保留不确定性=满分；伪装成本人观点断言=0 |
| 4 | 来源透明度 | 15 | 调研底稿是否可溯源 | 静态检查 skill 文件：有调研来源 section、**一手来源占比>50%**、关键引语有出处 |
| 5 | 结构完整度 | 15 | 是否具备防漂移和诚实运行的完整结构 | 静态检查：**心智模型 3-7 个、诚实边界≥3 条、内在张力≥2 对**、反模式清单、角色扮演规则含防漂移约束 |

**等级：** A ≥85（出厂即精品）/ B 70-84（合格，个别维度有已标注的薄弱点）/ C 55-69（能用但需谨慎，诚实边界必读）/ **D <55（不建议使用，需回炉重蒸）**

**它的科学依据（原文引述，**本次未核实该论文是否存在**）：**
> 背景：SkillLens 论文（arXiv 2605.23899）实证，LLM 自评 skill 质量准确率仅 46.4%（接近随机）。所以评分卡的铁律是：**答题 agent 和评分 agent 必须是两个独立 agent，绝不自评自证。**

**执行流程（原文 4 步）：**
1. 出题：3 道已知立场题 + 1 道超范围题 + 1 道风格样本题
2. 答题 agent：**只读该 skill 目录内的文件，按 skill 激活人物作答，禁止联网**
3. 评分 agent：**独立 agent**，拿到答题结果 + rubric + skill 文件路径，**对照人物真实公开立场**逐维打分
4. 产出：skill 目录下生成 `FIDELITY.md`，含分数表、每题判定理由、测试日期、**答题/评分所用模型**

**反作弊 4 条（原文）：**
```
- 答题agent不知道自己在被测试什么维度
- 评分agent不参与答题，只对照公开事实
- 出题避开skill文件里已有的示例对话（防止背答案）
- 重要结论建议2个评分agent独立跑，分差>10分时人工复核
```

**评分卡 vs Phase 4 的分工（原文）**：Phase 4 是**内部质检**（生成过程中的关卡）；评分卡是**对外报告**（生成完成后的出厂检验，任何人可复跑验证）。社区贡献的 skill 申请收录进 `COMMUNITY.md` 时 **评分卡 ≥B 是准入门槛**。

**实测的评分卡落地质量（`examples/naval-perspective/FIDELITY.md` 全文关键段）：**
```markdown
**总分：97/100 · 等级A** | 测试日期：2026-07-01 | 答题/评分：独立双agent（Claude Opus 4.8）

| 维度 | 得分 | 判定摘要 |
| 立场一致性 | 30/30 | 三题…方向与细节均与Naval公开立场高度一致，Q1=10/Q2=10/Q3=10 … |
| 风格辨识度 | 18/20 | 盲读指纹极强：重新定义开场、对称否定句、Oracle短句…三句内可认人。扣分在个别句子略带解释性铺陈 |
| 边缘诚实度 | 20/20 | 超范围题开头明确声明「Naval没公开系统谈过agent时代，下面是用他框架的推断，不是他的话」…教科书级处理 |
| 来源透明度 | 14/15 | 一手来源占比过半…扣1分因英文格言多为内联引用、缺逐条出处标注 |
| 结构完整度 | 15/15 | 心智模型5个（各含跨域验证+局限）、诚实边界6条、内在张力5对、反例黑名单7条… |
```
**每一维度都写出了扣分理由**（18/20 扣「解释性铺陈」、14/15 扣「缺逐条出处」），并有 `## 测试记录` 逐题列出「问题 / 回答摘要 / 对照的真实立场 / 判定」。→ **评分卡是可审计的，不是打分截图。**

**第 5 层（自动化）— `scripts/quality_check.py`（152 行，实测函数名与实现）**

6 个检查函数：`check_mental_models`、`check_limitations`、`check_expression_dna`、`check_honest_boundary`、`check_tensions`、`check_primary_sources`。用法 `python3 quality_check.py <SKILL.md路径>`。
实测 `check_mental_models` 的实现是**正则计数**：
```python
models = re.findall(r'^###\s+(?:模型|Model|心智模型)\s*\d', content, re.MULTILINE)
...
passed = 3 <= count <= 7
return passed, f"{count}个心智模型 {'✅' if passed else '❌ (应为3-7个)'}"
```
→ **是格式启发式检查，不是语义检查**。`check_limitations` 更宽松：只要有「局限|失效|不适用|盲区|limitation|blind spot」任一命中即通过。

**其他 scripts**：`merge_research.py`(150 行)、`srt_to_transcript.py`(108 行)、`download_subtitles.sh`(55 行)。

**反模式黑名单（`SKILL.md` 第 609–626 行，10 条，实测逐字核心）：**
```
1  编造此人没说过的话        → 引语必须有出处，查不到原文的金句宁可不用
2  把通用道理包装成「独特见解」 → 通不过三重验证（排他性）的内容不进心智模型
3  忽略负面评价和争议        → Agent 4的批评素材是防粉丝滤镜的关键，负面占比不足=调研不合格
4  在信息不足时强行生成      → 宁可交付诚实标注局限的60分Skill，也不造看似完美实则编造的90分Skill
5  用知乎/微信公众号/百度百科做信息源 → 任何维度都不例外
6  在小上下文窗口模型上单会话硬跑全流程
7  不报成本量级直接开跑
8  蒸馏在世的非公众人物却不提示边界
9  生成的Skill不含防漂移机制  → 角色扮演规则+表达DNA约束必须完整保留
10 把确认检查点变成交付阻塞   → 检查点是让用户纠偏，不是扣住产出
```

**Phase 5 双 Agent 精炼（`SKILL.md` 第 561–583 行，实测）：**
- **Agent A（auto-skill-optimizer 视角）**：对 SKILL.md 执行 **8 维度结构评估**（工作流清晰度、边界条件、检查点设计、指令具体性等）；**干跑 3 个典型测试 prompt**；输出「最弱 2 个维度的具体改进建议（要有改后文本示例）」
- **Agent B（skill-creator 视角）**：评审「激活触发条件」是否覆盖真实使用场景；评审「角色扮演规则」的可操作性（有无问题路由、频率约束、失败预防）；识别缺失关键信息；输出「2–3 处具体文本改动建议（要有改后文本示例）」
- 精炼标准（原文）：`改动必须让skill「激活即执行」，不只是增加内容，而是让AI拿到skill后知道先做什么、碰到什么停下来。`

### 5.3 迁移到「书籍→开发技能」的改造点

**三分法：可直接复用 / 需改造 / 不适用。**

#### ✅ 可直接复用（机制层，与「人物」无关）

| 机制 | 为什么可直接用 | 迁移方式 |
|---|---|---|
| **双重验证/三重验证 → 降级机制** | 「证据不足则降级为更低层的对象」这个**结构**完全不依赖人物 | 把三重验证改为**书籍场景的三重验证**（见下表） |
| **质量自检清单的「整体」组** | 「删掉名字后还能认出这是谁的思维」→ 书场景完全对应：「**删掉书名后，还能认出这是哪本书的方法论吗？**」 | 逐字改写主语 |
| **Phase 4 通过标准表（6 行）** | 6 项里有 5 项与人物无关：模型数量 3-7、模型局限性、诚实边界≥3、内在张力≥2、**一手来源占比>50%** | 保留 5 项，仅替换「表达DNA辨识度」一项 |
| **保真度评分卡的 5 维度结构** | 维度 3（边缘诚实度）、4（来源透明度）、5（结构完整度）**与人物无关**；维度 1（立场一致性）可改为主张一致性 | 见下表改造 |
| **「答题 agent ≠ 评分 agent」的铁律** | 与领域完全无关的**方法论纪律**，且给了依据（自评准确率 46.4%） | 原样保留；这正是本报告方法论（「只写亲自 curl/读到的」）的同类机制 |
| **反作弊 4 条** | 「答题 agent 不知道在被测什么维度」「出题避开 skill 内已有示例」「2 个评分 agent 分差>10 分人工复核」 | 原样保留 |
| **反模式黑名单 #1/#4/#5/#9/#10** | #1 编造引语、#4 信息不足时强行生成（「宁可交付诚实标注局限的 60 分」）、#5 排除知乎/公众号/百科、#9 不含防漂移机制、#10 检查点不阻塞交付 | 原样保留 |
| **`FIDELITY.md` 出厂报告 + 每维度写扣分理由** | 「可审计的评分」这个形式 | 原样保留，改名为 `FIDELITY.md` 或 `AUDIT.md` |
| **Phase 2→4 最多循环 2 次** | 防无限打磨的收敛约束 | 原样保留 |
| **`references/research/01..06` 的 6 文件调研结构** | 6 个维度是「信息源分类」而非「人物专属」 | 见下表改造维度名 |
| **每 skill 一个目录 + `references/` 分层** | 与 book2skills 的形态一致 | 直接采纳 |
| **Phase 0A 的 6 项澄清 + 三档成本表** | 「先问档位再花钱」的纪律；档位=调研规模而非质量 | 原样保留，把「本地语料」改为「书稿/笔记/划线」（更贴书场景） |

#### 🔧 需改造（结构可留，语义要换）

| 原设计 | 问题 | 改造方案 |
|---|---|---|
| **心智模型三重验证**（跨域复现 / 有生成力 / 有排他性） | 「跨此人讨论的 2 个领域」在书场景下退化为「跨 2 个章节」，**区分度不足**（一本书的章节本就同源） | 改为：**① 跨章复现**（≥2 个不同章节独立提出同一框架）/ **② 有生成力**（能用该框架推断书中未直接讨论的新问题）/ **③ 有排他性**（该框架是本书的特色，不是领域通识——可用「其他教材是否也这么讲」作为判据） |
| **`描述 DNA`（句式/词汇/节奏/幽默/确定性/引用习惯）** | 人物表达风格的模拟在「开发技能」场景**无意义**（技能不应模仿作者口吻） | 替换为 **`方法论 DNA`**：判据类型（定量/定性）、推理步长（先结论还是先推演）、证据要求（是否强制引原文）、输出粒度（清单/表格/代码）、失败处理（遇缺失数据是追问还是标注未知） |
| **`角色扮演规则`** | 人物 skill 的核心，开发技能完全不需要 | **删除**；空出来的位置换成 **`执行规则`**（从 book2skills 的 `## Execution Rules` 借用：只读路由表指定的模块、缺数据先说缺什么再给临时分析、窄问题不全跑） |
| **`身份卡`（我是谁/我的起点/我现在在做什么）** | 无对应物 | 替换为 **`能力边界卡`**：**我能做什么 / 我需要什么输入才能做 / 我明确不做什么**（「我明确不做什么」对应 nuwa 的「我拒绝的」） |
| **`人物时间线`（表格 时间\|事件\|对我思维的影响）** | 无对应物 | 替换为 **`方法论演进`**：仅当原书有多个版本/修订时使用（如 `analyzing-financial-statements` 标注了「2019年修订版」），记录「初版怎么说 → 修订版怎么改 → 为什么改」 |
| **`内在张力 ≥2 对`** | 「一个人的内在矛盾」不可迁移；但「**书内观点的张力**」可以 | 改造为 **`方法论张力`**：书中相互制约的两组原则（如「精确估值」vs「安全边际」）。nuwa 的第三种矛盾「本质性张力（价值观内在冲突）」在此正好对应「作者在两种原则间的取舍」 |
| **保真度维度 1「立场一致性」** | 「对人物公开表态的问题回答方向一致」→ 书场景应改为「**主张一致性**」：对书中明确论述过的问题，skill 给的建议方向是否与书一致 | 3 道已知主张题：书中反复强调的判据；评分不变（10/6/0） |
| **保真度维度 2「风格辨识度」** | 开发技能不该模仿文风 | 替换为 **`可执行性辨识度`**：不看名字，能否从回答看出这是**有具体判据和步骤**的方法论输出，而不是通用 AI 泛泛而谈（判据：是否给出可核对的具体标准、是否区分了适用/不适用条件） |
| **`references/research/01-writings` 等 6 个维度** | 「著作」对书场景是**输入本身**（书就在手里），不再是调研对象 | 6 维改造为：`01-<书>-原文结构`（章节目录与核心主张）、`02-<书>-关键引语`（逐字引语+章节定位）、`03-<书>-判据与步骤`（可执行的判断标准与流程）、`04-外部评价与批评`（书评、学术批评、实践者反馈）、`05-案例与反例`（书中正例、书中警告的反例、外部失败案例）、`06-版本与演进`（版本、修订、作者后续修正） |
| **反模式 #3「忽略负面评价和争议」** | 对活人适用；对书仍需（书评/批评是必要的） | 保留，但把「粉丝滤镜」改为「**崇拜滤镜**」：书籍类 skill 的最大风险是把作者观点当成真理 |
| **反模式 #8「蒸馏在世非公众人物的隐私边界」** | 书场景不涉及 | 替换为 **`版权边界`**：不得逐段复制受版权保护的正文；引语需控制在合理引用范围并标注出处（book2skills 的 `license` 字段已给出范式）|
| **`Phase 1 的 6 个并行 Agent`** | 人物场景是「6 个 Agent 围绕一个人」；书场景的输入主要是**一本书 + 外部评价**，不是 6 类分散信息 | 缩减为 **2–3 个 Agent**：① 书内结构提取（章节→主张→判据）② 外部评价与批评调研 ③ 案例验证。**并在 Phase 0A 明确告知用户成本会显著低于人物蒸馏** |
| **`COMMUNITY.md` 收录门槛「评分卡 ≥B」** | 阈值可保留，但维度的分值配比需重算（风格分被替换后，20 分应重新分配） | 建议改为：主张一致性 30 / 可执行性 20 / 边缘诚实度 20 / 来源透明度 15 / 结构完整度 15（**配比不变、只换语义**，保持 A≥85 的门槛可比） |

#### ❌ 不适用

| 原设计 | 为什么不适用 |
|---|---|
| **`角色扮演规则` / `身份卡` / 退出角色（「退出」「切回正常」）/ 「免责声明仅首次激活时说一次」** | 开发技能不扮演任何人，无角色可进可退 |
| **`表达 DNA` 的量化方法**（`extraction-framework.md` 第 2.1 节：随机抽 20 段统计平均句长/疑问句比例/类比密度/第一人称率/确定性语气比例/转折频率；2.2 节的 7 组风格标签；2.3 节的禁忌词与口癖） | 这套「文体指纹」方法**完全服务于模仿作者口吻**；开发技能越不模仿作者口吻越好 |
| **「模拟此人表达」的质量判据**（「读 100 字能认出是谁」「三句内可认人」「有辨识度，不像通用 AI」） | 与上同源。开发技能的目标恰恰是**不**带个人文风，判据应改为「读 100 字能否看出这是有具体判据的方法论」 |
| **`人物时间线` / `最新动态` 与「更新已有 Skill」流程**（只启动 Agent 2/5/6，改「诚实边界」里的调研时间、更新「最新动态」） | 书籍是**静态**的（除非出新版）；不需定期更新人设。nuwa 的「活人 vs 历史人物」区分在书场景应改为「**在版书 vs 绝版/多版本**」 |
| **「蒸馏活人需提示隐私边界、需用户提供素材、需提醒征得当事人同意」** | 书场景不适用；应替换为版权合规（见改造表最后一条） |
| **`promo/`、`assets/banner.svg`、`wechat-qrcode.jpg`、`x-thread-en.md`、5 个语言的 README** | 是 nuwa 项目的**推广物料**，非 skill 机制 |
| **「蒸馏用户自己」特殊场景** | 与「书籍→技能」无关（但对「用户自己的笔记/方法论 → 技能」可能有参考价值） |
| **「主题 Skill」（`[topic]-framework/`）** | **部分适用，但不是本书场景的目标形态。** 它的定义是「一个领域的思维工具箱（综合多人视角）」，而「书籍→开发技能」是**单一来源**。⚠️ 但 nuwa 的「主题 Skill 变体表」（Phase 变更对照表）在处理「**一本书跨多个主题**」时可能有借鉴：当一本书同时覆盖「如何做用户研究」和「如何做定价」两个主题时，可参考它的「先搜索该主题 3-5 个核心人物/流派，再按人物分配 Agent」思路，改为一本书内按主题分派 |

**迁移后的 skill 目录骨架（本书场景建议）**
```
<book-slug>-<topic>/
├── SKILL.md                      # name + description（触发词）+ 执行规则 + 路由表 + 判据与步骤 + Do Not
├── FIDELITY.md                   # 保真度评分卡（主张一致性/可执行性/边缘诚实度/来源透明度/结构完整度）
├── references/
│   ├── research/                 # 6 文件调研底稿（改造后的维度）
│   │   ├── 01-book-structure.md
│   │   ├── 02-key-quotes.md
│   │   ├── 03-criteria-and-steps.md
│   │   ├── 04-external-views.md
│   │   ├── 05-cases-and-counterexamples.md
│   │   └── 06-version-and-evolution.md
│   ├── quotes/                   # 若采纳 book2skills 的锚点式引语（逐字原文 + 出处）
│   └── case_library.md           # 引用 ID → 用途 → 文件路径 → 锚点 的映射表
└── subskills/m<N>_<topic>/       # 若方法可拆成多个独立流程（book2skills 形态）
    ├── module.md
    └── references/case_library.md
```

### 5.4 对本项目的可用性与缺口

**可直接复用（最高优先级）**

1. **「答题 agent ≠ 评分 agent」的独立双 agent 铁律 + 它给的理由（自评准确率 46.4%，出处 arXiv 2605.23899）** —— 这是**整个五仓库分析里最有方法论价值的一条**，且与本源仓库的「只写亲自读到的证据」纪律同源。
2. **可审计的 `FIDELITY.md` 形态**：分数表 + 每维度扣分理由 + 逐题测试记录（问题/回答摘要/对照真实立场/判定）+ 测试日期 + 所用模型 + 评分方法论链接。**15/15 example 全覆盖**，证明该形态在规模化下可维持。
3. **Phase 4 通过标准表**（6 行，含「不通过信号」列）—— 「通过标准 + 不通过信号」成对给出的写法比单列标准更可操作。
4. **「迭代上限：Phase 2→4 最多循环 2 次」** —— 明确的收敛约束，防止无限打磨。
5. **反作弊 4 条 + 反模式黑名单 10 条** —— 都是浓缩的踩坑经验。
6. **三档成本表**（快速/标准/深度，含「约标准档 1/3」的量化）—— 在开跑前告知成本量级的纪律。
7. **`references/research/01..06` 六维度调研结构** —— 可直接改名复用。
8. **「删掉名字后还能认出是谁」** 这条整体判据（改为「删掉书名后」）。

**缺口**

1. **无 schema、无机器校验的契约。** 全部质量控制是**自然语言 rubric + 一个正则启发式脚本**。`quality_check.py` 的 `check_limitations` 只要有「局限」二字就通过——**无法防「写了但很空」**。
2. **保真度评分卡依赖人/agent 判断，无自动评分。** 无 CI、无评分基线、无法批量校验。15 个 `FIDELITY.md` 的分数（实测 `naval` 97/100、`x-mastery-mentor` 96/100 都是 A 级）**全部由 Claude Opus 4.8 单模型产出**（原文自述「答题/评分：独立双agent（Claude Opus 4.8）」）——**同一个模型既当出题者又当评分者时，独立性弱于跨模型**（nuwa 只做了 agent 隔离，未做模型隔离）。
3. **无版本字段、无晋升决定引用。** 更新流程靠改「诚实边界」里的调研时间；需要 Kb2Agent 的 `revision`/`supersedes`/`promotionDecisionRef` 补齐。
4. **无 `stopConditions` / `rollback` 的位置**（同 book2skills 的缺口）。
5. **论文出处未核实。** 评分卡引用 `arXiv 2605.23899`（arXiv 编号 `2605.*` 对应 2026 年 5 月，时间上可能与 2026-04-05 建仓兼容，但本报告**未抓取该论文**，「LLM 自评准确率 46.4%」这个数字**未独立验证**。引用时必须标注为「nuwa 自述」。）
6. **体量无上限**：`sun-yuchen-perspective/SKILL.md` 541 行，超过 book2skills 的 500 行约定。两源标准不一致（见第 6 节冲突）。
7. **`references/` 三种布局并存**（6 文件 research 型 / 扁平中文名型 / 主题型），**无官方推荐的唯一形态**——`skill-template.md` 也没有规定 `references/` 内部结构。→ 本项目需自行统一。
8. **未覆盖「多 skill 协作」**：nuwa 是「一次造一个 skill」的流水线，无 skill 之间的接口/组合约定（Kb2Agent 的 `TaskPackage` + `requiredClosure` 是补这块的）。

---

## 6. 五者关系图与流水线定位

### 6.1 每个源负责哪一环（实测能力对照）

| 环节 | ai-agent-book | Hyper-Extract | Kb2Agent | book2skills | nuwa-skill |
|---|---|---|---|---|---|
| **源材料 → 结构化知识** | ❌ 无 | ✅ **唯一有真实抽取引擎的**（9 种 AutoType + 40 模板 + LLM/embedding） | ⚠️ 只有 schema（`SourceArtifact/Revision/StructuralElement` + `EvidenceFragment/Claim`），**无抽取实现** | ❌ 无（人工读原著） | ❌ 无（6 个调研 Agent，输出是自然语言 research/*.md） |
| **知识 → 对象类型分类** | ⚠️ 隐含（skill 主题分类） | ✅ 9 种结构 | ✅ **20 个对象类型 + 12 条关系白名单**（最完整） | ❌ 无 | ⚠️ 心智模型/启发式/表达DNA 三分 |
| **skill 格式（frontmatter）** | ✅ `name` + `description`（22/22 严格一致） | ✅ `name` + `description`（仅顶层 1 例） | ❌ **无 frontmatter 字段**（Skill 是 JSON） | ✅ `name` + `description` + `license` | ✅ `name` + `description` |
| **skill 正文骨架** | ✅ **6 段固定**（何时使用/核心原则/实践模式/常见陷阱/配套代码/深度阅读），22/22 一致 | ⚠️ 每个子 skill 自定（无统一骨架） | ❌ 只有 `steps[]` 字符串数组 | ✅ 4-9 段，**每 skill 自定**（实测 2 例骨架不同） | ✅ **模板化**（skill-template.md 13 段），15/15 有 FIDELITY.md |
| **目录形态规范** | ✅ 单文件（写死「每个 skill 是单文件 SKILL.md」） | ✅ 多文件（6 个子 skill 中 4 个有 `references/`，2 个还带 `cases/`） | ❌ **不规定目录**（零 SKILL.md 命中） | ✅ **实际有 8 种形态**，但 `CONTRIBUTING.md` 只规定 1 种（references 型） | ✅ 3 种变体（6文件research / 扁平中文 / 主题），无官方唯一形态 |
| **触发条件（何时唤起）** | ✅ `description` 内写「…时使用」+ 「触发词：」 | ✅ `description` 内写 `Trigger: User mentions ...` | ❌ 无 | ✅ `description` 内写 trigger phrases（`CONTRIBUTING.md` 明写 "Include example trigger phrases"） | ✅ `description` 内写「当用户提到『用X的视角』…时使用」+「即使用户只是说…也应触发」 |
| **溯源回链** | ✅ **双向**：技能→章节代码 + 技能→book/chapterN.md（22/22） | ⚠️ 模板内 `guideline` 是 prompt 而非溯源；有 `provenance` 文档 + `he info --sources` 来源账本 | ✅ **最严**：`EvidenceFragment.locator{sourceRevisionId, structuralElementId, locator, contentHash}` + `sourceRefs` | ✅ `quotes/` 锚点 + `case_library.md` 映射表；但**无逐 skill 章节追溯记录** | ✅ `references/research/01..06` + 「附录：调研来源」（一手/二手/关键引用） |
| **质量门禁** | ❌ 无 | ⚠️ 有 76 个测试文件，但多为 mock；**无 skill 质量门禁** | ✅ **最完整三层**（forbiddenClaims / forbiddenWithoutNewAuthorization / const false）+ EvidenceContract + Acceptance（4 角色） | ⚠️ `CONTRIBUTING.md` 5 条标准（**全靠人工 review**，无脚本） | ✅ 5 层（三重验证 / 自检清单 / Phase4 通过标准 / 保真度评分卡 / quality_check.py） |
| **证据分级** | ❌ 无 | ❌ 无 | ✅ **6 值 evidenceGrade** + **kind→grade 硬映射**（fixture→只能L2 等） | ❌ 无 | ⚠️ 隐性（「一手来源占比 >50%」） |
| **版本/晋升机制** | ❌ 无 | ⚠️ 包版本 0.10.5 | ✅ `revision` + `status` + `supersedes` + `PromotionDecision` + `canonicalWrite:false` | ⚠️ `skills-lock.json`（仅锁 1/38，格式 `version:1`） | ⚠️ 更新流程（改调研时间）；无 version 字段 |
| **可执行的产出** | ✅ 110 个代码目录 + 逐 skill 命令示例 | ✅ **真实 CLI/MCP/Python API**（可跑） | ⚠️ `reference/runtime/*.mjs` 有 compiler/agent，但需 node_modules | ⚠️ 3 个 skill 带 `scripts/`（python） | ✅ `scripts/quality_check.py` 等 4 个脚本 |
| **离线可用** | ✅ 是（纯 md） | ⚠️ **否**（必装 LLM + embedder；本地 vLLM 可自托管，但仍需服务） | ✅ 是（纯 JSON/MD） | ✅ 是（纯 md，scripts 为可选） | ⚠️ 脚本是纯本地，但生成流程需 LLM |

### 6.2 接口在哪里（可对接的接缝）

```
[书原文 .md/.pdf]
      │
      │  接口 A：文件系统 —— Hyper-Extract `he parse <file> -t <template> -o <dir> -l zh`
      ▼
[Hyper-Extract 的 9 种 AutoType 结构化输出]
      │  产出：graph/hypergraph 的 entities+relations、model 的 fields、set 的去重集合
      │  ⚠️ 接口 A 的风险：输出是 LLM 生成，无确定性；需人工或二次校验
      ▼
      │  接口 B：对象类型映射
      │  Kb2Agent 的 knowledge-object.schema.json 定义 7 种知识对象
      │  映射建议：AutoModel → Concept/Metric；AutoSet → 术语表(aliases)；
      │            AutoGraph/Hypergraph → DecisionModel/Playbook 的证据基础；
      │            Claim(contradictionRefs) ← 冲突/矛盾（对应 nuwa 的「核心张力」）
      ▼
[Kb2Agent 的 L2 知识对象]  ── PromotionDecision ──▶  [Skill]
      │  接口 C：skill 契约（10 项 required）
      │  name/inputContract/outputContract/tools(read|calculate|draft, sideEffect:false)/
      │  steps/eLevel(≤E2 公开)/stopConditions/rollback/tests(≥2)/promotionDecisionRef
      ▼
      │  接口 D：skill 目录形态（book2skills 7 类 + nuwa 模板）
      │  ai-agent-book 给「正文骨架」：何时使用/核心原则/实践模式/常见陷阱/配套代码/深度阅读
      │  book2skills 给「部件组合」：references/ | subskills/ | quotes/ | scripts/
      │  nuwa 给「质检件」：FIDELITY.md
      ▼
[skill 目录]  ── 接口 E：质量门禁 ──▶  [可交付]
      nuwa：独立双 agent 评分卡（A≥85）
      Kb2Agent：forbiddenClaims(minItems:1) + Acceptance(4角色) + evidenceGrade(≤ceiling)
```

**最自然的接缝是接口 C+D：** Kb2Agent 的 `skill.schema.json`（**运行契约**）与 ai-agent-book / book2skills / nuwa 的 SKILL.md 范式（**知识载体**）**恰好互补且不重叠**——前者规定「skill 必须有哪些结构字段才能被验收」，后者规定「skill 的正文该怎么写才能被 agent 用好」。两者合并即得一个完整的 skill 规范：

| 层 | 来源 | 内容 |
|---|---|---|
| **frontmatter** | ai-agent-book（`name`+`description`）+ book2skills（加 `license`）+ nuwa（description 内写触发词） | `name`（kebab-case，≤64 字符，不含 anthropic/claude）、`description`（触发场景 + 触发词）、`license` |
| **正文骨架** | ai-agent-book 的 6 段 + book2skills 的 `## Do Not` + nuwa 的 `## 诚实边界` | 何时使用 / 核心原则 / 实践模式 / 常见陷阱 / **Do Not** / **stopConditions** / **rollback** / 配套代码 / 深度阅读 / 诚实边界 |
| **机器契约** | Kb2Agent | `eLevel`(E0–E2) / `tools[]{toolId, mode, sideEffect:false}` / `tests`(≥2) / `promotionDecisionRef` / `inputContract.schemaRef` / `outputContract.schemaRef` |
| **部件** | book2skills | `references/` / `subskills/m<N>_*/{module.md, references/case_library.md}` / `quotes/`(锚点式) / `scripts/` |
| **质检件** | nuwa | `FIDELITY.md`（5 维度 100 分，独立双 agent） |
| **治理** | Kb2Agent | `PromotionDecision` / `forbiddenClaims` / `Acceptance`(4 角色) / `evidenceGrade` |

### 6.3 冲突在哪里（实测，必须由本项目裁决）

| # | 冲突点 | 各源立场 | 实测证据 |
|---|---|---|---|
| **C1** | **单文件 vs 分层** | ai-agent-book：**写死单文件**「每个 skill 是单文件 SKILL.md，自包含，可独立使用」（`skills/README.md` 第 49 行）；book2skills：**500 行上限 + 详细内容进 `references/`**（`CONTRIBUTING.md` 标准表） | ai-agent-book 单文件 7.3–16.6 KB（22/22）；book2skills 38 个里 **32 个有 references/subskills/quotes/scripts 至少一个**（实测同口径计数），即只有 **6 个**是真单文件 |
| **C2** | **体量上限** | book2skills：**SKILL.md < 500 行**（硬标准）；nuwa：**无上限**（`sun-yuchen-perspective` 541 行）；ai-agent-book：80–129 行 | `wc -l`：ai-agent-book 80–129；book2skills 54–485（0 个超 500）；nuwa **343–541（3 个超 500）** |
| **C3** | **frontmatter 字段数** | ai-agent-book：**2 个**（name, description）；book2skills：**2 个必需 + license 常见**；nuwa：**2 个**（name, description）；Hyper-Extract：2 个；Kb2Agent：**0 个**（JSON） | 实测各源 frontmatter 键集合 |
| **C4** | **知识分层编号** | Kb2Agent **内部三套冲突** | 体系(a) 目录表 vs (b) schema title vs (c) terms.json：Skill 在三处分别是 L3 / L5 / L5；TaskPackage 是 L4 / L6 / L6（完整对照见 3.1） |
| **C5** | **「Skill」这个词指什么** | 四个源：**一个装着 SKILL.md 的目录**（ai-agent-book、book2skills、nuwa、Hyper-Extract 均如此）；Kb2Agent：**一个 JSON 对象**（`skill.schema.json`），无目录概念 | Kb2Agent 全仓 grep `SKILL.md` 零命中（排除 docs/knowledge） |
| **C6** | **谁负责质量门禁** | book2skills：**人工 review + 500 行约定**（无脚本，无 CI）；nuwa：**独立双 agent 评分卡**（有脚本但只做正则启发式）；Kb2Agent：**schema + 校验器 + 4 角色验收**（有 `.mjs` 断言） | book2skills 顶层无 `scripts/`、无 CI 校验；nuwa `quality_check.py` 152 行正则；Kb2Agent `check-reference-contracts.mjs` 422 行 + `docs:qa` 串联 20+ 命令 |
| **C7** | **证据等级的粒度** | Kb2Agent：**6 值 evidenceGrade + 6 值 eLevel（公开只到 E2）**；nuwa：**隐性（一手来源 >50%）**；book2skills：**无**；ai-agent-book：**无** | 各源 schema/frontmatter 实测 |
| **C8** | **外部写入的处置** | Kb2Agent：**三层锁死**（`externalWrite: const false` + `status` 无 executed + E3/E4 非 public）；其余四源：无此概念 | 3.4 节实测 |
| **C9** | **溯源粒度** | Kb2Agent：**字符级**（`contentHash` + `locator` + `structuralElementId`）；book2skills：**锚点级**（`quotes/#anchor`）；ai-agent-book：**章节级**（`book/chapterN.md`）；nuwa：**文件级**（`references/research/01..06`）；Hyper-Extract：**文档级**（`he info --sources`） | 各源证据结构实测 |
| **C10** | **本项目任务的「22-24 个 skill」** | 实测 **22** | `ls skills/*/SKILL.md \| wc -l` → 22；`/git/trees` 过滤 `skills/` → 45 条（22 目录 + 22 SKILL.md + 1 README） |
| **C11** | **Hyper-Extract「80+ 模板」** | 实测 **40** | `find hyperextract/templates/presets -name '*.yaml' \| wc -l` → 40；README 三处声称 80+ |

**本项目必须先裁决的 3 个冲突（建议，非实测结论）**：
1. **C1/C2**：定一条分界线——建议「正文骨架与触发条件在 SKILL.md（≤ X 行）；引语、案例库、模块流程、调研底稿进 `references/`」，X 取 book2skills 的 500 行作为起点。
2. **C4/C5**：Kb2Agent 的层号**不可直接引用**，必须重建唯一编号表；且要明确「本项目说的 skill」是**目录**（采纳四源共识）还是**JSON 对象**（Kb2Agent），或两者分别命名。
3. **C7/C8**：证据等级与外部写入禁止是否采纳 Kb2Agent 的 schema 级实现——若采纳，需同时接受它的成本（写 JSON 而非 markdown）。

---

## 7. 关键发现

> 每条附实测证据。**「实测」= 本轮真跑过命令并贴得出输出；「推断」= 由实测事实推导，已标注推导链。**

**F1 — ai-agent-book 的 skill 格式是五源中最严格、最可直接复用的：22/22 完全一致。**
实测：对 22 个 `SKILL.md` 提取全部 `##` 标题并比对期望序列，脚本输出 `all 22 conform to exact 6-section order`；frontmatter 键统计 `{'name': 22, 'description': 22}`。
骨架固定为 `## 何时使用 / 核心原则 / 实践模式 / 常见陷阱 / 配套代码 / 深度阅读`，每段命中 22/22。
证据：本地落盘的 22 个 SKILL.md（合计 244653 B）+ 校验脚本输出。

**F2 — ai-agent-book 的 skill 与书的映射是「双向回链」，且 22/22 全部在「深度阅读」段回链 `book/chapterN.md`。**
实测：逐 skill 提取「深度阅读」段内 `book/chapterN.md` 匹配，22 个 skill 全部命中（引用密度 1–8 次/技能，`agent-evaluation` 与 `post-training-strategy` 各 8 次最高）。
「配套代码」段同时指向 `chapterN/<子目录>/`，110 个代码子目录平均被 3.4 个 skill 引用（推断：路径计数 110 目录 / 22 技能，按「配套代码」段路径出现次数统计）。

**F3 — Hyper-Extract 的「9 种知识结构」定义清晰，可直接作为目标结构分类法。**
实测 `hyperextract/types/__init__.py` 的 docstring 表格逐字可见 9 个类：`AutoDocument`(Text Chunks，**不做 LLM 抽取**)、`AutoModel`(Single Object)、`AutoList`(List[Item])、`AutoSet`(Set[Item]，按唯一键去重合并)、`AutoGraph`(Nodes+Edges)、`AutoHypergraph`(Nodes+Hyperedges，**N 元关系**)、`AutoTemporalGraph`(+Time)、`AutoSpatialGraph`(+Space)、`AutoSpatioTemporalGraph`(+Time+Space)。`__all__` 导出确认。对应 9 个 YAML `type:` 值。

**F4 — 🔴 Hyper-Extract 的「80+ 模板」是虚假宣传：实测 40 个，且自带目录表只列 39 个。**
实测：
```
README.md:316  - **Templates** — 80+ presets across 6 domains.
README.md:350  - [Browse all 80+ templates](./hyperextract/templates/presets/)
README.md:369  | Template Gallery | [80+ presets](./hyperextract/templates/presets/) |
$ find he/hyperextract/templates/presets -name '*.yaml' | wc -l
40
$ grep -o 'presets/[a-z]*/[a-z_]*\.yaml' hyperextract/templates/README.md | sort -u | wc -l
39
```
域分布实测 **7 个域**：education 2 / finance 5 / general 13 / industry 5 / legal 5 / medicine 5 / tcm 5 = 40。**README 还写 `across 6 domains`，域数也被低报**（实测 7）。
**集成结论：不得引用「80+」，也不得引用「6 domains」。**

**F5 — Hyper-Extract 不能离线：LLM + embedder 是硬依赖，不存在「无 LLM 抽取」模式。**
实测：`pyproject.toml` 依赖 `langchain>=1.2.6`、`faiss-cpu>=1.13.2`；`mcp_server.py` 的 `_get_clients()` 返回 `tuple[BaseChatModel, Embeddings]`（两者都要）；`cli.py` 中 grep `offline|no_llm` **零命中**（唯一 `dry_run` 命中的是 `remove` 命令，语义为「只打印不落盘」）。
唯一窄路径：本地 vLLM 自托管（README 原文 `he config llm -p vllm -u http://localhost:8000/v1 -k dummy -m Qwen/Qwen3.5-9B`），**但仍是服务依赖**。

**F6 — Hyper-Extract 提供 MCP，9 个工具，stdio 传输，属 optional extra。**
实测 `mcp_server.py` 第 432–439 行注册循环逐字可见：`list_templates, info, search, ask, export_obsidian, export_graphml, export_csv, export_jsonld, export_cypher`；`build_server().run()` 为 stdio；`pyproject.toml` 中 `mcp = ["mcp>=1.2.0,<3"]` 是 optional extra，且代码同时兼容 `mcp 1.x`（`FastMCP`）与 `2.x`（`MCPServer`）。

**F7 — 🔴 Kb2Agent 的知识分层编号在仓库内部自相矛盾，三套体系并存且无校验。**
实测同一对象 `Skill` 在三处是三种层号：
- `docs/architecture/m1-a-schema-catalog.md` 第 20 行：`| L3 | Skill | skill.schema.json | PromotionDecision 存在，首案最高 E2 |`
- `reference/schemas/skill.schema.json` 的 `"title": "MKD L5 Skill"`
- `reference/ontology/terms.json`：`{ "id": "TERM-SKILL", "zh": "技能契约", "en": "Skill", "layer": "L5" }`
同型冲突还有 `TaskPackage`（L4 / L6 / L6）与 `DecisionModel`（L2 / L2-L4 / L3）。
且 `check-reference-contracts.mjs` 中**没有任何层号断言**（422 行输出仅涉及证据天花板）。
**集成结论：不得直接引用 Kb2Agent 的层号，必须自建唯一编号表。**

**F8 — Kb2Agent 的门禁是三层结构，且大量用 schema 常量锁而非提示词约束。**
实测三层：
1. **能力级**：`knowledge-system/schemas/capability-map.schema.json` 强制 `forbiddenClaims: {minItems: 1, items: {minLength: 10}}` —— 每项能力必须写禁止声明。13 项能力各带 1–2 条（实测）。
2. **授权级**：`product-decisions.json` 的 `forbiddenWithoutNewAuthorization` 7 项（`provider-call / production-deploy / canonical-knowledge-write / external-send / git-commit / git-push / package-publication`），schema 强制 `minItems: 6`，校验器（`check-reference-contracts.mjs:284-286`）要求该集合必须让每个动作「失败关闭」。
3. **对象级 `const: false`**：`externalWrite`(PermissionRule、ActionPackage.options[])、`canonicalWrite`(KnowledgeCandidate)、`productionReady`(Acceptance)、`freeText`(Observation、TaskPackage.publicInput)、`fileUpload`、`urlInput`、`maxExternalCalls: 0`、`maxSideEffects: 0`、`sideEffect`(每个 tool)。
**直接对本项目「不得执行 external-write」有用**：`ActionPackage.status` 枚举是 `{draft-for-review, blocked-insufficient-input, approved-for-manual-execution}` —— **根本没有 "executed" 状态**。

**F9 — Kb2Agent 的 skill 晋升靠一个必填的 `promotionDecisionRef`，且 Case 直通 Skill 被硬拒绝。**
实测 `skill.schema.json` 的 required 数组逐字为：
```json
["name","inputContract","outputContract","tools","steps","eLevel","stopConditions","rollback","tests","promotionDecisionRef"]
```
（`tests` 为 `minItems: 2`）。校验器 `check-reference-contracts.mjs:136` 断言 `requireRef(skill.promotionDecisionRef, 'PromotionDecision', skill.id)`；第 157 行对绕过路径抛 `CASE_SKILL_PROMOTION_FORBIDDEN`：「bypasses KnowledgeCandidate and PromotionDecision」。候选侧 `KnowledgeCandidate.canonicalWrite` 恒为 `false`。
**另注：Kb2Agent 不规定 skill 的磁盘目录布局**——全仓（排除 `docs/knowledge/`）grep `SKILL.md` 零命中；它把 Skill 定义为 JSON 对象。

**F10 — nuwa 的「答题 agent ≠ 评分 agent」是五源中最有价值的方法论纪律；book2skills 的 7 种目录形态是实测归纳的最实用落地分类。**
实测（nuwa）：`references/fidelity-scorecard.md` 第 5 行原文「SkillLens 论文（arXiv 2605.23899）实证，LLM 自评 skill 质量准确率仅 46.4%，所以评分卡的铁律是：**答题 agent 和评分 agent 必须是两个独立 agent，绝不自评自证**」；反作弊 4 条含「重要结论建议 2 个评分 agent 独立跑，分差 >10 分时人工复核」。**15/15 example 都有 `FIDELITY.md`**（实测 `ls examples/*/FIDELITY.md | wc -l` → 15），每份都写出各维度扣分理由（`naval` 97/100：18/20 扣「解释性铺陈」、14/15 扣「缺逐条出处」）。
实测（book2skills）：对 38 个 `skills/*/` 逐一探测 `references/subskills/scripts/quotes` 四个部件，得到 **8 种形态**（单文件型 6 / quotes 型 14 / subskills+quotes 型 5 / references 型 4 / references+scripts 型 3 / subskills 型 3 / references+quotes 型 2 / scripts 型 1，合计 38）；`SKILL.md` 行数 54–485，**0 个超过 `CONTRIBUTING.md` 规定的 500 行上限**。
**但 nuwa 引用的论文 `arXiv 2605.23899` 本报告未抓取核实，「46.4%」应标注为 nuwa 自述。**

**F11（补充）— book2skills 的质量控制只有人工约定，无任何自动化；且 README 与实际内容严重不同步。**
实测：顶层无 `scripts/`、无校验 CI；`CONTRIBUTING.md` 的 5 条标准（Faithful to source / Actionable / Clear structure / Valid YAML / **SKILL.md < 500 行**）全靠 PR review；「是否读完原著」只填 `yes/no` 自述。
`README.md` 的 Skills List 只列 2 个 skill，而 `skills/` 下实存 **38 个**（`ls -d skills/*/ | wc -l`）；`skills-lock.json` 只锁了 **1 个**（`common-stocks-uncommon-profits`，`{source, sourceType, computedHash}`，`version: 1`），无算法说明（未核实）。
