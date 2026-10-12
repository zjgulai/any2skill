# ADR-023 · `parseModelPayload` 围栏正则未锚定：合法响应被解析器切坏

- 状态：已采纳（2026-10-12）
- 触发：全书首跑 13 个文件中 6 个退出码 4，`engineeringFailure.kind` 全部是 `layer2-response`
  ——**6/6 的原始响应本来就是合法 JSON，是解析器把它切坏的**（交接文档的「裸换行」归因被证伪）
- 影响面：
  - 新建 `pipeline/tools/model-json.mjs`：全流水线唯一的响应解析实现
  - `pipeline/tools/layer2-extractor.mjs`：`parseModelPayload` 改用 `model-json.mjs`
  - `pipeline/tools/judge.mjs`：`parseJudgeVerdict` 改用 `model-json.mjs`
  - `pipeline/tools/theme-proposer.mjs`：`parseThemeProposal` 改用 `model-json.mjs`
  - `pipeline/tools/antipattern-synthesis.mjs`：`parseSynthPayload` 改用 `model-json.mjs`
  - `pipeline/tools/test/model-json.test.mjs`：新建，覆盖三种形态 + 6 例首跑真实样本
  - `pipeline/tools/test/layer2-real.test.mjs`：补 3 个回归用例
  - `pipeline/tools/test/judge-verdict.test.mjs`：补 1 个判定者视角的回归用例
  - `PIPELINE_VERSION` **不变**（提示词未改动，旧回执仍然有效）

---

## 根因：解析器把合法 JSON 切坏了

### 归因过程

交接文档（`handoff-2026-10-11.md` §2）的归因是「模型在 JSON 字符串里写了裸换行」。
复现发现此判断**不成立**：

```bash
node -e '
import("./pipeline/tools/layer2-extractor.mjs").then(m=>{
  require("fs").readdirSync("pipeline/registry")
    .filter(x=>x.startsWith("run-failed-")&&x.endsWith(".layer2-raw.json"))
    .forEach(f=>{
      const t=require("./pipeline/registry/"+f).rawText;
      try{JSON.parse(t);console.log(f,"→ 本身合法");}
      catch(e){console.log(f,"→ 本身不合法",e.message.slice(0,40));}
    });
});'
# 输出：6 份全部「本身合法」
```

`JSON.parse(rawText)` 6/6 成功，但 `parseModelPayload(rawText)` 6/6 失败。

### 缺陷代码（旧 `parseModelPayload`）

```js
const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)   // ← 没有 ^ / $
const body = (fenced ? fenced[1] : raw).trim()
// 然后 JSON.parse(body) 或 JSON.parse(body.slice(start, end+1))
```

**技术书稿里几乎每个锚点都含代码块**。模型把 `evidenceQuote` 忠实地抄进去，
于是 JSON 字符串**内部**出现了一对 ```` ``` ````。这个未锚定的正则从响应头部开始，
匹配到字符串内那个围栏的**结束符**，把一大段中间内容当成「围栏壳」剥掉——
`body` 就是那段碎片（`bash\ngit clone...`），自然不是 JSON。

错误串 `Unexpected token 'b', "bash\ngit "...` 里的 `'b'` 正是被切剩的 `bash` 的首字母。

### 同一缺陷出现在四个解析器

| 文件 | 函数 | 旧正则 |
|---|---|---|
| `layer2-extractor.mjs` | `parseModelPayload` | `/```(?:json)?\s*([\s\S]*?)```/` |
| `judge.mjs` | `parseJudgeVerdict` | 同上 |
| `theme-proposer.mjs` | `parseThemeProposal` | 同上 |
| `antipattern-synthesis.mjs` | `parseSynthPayload` | 同上 |

判定者那一处尤其危险：锚点原文是它的输入，含代码块的概率与第 2 层同样高。
一个本该裁决为「支撑」的响应会被判成「解析失败」，而这两者在回执里类型不同，
实际表现却都是「没通过」。

---

## 决策

### 决策 1：提取共享模块 `model-json.mjs`

按仓库「单一真源」既有立场（`README.md`「理由码表不另抄一份」的原则），
实现**一处**，四处复用——而不是把修法抄四遍，下次再有人加第五个解析器时又复现缺陷。

### 决策 2：解析逻辑顺序（顺序是判据的一部分）

```
① 整份原样 → ② 锚定围栏（^…$）→ ③ 首 { → 末 }
```

**① 必须排第一位**：下面两步都是「从响应里切一块出来」，切点猜错就会把合法 JSON 切坏。
这正是此次故障的机制。

**②「锚定」两字是关键**：旧正则的 `/[\s\S]*?/` 是惰性的，但没有 `$`，
所以它先匹配到字符串内那个 ```` ``` ````，然后 `.trim()` 取出碎片。
加上 `\s*$` 后，惰性匹配会在「第一个 ```` ``` ````+ 后续空白到串尾」不成立时回溯，
直到找到真正结束整份响应的那个 ```` ``` ````。

