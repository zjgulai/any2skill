# 12：门禁二 · 触发盲测（环 5 上半）

**要构建什么：**给 40 个技能候选做一次**真实场景下的触发盲测**——盲测者只看到场景与各候选的
`name` + `description`（不给正文、不给来源、不给编组信息），回答「哪些 skill 会被这个场景触发」；
由此产出三类判定：**命中 / 零命中 / 争抢（同一场景被 ≥2 个候选认领）**，并把结论落盘成
门禁二报告。**这是 ADR-007「让门禁反向修正划分」回路的另一半**——环 3 负责切，门禁二第一次
给出「切得对不对」的可观测反馈。

**为什么这一卡非独立不可（实测）：**

- 40 个候选已落盘（`skill-candidates.json`），但**至今没有任何机制回答「它们找得到吗」**。
  `verify-skill.mjs` 文件头明文写着：「它能说『这个 SKILL.md 合不合规』，**不能**说
  『这个 skill 有没有用』——那是门禁二（触发盲测）与门禁三（效用 A/B）」。
- ADR-007 的修正表（争抢→合并、零命中→并入或降级、description 盖不住→拆分）与
  ADR-021 的风险标记（`PITFALL_COVERAGE_BELOW_ADVISORY` 按 ADR-006 路由到**门禁二/三的
  高风险抽样**）都挂着**没有下游消费者**——本卡是那个下游的第一半。
- 环 3 端到端已带出第一个待修正信号：`chapter4-s4` 被 `SECTION_EMPTY` 拒（该簇无陷阱来源）。
  门禁二报告将把「哪些候选该合并/该降级」从个案变成一次全场观测。

**被谁阻塞：**11（已达成：40 候选 + 触发语就位）。**无阻塞。**

**状态：**已建成并经两读数真实盲测验收（2026-10-12，见文末两段构建记录）；划分修正执行另立卡。

## 规格指针（真源，不在本卡复述）

| 路径 | 读它的理由 |
|---|---|
| [`ADR-006`](../adr/ADR-006-three-quality-gates.md) 门禁二一节 | 定义与三条硬约束：盲测者只给 `name`+`description`；独立 agent 实例；构建者不得自评 |
| [`ADR-007`](../adr/ADR-007-skill-partition-semantic-clustering.md) | 修正表：争抢→合并、零命中→并入或降级、description 覆盖不住的场景→拆分 |
| [`ADR-004`](../adr/ADR-004-skill-granularity-and-skeleton.md) | 粒度判据的语义：「两个 skill 该不该分开 = 是否回答同一类问题」 |
| [`ADR-024`](../adr/ADR-024-ring3-implementation-form.md) 未决 3 | `promotionState` 状态机随环 5 落地——本卡定义其中门禁二那一段 |
| [`00-mvp-plan.md`](../specs/00-mvp-plan.md) §6 / §10 | 门禁二验收标准：**有争抢/零命中的实测记录**（证明它真能发现问题，而非总是通过） |
| arXiv:2605.23899（ADR-006 已核实） | extractor/consumer 不相关性：盲测者与构建者必须是不同实例 |

## 可直接利用的既有物

- `skill-candidates.json`：40 个候选的 `skillId` / `name` / `trigger` / `sourceObjects` / `units` / `anchors`。
- **description 不另起炉灶**：盲测里展示的 `description` 用**装配器的 `buildDescription`**
  从同一批对象生成（离线、零模型）——盲测看到的即为发布产物会携带的描述，两者不漂移。
- 身份/复用/隔离的整套纪律（ADR-013/014/017 + 卡 09 的账本工具）照用，不另立。

## 已拍板（2026-10-12，决策全文与理由见 [`ADR-026`](../adr/ADR-026-gate2-implementation-form.md)）

1. **场景生成与盲测分离，场景集落盘 + 哈希进身份**：每候选 K=3 个应触发场景 + 20 个无关场景；生成侧可见内容，盲测侧不可见；生成与盲测是两次独立交互。拿候选 `trigger` 当场景被明确否决（循环：trigger 是题面的一部分）。
2. **列表式回答（可以为空）**：「这个场景会触发下列哪些 skill？」——命中/零命中/争抢直读；候选以乱序 + 不透出处的代号（`k01…k40`）呈现。
3. **全量 40×3 + 20 = 140 次调用**：争抢是全场关系判定，抽样看不见「谁抢谁」；成本靠候选目录前缀的服务端提示缓存压。

## 验收

