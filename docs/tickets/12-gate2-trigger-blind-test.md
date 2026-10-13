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

**状态：**离线段已建成（2026-10-12，见文末构建记录）；**真实盲测待启动**。

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

- [ ] **盲测隔离是机制不是约定**：盲测者输入里只有场景 + `name` + `description`（乱序 + 代号）；
      正文、对象、units、来源、编组一概不进题面——并有**可失败的反证测试**（往题面注入正文时测试必须红）
- [ ] 场景集落盘且身份进指纹（同输入复用不重买；场景或描述变化 → 身份变）
- [ ] 三类判定逐条落盘：每个候选的 命中/零命中/被认领情况 + 每个无关场景的误触发情况
- [ ] **门禁二报告落盘**（含三类结论、逐候选明细、成本账；报告本身不改 `skill-candidates.json`）
- [ ] `promotionState` 的门禁二段状态机落地：候选 →（门禁二结论）→ `trigger-passed` /
      `trigger-conflict` / `trigger-miss`（命名可议，但**三态必须可区分**，为 ADR-024 未决 3 补上这段）
- [ ] **ADR-007 修正表被执行到「产出动作清单」为止**：争抢组 → 建议合并哪些候选；零命中 →
      建议并入哪家或降级；description 覆盖不住 → 建议拆分。本卡**只出清单不自动改划分**——
      改划分是环 3 的动作，单独立卡执行
- [ ] 真实运行跑一次全量盲测（140 次调用），报告与数字如实入卡
- [ ] 隔离不破：门禁二全程不读 `benchmark/`（账本工具跑一遍）
- [ ] 测试：全部离线（盲测调用用替身）；上面每一条都有对应用例
- [ ] README 状态终稿 + 风险标记的路由说明更新（`PITFALL_COVERAGE_BELOW_ADVISORY`
      首次有了下游：高风险抽样清单包含它）

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
