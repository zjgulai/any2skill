# ADR-002 · 项目结构：双平面混合（外层 Claude 合规 / 内层 Kb2Agent 治理）

- 状态：已接受
- 日期：2026-10-08
- 决策者：用户（拍板「A」）
- 关联：ADR-001、ADR-003

## 背景

需要为 any2skills 选择仓库根结构。候选标准并非同一层的东西：

**标准一：Claude Code 官方结构（已核实原文）**

来源：[Claude Code plugins 官方文档](https://code.claude.com/docs/en/plugins/overview)、[Agent Skills 架构文档](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)。

- 双层：marketplace 层 `.claude-plugin/marketplace.json`（目录清单）+ plugin 层 `.claude-plugin/plugin.json`（插件清单）
- 组件按固定子目录：`skills/`（每个一个 `SKILL.md`）、`agents/`、`hooks/`、MCP servers
- Skill 三层渐进披露：L1 frontmatter（`name` ≤64 字符、`description` ≤1024 字符，always loaded）→ L2 `SKILL.md` 正文（触发时加载，建议 <5k tokens）→ L3 `references/`/`scripts/`（按需加载，不进上下文）
- 硬约束：Skills **不跨平台同步**（claude.ai / API / Claude Code 三处各自独立）
- 硬约束：Claude API 环境下 Skills **无网络访问、不能运行时安装包**（**注意**：此约束只适用于 API 环境，Claude Code 环境有完整网络访问）

**标准二：Kb2Agent 治理结构（已核实原文，含对既有前提的更正）**

实测 `curl -s https://api.github.com/repos/zjgulai/Kb2Agent/git/trees/main?recursive=1`：369 个 blob 中，路径含 `SKILL.md` 的 **0 个**，含 `skills/` 的 **0 个**。

⇒ **Kb2Agent 不规定 skill 目录布局，它把 Skill 定义为 JSON 对象（`reference/schemas/skill.schema.json`）。**

图层权威文档是 `docs/architecture/m1-a-schema-catalog.md`（**不是** `mkd-design-spec.md`——那是 UI 规格；**不是** `mkd-information-architecture.md`——那是站点 IA）。其 L0–L6 对象链及「进入下一层的必要条件」：

| 层 | 主要对象 | Schema | 进入下一层的必要条件 |
|---|---|---|---|
| L0 | SourceArtifact / SourceRevision / StructuralElement | `source.schema.json` | revision、hash、来源与结构定位完整 |
| L1 | EvidenceFragment / Claim | `evidence.schema.json` | locator 可解析、支持与冲突引用可追溯 |
| L2 | Concept / Metric / DecisionModel / Case / Playbook | `knowledge-object.schema.json` | 类型化、版本化、关系端点合法 |
| L3 | Skill | `skill.schema.json` | PromotionDecision 存在，首案最高 E2 |
| L4 | TaskPackage | `task-package.schema.json` | Skill、对象闭包和 EvaluationContract 均可解析 |
| L5 | ActionPackage / RunTrace | `action-package.schema.json` / `run-trace.schema.json` | 固定 fixture 可重放，事件输入输出闭合 |
| L6 | KnowledgeReceipt / ReleaseSnapshot | `knowledge-receipt.schema.json` / `release-snapshot.schema.json` | 评估引用、trace、manifest hash 一致 |

⚠️ **编号冲突警告**：`Skill` 这一对象在 Kb2Agent 三处出现三种层号（`m1-a-schema-catalog.md` 目录表 = L3；`skill.schema.json` 的 title = 「MKD L5 Skill」；`ontology/terms.json` 的 layer = L5），`TaskPackage` 同型冲突（L4/L6/L6），且校验器**无任何层号断言**。⇒ 本项目**必须自建唯一编号表**，不得直接引用 Kb2Agent 的层号。

**实测的本机 skill 目录惯例**（`~/.agents/skills`，178 个目录）：

| 部件 | 出现次数 | 占比 |
|---|---|---|
| `SKILL.md` | 178 | 100% |
| `references/` | 93 | 52% |
| `README.md` | 69 | 39% |
| `scripts/` | 61 | 34% |
| `LICENSE` | 60 | 34% |
| `agents/` | 45 | 25% |
| `evals/` | 30 | 17% |

## 决策

采用**双平面混合结构**：外层 Claude 合规保证产出即插即用，内层 Kb2Agent 治理保证产出可审计。

```text
any2skills/
├─ .claude-plugin/            # 平面一：Claude 合规层（对外、可发布）
│  ├─ plugin.json
│  └─ marketplace.json
├─ skills/                    # 已发布的成品 skill（只读区，只接收晋升通过的产物）
│  └─ <skill-name>/
│     ├─ SKILL.md             # 必需；frontmatter 仅 name + description
│     ├─ references/          # 按需（L3）
│     └─ scripts/             # 按需（L3）
├─ agents/                    # 子代理定义（独立评估者等）
├─ commands/                  # 斜杠命令
├─ hooks/                     # 生命周期钩子
├─ pipeline/                  # 平面二：治理层（内部、不发布）
│  ├─ knowledge/              # 中间表示：知识对象与关系（Hyper-Extract 或其替代的产物）
│  ├─ registry/               # capability-map / SkillCandidate 候选池 / 门禁回执
│  └─ schemas/                # 知识对象与 skill 契约的 JSON Schema
├─ benchmark/                 # 只读：原书 22 个 skill，作盲测对照（禁止进入生成链路）
├─ sources/                   # 原始信息源（已就位：ai-agent-book 中文正文）
├─ analysis/                  # 源剖析报告
└─ docs/
   ├─ adr/                    # 决策记录
   ├─ specs/                  # 规格
   └─ tickets/                # 执行任务卡
```

**平面隔离规则（强制）**：
- `skills/` 是**只读发布区**，只接收门禁通过的产物；生成过程不得就地修改它。
- `pipeline/` 是**只写中间态**，其内容不进入发布物。
- `benchmark/` 是**只读**，且生成链路的任何环节不得读取。

## 理由

- 两个标准**不是竞品，是不同层次**：Claude 标准管「skill 长什么样、怎么被发现」，Kb2Agent 管「skill 凭什么算达标、知识从哪来」。
- 本项目本质是**编译器**（原始内容 → skill）。编译器必须有中间表示（IR）与验收标准，否则失败无法归因——IR 由 Kb2Agent 的知识对象承担，验收由其门禁机制承担。
- 外层保持 Claude 合规，使产物可立即拷入 `~/.agents/skills/` 或 `~/.claude/skills/` 使用，且未来要做 marketplace 分发时零改造成本。
- 物理隔离（`skills/` 只读 / `pipeline/` 只写 / `benchmark/` 隔离）同时满足 ADR-001 的污染隔离要求，三者互不污染。

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 纯 Claude 官方结构，治理用 `docs/` 承载 | 治理无约束力：知识对象退化为自由 markdown，无 schema 校验，AI 可悄悄产出不合规候选；「凭什么通过」无法机器判定 |
| 纯 Kb2Agent 式治理结构为主 | 产出不能直接装入 Claude Code / DSH，需额外适配脚本；且与官方 `plugin.json` 发现机制脱节。**且实测证明它根本不含目录规范**，无法单独作为结构方案 |
| 极简：只要 `skills/` + `scripts/` | 链路退化成黑盒脚本，「可审计的编译过程」不可见，失败无法归因 |

## 后果

**正面**
- 产物即插即用 + 过程可审计，两者兼得。
- 三平面物理隔离天然满足污染隔离与只读约束。

**负面 / 代价**
- 多出一个「晋升」动作：候选 → `pipeline/registry/` → 门禁通过 → `skills/`。
- 两套标准的映射关系需要显式记录（本 ADR 即为该记录），否则日后会有人误以为 `pipeline/schemas/skill.json` 与 `skills/<name>/SKILL.md` 是重复定义。

**必须遵守的约束**
- 层号**一律使用本项目的自建编号表**，禁止引用 Kb2Agent 的 L0–L6 编号（其仓库内自相矛盾）。
- `SKILL.md` 的 frontmatter 遵守 Claude 官方硬限制：`name` ≤64 字符（仅小写字母/数字/连字符，禁含 `anthropic`/`claude`），`description` ≤1024 字符。

## 核实方式

```bash
# Claude 标准：见上方引用的两份官方文档 URL（本次实测 HTTP 200 并读到原文）
# Kb2Agent 不含目录规范（实测）
curl -s https://api.github.com/repos/zjgulai/Kb2Agent/git/trees/main?recursive=1 \
  | jq -r '.tree[]|select(.type=="blob")|.path' > /tmp/kb2paths.txt
wc -l < /tmp/kb2paths.txt          # 369
grep -ci 'SKILL\.md' /tmp/kb2paths.txt   # 0
grep -c 'skills/' /tmp/kb2paths.txt      # 0
# 本机 skill 目录惯例
cd ~/.agents/skills && for d in */; do ls "$d" 2>/dev/null; done | grep -v '^$' | sort | uniq -c | sort -rn
```
