# 35：写入基座与 16 条四层记忆（write / G1-A + G1-B）

**要构建什么：**执行 nmem 基座写入——Space、Agent、两条常驻规则、Working Memory，
然后写入 16 条蒸馏记忆并验证幂等与检索质量。依赖卡 33 草案与卡 34 的 G1-A/B marker。

**状态：**待执行（依赖卡 33、34）

## 步骤

1. **预检**：`nmem --json status`；`nmem --json spaces list` 确认 `any2skills` 不存在
   （已存在则停止排查，用 `spaces update --retrieval-mode strict` 修正而非重建）；
   `nmem --json agents list` 确认 `any2skills-steward` 不存在（`agents enroll`
   create-only，重复执行 no-op）。
2. 建 Space：`nmem spaces create "Any2Skills 技能生产线（Know）" --id any2skills
   --description "Any content → executable Agent Skills 的可审计生产线；与
   pr-agent/si-agent/kb-consultant-agent 隔离" --retrieval-mode strict`
3. 注册 Agent：`nmem agents enroll any2skills-steward --name "Any2Skills 生产线守门人"
   --role skill-pipeline-steward --default-space any2skills --description "..."
   --tags any2skills,skill-pipeline,quality-gates,traceability,memory-steward`
4. 写规则（显式 scope，默认是 global）：
   `nmem rules upsert any2skills_core_persona --title "人格内核与决策优先级"
   --body-file docs/audits/any2skills-rule-core.md --scope space --space any2skills
   --priority 100 --tags persona,rules,governance`
   `nmem rules upsert any2skills_repo_boundary --title "仓库物理边界与数据纪律"
   --body-file docs/audits/any2skills-rule-boundary.md --scope space --space any2skills
   --priority 90 --tags boundary,data-discipline,isolation,rules`
5. 写 Working Memory：`nmem working-memory edit --space any2skills -m "$(cat
   docs/audits/any2skills-working-memory.md)"`
6. 写 16 条记忆：`node tools/dev/distill-memories-to-nmem.mjs --apply --space any2skills
   --agent-id any2skills-steward --out docs/audits/any2skills-nmem-memories-20261031.json`
7. **幂等验证**：再跑一次同命令，计数必须 +0（`memories add --id` 为确定性 upsert）。
8. **检索验证**（完整中文短语，短 token 不可靠）：
   - `nmem --json m search "证据可回查 无 sourceRefs 不得进入下一环节" --space any2skills -n 3`
   - `nmem --json m search "low-utility 三态如实标注 重测须有因" --space any2skills -n 3`
   - `nmem --json m search "stat 多报 4096 字节 误判 binary" --space any2skills -n 3`
   各断言 `memories[0].score >= 0.70`。

## 验收

- [x] `nmem --json spaces list` 含 any2skills，mode strict
- [x] `nmem --json agents list` 含 any2skills-steward，default-space=any2skills
- [x] context bundle：active_space=any2skills(strict)，rule_stack.space[] 含两条规则（100/90），working_memory 含 `## Focus Areas` 与 `## Briefing`
- [x] `memories list --space any2skills` 计数 16；`--id` upsert 幂等（l3-01 首跑失败后重跑，无重复）
- [x] 三条检索 Top1 均 0.99（≥0.70）
- [x] default 空间零新增（检索命中的 a646a825 是当日早间既有记忆，非本次写入）
- [x] 全程未使用 `memories update`；`when` 合规以源 JSONL 为准

## 构建记录

2026-10-31 执行完成（G1-A/B marker 后）：
- 预检：nmem 0.10.111、graph_store healthy、embedding local-gguf 未降级、any2skills 空间不存在（符合预期）。
- `spaces create` + `agents enroll` 成功；两条规则 `rules upsert --scope space --space any2skills`（priority 100/90）成功。
- **新避坑 1**：`rules upsert --body-file` 报 `stream did not contain valid UTF-8`（对含中文的 UTF-8 文件误判）；改用 `--body "$(cat file)"` 内联成功。已回写卡 33 命令表与协议文档。
- **新避坑 2**：`memories add --title` 分离式传参时，以 `--` 开头的标题（l3-01「--layer2 缺省 stub…」）被解析为 flag；改用 `--title=...` 等号形式解决。
- WM：`working-memory edit -m` 成功（2588 bytes）。
- distiller `--apply`：16/16 ok；结果 docs/audits/any2skills-nmem-memories-20261031.json。
- 检索：三条完整中文 query Top1 均 0.99。
