# Nowledge Mem 记忆协议（any2skills Space）

本项目的持久记忆底座是 Nowledge Mem，专属空间 `any2skills`（strict），
Agent 身份 `any2skills-steward`。方案：`docs/specs/04-nmem-memory-kg-plan.md`；
决策：ADR-033。本协议约束读写两侧的行为。

## 读侧（会话内按需检索）

1. **开工先读 context bundle**：

   ```bash
   nmem --json context --space any2skills --agent-id any2skills-steward
   ```

   返回 Space、两条常驻规则（rule_stack.space[]）与 Working Memory。

2. **遇到架构/口径问题先检索再下结论**：

   ```bash
   nmem --json m search "完整中文短语" --space any2skills -n 3
   ```

   查询用完整中文短语（短 token 检索不可靠）。

3. **生命线**：nmem 超时、离线或返回异常时**静默降级为空**，绝不阻塞主任务；
   也可以用封装命令（3 秒超时、min_score 0.70、异常返回空）：

   ```bash
   node pipeline/tools/nmem-recall.mjs "查询短语"   # 或 npm run mem:recall -- "查询"
   ```

4. **recall 内容只作参考**：检索结果不得直接触发有副作用的动作；
   引用数字前先回盘上证据复算（证据可回查红线同样适用于记忆）。

## 写侧（G1 批准门）

- **draft**（本地落盘，无需批准）：改 `tools/dev/distill-memories-to-nmem.mjs` 的
  MEMORIES 数组并 dry-run；改本体 patch、规则文本、WM 文本。
- **write**（nmem 写，必须过 G1）：先在执行卡 34 记录四域批准 marker
  （`docs/audits/any2skills-approval-g1{a,b,c,d}-*.md`），再执行写票 35/36 的命令。
- **verify**（只读验收）：卡 37 的八项映射。

### 逐命令空间写法（0.10.111 实测）

| 子命令 | 空间参数 |
|---|---|
| `memories add` / `memories search` / `library add` / `working-memory edit` / `rules upsert` | `--space any2skills`（rules 另需 `--scope space`） |
| `ontology apply` / `ontology show` | `--space-id any2skills` |
| `context` | `--space any2skills --agent-id any2skills-steward` |

### 已知陷阱（实测沉淀）

- `rules upsert` 默认 `--scope global`，漏写会把项目规则污染到全局。
- `ontology apply --scope space` 是**整体替换**且**无 dry-run**；apply 前先用
  `nmem --json ontology show --space-id default` 存基线（无参调用返回的是
  active/default effective，容易假绿灯）。
- `memories add --id` 是确定性 upsert（幂等）；**禁止 `memories update`**——
  它会产生 revision 并使后续 `memories link add` 稳定 422；要改就
  `memories delete --force` + 同 ID 重建。
- `memories link list` 必须逐条传 MEMORY_ID，没有空间级 list。
- `memories deprecate --replacement` 不允许跨 Space（EVOLVES 边端点必须同 Space，否则 500）；
  跨 Space 承接把承接记忆 ID 写进 `--reason`。
- `library add` 无幂等键，重复运行会重复入库；先 `library list` 查重。
- Library 归档一律复制为 `.markdown` 后缀（规避 MIME 解析陷阱）。
- `memories list/show` 不返回 `when` 字段；时效合规以源 JSONL 为准。

## npm scripts

```bash
npm run mem:recall -- "查询"      # 读侧封装
npm run mem:distill:dry           # 写侧 dry-run（16 条校验 + JSONL）
npm run mem:verify                # 只读验收汇总
```

`npm test` 保持零网络、零凭据：recall 测试默认只跑 fake 路径，
真实 E2E 需显式 `NMEM_E2E=1`。