### 决策 3：`PIPELINE_VERSION` 不变

提示词未改动，旧回执仍然有效。已完成文件（7/13）的断点续跑不受影响。

### 决策 4：交接文档的错误归因不追改

`handoff-2026-10-11.md` 是历史文档，按本仓规范「更正留痕、不静默删除」。
本 ADR 是其更正文件，阅读者应以本 ADR 为准。

---

## 未决

1. **重试策略是否需要**：此次修复后，六例失败全部是「解析器 bug」而非「模型输出问题」，
   因此不再需要「200 + 坏 body 重试」。若将来真遇到模型写坏 JSON 的情况，届时再立 ADR。
2. **`totals.anchors` 盲区**（交接文档未决项 2）与**失败花费进聚合回执**（未决项 3）：
   与本次修复独立，后续单独处理。


- 状态：已采纳（2026-10-12）
- 触发：全书首跑 13 个文件中 6 个退出码 4，`engineeringFailure.kind` 全部是 `layer2-response`
  ——模型在 JSON 字符串字段内写出了字面换行而非 `\n`，整份响应因此不是合法 JSON
- 影响面：
  - `pipeline/tools/layer2-extractor.mjs`：`buildSystemPrompt` 增加一条 JSON 格式要求；
    `promptFingerprint` 随之变化（**必然**，因为它哈希系统提示词全文）
  - `pipeline/run.mjs`：`PIPELINE_VERSION` 8 → 9（提示词指纹变化，旧/新回执必须身份可区分）
  - `pipeline/tools/llm-client.mjs`：`chatCompletion` 在 `res.ok` 但 body 不是合法 JSON 时加入有限重试

---

## 背景

### 失败形态

首跑 `book-07faf309c5a1` 的 6 份失败回执，`engineeringFailure.message` 形如：

```
Unexpected token 'e', "text\nExtra"... is not valid JSON
Unexpected token 'p', "python\nwo"...
Unexpected token 'b', "bash\ngit "...
```

六例的前缀（`text` / `python` / `bash`）全是 **markdown 代码围栏的语言标签**。
形状高度一致：模型在把带代码围栏的原文抄进某个字符串字段（最常见是 `evidenceQuote`）时，
把围栏内的**字面换行**原样写出，导致整份响应不是合法 JSON。

### 为什么一次坏响应杀死整个文件

三层叠加，每一层单独看都合理：

1. `llm-client.mjs:463`：重试只覆盖 HTTP `429 / 5xx`，**200 + 坏 body 走不进重试**。
2. `layer2-extractor.mjs` 的 `parseModelPayload`：只做去围栏与「首 `{` → 末 `}`」两种壳层容错，
   明确「不做语义修补」，失败即抛 `Layer2Error`。
3. `run.mjs`：`Layer2Error` 对文件是终止性的——该文件的全部剩余锚点不再推进。

失败率 46%（6/13 文件），且这 6 个跨了不同章节与不同长度，可排除偶发。

---

## 三条候选路线的决策

