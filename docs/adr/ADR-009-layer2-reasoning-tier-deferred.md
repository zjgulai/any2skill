# ADR-009 · 第 2 层推理档位：推迟到卡 09 之前定，不在卡 05 之前定

> **✅ 本 ADR 的到访点已完成（2026-10-08，批次一）。**
> 结论见 [`ADR-015-reasoning-tier-decision.md`](ADR-015-reasoning-tier-decision.md)：
> **两层都维持默认（不拨档）**。本 ADR 写明的硬约束「卡 09 开工前必须先回到本 ADR 定档」**已了结**，卡 09 不再被它阻塞。
>
> **本 ADR 正文保留原样**（它是「为什么当时不下判断」的记录，那个判断是对的）。
> 其中**三处表述已被后续实测取代**，逐条列在 ADR-015 的「对 ADR-009 原文的三处更正」一节：
> 1. 第 17 行引用的请求体字段清单——已加入 `reasoning_effort`；
> 2. 「推理更像每锚点的固定开销」——控制变量实验不支持其外推；
> 3. 决策段的「维持现状」——**结论被维持，但理由变了**（当时是「还不能定」，现在是「不值得动」）。

- 状态：已接受（推迟型决策——本轮拍板的是「先不拍板」，且写明何时必须拍）
- 日期：2026-10-08
- 决策者：用户（在「先做低档对照 / 直接定低档 / 维持 high 并推迟」三选项中拍板第三项）
- 关联：ADR-005（三段式）、ADR-006（三道门禁）；规格 `docs/specs/01-pipeline-spec.md` 的 D6
- 落地任务卡：`docs/tickets/05-verifier-independence.md`（本轮开工）、`docs/tickets/09-full-book-run.md`（本决策的到期点）
- **后续**：ADR-015（到访点，2026-10-08）

## 背景

卡 04 跑通真实链路后，回执显示推理（思维链）占全部输出 token 的九成以上。这个旋钮在卡 09 的全书跑批上会真正开始花钱，因此提出：要不要在开卡 05 之前先把它定下来。

**杠杆确实存在，且我们没接**（实测）：

```bash
grep -n "reasoning\|temperature\|max_tokens" pipeline/tools/llm-client.mjs
# → 请求体构造在第 283–292 行，字段只有 model / messages / max_tokens / temperature
```

DeepSeek 官方文档（[思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)，本轮 web_fetch 实测：
HTTP 200）写明：思考模式**默认打开**，effort **默认 high**；控制参数为
`{"reasoning_effort": "low/high/max"}` 与 `{"thinking": {"type": "enabled/disabled"}}`。
⇒ 现状等价于「默认满血，且不可配置」。

**成本实测**（`pipeline/registry/run-9a30407d7271.receipt.json`，真实调用，非估算）：

| 项 | 值 |
|---|---|
| 调用次数 | 20（chapter4 的 20 个锚点各一次） |
| input / output tokens | 39,434 / 83,750 |
| 其中推理 tokens | **77,565 = 输出的 92.61%** |
| cached input tokens | 20,736 |
| 单锚点均值 | input 1,972 / output 4,188（推理 3,878） |

**规模实测**：全书 13 个源文件合计 **336 个锚点**（`buildAnchorIndex` 纯函数逐个计数，本轮实测，
零落盘）。chapter4 是 20 个锚点，全书是它的 **16.8 倍**。

**全书用量为推算，非实测**：按上表单锚点均值线性外推 → 调用 336 次、
input 662,491 / output 1,407,000（其中推理 1,303,092）。前提假设是各章锚点的 token 画像一致。

**一处口径更正留痕**：本决策的讨论中一度出现「全书约 7,900 行」。实测两个口径：
`wc -l` 得 **7,890** 行，`buildAnchorIndex` 的 `totalLines` 得 **7,903**——差 13，
恰为文件数，源于「以换行结尾的文件 split 后多出末尾空串」。两处均以各自口径为准，不混用。

## 决策

**不在卡 05 之前定档位。维持现状（思考模式默认开、effort 默认 high、不显式设置参数），
把定档时点推到卡 09 之前。**

依据是**测量仪器的归属**，不是成本权衡：

