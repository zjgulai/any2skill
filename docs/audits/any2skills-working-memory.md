## Focus Areas

1. **nmem 记忆与知识图谱落地（进行中）**：为 any2skills 建专属 Space、Agent、两条常驻规则、16 条四层记忆、10+8 本体、5 份 Library 真源；所有 nmem 写入先经 G1 四域批准（A 基座 / B 记忆 / C Library / D 本体）。计划写入 16 条记忆，待卡 35/36 完成后回填实际值。
2. **低效用治理与复测**：17 个在售技能为 7 passed / 10 low-utility / 0 rejected；按 ADR-030「降级=如实披露、重测须有因」维护 tiers/README，不把发布数当 KPI。
3. **提示词包 03–10 真实试用**：prompts/agent-dev v1.2 只完成模块 01→02 的真实交互链验证，03–10 尚未真实试用；02 正文 3166 字已逼近 3200 字硬上限。
4. **工程收口**：卡 08「回执的聚合、计数与拒绝理由码」状态仍 ready-for-agent；7 个契约字段无来源；4 个 Rust 候选未发布。
5. **分发成熟度**：无 LICENSE、无 CI、package.json 为 private，ADR-002 规划的 .claude-plugin 即插即用分发层尚未落地。

## Briefing

- **项目**：any2skills（成果报告称「Know」），把中文技术书编译为可执行、可溯源、经三道质量门禁验证的 Agent Skills；双平面架构：外层 skills/ 发布面，内层 pipeline/ 可审计承重面（ADR-002）。
- **两个源**：ai-agent-book-zh 13 个 md（章级，1,102,782 字节，336 锚点/604 对象）+ chapter4 代码镜像 851 文件；rust-book-cn 105 个 md（节级，513 锚点，pin cde74c4）。第二源判据零改动跑通，证明「any」成立。
- **三道门禁**：门禁一契约与证据（确定性、全量必过，拒绝率 3.8%）；门禁二触发盲测（40 候选×120 场景、280 次，19→17）；门禁三效用 A/B（K=6 复跑制，两次确认负迁移）。
- **维护入口**：node pipeline/run-new-book.mjs all|onboard|pipeline|scaffold；主流程 docs/guides/book-to-skills-runbook.md；全景 playbook.html；成果 reports/Know-项目成果总结-20261031.md。
- **迁移注意**：default 空间两条旧 any2skills 记忆（d3a1a91a 指向旧报告名、a646a825「尚无专属 Space」）已于 2026-10-31 deprecate（specs/04 §7 Q1 拍板），口径以本 Space 为准；replacement 不可跨 Space，承接关系写在 deprecate reason 中。
- **工作纪律**：先读盘上证据再回答；引用数字必须给口径与复算命令；非 dry-run 的 build 就是发布；账本每进程独立；任何效应先给同档噪声带。
