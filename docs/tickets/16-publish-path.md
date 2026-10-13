# 16：打通发布门径（基准比对报告的主归因回应）

**要构建什么：**回应 [`02-benchmark-report.md`](../specs/02-benchmark-report.md) 对「22→2」的两条主归因，
把发布门径扩宽：① 其余章配套代码来源（**轻镜像**）；② 实现 ADR-004 的 **references 溢出阀**
（规格 2026-07 早已写定、从未实现）；③ 体积阈值**对齐信息源实测上限**（[`ADR-028`](../adr/ADR-028-size-limit-aligned-to-source.md)）。
目标：让重切后被门禁一拒掉的合并候选尽可能走到发布。

**为什么非独立不可（实测）：**比对报告的两条主归因有据可查——发布门径（27 个候选没走完全流程，
重切吸收者 1 过 10 拒）与来源缺口（配套代码段仅 chapter4 有镜像，非 chapter4 系必然 `SECTION_EMPTY`）；
而 12KB 阈值被实测证明**严于原书自身实践**（原书 5/22 超阈、最大 16,568B）。

**被谁阻塞：**无（卡 15 已达成，上游仓库可达已验证）。

**状态：**已达成（2026-10-13）。

## 拍板（两处用户拍板 + 一处重建实测后追加）

1. **镜像口径 = 轻镜像（只取 README）**：消费面（`collectCodePointers`）只需要「目录路径 + 一句说明」，
   说明取自各目录 README 首段——全量镜像不可能（十章合计约 1.2GB，chapter2 一章 389MB）。
2. **体积策略 = 实现 references 溢出阀**（ADR-004 决策 2），不抬阈值（当时）。
3. **追加（重建实测后）**：溢出后仍有 6 个超 12KB，其中 `chapter2-s3`（16,286B）**比原书最大的
   skill 还小**——用户拍板阈值对齐原书上限 **16,568B**（ADR-028）。

## 建成的东西

| 构件 | 内容 |
|---|---|
| 轻镜像 | `sources/ai-agent-book-zh/code/chapter{1,2,3,5,6,7,8,9,10}/`：**137 个 README（二级目录 100% 覆盖）**，每章 `MIRROR-MANIFEST.md` 带逐目录口径表 + 逐文件 sha256；取法 = blobless clone + 按需 `git show` 单 blob（pin 与 ADR-020 同） |
| 溢出阀 | 装配器两态渲染（`full`/`pointer`）→ 超限时「实践模式」整段进 `references/practice-patterns.md`，SKILL.md 保留加粗小节头 + 指针；契约增 `references`（带哈希）与 `overflow` 字段（schema 同步）；build-skill 暂存/发布**双写** references |
| ADR-028 | 阈值 12,288 → **16,568**（= 镜像清单里 `agent-evaluation/SKILL.md` 的实测字节） |
| 测试 | 溢出阀 4 条（收敛/未超限一字不动/确定性/stillOverLimit 如实标记）；全套 **553 通过 / 0 失败** |

## 重建判决（`pipeline/registry/rebuild-verdicts.json` v2，复算）

**11 个吸收者：7 过 4 拒**（v1 时代为 1 过 10 拒；v1 表见卡 13 构建记录）。

| 结果 | 候选 |
|---|---|
| ✅ 本次新发布 6 个 | `chapter10-s3`（15,650B）、`chapter1-s1`（14,579B）、`chapter5-s3`（14,112B，溢出）、`chapter3-s1`（13,419B，溢出）、`chapter2-s3`（16,328B，溢出）、`chapter9-s2`（8,713B） |
| ✅ 既有 | `chapter4-s1` → `chapter4-single-tool-design`（9,538B，卡 13 已发布） |
| ❌ 仍拒·内容缺口 | `chapter1-s2`、`chapter9-s3`：`SECTION_EMPTY@常见陷阱`——这两簇没有反模式来源 |
| ❌ 仍拒·体积 | `chapter7-s1`（21,914B，溢出自 28,259）、`chapter10-s1`（17,531B，溢出自 24,851） |

**发布区 2 → 8 个 skill。**

## 验收

- [x] 轻镜像：二级目录 100% 覆盖、逐文件哈希在册（每章清单内）、排除口径成文、只读纪律保留
- [x] 溢出阀按其 ADR-004 原文落地（「超出时把细节移入 references/，SKILL.md 保留骨架与指针」），且有可失败测试
- [x] 阈值数字**可追溯**：等于镜像清单内某文件的实测字节（`wc -c benchmark/upstream-skills/agent-evaluation/SKILL.md` → 16568）
- [x] 重建判决以复算产物落盘（`rebuild-verdicts.json` v2），非口头结论
- [x] 全程零模型调用、零 `benchmark/` 读取（重建为确定性命令）；既有发布物未被本次修订改动
- [x] 冻结不追改：`freeze-2026-10-13T11-52-41.json` 及其比对报告仍有效于其快照；**下次比对前需重新冻结**（已记入 README 状态）

## 未决（交给后续）

1. **二段溢出**：`chapter7-s1` / `chapter10-s1` 的剩余体积大头是 **principles 理由段**与**深度阅读逐锚点列表**——
   理由段入 references、深度阅读折叠为按文件，是候选做法；若仍不够，问题会回到「合并粒度超出骨架容量」（卡 13 议题）。
2. **两个内容缺口**：`chapter1-s2` / `chapter9-s3` 的陷阱段没有来源——靠跨章反模式池或进一步合并补。
3. ~~**新发布 6 个只过了门禁一**~~：**已由卡 17 处置**——门禁二第三读数本就覆盖这 6 个（登记表在卡 17）；门禁三已全量覆盖 8 个发布物，并**检出一次确认的 negative transfer**（chapter3-s1，按 ADR-006 拒绝下架，发布区 8 → 7）。
