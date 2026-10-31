# G1-B 批准 marker（2026-10-31）

- 批准范围：G1-B 记忆域：16 条四层记忆（L1 4 / L2 4 / L3 6 / L4 2），源 tools/dev/distill-memories-to-nmem.mjs MEMORIES
- 批准方式：会话内四选项确认，用户选择「批准（推荐）」（四域 A/B/C/D 全部批准）
- 批准材料：docs/tickets/34-nmem-g1-approval.md

## 扩围记录（2026-10-31，Q4 二批）

用户拍板「继续 Q4 补充第二批记忆」（会话内直接指示）。二批 +6 条：
any2skills-l1-05（噪声带归因）、l2-05（开关面审计）、l2-06（提示词包试用状态）、
l3-07（历史拒绝处置）、l4-03（工程收口快照）——共 22 条策展记忆。
全部先 dry-run 校验（unit_type/字数/句数/source 路径）后写入，检索 Top1 均 0.99。
另发现并确认：library add 会触发服务端自动切片（34 条 library:src_* 记忆），
属正常行为非污染，空间总计 56。
