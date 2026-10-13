# 拒绝记录 · chapter3-s1「用户记忆体系设计」

**判定**：`rejected`（negative transfer 复现）——ADR-006 门禁三硬约束：**必须拒绝**。

## 证据

- 报告：`pipeline/registry/gate3-report.json`（`skills[]` 中 slug=`chapter3-s1` 的 verdict 块）
- 任务 `chapter3-s1-t2`：按 `user_data.json` 设计记忆存储方案，检查单要求
  `storage_plan.json` 的 `/mode`="混合模式" 且 `/plan/{0,1,2}/recommended_format` 分别为规定值。
- **首轮**：无 skill 臂**过**、有 skill 臂**败**（mode 与文件正确，`/plan/*/recommended_format`
  实际为 `undefined`——数组项结构被改变）。
- **复跑（同题同夹具重采样）**：无 skill 臂再**过**、有 skill 臂再**败** → 按 ADR-027 决策 3
  的复跑制，判定为**确认退化**而非噪声。

## 处置

- 已从发布区移出（`git mv skills/chapter3-s1 → pipeline/registry/rejected/chapter3-s1`，**移动而非删除**，可恢复）。
- 机制说明（如实、不替它开脱也不夸大）：该 skill 的词汇体系（记忆格式/层次/压缩等）
  在实测中把输出的 plan 项结构带离了任务显式要求的字段命名——这正是确定性检查单
  设计来抓的「输出漂移」。n=2 的复现是判定依据；样本量小仍是事实。
- 后续：若修订该 skill 的正文（如把「格式命名以任务要求为准」写进正文）可重跑门禁三复评；
  在此之前它不回到发布区。
