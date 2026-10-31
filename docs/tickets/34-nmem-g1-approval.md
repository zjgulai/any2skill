# 34：G1 四域批准门（nmem 写入前的人工门）

**要构建什么：**把卡 33 的全部草案交给用户，按四域分别确认。**这是 nmem 写入的
唯一许可来源**——未获某域 marker，卡 35/36 对应写票不得执行。

**状态：**待执行（依赖卡 33 完成）

## 批准材料

- A 基座域：Space/Agent 参数（`any2skills` / `any2skills-steward`）、两条规则正文
  （`docs/audits/any2skills-rule-core.md`、`any2skills-rule-boundary.md`）、
  WM 全文（`docs/audits/any2skills-working-memory.md`）
- B 记忆域：`--dry-run` 输出的 16 条 JSONL（标题+层级+正文全文）
- C Library 域：5 份归档清单（`docs/audits/any2skills-library-manifest-20261031.json`）
- D 本体域：`artifacts/any2skills_ontology_patch.json`（10+8 全文）

## 流程

1. 用户对 A/B/C/D 逐域确认（可只批准部分域；未批准域的写票跳过并在验收表记录）。
2. 每批准一域，写 marker：`docs/audits/any2skills-approval-g1{a,b,c,d}-20261031.md`，
   内容含确认时间、批准范围、用户原话摘要。
3. marker 落盘后才允许执行对应写票。

## 验收

- [ ] 4 份 marker（或跳过记录）存在于 `docs/audits/`，含用户原话摘要
- [ ] 无 marker 前 `nmem` 写调用为 0（可用 dry-run 日志反证）
- [ ] 批准材料与本卡列出的文件一一对应

## 构建记录

（执行时回填）
