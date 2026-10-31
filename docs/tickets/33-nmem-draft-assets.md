# 33：nmem 落地草案与工具（全 draft，零 nmem 写）

**要构建什么：**为 Nowledge Mem 落地准备全部本地草案与工具——16 条四层记忆蒸馏脚本、
空间本体补丁、5 份 Library 清单、读侧 recall util 及测试、规则/WM 文本、命令表。
**本票零 nmem 写操作**，所有 nmem 写入在卡 35/36（G1 批准后）。

**状态：**待执行

## 产物清单

1. `tools/dev/distill-memories-to-nmem.mjs` — 内置 `MEMORIES` 16 条
   （L1 4 / L2 4 / L3 6 / L4 2；ID `any2skills-l<层>-<序号>`；每条含
   id/title/importance/unitType/when/labels/source/content），默认 `--dry-run`
   输出 JSONL 与统计，显式 `--apply` 才逐条 spawnSync `nmem memories add --id ... --space any2skills --agent-id any2skills-steward --unit-type ... --when ... --label ... --source ... --stdin`。
2. `tools/dev/validate-memories.mjs` — 校验：unit_type ∈ 8 合法枚举；ID 唯一且符合
   规则；层级计数 4/4/6/2；content 2–5 句（句号/问号/感叹号计）且去空白字符 ≤300；
   source 指向仓库真实路径。校验失败退出码非 0。
3. `artifacts/any2skills_ontology_patch.json` — 10 objectTypes（SKILL/SOURCE/
   KNOWLEDGEOBJECT/QUALITYGATE/PIPELINESTAGE/ARTIFACT/DECISION/TICKET/BENCHMARK/
   PROMPTMODULE）+ 8 linkTypes（DERIVES_FROM/PASSES_GATE/GOVERNED_BY/PRODUCES/
   NAMESPACED_UNDER/SUPERSEDES/IMPLEMENTS/BENCHMARKS）；meta 声明
   `target_space=any2skills`；每个 description 含典型关系链。
4. Library 清单（本票只落本地）：5 份源复制为 `.markdown` 到 `tmp/any2skills-library/`，
   生成 `docs/audits/any2skills-library-manifest-20261031.json`
   （source/archive/comment/labels/sha256）：

   | 源 | 归档名 | labels |
   |---|---|---|
   | README.md | any2skills-readme.markdown | readme,entrypoint,pipeline |
   | docs/guides/book-to-skills-runbook.md | any2skills-book-to-skills-runbook.markdown | runbook,workflow,operations |
   | docs/adr/ADR-006-three-quality-gates.md | ADR-006-three-quality-gates.markdown | adr,quality-gates,governance |
   | docs/adr/ADR-030-low-utility-governance.md | ADR-030-low-utility-governance.markdown | adr,low-utility,honesty |
   | reports/Know-项目成果总结-20261031.md | Know-project-outcome-20261031.markdown | report,outcome,baseline |

5. `pipeline/tools/nmem-recall.mjs` — spawnSync `nmem --json m search <query>
   --space any2skills -n 3 --importance-min 0.7`，timeout `NMEM_TIMEOUT_MS`（默认
   3000），min_score 0.70，非零退出/超时/坏 JSON 全部返回空串。只被会话调用。
6. `pipeline/tools/test/test_any2skills_nmem_recall.mjs` — fake nmem（`NMEM_BIN`
   注入）测成功/超时/非零/坏 JSON 四路径；`NMEM_E2E=1` 时另跑真实检索
   （三条完整中文 query，断言 `memories[0].score >= 0.70`）与真实超时降级。
   注：SOP 的 `test_<agent>_nmem_recall.py` 在本仓等价落为 `.mjs`。
7. `docs/guides/nmem-memory-protocol.md` — 读写协议（开工读 context bundle、
   检索失败降级、写操作须过 G1）+ 逐命令表。
