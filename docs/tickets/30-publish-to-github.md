# 30：入库面梳理 + 发布到 GitHub（zjgulai/any2skill）

**要构建什么：**把本仓推到 `https://github.com/zjgulai/any2skill`（新建空仓库）。
推送前做一次**入库面梳理**：明确「什么进 git、什么只留本地」，让 clone 后的仓库
**自证可用**（`npm test` 全绿）且不含本地进程状态。

**状态：**完成（2026-10-16）。

## 入库面政策（梳理结果）

**入库（证据面与承重面）：**

| 类别 | 为什么入库 |
|---|---|
| `sources/**`（书/镜像清单/代码镜像） | 溯源与冻结的源头 |
| `pipeline/knowledge/*.{objects,anchors}.json`（151 文件，本次补入） | 套件构建、门禁、隐含判定链直读它们——clone 后 `build-task-suite`/测试要能跑 |
| `pipeline/knowledge/history/**`（本次补入 9） | 归档面（重跑/事故的证据） |
| `pipeline/registry/run-*.receipt.json`、`book-*.book-receipt.json`（本次补入） | 契约的 `gateReceiptFile` 指向它们；`findLatestReceipt` 的门禁通过集 |
| `pipeline/registry/*.antipattern-raw.json` + `*antipattern-verdicts.json` | 跨章合成的付费证据与判定表（`apPassSet` 的来源） |
| `pipeline/registry/history/**` | 覆盖前的归档（既有约定） |
| `skills/**`、`registry/build/**`、`registry/rejected/**`、冻结/评测/lineage/status、`curation/**`、`benchmark/**` | 发布面与评测面（既有约定） |

**不入库（本地状态与续跑资产，.gitignore 新增）：**

| 规则 | 理由 |
|---|---|
| `.claude/` | 本地 harness 状态（权限、worktrees），非项目内容 |
| `pipeline/registry/fs-ledger/` | 运行期账本转储（按机按次生成） |
| `*.stdout.txt` / `*.stderr.txt` | 控制台转储 |
| `pipeline/registry/*.layer2-raw.json` | 按 runId 命名的付费原始响应（续跑资产）；**并摘除既有 10 个跟踪**（fixtures 6 个保留——测试在读） |

## 执行记录

- `.gitignore` 增一段（带口径注释）；`git rm --cached` 摘除 10 个 registry raw
  （文件留盘，历史提交保留）。
- `git add -A` 后审计：223 增（152 knowledge + 62 registry + 9 knowledge/history）、
  10 摘、1 改（`.gitignore`），合计 **4.7MB**，无 >300KB 单文件，抽查无本地状态混入。
- 提交后设 remote 为 `https://github.com/zjgulai/any2skill.git`（gh 认证 zjgulai），
  `git push -u origin main`（全量历史 + 本次入库面）。

## 验收

- [x] 入库面审计：不该入的（claude/ledger/转储/raw）全部被 ignore，且不在暂存面
- [x] clone 自证前提：测试直读的承重文件（objects/receipts/pools/verdicts/fixtures）在库
- [x] 本地 `npm test` 577/0 不受影响
- [x] push 成功（见提交与远端）