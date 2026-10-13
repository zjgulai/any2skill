# 11：环 3 语义聚类与 SkillCandidate（内容单元 → 候选）

**要构建什么：**把 593 个门禁一通过的知识对象切成**内容单元**（同章 + 同问题空间），再把内容单元聚成**候选 skill**，落盘 `clusters.json` 与 `skill-candidates.json`——并让**至少一个候选真的经环 4 装出 SKILL.md**。这一步把「对象能装配成 skill」的链路从「手工指定一个文档子树」推进到「由划分算法决定切哪里」。

**为什么这一卡非独立不可（实测）：**

- `clusters.json` / `skill-candidates.json` 在盘上**不存在**（ADR-019 开工时逐项 `[ -e ]` 检查，环 3–5 的产物全缺）。
- 环 4 当前只认 `--root-anchor`（一个文档子树），全盘唯一发布的 skill 是手工挑的 `chapter4#h2-2`——**「切哪里」这个决策至今没有任何机制产出**，是链路中间断掉的一环（ADR-019 决策 2 已声明「真正的语义聚类属环 3，本版不假装实现了它」）。
- 门禁二（环 5，卡 12）的「≥2 个 skill 争抢同一场景 → 粒度太碎」判据，需要一个**真实的划分**作为被检验对象；没有环 3 的产出，门禁二只能对着一个 skill 空转。
- ADR-007 的对照诊断（原书 22 skill / 10 章 ≈ **2.2 skill/章**）要有实际划分数字才能做。

**被谁阻塞：**09（已达成：13/13 完成、593 个通过对象在盘、隔离三轮验证通过）。**无阻塞，可开工。**

**原料规模（2026-10-12 回执口径，`book-07faf309c5a1`）：**对象 604（通过 593 / 拒绝 11）；逐文件 5–82 条；类型分布 Concept 265 / EngineeringRule 231 / AntiPattern 44 / Heuristic 31 / MentalModel 10 / DecisionModel 8 / Case 7 / Metric 5 / Playbook 3。

**状态：**已建成并通过端到端验收（2026-10-12，见文末两段构建记录）；两处留注见验收勾选（专项分析按 ADR-001 缓办；切片未触发）。

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

- [x] `pipeline/knowledge/clusters.json` 落盘：两级（内容单元 / 簇），每级含成员对象 id 与**聚类依据**（因何聚在一起），划分可复核
- [x] **零静默丢弃**：每个门禁一通过的对象恰属于一个内容单元；未归类者进显式清单并带理由（口径承卡 09「一个都不静默跳过」）——真实运行实测：593 全归类，四件套（未归类/未解析 id/重复归属/无候选单元）**全零**
- [x] `pipeline/registry/skill-candidates.json` 落盘：`skillId` / `sourceObjects[]` / `trigger` / `chapterRefs[]` / `promotionState`（字段名照 MVP 计划 §4.2，不加私有别名）
- [x] **端到端可证伪点**：`chapter4-s1` 经环 4 装出 `skills/chapter4-single-tool-design/SKILL.md` 并通过门禁一（见「真实段」记录；同批 s2/s3 干跑也过，s4 被 `SECTION_EMPTY` 正当地拒）
- [x] 事后偏差诊断：35 个章级候选 / 10 章 vs 基准 2.2（**+59%**）。**专项分析按 ADR-001 缓办**：该分析属基准比对（读 `benchmark/`、产出冻结后、由独立于构建者的 agent 做），本轮不读、不代析
- [x] 跨章综合物处置结论落盘（含依据）：14 条 = 7 条跨 ≥2 章 → `independent-candidate-pending-gate2`（「≥3 个独立场景」标为未验证条件）+ 7 条单章 → `distribute-to-pitfalls`
- [x] 身份与复用：复用键 = 真实要发出的两条提示词 + 模型 id（含章标题）；真实产物上复验 **13/13 可复用、计划调用 0 次**；键随提示词/对象/模型变化（有测试）
- [x] 成本有界：调用次数与 token 逐章 + 顶层进产物（真实运行 13 次 / 42,673 输入 / 167,074 输出 token）；**切片策略未实现**——实测最大章提示词仅 9,726 字符，未触发该需要（承 ADR-017 的立场：本书语料上不可测的事不预先造机制）；截断（`finish_reason=length`）检测与告警有测试
- [x] 隔离不破：真实运行挂卡 09 的账本——640 条访问，`benchmark/` 内容访问 0、`skills/` 写入 0，`assertIsolation` 通过
- [x] 测试：全部离线（LLM 路径用注入替身）；上面每一条都有对应用例（本卡新增 34 条：cluster-proposer 24 + 环 4 入口 8 + 判据修正 2）

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

## 构建记录（2026-10-12，离线段）

### 建成的东西

