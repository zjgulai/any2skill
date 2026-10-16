# 审计报告 · 开关 / 配置 / 实验面（全仓资产，2026-10-16）

**执行约束（合规声明）**：本次审计**未修改任何线上配置、服务或仓库内行为**；唯一新产物是本报告文件。
所有「移除判定」都是结论与证据，不是执行记录——本仓对应的清理动作已在
[`卡 31`](../tickets/31-dead-code-cleanup.md)（死代码）与本报告的分组表中列明。

---

## 0. 执行摘要

**① 关于 Statsig 类资产：本仓为零。** 这不是凭印象——以 15 个模式串（`statsig`、`launchdarkly`、
`unleash`、`optimizely`、`flagsmith`、`split.io`、`growthbook`、`posthog`、`feature flag|gate`、
`remote config`、`kill switch`、`experiment` 等）全仓扫描 `*.mjs/*.cjs/*.json/*.md/*.txt`
（排除 node_modules 与历史/源/基准归档面）：命中仅两类——**自家实验探针脚本**
`pipeline/experiments/probe-task-headroom.mjs`（卡 25 工具）与**源书数据**
（`analysis/05-source-analysis.md` 对上游书里 `EXPERIMENT_LEDGER.md` 的统计）。
**没有 SDK、没有旗标服务、没有灰度/实验平台配置。**

**② 本仓真实存在的「开关面」= CLI 旗标（48 个）+ 环境变量（11 个）+ 行为门控常量/模式（枚举 3 张表 +
若干模式参数）**。全量审计结果：

| 结论 | 数量 | 说明 |
|---|---:|---|
| 陈旧、可安全移除的线上开关/实验 | **0** | 无 Statsig 类资产；其余开关逐项核对均在役 |
| 「全量上线」机制（曾为可选/现在无条件生效） | 5 项 | **无开关残骸**（残骸专项核验见 §2 G7） |
| 薄覆盖活模式（0 测试/0 文档，冒烟确认在役） | 6 个旗标 | 见 §2 G4，建议补测试（不是删除） |
| CPU 热点实测（>10ms/次 的重复扫描） | **1 处** | 回执查找 11.6ms/次；全量干跑总耗时 0.56s——**可接受**，缓存为可选优化 |

**③ 与「生产遥测/性能分析」的对应**：本仓无遥测服务；其等价物是**盘上的运行遥测**
（回执、账本、门禁报告）与**实测时间**（本报告 §2 G9 全部为当机实测数字，非估算）。

---

## 1. 审计方法与枚举证据（可复跑）

| # | 维度 | 方法 | 覆盖 |
|---|---|---|---|
| 1 | SDK/平台 | 15 模式串全仓扫描（含大小写、含文档） | 全仓 |
| 2 | CLI 旗标 | 逐 CLI 解析 `'--*'` 字面量 → 与测试/文档/运行时交叉计数 | 12 个 CLI，48 旗标 |
| 3 | 环境变量 | `process.env.*` 静态读取 + `env[name]` **动态键**（名字表） | 11 个名字 |
| 4 | 动态拼接名 | 模板串 `` `--${…}` ``、`` `${x}.json` `` 全枚举 | 全部命中均为确定性产物命名，无隐藏开关 |
| 5 | 包装函数/别名 | 名字替换型包装逐个人工复核 | `judgeAppliedFor`、`crossChapterObjectsFile`、`isCrossChapterObjectsFile`、`resolveJudgeLlmConfig` 等 |
| 6 | 废弃标记 | `deprecated\|废弃\|作废\|退役\|retired\|过时\|遗留` 代码面扫描 | 7 处命中，全部是**解释性注释**（见 §2 G8） |
| 7 | 残骸核验 | 对每个「已作废」声明做反向核验（开关是否真的不在代码里） | ADR-021 双口径开关：**零残骸** |

---

## 2. 资产清单（按归属分组，可直接并行处理）

### G1 · run.mjs 旗标族（owner：`pipeline/run.mjs`）

生产取值 = parseArgs 默认值。核验：全部旗标在运行时 `flags.*` 判定链中被读取（逐项 grep 核过）。

| 旗标 | 生产取值 | 状态 | 证据 |
|---|---|---|---|
| `--layer2` | **`stub`（默认！真跑必须显式 `deepseek`）** | 在役（安全默认） | `run.mjs:672`、`run-book.mjs:214` |
| `--judge` / `--no-judge` | 判定者默认开启（stub 层自动关） | 在役 | 测试 11+29 引用；`judgeAppliedFor` 判据 |
| `--objects-fixture` | 无默认（测试夹具缝） | 在役（测试缝，文档化） | 8 处测试引用 |
| `--no-ledger` | 审计默认开 | 在役（2 测试引用） | `run-book.mjs:232` |
| `--llm-*` / `--judge-*`（model/base-url/provider/reasoning-effort） | 无默认（走 env/凭据） | 在役（路由配置面） | `resolveLlmConfig` overrides |
| `--max-anchor-bytes` / `--max-objects-per-anchor` | 有默认常量 | 在役（预算旋钮，ADR-017） | 文档 3 处 |

