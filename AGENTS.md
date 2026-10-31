# AGENTS.md · any2skills 仓库工作约定

本文件是所有进入本仓的 Agent 会话的入口约定。细节单源维护，此处只放指针。

## 记忆系统（Nowledge Mem）

本项目有专属持久记忆底座：Space `any2skills`（strict）、Agent `any2skills-steward`。

**完整协议：`docs/guides/nmem-memory-protocol.md`**（必读）。四条硬约定：

1. **开工先读 context bundle**：`nmem --json context --space any2skills --agent-id any2skills-steward`。
2. **架构/口径问题先检索再下结论**：`nmem --json m search "完整中文短语" --space any2skills -n 3`
   （或 `npm run mem:recall -- "查询"`）；查询用完整中文短语，短 token 不可靠。
3. **生命线**：nmem 超时/离线/异常时静默降级为空，绝不阻塞主任务。
4. **写操作必须过 G1 批准门**（执行卡 34）：draft 随便落，write 先拿 marker；
   禁止 `memories update`，禁止默认 global scope。

方案与决策：`docs/specs/04-nmem-memory-kg-plan.md`、`docs/adr/ADR-033-nmem-memory-space.md`。

## 其他工作约定

- 先读盘上证据再回答；引用数字必须给口径与复算命令（证据可回查红线）。
- 非 dry-run 的 build 就是发布；账本每进程独立；生成链路不得读取 `benchmark/`。
- 判据/口径改动必须新增 ADR，不静默改写；执行卡从 `docs/tickets/` 下一号续。