- [x] **盲测隔离是机制不是约定**：盲测者输入里只有场景 + `name` + `description`（乱序 + 代号）；
      正文、对象、units、来源、编组一概不进题面——并有**可失败的反证测试**（往题面注入正文时测试必须红）
- [x] 场景集落盘且身份进指纹（同输入复用不重买；场景或描述变化 → 身份变）——真实运行复验：
      严格读数复用 108/140 场景，两次瞬断/空响应全部由逐条 partial 接住，**零重复付费**
- [x] 三类判定逐条落盘：每个候选的 命中/零命中/被认领情况 + 每个无关场景的误触发情况
- [x] **门禁二报告落盘**（`gate2-report.json` + `gate2-report.strict.json`；未改 `skill-candidates.json`）
- [x] `promotionState` 的门禁二段状态机落地：三态 `trigger-passed` / `trigger-conflict` /
      `trigger-miss` 逐候选落进报告（为 ADR-024 未决 3 补上这段）
- [x] **ADR-007 修正表执行到「产出动作清单」为止**：两读数合计产出 merge / merge-or-demote /
      route-to-risk-sampling 三类清单；**未自动改划分**（见「校准结论」里的稳定对清单）
- [x] 真实运行：两读数共 320 次盲测调用（140 宽松 + 140 严格 + 40 生成复用），数字如实入卡
- [x] 隔离不破：门禁二全部运行账本 **6 份 / 13,152 条**访问（dry-run 1 + 宽松读数 2 + 严格读数 3），
      `benchmark/` 内容访问 0、`skills/` 写入 0，`assertIsolation` 通过
- [x] 测试：全部离线（盲测调用用替身）；上面每一条都有对应用例（本卡新增 29 条：gate2 24 + 传输修复 3 + 其他 2）
- [x] README 状态终稿 + 风险标记路由说明（`route-to-risk-sampling` 动作种类已实现；两读数都是
      0/20 无关误触发，故本轮未触发路由——如实记录为空，不粉饰）

## 核实方式（开工前先跑）

```bash
cd /Users/lute/Project/any2skills

# 40 个候选在盘（现状基线）
node -e 'const d=require("./pipeline/registry/skill-candidates.json");console.log(d.candidates.length, d.candidates.map(c=>c.skillId).slice(0,4).join(",")+"…")'

# 门禁二尚不存在（期望 ENOENT）
ls pipeline/registry/gate2-report.json 2>&1

# 盲测的题面素材只有 name+description（描述由装配器离线生成）
node -e 'import("./pipeline/tools/skill-builder.mjs").then(m=>console.log(typeof m.buildDescription))'   # function

# agents/ 目录也还不存在（ADR-002 结构里预留）
ls agents 2>&1
```

## 构建记录（2026-10-12，离线段）

### 建成的东西

| 文件 | 作用 |
|---|---|
| `pipeline/tools/gate2-blind-test.mjs`（新） | 两段提示词（场景生成/盲测）、解析与校核（名称泄漏、未知代号逐条记录）、确定性乱序与代号、判分与 ADR-007 动作清单、三个身份键的单一真源 |
| `pipeline/run-gate2.mjs`（新） | CLI：候选加载（描述走装配器同源）→ 场景生成（逐候选复用）→ 盲测（逐场景复用）→ 报告；`--dry-run` 零调用零写盘 |
| `pipeline/build-skill.mjs`（改） | 抽 `loadAssemblyInputs` / `clusterFromCandidate` / `antipatternIdentityWarning`——**门禁二与环 4 走同一条加载与门禁过滤路径**，被测对象 = 发布对象 |
| `pipeline/tools/skill-builder.mjs`（改） | `skillId` 兜底修雷：旧式 `CHAPTER4-${split('#')[1]}` 对不含 `#` 的根锚点（簇模式 skillId）直接崩、且前缀写死与章节无关；改为从根锚点派生 |
| `pipeline/tools/test/gate2-blind-test.test.mjs`（新，22 用例） | 白名单反证、校核、确定性乱序、判分与动作清单、身份键、CLI 干跑 |

### 离线验证（实测）

- `npm test` → **513 通过 / 0 失败**（本卡新增 22 条）。
- 真实仓库 `--dry-run`：40 个候选；**计划调用 41（生成）+ 140（盲测）= 181 次**；
  生成侧输入合计约 56,512 字符；描述由装配器生成（与发布产物同源）。
- **白名单是机制且有反证**：向目录条目塞入正文/出处/引文哨兵与 skillId，题面逐一断言不出现——
  谁把题面改成直吐整个候选对象，这组测试立刻变红。