**移除判定：无可移除项。** `--layer2` 默认 `stub` 是刻意安全默认（README 陷阱表有案），**保持不动**。

### G2 · llm-client 环境/凭据族（owner：`pipeline/tools/llm-client.mjs`）

| 名字 | 生产取值 | 状态 | 证据 |
|---|---|---|---|
| `ANY2SKILLS_LLM_API_KEY` / `_MODEL` / `_BASE_URL` / `_PROVIDER` / `_REASONING_EFFORT` | 无默认（缺失则拒绝调用） | 在役（生产者路由） | `LLM_ENV` 表 + `env[name]` 动态读取 |
| `ANY2SKILLS_JUDGE_MODEL` / `_BASE_URL` / `_PROVIDER` | 缺省**继承生产者** | 在役（ADR-010 独立可配） | `JUDGE_LLM_ENV` 表 |
| `DSH_HOME` | 缺省 `os.homedir()` | 在役（凭据文件定位） | `llm-client:213` |
| `DSH_FS_LEDGER` | 未设=不装钩子（零开销） | 在役（账本总开关） | `fs-ledger.cjs:49/59` |
| `DSH_BOOK_DEBUG` | 未设=静默 | 在役（调试缝） | `run-book.mjs:762` |

**移除判定：无可移除项。** 动态键读取（`env[name]`）即目标要求的「动态拼接名」核查点——已核，
名字表封闭（`Object.freeze`），无未声明通道。

### G3 · 门禁二/三模式族（owner：`run-gate2.mjs` / `run-gate3.mjs` / `tools/gate{2,3}-*.mjs`）

| 名称 | 生产取值 | 状态 | 证据 |
|---|---|---|---|
| `BLIND_MODES {list, strict}` | 两模式都在役（历史两读数 + `--compare`） | 在役 | 卡 12/27 实测；`--compare` 运行时 1 处引用 |
| `--suite / --suite-key / --suite-manifest` | 缺省 `task-suite` 命名空间 | 在役（卡 27/29） | 16 处文档引用 |
| `--rerun`（退化复跑制） | 在役 | 在役 | 9 测试 + 11 文档 |
| `--blind-mode` | 缺省 list | 在役 | 5 测试引用 |
| `CHECK_TYPES`（声明式检查单白名单） | 5 类封闭枚举 | 在役 | ADR-027 |
| `REASONING_EFFORTS {low, high, max}` | 缺省 null=不发字段 | 在役 | ADR-009/015 |

**移除判定：无可移除项。** 无「已收敛为单一模式」的废弃实验——两读数制是**现行判据的一部分**（稳定对对照）。

### G4 · 环 3 / 合成域的薄覆盖活模式（owner：`propose-clusters.mjs` / `synthesize-antipatterns.mjs`）

以下 6 旗标在**测试与文档中零引用**（计数器盲区提示），本次**逐个冒烟实跑**确认在役：

| 旗标 | 冒烟结果（实测） | 判定 |
|---|---|---|
| `--chapter`（单章调试） | ✅ 计划 1 次调用、39 对象正常列出 | 在役；**建议补一条测试**（覆盖缺口而非删除理由） |
| `--list`（主题清单） | ✅ T01/T02… 正常列出 | 在役 |
| `--themes` / `--max-patterns` / `--max-tokens` | 文档 1–3 处引用，代码路径未被删除 | 在役（手动旋钮） |
| `--plan`（apply-resplit） | ✅ 干跑复算「afterword-s1 → chapter9-s2」在役 | 在役（rust 重放即用它） |
| `--receipt`（build-skill 单章逃逸口） | 运行时 `flags.receipt` 分支完整 | 在役（旁路模式） |

### G5 · 发布 / 冻结面（owner：`build-task-suite.mjs` / `freeze-outputs.mjs` / `publish-task-suite.mjs`）

| 名称 | 生产取值 | 状态 |
|---|---|---|
| `--publish` | 缺省 **不发布**（staging only） | 在役（安全默认） |
| `--bundle` / `--manifest` | 缺省主套件清单 | 在役（卡 29） |
| `--verify`（冻结校验） | 只读 | 在役（35 处文档引用） |
| `publish-task-suite`（30→19 迁移器） | 幂等；本仓已迁移态 | **在役但一次性**：新书不用（runbook 已注明）；保留为历史迁移的可复核工具 |

### G6 · run-book 编排面（owner：`run-book.mjs`）