> 降档最危险的失败形式是**少抽**，而不是抽错。
> 逐字引用判据对「漏抽」完全无感——少抽的对象根本不存在，没有任何判据会为缺席者报警。
> 而能看见「漏抽」的判据，正是卡 05 要建的语义判定者。

因此此刻能做的对照只能回答「引文保真度是否下降」，回答不了「知识覆盖率是否下降」。
在只有半边证据时定档，一旦低档真的在悄悄少抽，这个结论不会被任何现有判据推翻——
我们会带着一个错误的放行信号跑完 336 个锚点。

（附带实测支持：推理长度与锚点体量的皮尔逊相关仅 **0.506**，而锚点体量本身跨 **51.9 倍**
（305B→15,838B）时推理只跨 **13.3 倍**（1,086→14,396 字符），content 输出几乎恒定
（546–1,032 字符）。最大的 15.8KB 锚点只花 12,379 推理字符，而 712B 的小锚点花了 10,727。
⇒ 推理更像每锚点的固定开销。这条支持「降档很可能省得下来」，但它是关于**省不省**的证据，
不是关于**掉不掉质**的证据，故不改变上面的结论。）

## 被否决的方案

| 方案 | 否决理由 |
|---|---|
| 先在 chapter4 上做 effort=low 受控对照，再开 05 | 对照的判据（逐字引用 + 对象数 + 类型分布）只能测「低档会不会当场塌」，测不了「低档是否悄悄少抽」。前者的结论足以让人产生「已验证」的错觉，而这正是最危险的：它给出的是一个**看起来完备**的放行信号。成本（20 次调用，占全书推算预算 0.3%）确实很低，但答案不完整，低价买入半个结论不值。 |
| 不做对照，直接定低档开 05 | 省 20 次调用。若低档真的塌，窟窿要到 336 个锚点跑完才暴露，返工成本是抽样成本的 16.8 倍。且会丢弃已产出的唯一一次真实档位参照点。 |

## 后果

**正面**
- 卡 05/07 在现状口径下推进，不引入额外变量；卡 05 建成的语义判定者可直接用于降档对照。
- 本轮实测数据（用量、规模、推理↔体量相关性）已固化在本 ADR，定档时不必重新测量。

**负面 / 代价**
- **卡 09 开工前必须先回到本 ADR 定档**，否则全书跑批会按未经验证的满血口径消耗预算。
  这条是硬约束，不是建议。
- 推理档位在此之前不可配置；`llm-client.mjs` 不新增对应参数。

**必须遵守的约束**
- 定档时**不得**只依据「引文保真度未下降」；必须以卡 05 的语义判定者判据为主证据。
- 定档时**必须**同时评估生产者与判定者两层——卡 05 的判定者本身也是 LLM 调用。
- 本 ADR 的用量数字是**实测**，全书数字是**推算**；后续引用时不得把推算写成实测。

## 核实方式

```bash
# 请求体字段（实测）
grep -n "model: config.modelId" -A6 pipeline/tools/llm-client.mjs
# 用量（实测，回执为生产证据）
node -e 'const r=require("./pipeline/registry/run-9a30407d7271.receipt.json");console.log(r.model.tokens, r.model.tokensDetail)'
# 全书锚点（实测；只调纯函数，不落盘）
node --input-type=module -e 'import {buildAnchorIndex} from "./pipeline/tools/anchor-index.mjs";
for (const n of ["introduction","chapter1","chapter2","chapter3","chapter4","chapter5","chapter6","chapter7","chapter8","chapter9","chapter10","afterword","reference-answers"])
  console.log(n, (await buildAnchorIndex(`sources/ai-agent-book-zh/book/${n}.md`)).anchorCount)'
# 端点可用档位（实测，只读 GET）
node --input-type=module -e 'import {resolveLlmConfig} from "./pipeline/tools/llm-client.mjs";
const c=await resolveLlmConfig({overrides:{modelId:"deepseek-v4-pro",baseUrl:"https://api.deepseek.com"}});
console.log((await (await fetch(`${c.baseUrl}/models`,{headers:{Authorization:`Bearer ${c.apiKey}`}})).json()).data.map(m=>m.id))'
# → ["deepseek-flash", "deepseek-v4-pro"]
```
