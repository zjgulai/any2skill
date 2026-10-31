# 37：SOP 八条验收、证据归档与 git commit（verify）

**要构建什么：**对照 SOP 八条验收基线逐项核验，把全部命令输出归档为可回查证据，
最后规范化 commit 收口。这是 nmem 落地的收束卡。

**状态：**待执行（依赖卡 33–36）

## SOP 八条 → 执行映射（逐项核验并记录证据）

| # | SOP 验收项 | 核验命令/方式 | 通过判据 |
|---|---|---|---|
| 1 | Space 显式列出且 strict | `nmem --json spaces list` | 含 any2skills，mode=strict |
| 2 | Agent 存在且默认 Space 正确 | `nmem --json agents list` | any2skills-steward，default-space=any2skills |
| 3 | Context Bundle 完整 | `nmem --json context --space any2skills --agent-id any2skills-steward` | active_space/rule_stack.space[]（2 条）/working_memory 齐全 |
| 4 | Library 切片达标 | `nmem --json library list --space any2skills -n 50` | 5 源、text/markdown、state ∈ {indexed, extracted}、error 空 |
| 5 | 桌面 ⌘5 图谱可见 | 人工截图 | ≥16 记忆节点 + ≥11 显式边；`graph expand --depth 2` 可多跳；截图存 `docs/audits/` |
| 6 | 语义检索 Top1 ≥ 0.70 | 卡 35 的三条 query | 解析 `memories[0].score`，三条全 ≥0.70 |
| 7 | recall 测试全绿 | `NMEM_E2E=1 node --test pipeline/tools/test/test_any2skills_nmem_recall.mjs` + `npm test` | fake 四路径 + 真实检索 + 真实超时降级全绿 |
| 8 | 规范化 git commit | `git commit` | 约定式提交（见下） |

## 证据归档

全部核验输出写入 `docs/audits/any2skills-nmem-acceptance-20261031.json`
（含命令、时间戳、原始 JSON 摘要），并写简短 md 报告
`docs/audits/any2skills-nmem-acceptance-20261031.md`（八项逐项 PASS/FAIL + 失败处置）。

## git 收口

1. `.gitignore` 增 `tmp/`（卡 33 的 `.markdown` 中转目录不入库；manifest 已在
   `docs/audits/`）。
2. Q3 拍板结果落 `reports/`：入库则一并 add；不入库则在 manifest 标注「源未入库」。
3. `git add docs/ tools/ pipeline/ artifacts/ package.json .gitignore`（`.claude/`
   已忽略，不提交），commit：

   `feat(memory): add any2skills Nowledge Mem space, 4-layer memories, ontology and graph links`

## 验收

- [x] 八项映射表逐项核验：7 PASS + 1 MANUAL（桌面 ⌘5 截图需人工查看，CLI 证据齐全）
- [x] acceptance JSON + md 已归档 docs/audits/
- [x] commit hash：b9a5941
- [x] git status 无本次改动残留（reports/ 已入库；tmp/ 已忽略）
- [x] npm test 584/584、零网络、零凭据；NMEM_E2E=1 真实 E2E 11/11

## 构建记录

2026-10-31 执行完成：commit b9a5941（feat(memory): add any2skills Nowledge Mem space, 4-layer memories, ontology and graph links）。
八项验收证据：docs/audits/any2skills-nmem-acceptance-20261031.json / .md。
真实 E2E：NMEM_E2E=1 下 11/11 全绿（3 条真实检索 Top1≥0.70 + 真实超时降级）。
reports/ 一并入库，Library 源获得 Git provenance（specs/04 §7 Q3 拍板：入库）。
