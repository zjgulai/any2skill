# 04：九种对象类型 + 第 2 层真实模型接入

**要构建什么：**把示踪弹从「一个对象」扩到「一个章节的多种对象」：第 2 层接上真实模型，并按既定九种类型产出对象，含三者边界判据防误分。

本卡同时把第 2 层的**非确定性纪律**落地：产出必须落盘固化、重跑须显式指定、用量必须记账——否则同一输入两次跑出不同结果且无人察觉（方案 R5）。

**被谁阻塞：**03

**状态：**done（真实模型跑通并落盘固化）。**「188 全绿」是本卡收工当时的数字**，不是现况——现况见 `README.md` 的 `npm test` 行（当前 286 项 / 55 套件）。

- [x] 第 2 层接入真实模型，模型路由**可配置**（不硬编码具体模型）
      —— 代码里没有默认模型：缺 `modelId`／`baseUrl` 即报错退出，路由由 `--llm-*` 或环境变量给出
- [x] 九种类型全部可产出：`Concept` / `Metric` / `MentalModel` / `DecisionModel` / `Heuristic` / `Case` / `Playbook` / `EngineeringRule` / `AntiPattern`
      —— 「可产出」由契约测试钉住（九类各一个正例通过、各一个负例被拒）；**本章实际只触到 5 类**，见构建记录
- [x] 每个对象携带逐字引文（`evidenceQuote`），且经第 3 层逐字比对判据
- [x] 三者边界判据有测试钉住：可证伪且无概率 → `EngineeringRule`；有置信度或例外 → `Heuristic`；多分支且需输入输出契约 → `DecisionModel`
      —— 机械侧由 schema 兜住（`EngineeringRule` 带 `confidence` 即拒、`Heuristic` 缺 `confidence` 即拒、`DecisionModel` 缺 `branches` 即拒），语义侧由提示词逐字携带且被测试钉住
- [x] `MentalModel` 的 `limits` 与 `counterexample` 缺失时被拒（不是警告，是拒绝）
- [x] 第 2 层每次运行记录**调用次数与 token 用量**，写入回执
- [x] 产出**落盘固化**：不显式指定重跑时，使用既有产物而不重新调用模型
- [x] 显式指定重跑时，新产出与旧产出可并存可对比，不静默覆盖
- [x] 第 2 层产物**原样落盘**（含未通过第 3 层的部分），以便失败可归因到具体环节
- [x] 测试：九种类型各有正例通过、各至少一个负例（缺必填字段）被拒

---

## 构建记录（2026-10-08）

**入口：**`node pipeline/run.mjs <内容源.md> [--layer2 stub|deepseek] [--rerun] [--no-resume] [--max-tokens <n>] [--llm-model <id>] [--llm-base-url <url>]`
**默认第 2 层是替身**：不传 `--layer2` 就不会有任何真实调用，`npm test` 也不花钱。

### 新增模块

| 文件 | 职责 |
|---|---|
| `pipeline/tools/llm-client.mjs` | 路由配置解析（显式 > 环境变量 > `$DSH_HOME/.credentials.yaml` 的 `refs`）、调用与**记账**、凭据永不外泄 |
| `pipeline/tools/layer2-extractor.mjs` | 提示词组装（从契约生成）、响应解析、对象实体化、提示词指纹 |
| `pipeline/tools/object-contract.mjs` | 九类必填字段 + **字段形状** + 边界判据的单一真源，与组装后的 schema 逐项比对防漂移 |

`verifier.mjs` 与 `model-stub.mjs` 改为从 `object-contract.mjs` 取类型集合与标识生成，消除三处各写一份的漂移面。

### 真实运行实测（chapter4.md · deepseek-v4-pro · 每锚点一次调用）

| | 基线（无形状提示） | 定稿（有形状提示） |
|---|---|---|
| `SCHEMA_INVALID` | 6 | **0** |
| `QUOTE_MISMATCH` | 3 | 6 → **0**（判据修订后重判） |
| 通过 / 被拒 | 29 / 38（76.3%） | **38 / 38**（判据修订后） |
| 类型覆盖 | 4 类 | **5 类**（+`MentalModel`） |
| 调用 | 20 | 20 |
| token | in 32,294 + out 92,742 | in 39,434 + out 83,750（推理占 92.6%） |
| 耗时 | 12 分 22 秒（断点续跑） | 约 16 分钟 |

