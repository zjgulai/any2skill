# 17：新发布物补齐门禁二/三记录

**要构建什么：**卡 16 一次放行了 6 个新发布物（只过了门禁一）。本卡让**已发布的 8 个 skill
全部有门禁二与门禁三的可查记录**——发布门径只挡门禁一，这是流程的既定语义；补记录不是补流程，
而是让后续任何「这个 skill 该不该继续在发布区」的讨论有据可依。

**被谁阻塞：**无（16 已达成；门禁二第三读数与门禁三机制均在盘）。

**状态：**已达成（2026-10-13）——含一次**确认的 negative transfer** 与按 ADR-006 的执行拒绝。

## 关键事实：门禁二**已经覆盖**这 6 个，不需要重跑

门禁三是测**发布物**；门禁二测的是**候选划分**——而这 6 个发布物就是重切后的吸收者，
**第三读数（strict）的 29 个候选里包含它们**。既成记录（源：`gate2-report.strict.json`）：

| skill | 门禁二状态（第三读数） | 命中 | 被共认领 |
|---|---|---:|---:|
| chapter10-s3 | trigger-conflict | 3/3 | 1/3 |
| chapter1-s1 | trigger-conflict | 2/3 | 3/3 |
| chapter5-s3 | trigger-conflict | 2/3 | 3/3 |
| chapter3-s1 | trigger-conflict | 3/3 | 2/3 |
| chapter2-s3 | trigger-conflict | 2/3 | 1/3 |
| chapter9-s2 | trigger-conflict | 3/3 | 2/3 |

**读法**：命中不是问题（2–3/3）；冲突是弥散性的（与第三读数整体口径一致——共认领不是等价关系，
下一层是描述收敛，与本卡无关）。这张表就是这 6 个的门禁二记录。

## 本卡的实际工作：门禁三扩样到全部 8 个

- `run-gate3.mjs` 全量跑（被测物 = `skills/` 下的发布物全集）；2 个旧发布物
  任务与两臂执行按身份复用（0 重复付费），6 个新的 × 13 ≈ **78 次新调用**。
- 判定规则与口径照 ADR-027（退化复跑制、声明式检查单、n 小如实标注）。

## 验收

- [ ] 门禁三全量覆盖 8 个发布物；`gate3-report.json` 含全部判定与成本账
- [ ] 本卡的门禁二登记表与 `gate2-report.strict.json` 逐格一致（可复算）
- [ ] 退化事件（若有）走复跑确认路径；结果如实
- [ ] 隔离账本复核
- [ ] README 状态同步 + 卡 16 未决 3 的处置标注

## 构建记录（2026-10-13，真实段）

### 门禁三全量：8 个发布物

| skill | 判定 | 改进 | 确认退化 | 噪声 | 无效任务 |
|---|---|---:|---:|---:|---:|
| chapter1-s1 | **passed** | 2 | 0 | 1 | 2 |
| chapter10-s3 | **passed** | 1 | 0 | 0 | 4 |
| chapter4-single-tool-design | **passed** | 1 | 0 | 1 | 1 |
| chapter5-s3 | **passed** | 1 | 0 | 0 | 3 |
| chapter2-s3 | low-utility | 0 | 0 | 0 | 0 |
| chapter4-tool-design-principles | low-utility | 0 | 0 | 0 | 1 |
| chapter9-s2 | low-utility | 0 | 0 | 0 | 1 |
| **chapter3-s1** | **rejected** | 0 | **1** | 0 | 0 |

**MVP 验收第 3 条的完成形态到位**：此前是「**排除**一次 negative transfer」，本轮
**检出**了一次并执行拒绝——门禁三「唯一能检出 skill 有害」的定位第一次有真实产出。

### 确认的 negative transfer：chapter3-s1「用户记忆体系设计」

- 任务 `chapter3-s1-t2`：按 `user_data.json` 设计记忆存储方案；检查单要求
  `storage_plan.json` 的 `/plan/{0,1,2}/recommended_format` 为规定值。
- 首轮：无 skill 臂过、有 skill 臂败（mode 对、数组项结构被改，字段为 `undefined`）；
  **复跑复现**（无再过、有再败）→ ADR-027 复跑制判「确认退化」。
- 机制如实记录：该 skill 的词汇体系把输出结构带离了任务显式要求的字段命名——
  这正是确定性检查单设计来抓的漂移。n=2 复现是判定依据，样本小仍是事实。
- **处置（ADR-006 硬约束：必须拒绝）**：`git mv skills/chapter3-s1
  → pipeline/registry/rejected/chapter3-s1`（**移动而非删除**，附 `REJECTION.md`
  全证据，可恢复）。发布区 **8 → 7**。

### 顺带得到的质量信号（如实记录，未处置）

- **无效任务率偏高**：chapter10-s3 4/6、chapter5-s3 3/6、chapter1-s1 2/6——两臂都败，
  绝大多数是**逐字术语检查**（「静默注入」式）抓到两臂都没用原词。这是检查单表达力的
  第二批实测数据（ADR-027 未决 1）：任务生成该被要求「同一含义允许多种措辞」或改用
  更鲁棒的结构检查。
- 运行中的一次截断（chapter5-s3-t4 推理吃满 16,000 上限）→ 上限抬到 32,000
  （实测驱动，注释在常量处），partial 续跑零重复付费。

### 隔离与成本

- 账本 2 份 / 2,141 条；`benchmark/` 内容访问 0、`skills/` 写入 0（发布区变更全部经
  build-skill/git，不在账本进程内）；`assertIsolation` 通过。
- 成本：任务生成 27,329+71,704；执行 178,999+389,521 token（含 2 个旧发布物复用后的
  全量 8 个）。

## 核实方式

```bash
cd /Users/lute/Project/any2skills
node -e 'const s=require("./pipeline/registry/gate2-report.strict.json");const six=["chapter10-s3","chapter1-s1","chapter5-s3","chapter3-s1","chapter2-s3","chapter9-s2"];for(const id of six){const c=s.perCandidate.find(x=>x.skillId===id);console.log(id,c.promotionState,c.hits+"/3")}'
node -e 'const r=require("./pipeline/registry/gate3-report.json");for(const s of r.skills)console.log(s.slug,s.verdict.verdict)'
ls skills/ | wc -l                        # 7（chapter3-s1 已移入 registry/rejected/）
```