`--file` / `--from`（回执查询模式，3+5 测试）、`--concurrency`（4 测试）、`--verify-isolation`（2 测试 + 15 文档）、
`--no-ledger`——全部在役。**移除判定：0。**

### G7 · 「全量上线」机制（曾可选/现在无条件生效）及其残骸核验

| 机制 | 上线点 | 残骸核验（反向搜索） | 结果 |
|---|---|---|---|
| 产物按源命名空间 | 卡 19–22 | 搜旧固定名直读路径（`'antipatterns.objects.json'` 字面量等） | 零残骸（卡 31 已清 `CROSS_CHAPTER_OBJECTS_FILE` 别名） |
| 源条件骨架（ADR-029） | 卡 19 | 搜「配套代码段按旧硬要求」分支 | 零残骸（`codeSource.available` 为动态判定，非旧开关） |
| ADR-021 双口径开关退役 | 卡 10 期 | 搜 `dualCount/strictSectionCounts/legacySectionCounts` | **零残骸**（注释说明「开关已删除」属实） |
| 字面保真条款 | 卡 28 | 搜旧 3 份外的条件注入分支 | 无「开关」——是三份工作流正文的常量 |
| 任务套件为发布面 | 卡 26 | 搜 `chapter-suite` 触发桩/别名 | 零残骸（无别名策略，ADR-031） |

### G8 · 废弃注释存量（owner：各处）

7 处「作废/遗留」字样**全部是解释性注释**（说明历史决策为何如此、防止后人重开旧歧义），
**没有一处背后藏着休眠开关**。逐条：`build-skill.mjs:593`（双口径）、`verify-skill.mjs:52`（同上）、
`propose-clusters.mjs:346`（partial 身份失效语义）、`antipattern-synthesis.mjs:36`（身份拦截语义）等。
**动作：保留（它们是判据演化的审计轨迹）。**

### G9 · CPU 开销实测（当机数字，非估算）

| 路径 | 实测 | 判定 |
|---|---|---|
| `build-task-suite --dry-run`（17 成员全量装载+渲染+门禁一） | **0.56s** total | 可接受 |
| `run-gate3 --dry-run`（按源枚举） | 0.06s | 可接受 |
| `findLatestReceipt`（79 回执全目录扫描） | **11.6ms/次**（miss 情形最贵） | 单次套件构建合计 ≈0.3s；**可选优化**：会话内缓存 receipt 索引（不改行为），收益仅在大书（200+ 候选）时可见 |
| `buildAnchorIndex`（rust 单章） | 0.4ms/次 | 可接受 |
| `screenCandidates`（逐候选 spawn CLI） | 每候选 ~80ms 进程启动开销 | 30 候选 ≈2.5s；**设计如此**（隔离子进程是审计签字面），不动 |

**「昂贵的无用判断」搜寻结果：未发现。** 最大的单点（回执扫描）是承重判据（「没有回执 ≠ 通过」），
只是实现上可缓存——标注为可选优化而非无用判断。

---

## 3. 明确排除（不是开关面，是证据面——保留）

`analysis/`（ADR-018 明文引用的**冻结基线工具** `quote-gate-measure.mjs` + 源剖析）、
`benchmark/`（对照镜像）、`sources/`（源与镜像清单）、`pipeline/registry/{history,legacy-published,rejected}/`
（归档与拒绝证据）、`pipeline/curation/`（策展定义）——审计时未把它们当「配置」对待。

## 4. 并行处理分组（若未来执行任何简化，按此拆工）

| 组 | 文件工作流 | 组内清单 | 独立性 |
|---|---|---|---|
| A | `run.mjs` + `llm-client.mjs` | G1/G2 全部（判定：保留） | 独立 |
| B | `run-gate2/3` + `gate{2,3}-*` | G3（保留）+ G4 的补测试建议 | 独立 |
| C | `propose-clusters` + `synthesize-antipatterns` | G4 剩余（保留） | 独立 |
| D | `run-book` + 发布/冻结族 | G5/G6（保留；G5 的可选 receipt 缓存） | 独立 |

**当前结论下，四组均无必须执行项**——本表的意义在于：一旦要补测试或做可选缓存，四组互不依赖，可并行。

## 5. 复核命令

```bash
# ① Statsig 类资产零命中（复跑）
grep -rniI "statsig\|launchdarkly\|unleash\|optimizely\|feature.?flag" pipeline/ docs/ README.md | grep -v history
# ② 旗标交叉计数（重生成 §1 表 2 的来源数据）
# ③ 薄覆盖模式冒烟
node pipeline/propose-clusters.mjs --chapter chapter4 --dry-run | tail -1
node pipeline/synthesize-antipatterns.mjs --list | head -1
# ④ CPU
time node pipeline/build-task-suite.mjs --dry-run >/dev/null
```