- 隔离（卡 09 的账本工具跑 dry-run）：1 份账本 / **2,084 条访问**；`benchmark/` 内容访问 0、
  `skills/` 写入 0，`assertIsolation` 通过。

### 尚未做（真实段）

1. 181 次真实调用（场景生成 + 盲测）→ `gate2-scenarios.json` 与 `gate2-report.json` 落盘。
2. 逐条验收核对（三态状态机、动作清单、隔离复核）+ README 终稿；报告出来后再看
   s4 类划分修正是否要立执行卡。

## 构建记录（2026-10-12，真实段）

### 两读数（同场景、同目录，只换盲测口径）

| 口径 | 答案列表长度分布 | 被共认领场景 | 平均组规模 | 三态 | 无关误触发 |
|---|---|---|---|---|---|
| `list`（读一） | 0:4 1:20 2:37 3:28 4:12 5:12 6:3 7:2 8:2 | 96/120 | 3.27 | 通过 0 / 争抢 40 / 零命中 0 | 0/20 |
| `strict`（读二，至多 2 个） | 0:3 1:39 2:78（超限 0） | 78/120 | 2.00 | 通过 1 / 争抢 38 / 零命中 1 | 0/20 |

### 校准结论（本页是这一卡最有价值的部分）

- **宽松口径有相当一部分是格式产物**：68 个共认领对只在 list 出现、5 个只在 strict（噪声）。
- **但争抢的核心是真的**：**87 对共认领在两读数都存活**——把答案压到至多 2 个后，
  仍有 78/120 场景被双认领。「一批候选的描述彼此覆盖」不是口径幻觉。
- 每候选被共认领场景数（strict）：全 0 的 2 个、1 个的 10 个、2 个的 16 个、3 个的 12 个——
  **分级信号回来了**（读一里人人 96/96，无区分力）。
- **同章兄弟稳定对**（簇边界模糊的热点）：`chapter1-s2|s4`、`chapter10-s2|s3`、`chapter3-s1|s3`、
  `chapter4-s1|s4`、`chapter7-s1|s2`。
- **跨章稳定对**（ADR-024 决策 1 留给门禁二的跨章合并证据·第一批）：`chapter1-s3|chapter4-s2`、
  `chapter1-s1|chapter2-s1`、`chapter1-s1|chapter4-s1`、`chapter2-s3|chapter4-s2`、
  `chapter5-s3|reference-answers-s1`、`chapter10-s1|chapter2-s1`、`afterword-s1|chapter9-s2`。
- **最强单点信号**：`chapter10-s2`「可靠性验证与失效治理」strict 下**零命中**——自己的 3 个场景
  全被 chapter10-s3 / chapter5-s3 / chapter5-s2 / chapter7-s2 认领、无一回选它 → merge-or-demote。
- `chapter4-s4` 有**两个独立信号**：门禁一判 `SECTION_EMPTY`（卡 11 记录）+ 与 `chapter4-s1`
  的稳定共认领——都指向「并入 s1」。
- 唯一 `trigger-passed`：`chapter6-s2`「语音实时交互」（窄主题；与「清洁度 ∝ 主题稀有度」的观察一致）。

### 三次瞬时故障与一次全仓修复

1. 空响应（首次全量 27/40 处：`finish_reason=stop` 而正文为空）→ 续跑接住；
2. 传输中断 `terminated`（读二 41/140 处）→ 续跑接住；
3. 再次 `terminated`（读二 108/140 处）→ 触发根因排查：`llm-client.mjs` 的 `await res.text()`
   **不在任何 try/catch 里**——fetch 成功、响应头已到、正文读到一半断连时，不重试、不包装、裸抛
   （而 fetch 本身失败是有重试与包装的）。已修复并单独提交（`bd1fa12`，回归测试 3 条），续跑一次走完。

**这一串是「逐条 partial」设计的真实验收**：三次故障、零重复付费；且第三次把「续跑能救」
升级成了「根因被修掉」。

### 成本（源：两份报告的 `usage`）

- 场景生成：47,558 输入 / 78,972 输出 token（40 候选 + 1 无关；chapter4-s1 场景复用）。
- 读一（list）盲测：534,767 / 591,196；读二（strict）盲测：531,687 / 217,646（答案变短，输出省 65%）。

### 动作清单（报告已含；**未执行**，执行另立卡）

优先级建议：`chapter10-s2`（miss+稳定对）→ `chapter4-s4`（双信号）→ 同章兄弟稳定对 →
跨章稳定对（回到 ADR-024 决策 1 的跨章合并议题）。`route-to-risk-sampling`：两读数都是
0/20 无关误触发，本轮为空——如实记空，不粉饰。