定稿产物：`pipeline/knowledge/chapter4.objects.json`、`pipeline/registry/run-e4a57c21cd0a.receipt.json`、
原始响应 `pipeline/registry/run-9a30407d7271.layer2-raw.json`、被判据升级前的旧产出归档于
`pipeline/knowledge/history/chapter4.78fa33fa.objects.json`。

### 真实运行暴露的问题与随之落地的设计

1. **推理型模型把 max_tokens 吃光**。锚点 10 时 `finish_reason=length`、8000 completion 全是推理、content 为空、HTTP 仍是 200。原代码会报成「响应不是 JSON」，把人引向错误的方向。
   → 客户端单列 `truncated`，失败分类新增 `layer2-truncated`（修法是调大 maxTokens，与「服务端拒绝」「网络不通」分属不同修法）；默认 `max_tokens` 提到 16000。
   这一条直接催生两项设计：**增量落盘**（每锚点写一次半成品，实测正是它保住了前面 9 个锚点已付费的产出）与**断点续跑**（下一次只跑剩下的 11 个）。
2. **9 条拒绝里 6 条是纯字段形状错**（`AntiPattern.evidence` 写成字符串、`EngineeringRule.appliesWhen` 写成数组、`Concept.examples` 给空数组）。与知识无关，是契约没在提示词里说清。
   → 把**字段形状表**从 schema 生成后写进提示词，并用测试钉住形状表与 schema 逐项一致。A/B 结果：`SCHEMA_INVALID` 6 → 0。
3. **引文判据误杀**。判据修订前后的全部 9 条 `QUOTE_MISMATCH`，逐字符比对后差异**只有 `**` 强调标记**（相似度 0.90–0.98），没有一条是改写。模型复述的是渲染后的文本，而判据比的是 markdown 源。
   → 比对时忽略 markdown 强调标记与空白差异（口径补充写进规格 D6）；回执逐对象记 `quoteComparison`，使「靠归一化放过的」看得见。放宽幅度有界：内部删字、同义改写、凭空编造仍被拒。
4. **复用冻结产物会覆盖生产回执**（本卡自己引入的缺陷，实测踩到：`model.calls` 从 20 变成 0）。
   → 复用**不写任何产物**，只回放生产回执；产出者认定跳过「复用型回执」，避免链条指回自己。

### 一处需要读者知道的遗留痕迹

`pipeline/registry/run-3c60c2ce53b6.receipt.json` 是**缺陷被触发的那一份**：它描述的是一次
「0 次调用、复用冻结产物」的读取，而不是产出记录。真正的生产事实保存在同目录的
`run-3c60c2ce53b6.layer2-raw.json`（逐锚点原始响应与用量，由它复算出的 input 32,294 /
output 92,742 与当时回执一致），以及该回执自己的 `reusedFrom` 块里。
保留它是为了让这段痕迹可查——把它删掉会让「这批对象当初花了多少次调用」彻底无处可对。

### 判据升级后的重判（零模型开销）

判定口径一改，旧回执记的计数就不再代表现状。`PIPELINE_VERSION` 已提到 3 并进运行指纹，于是：

- 现行版本能算出对应回执 → 回放，不写任何文件；
- 算不出（说明判据变了）→ **用现行判据重判，不重跑第 2 层**，落到新的 runId，新旧回执并存可对比，
  对象文件一个字节都不动，`calls`/`tokens` 沿用它产出时的实测值（重判的开销是 0，不该把它写成 0）。

实测：`run-e4a57c21cd0a` 以 v3 判据重判 v2 产出的 38 个对象 → 38 通过 / 0 拒绝，全程 0 次模型调用。

### 本卡不覆盖（留给后续卡）

- **本章只触到 5 类**（`Concept` 13 / `EngineeringRule` 13 / `AntiPattern` 6 / `Heuristic` 5 / `MentalModel` 1）。
  `Metric`、`DecisionModel`、`Playbook`、`Case` 未出现——“九种类型均可产出”由契约测试保证，
  不是由这一章的采样结果宣称的。跨类型与跨章覆盖属 **06/07/09**。
- 判定者判据（LLM）与判定者独立性 → **05**；回执目前如实记 `judge.implemented = false`。
- 整章批量与全书跑批的**成本优化**：本次实测输出 token 里 92.6% 是思维链，全书规模（约 7,900 行）会放大该开销，属 **07/09** 的范围。
- 推理正文（`reasoning_content`）**刻意不落盘**：它是生产者的思维链，05 要求判定者看不到它，写到盘上等于留了一条回流路径。只记长度。