| 路线 | 选择 | 理由 |
|---|---|---|
| C：改提示词，要求字符串内换行写成 `\n` | **采纳** | 从根本上降低坏响应概率；这是正向约束，完全相容于既有设计立场 |
| A：解析层有限重试（坏 body 也重发） | **采纳** | 作为防御层处理残余的低概率失败；代价可控（最多 1 次额外调用），且与「不做语义修补」的立场不冲突——重试不碰内容 |
| B：容错修补（转义裸换行再 parse） | **拒绝** | 「静默改动内容」直接冲突「不做语义修补」既有立场；且无法可靠区分「代码围栏换行」与「字段之间的分隔」 |

**C + A 组合**：C 是主修，A 是防御层。单独 C 不保证模型 100% 遵守；单独 A 不保证重试后合法；组合后深度防御。

---

## 决策细节

### 决策 1：提示词新增 JSON 格式要求（路线 C）

在 `buildSystemPrompt` 的「硬性要求」列表末尾追加一条（原有 7 条 → 8 条）：

> 8. **JSON 格式**：输出必须是合法 JSON。字符串值内的换行**必须写成 `\n`**，不得使用字面换行
>    （即不能在 JSON 字符串里直接回车）。尤其注意 `evidenceQuote` 里如果原文含代码块，
>    代码块内的每一行之间写 `\n`，不要直接换行。

**为什么加在系统提示词末尾而非第 6 条（JSON 形状）旁**：第 6 条描述的是 JSON 的**结构形状**；
新条描述的是 JSON 的**编码合法性**，两者关注点不同，分开表述更容易被模型各自识别。

**为什么不在 `evidenceQuote` 的引文要求（第 2 条）里加**：那里说的是「逐字复制」，加换行规则会
模糊关注点；换行是 JSON 编码层问题，不是引文真实性问题。

### 决策 2：`PIPELINE_VERSION` 8 → 9

提示词任何改动都必须升版本（ADR-014 的既定规则）。版本进运行身份，确保旧回执与新回执
可区分，断点续跑不会用旧格式的缓存污染新产出。

### 决策 3：解析层有限重试（路线 A）

在 `llm-client.mjs` 的 `chatCompletion` 里，当 `res.ok` 但 JSON 解析失败时加入重试：

- 最多额外 **1 次**（即最多共 2 次调用，不是原来的 `maxAttempts`）
- 重试前等待独立的 `badBodyRetryDelayMs`（缺省 **0ms**，测试环境不引入延迟）
- 重试耗尽后仍抛 `LlmCallError`（行为与现在相同，错误信息改为「模型返回的 body 不是合法 JSON，已重试」）
- `ledger.retries` 递增，使「因坏 body 重试了一次」在账本上可见
- 回执的 `reuseObservation` 不受影响（重试发生在调用层，不触及对象复用逻辑）

**为什么最多 1 次**：坏响应通常是模型在那次调用里出的形式错误，一次重试已能覆盖大多数情况；
多次重试只会多花钱且掩盖「提示词本身有问题」的信号。

**为什么 badBodyRetryDelayMs 独立于 retryDelayMs**：坏 body 不是服务端过载信号，
不需要退避；与限流重试共用同一个延迟会让测试变慢（限流重试延迟通常 > 0）。

### 决策 4：重试记录进回执

`layer2-raw.json` 的每个锚点 record 已有 `usage` 与 `finishReason`。
重试不新增字段——`ledger.retries` 已进 `usageSoFar`（既有字段），
「这个锚点重试过」的信号在账本里可读。

---

## 未决

1. **重试率是否需要进聚合回执**：目前不进，可等全书第二次跑后看是否有必要。
2. **提示词改动效果验证**：第二次全书跑后，看 `layer2-response` 类失败是否降为 0；
   若仍有，看错误串形状——是否与「换行」无关的新失败类型。
3. **`totals.anchors` 盲区**（交接文档未决项 2）与**失败花费进聚合回执**（未决项 3）：
   与本次 ADR 独立，可后续单独处理，不进本次改动。