8. 规则与 WM 文本：`docs/audits/any2skills-rule-core.md`（priority 100）、
   `docs/audits/any2skills-rule-boundary.md`（priority 90）、
   `docs/audits/any2skills-working-memory.md`（含 `## Focus Areas` 与 `## Briefing`，
   写「计划写入 16 条 / 待 T6–T9 完成」，不写未来完成时态）。
9. `package.json` 增 scripts：`mem:recall` / `mem:distill:dry` / `mem:verify`。
10. `.claude/settings.local.json` 增 `env.NMEM_SPACE=any2skills`、
    `env.NMEM_AGENT_ID=any2skills-steward`（本地，不入库）。

## Bootstrap 命令表（0.10.111 实测口径，卡 35/36 直接引用）

| 写操作 | 命令要点 |
|---|---|
| spaces create | `nmem spaces create "Any2Skills 技能生产线（Know）" --id any2skills --retrieval-mode strict --description ...` |
| agents enroll | create-only；重复执行是 no-op，修正须 `agents set`；`--tags` CSV |
| rules upsert | 默认 `--scope global`，必须显式 `--scope space --space any2skills`；`--body-file` |
| working-memory edit | `-m` 整篇覆盖；按段更新用 `working-memory patch --heading` |
| memories add | `--id` 确定性 upsert；`--when` ∈ past/present/future/timeless；label 用可重复 `--label` |
| memories link add | `nmem memories link add --type <REL> <SRC> <TGT> --space any2skills --reason ...`；查重用 `memories link list <MEMORY_ID>`（无空间级 list） |
| library add | 位置参数；`-c` comment、`-l` label 可重复；传 `.markdown` |
| ontology apply | `--scope space --space-id any2skills`（整体替换、无 dry-run）；global 基线用 `--space-id default` 前后各存 |

## 验收

- [x] dry-run 退出 0；JSONL 16 行（校验内置于 distiller，独立 validate 脚本合并实现）
- [x] dry-run 只写本地文件，nmem 写调用 0
- [x] 本体 patch JSON 可解析、key 唯一、10+8 齐全（artifacts/any2skills_ontology_patch.json）
- [x] 5 个 `.markdown` 全部 UTF-8；manifest 5 条含 sha256（docs/audits/any2skills-library-manifest-20261031.json）
- [x] recall 测试 fake 七路径全绿；`npm test` 584/584 全绿且零网络、零凭据
- [x] nmem 不在 PATH 时不失败（fake 注入 + E2E 默认 skip）
- [x] 命令表与 `docs/specs/04` §6 口径一致（并入 docs/guides/nmem-memory-protocol.md）

## 构建记录

2026-10-31 执行完成。产物：
- tools/dev/distill-memories-to-nmem.mjs（16 条记忆单一真源 + 内置校验 + --apply）
- tools/dev/link-memories-to-nmem.mjs（11 条边，dry-run 默认，--apply 幂等）
- artifacts/any2skills_ontology_patch.json（10 objectTypes + 8 linkTypes）
- tmp/any2skills-library/ 5 份 .markdown（manifest: docs/audits/any2skills-library-manifest-20261031.json）
- pipeline/tools/nmem-recall.mjs + test（7 fake 测试 + NMEM_E2E=1 真实 E2E）
- docs/guides/nmem-memory-protocol.md（协议 + 逐命令表 + 已知陷阱）
- docs/audits/any2skills-rule-core.md / -rule-boundary.md / -working-memory.md
- package.json：mem:recall / mem:distill:dry / mem:verify
- .claude/settings.local.json env 固化（本地不入库）；.gitignore +tmp/
- 修正记录：16 条记忆的 source 路径 5 处按盘上实际文件名修正（ADR-003/001/022/023/卡19）；
  distiller 首版 when 校验逻辑错误已修（when 由层级派生，非条目字段）。
  验证：npm test 584/584；dry-run 16 条 L1=4/L2=4/L3=6/L4=2。
