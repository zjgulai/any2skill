# 29：md 书 → skills 完整流程（runbook + run-new-book 编排器）

**要构建什么：**把本项目全部经验（30+ 卡、34 篇 ADR、两本书的实测）沉淀为
**一条完整、可执行、可复算的流程**：给到一个 md 书目录，产出经门禁验证的岗位技能。
交付物三层：

1. **Runbook**（`docs/guides/book-to-skills-runbook.md`）——八阶段工作流全文：
   每阶段的命令、产物、验收、成本估算与陷阱，含「高质量」的操作性定义；
2. **编排器**（`pipeline/run-new-book.mjs`）——`onboard / pipeline / scaffold` 三子命令：
   源入场（拷贝+逐文件哈希 MANIFEST）→ 环 1/2/3 + 合成（串联既有 CLI，复用+账本）→
   门禁一筛查 → **策展草稿自动生成**（清单草案 + 工作流草案 + 编辑核对单）；
3. **构建器补口**——新书无 legacy 章节契约时 provenance 从 owned 对象派生；
   工作流 `draft: true` 一律拒绝构建（草稿与可发布物之间的硬边界）。

**「直接生成高质量 skill」的诚实口径：**管线能自动保证的是**结构门禁 + 溯源 +
全程可复算**；「任务边界、步骤、命名」是编辑层，编排器生成**带草稿标记的草案**，
编辑按核对单收敛后构建——把人工面从「从零写」压到「改草稿」。质量由门禁（一/二/三）
与披露义务背书，不由口号背书。

**状态：**完成（2026-10-16）——runbook + 编排器 + 构建器补口齐备；测试 577/0。

## 构建记录

**① Runbook**（`docs/guides/book-to-skills-runbook.md`）：八阶段全文（前置/入场/环1-2/环3/
合成/筛查/策展/发布与评估/收束），每阶段 命令+产物+验收+成本+陷阱；「高质量」六维操作性
定义；跨阶段陷阱总表（五项固定路径漏网、跑通≠落盘齐、共用账本、透传取值、目录哈希重答、
heredoc 编码事故等全部在册）；附录命令速查与关键 ADR 索引。

**② 编排器**（`pipeline/run-new-book.mjs`，四子命令）：
- `onboard`：md 目录（含子目录）拷入 `sources/<key>/book/` + 逐文件 sha256 SOURCE-MANIFEST；
  非 md 不入场；重复入场拒绝覆盖；key 合法性校验。
- `pipeline`：串联 run-book（llm-* 参数形态）→ propose-clusters → 主题+合成（可 `--no-synthesis`）
  → 门禁一筛查（逐候选 dry-run，零调用）→ `screening.<key>.json`；`--dry-run` 只打印命令链。
- `scaffold`：从筛查通过者生成**策展草稿**——清单草案（draft 标记）+ 工作流草案
  （**字面保真条款默认内置**；步骤含来源规则的建议草稿并显式标注；whenToUse 取自对象
  trigger/appliesWhen 原文）+ EDITORIAL-CHECKLIST（六项收敛点 + 收敛后的命令序列）。
- `all`：三段连跑。**不发起任何付费评测**（评估阶段由主人显式运行）。

**③ 构建器补口**：新书无 legacy 章节契约时，provenance.sourceFile 从 owned 对象所在章派生
（确定性：装载按 fileKey 排序取首）；`draft:true` 工作流**一律拒绝构建**（草稿与可发布物的
硬边界——防「草案直接发布」静默降格）。

**④ 门禁二套件参数化**：`--suite-key <token>` / `--suite-manifest <path>`——新书的套件盲测
按自己的命名空间落盘，本仓 task-suite 报告不受影响。

**验证（全部免费）**：新增 `new-book.test.mjs` 五项（入场含子目录与哈希、二次拒绝、
pipeline 干跑命令链、草稿生成全要件与覆盖拒绝、**无 legacy 构建**从 owned 对象派生
sourceFile 且过门禁一）+ 冒烟：真实 key 干跑命令链渲染正确；临时仓库 onboard +
`--layer2 stub` 环 1/2 实跑出锚点/对象/回执/账本。`npm test` **577/0**。

## 验收

- [x] 给定 md 目录 → `all` 一条命令到策展草稿（免费部分全自动；付费环节显式）
- [x] 草案不可能是发布物（draft 硬拒 + 核对单收敛路径）
- [x] 字面保真条款默认进每一份草案
- [x] runbook 每阶段都有产物与验收；陷阱总表覆盖两本书的全部实测教训
- [x] 现行仓库行为零回归（577 测试、冻结照旧）
