# any2skills Nowledge Mem 落地验收报告（2026-10-31）

对照 SOP《智能体记忆系统与知识图谱构建规范》v2.0 八条验收基线，逐项核验结果：

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | Space 显式列出且 strict | **PASS** | `spaces list`：any2skills，defaultRetrievalMode=strict，memories=16，sources=5 |
| 2 | Agent 存在且默认 Space 正确 | **PASS** | `agents list`：any2skills-steward，defaultSpaceId=any2skills |
| 3 | Context Bundle 完整 | **PASS** | `context`：active_space=any2skills(strict)，rule_stack.space 两条（100/90），WM 含 Focus Areas + Briefing |
| 4 | Library 全 indexed、错误 0 | **PASS** | `library list`：5 源，lifecycle_state=indexed×5，text/markdown×5，errors=0 |
| 5 | 桌面 ⌘5 图谱 | **MANUAL** | CLI 侧已证：16 记忆节点 + 11 显式边，`graph expand l2-01 --depth 2` 达 5 邻居；桌面截图待人工查看 |
| 6 | 语义检索 Top1 ≥ 0.70 | **PASS** | 三条完整中文 query Top1 均 0.99 |
| 7 | recall 测试全绿（真实+降级） | **PASS** | fake 7/7；`NMEM_E2E=1` 真实检索 3/3 + 真实超时降级 1/1；`npm test` 584/584 |
| 8 | 规范化 git commit | **PASS** | 本次 commit（见卡 37 构建记录 hash） |

结果：**7 PASS + 1 MANUAL（桌面截图需人工打开 App 确认，CLI 侧证据齐全）**。

## 执行过程中的新增避坑（已回写卡 33/35/36 与协议文档）

1. `rules upsert --body-file` 对含中文的 UTF-8 文件报 `stream did not contain valid UTF-8`，
   改用 `--body "$(cat file)"` 内联成功。
2. `memories add --title` 分离式传参时，`--` 开头的标题被解析为 flag；改 `--title=...` 等号形式。
3. `ontology apply` 的 patch 只接受 `objectTypes/linkTypes/openWorld/policy/seedFromDefaults`；
   `meta` 与 linkTypes 的 `description` 字段均 422。
4. `memories link list` 返回同时含 incoming/outgoing，查重必须过滤 `direction !== 'incoming'`；
   `link add` 为 upsert 语义，重复执行不重复建边。
5. library list 的状态字段是 `lifecycle_state`（不是 `state`），agents list 的是 `agentProfiles`/`defaultSpaceId`。
6. SOP 的 `.md`→`.markdown` MIME 规避在 0.10.111 实测仍建议保留（5/5 indexed）。

## 交付物索引

- 方案：`docs/specs/04-nmem-memory-kg-plan.md`；决策：`docs/adr/ADR-033-nmem-memory-space.md`
- 执行卡：33（draft）/ 34（G1）/ 35（基座+记忆）/ 36（Library+本体+边）/ 37（验收）
- 脚本：`tools/dev/distill-memories-to-nmem.mjs`（16 条单一真源）、`tools/dev/link-memories-to-nmem.mjs`、
  `pipeline/tools/nmem-recall.mjs`（读侧生命线）
- 协议：`docs/guides/nmem-memory-protocol.md`；证据：`docs/audits/any2skills-*`
- nmem 侧：Space `any2skills`(strict) + Agent `any2skills-steward` + 2 rules + WM + 16 memories
  + 11 links + 5 library docs + 空间本体 revision 17（10+8）