| 文件 | 作用 |
|---|---|
| `pipeline/tools/cluster-proposer.mjs`（新） | 提示词/解析/复用键/校核四件套/候选派生/跨章处置/诊断/落盘 |
| `pipeline/propose-clusters.mjs`（新） | CLI：门禁过滤 → 逐章调用（可复用）→ partial 续跑 → 两份正式产物 |
| `pipeline/build-skill.mjs`（改） | 新入口 `--cluster <skillId>`：按 `clusters.json` 的簇定义装配，复用装配管线与门禁一 |
| `pipeline/tools/test/cluster-proposer.test.mjs`（新，24 用例） | 压缩/键/校核四件套/候选/处置/诊断，全离线（注入 chat 替身） |
| `pipeline/tools/test/build-skill-cluster.test.mjs`（新，8 用例） | 环 4 簇入口端到端（临时仓库根 + 真实 chapter4.md 的锚点） |

### 离线验证（实测）

- `npm test` → **489 通过 / 0 失败**（2026-10-12；本卡新增 32 条）。
- 真实仓库 dry-run：13 章、门禁通过 **593**、除外 **11**（与回执逐格一致）；
  用户提示词 779–9,726 字符/章（合计约 74 KB）；**计划调用 13 次**。
- 隔离（卡 09 的账本工具跑 dry-run）：1 份账本 / **608 条访问**；
  `benchmark/` 内容访问 **0**、`skills/` 写入 **0**，`assertIsolation` 通过。

### 尚未做（真实段）

1. 13 次真实章级调用 → `clusters.json` + `skill-candidates.json` 落盘（含真实 `usage`）。
2. 端到端：至少一个候选经 `--cluster` 装出 SKILL.md 过门禁一（或如实记录为什么不过）。
3. 逐条验收核对 + README 状态终稿。

## 构建记录（2026-10-12，真实段）

### 全书聚类（13 次真实调用）

| 口径（源：`clusters.json` / `skill-candidates.json`） | 值 |
|---|---|
| 规模 | **13 章 / 115 单元 / 40 候选**（章级 35）；门禁通过 593 条全归类 |
| 四件套 | 未归类 **0** / 未解析 id **0** / 重复归属 **0** / 无候选单元 **0** |
| 成本 | 13 次调用，输入 **42,673** / 输出 **167,074** token（推理占约 85%） |
| 单元尺寸 | min 1 / p50 5 / max 12；候选含 2–7 个单元 |
| 隔离 | 640 条访问；`benchmark/` 内容访问 0；`skills/` 写入 0 |
| 复用复验 | 同一产物再 dry-run：13/13 键一致、**计划调用 0 次** |

dry-run 阶段预估 4–5 万输入 / 15–19 万输出，实测落在带内——预估与实测对齐。

### 端到端：第一个由「划分」而非「手挑子树」装出的 skill

```
node pipeline/build-skill.mjs --cluster chapter4-s1 \
  --slug chapter4-single-tool-design --title "单工具设计与审查"
→ 门禁一：通过；已发布 skills/chapter4-single-tool-design/SKILL.md
  （随契约带 12 条缺口 + 风险标记 PITFALL_COVERAGE_BELOW_ADVISORY，照旧如实披露）
```

同批干跑：s2/s3 通过、**s4 被 `SECTION_EMPTY` 拒**——s4「多模态感知与内容读取」那簇没有反模式来源，
「常见陷阱」段为空。这是划分需要门禁反馈的**第一个真实信号**（ADR-007 的「门禁反向修正划分」回路
第一次有东西可修）：s4 应并入邻近候选，或从跨章反模式池补来源——留给门禁二落地时一并处理。

### 端到端暴露的判据修正：ADR-025

真实装配第一次把 `## 实践模式` 的计数缺陷打了出来：条目是**加粗小节头**（每概念一条），
示例是子行，而旧口径 `max(列表项, 加粗行)` 让多示例的概念被误报 `SECTION_COUNT_OUT_OF_RANGE`
（实测契约 3 / 列表项 10 / 加粗行 3）。已发布的 `chapter4-tool-design-principles` 只是恰好
每概念一个示例才没踩到。修正见 [`ADR-025`](../adr/ADR-025-section-item-kind.md)：
每段的条目种类写进骨架（`itemKind`），校验器按种类计；检查本身未放宽（丢一个概念仍会被抓，有测试）。

### 偏差诊断与缓办项

章级候选 **35** vs 基准 22（2.2/章）＝ **+59%**。按 ADR-007 本应专项分析差异原因，
但该分析属**基准比对**（要读 `benchmark/`，且按 ADR-001 须在产出冻结后由独立于构建者的
agent 做）——本轮不读、不代析，如实记在验收勾选里。可立即观察的（不涉基准）：
40 个候选里含 afterword/introduction/reference-answers 的 5 个非章候选；跨章合并 v1 刻意未做，
若干同主题候选（如 chapter4 的 s1/s3）在门禁二的「争抢」判定下可能会合并。
