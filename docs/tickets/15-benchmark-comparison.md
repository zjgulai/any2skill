# 15：基准比对（产出 vs 原书 22 个）——MVP 验收 4

**要构建什么：**由**独立于构建者的会话**执行一次「产出 vs 原书 22 个 skill」的比对，
产出 `docs/specs/02-benchmark-report.md`（ADR-019 列表里长期缺失的那个路径）：
数量与粒度的对照、主题级映射表、结构复核、以及**显著差异的归因分析**——MVP 验收第 4 条
「与 `benchmark/` 22 个对照后差异可解释」的落点。

> ⚠ **本卡由构建会话起草，不得由构建会话执行。** ADR-001 / ADR-006 明文：
> 基准比对者必须是**独立于构建者的 agent 实例**（构建者不得自评）。执行者拿到的是
> 下述协议与本仓文件，不携带构建过程的上下文。

**为什么非独立不可（实测）：**本仓为这一刻备了三件东西——`benchmark/upstream-skills/`
的 23 文件镜像（逐文件哈希在册，2026-10-13）、产出冻结机制（`freeze-outputs.mjs`，
可复算「比的是哪一版」）、以及 ADR-007 早就立下的硬约束：**数量差异显著时必须专项分析、
不得简单归因于「质量不够」**。三者都指向同一个要求：比对是个有协议、有证据、可复核的动作。

**被谁阻塞：**无——对照物与冻结面均已就位（本卡是「等一个独立执行者」的状态）。

**状态：**未开工（协议就绪，等待独立会话执行）。

## 前置（均已就位，执行前先验证）

| 项 | 位置 | 校验命令 |
|---|---|---|
| 对照物 | `benchmark/upstream-skills/`（22 skill + README，23 文件哈希在册） | 见 `MIRROR-MANIFEST.md` |
| 产出冻结 | `pipeline/registry/freeze-2026-10-13T11-52-41.json`（13 文件，commit c52856d） | `node pipeline/freeze-outputs.mjs --verify <冻结文件>` |
| 三门禁状态 | `gate2-report{,.strict}.json` / `gate2-stable.json` / `gate3-report.json` | 冻结面包含它们 |
| 划分与候选 | `clusters.json`（29 候选）/ `skill-candidates.json` | 冻结面包含它们 |

## 比对协议（执行者的操作规范）

**0. 开工先校验冻结**：`--verify` 必须通过（漂移即停——比对不得在漂移状态上进行）。
   收尾时再跑一次同样的命令，作为「未修改任何被比对物」的收尾证据。

**1. 只读**：不得修改任何产出、`benchmark/` 内文件、或冻结文件本身。产出就是
   `docs/specs/02-benchmark-report.md` 一份（外加可选的工作用临时文件，不入库）。

**2. 四个比对维度**（每条都要给出**可复核的证据**——文件路径 + 命令/字段，而不是印象）：

| 维度 | 怎么比 | 产出 |
|---|---|---|
| 数量与粒度 | 原书 22 个 vs 我们的发布物（2 个）与候选划分（29 个，见 `clusters.json` / `resplit` 块） | 计数对照 + **差异归因分析**（ADR-007：不得归因「质量不够」了事） |
| 主题映射 | `benchmark/upstream-skills/README.md` 的章节映射表 ↔ 候选的锚点章节（`clusters.json` 各单元 `anchors`） | **映射表**：每个原书 skill ↔ 我方候选；允许「无对应 / 多对一 / 一对多」，每格写依据 |
| 结构 | 双方六段骨架 | 两侧命中率（我方已有门禁一全量记录；原书 22/22 已在镜像核验） |
| 质量边界 | 双方不可直接比的部分要**明说**（原书是人工写作、跨章取用；我方是自动提取 + 门禁，且跨章合并两轮后才 29 个候选） | 「不可比项」清单 |

**3. 结论必须引用状态而非印象**：我方侧的一切论断以三道门禁的**报告产物**为准
   （门禁二的两读数与重切第三读数、门禁三的 passed/low-utility、风险标记），
   执行者不重新跑任何模型。

**4. 已知的口径边界（写进报告，不要隐藏）**：
   - 我方只有 **2 个已发布 skill**（另有 10 个合并候选被门禁一以体积/来源拒）——
     与 22 个的差距**首先要在「发布门径」与「来源缺口」上归因**，而不是只谈提取能力；
   - 跨章合并是门禁二反馈后执行的（卡 13），第三读数显示**部分消解**；
   - 原书的 22 个是**人工写作、可跨章取用**（ADR-004/021 的实测），与我方的
     自动提取在同一条产线上不可直接对齐——这一点在 ADR-021 里已有结论。

## 验收

- [ ] 开工与收尾各一次 `freeze-outputs --verify` 通过（收尾那次是「未修改被比对物」的证据）
- [ ] `docs/specs/02-benchmark-report.md` 落盘：四维度齐备，映射表逐格带依据
- [ ] **数量差异有专项归因**（ADR-007 硬约束），归因引用具体产物与门禁状态
- [ ] 无任何产出/benchmark/冻结文件被修改（`git status` 与收尾校验双重为证）
- [ ] 报告不引用未核实数字（承 ADR-006 的引用纪律；46.4% 那条禁用）

## 给执行会话的现成入口（用户复制即可开新会话）

```text
读 docs/tickets/15-benchmark-comparison.md 并按其中的比对协议执行
（你是独立于构建者的会话；先跑冻结校验，只读，产出 docs/specs/02-benchmark-report.md）。
```

## 核实方式（起草者自检）

```bash
cd /Users/lute/Project/any2skills
ls benchmark/upstream-skills | wc -l                      # 24（22 skill + README + MANIFEST）
node pipeline/freeze-outputs.mjs --verify pipeline/registry/freeze-2026-10-13T11-52-41.json
node -e 'const c=require("./pipeline/registry/skill-candidates.json");console.log("候选",c.candidates.length)'   # 29
```
