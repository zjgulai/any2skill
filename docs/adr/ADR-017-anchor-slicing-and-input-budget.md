# ADR-017 · 整章批量的三处缝隙：零产出锚点、按章容量护栏、以及一条被真实数据证伪的验收措辞

- 状态：已接受（决策者：用户，2026-10-09）
- 日期：2026-10-09
- 关联：ADR-001（全书范围的立项）、ADR-005（三段式）、ADR-008（不静默的默认行为）、ADR-009（判据的缺席者问题）、ADR-011（引文的两个用途）、ADR-013（提示词漂移的处置）
- 兑现：卡 07 的全部验收项；卡 08 从本轮的 `coverage` 与 `layer2.usage` 取数

## 背景

卡 07 要的是把流水线从「一个章节的少量对象」扩到「一个**整章**的完整提取」。但「整章跑完」这件事在卡 04 就已经成立了——chapter4 的 8 次真实运行**每次都是 20 次调用、20 条逐锚点明细**。因此这一卡真正的价值不在「跑完」，而在**三处缝隙**：

1. **调用了、但没有产出**。原验收测的是「有没有对该锚点发出调用」，而实际失效模式是调用了却返回空。它从缝隙里穿过去，且流水线对此零信号。
2. **该信号只在部分路径上存在**。复用路径与重判路径的 `perAnchor` 是空数组，而那两条正是「回头查这批对象」时最常走的路。
3. **超预算的锚点没有出口**。切分方式必须落在结构边界上，且不得被第 3 层看见。

## 决策

### 决策 1 · 零产出判据落在「对象 × 索引」上，不读 `perAnchor`

`coverage.withoutObjects` 由「哪些锚点没有任何对象把 `sourceRefs` 指向它」推导，而不是从 `perAnchor[].objectCount === 0` 读出。

**理由是那条信号会在两条路径上整体消失**（实测）：纯复用路径返回的是产出者的回执（还有 `perAnchor`），但**冻结产物复用分支与重判分支**的 `perAnchor` 是 `[]`——于是「哪个锚点没产出」在重判路径上完全答不出来，而重判恰恰是「同一批对象、只看换尺子之后结论怎么变」时最常走的路径。

**这个判据的方向是保守的**：未处理的锚点会落进「零产出」而不是消失。宁可多报一个「被处理但没产出」，不可漏报一个「整节被静默跳过」——后者是 ADR-009 论证过的那个形态（**少抽的对象根本不存在，没有任何判据会为缺席者报警**）。

重判路径同时补上了 `perAnchor` 的沿用：逐锚点明细是**生产事实**，与 `calls`/`tokens` 同类，此前只沿用了账本、把它丢成了空数组。

### 决策 2 · 「被处理」不是猜的：`processedKnown` 与「零产出」分列

`withoutObjects` 在两条路径上含义不同：

| 路径 | 该清单的真实含义 |
|---|---|
| 真的按锚点调用过（真实第 2 层） | **被处理但产出 0 个对象** |
| 未按锚点调用（替身、夹具注入） | **没有任何对象指向它**（可能压根没处理过） |

因此 `coverage` 里 `processedAnchors` 取「逐锚点明细的条数」（本次真的为哪些锚点发过调用），取不到时是 `null`，并附一句 `reading` 说明当前这份清单答的是哪个问题。CLI 的措辞随它切换，**不把「没被指向」写成「被处理但零产出」**。

### 决策 3 · 容量护栏按**结构边界**切分，切分对第 3 层不可见

`splitAnchorIntoSlices` 的切点只有一种：**空行且不在代码围栏内**（markdown 段落边界）。刻意不做的事：不按字节硬切（会在句子中间断开）、不在围栏内切（会把一个代码块劈成两半，而代码块往往正是一段工程规则的唯一证据）。

单个段落自身超预算时**整段交出并标 `oversized: true`**——宁可让这一次调用超预算，也不把它切断；这是唯一允许超预算的出口，且它是**可见的**（进回执的 `layer2.splits`）。

**溯源不受影响**：切片只是喂给模型的窗口，`sourceRefs` 仍由 `materializeObject` 按**锚点**填入，因此每个对象依旧解析到第 1 层的同一个锚点、同一个 `lineStart`/`lineEnd`/`contentHash`。切分因此不能、也不该被下游看见——由测试逐条比对索引钉住。

`seq` 是**跨片累计**的（从 `carriedObjects.length + 1` 起算），因此对象 id 只取决于「锚点 + 该锚点内的次序」，与切法无关。

### 决策 4 · 缺省预算**不触发**切分，且这一点由测试钉住

`DEFAULT_MAX_ANCHOR_BYTES = 24000`。**这是选定的策略，不是测量结果**——把它说清楚比数字本身重要（见下「实测口径」）。全书 336 个锚点里最大的是 16,718 字节，因此**缺省预算下全书没有任何锚点会被切分**；`layer2.splits` 是空数组，而**「为空」本身就是一条可核对的结论**：它说明这次运行的每个对象都来自一次看完整节的调用。

机制由构造出来的超预算锚点钉住，不靠真实语料偶然触发。为什么不设更小（例如 8,000）：切分会把一节的语义切开，而「一节内跨段落的综合」正是最有价值的对象形态。

### 决策 5 · 断点续跑下沉到**片**，但不是无条件续

半成品新增 `inFlight: {anchor, slicesDone, sliceCount}` 与 `maxAnchorBytes`。续跑时逐项核对：「inFlight 必须是**下一个**锚点」，且「`slicesDone` 落在该锚点用**同一个预算**复算出的片数区间内」。任一不成立即丢弃半成品从头跑。

`checkPartialUsable` 另加一条不变量：半成品里「在跑锚点」的那些对象**必须是已产出对象的尾部**（收尾那次落盘最后写入）。不成立即抛错拒绝续跑——**续错位置会静默重复产出或丢对象，而两者都不会在计数上露出破绽**（总数看起来一样）。

## 实测口径

### 一 · 字节 → 输入 token 的换算（这是测量，可复算）

取 `run-7afb98d262b5.layer2-raw.json` 里 chapter4 全部 20 个锚点，用每锚点的 `usage.prompt_tokens` 对索引里的 `contentBytes` 做最小二乘拟合：

```
prompt_tokens = 1213.2 + 0.21175 × bytes        残差 max|.| = 125.5 token
```

即 **1 输入 token ≈ 4.72 字节正文**，另加约 **1,213 token** 的固定开销（系统提示词 + 用户提示词模板 + 服务端 chat 模板）。复算脚本见「复现方式」。

**这两个数不参与任何判据**——判据是字节数本身，因此不会随模型的换算出错而漂移；它们只用来把字节预算翻译成人看得懂的 token 量级。

外推（**推算**，非实测）：全书最大锚点 `chapter10#h3-6` = 16,718 字节 → 1,213 + 3,542 ≈ **4,755 输入 token**；缺省预算 24,000 字节 ≈ **6,298 输入 token**。两者都远低于常见的 32K 输入窗口，因此缺省预算下切分不会被触发。

锚点体量的实测分布（**实测**，来自 `pipeline/knowledge/` 下全部 **13** 份索引）：

| 项 | 值 |
|---|---|
| 全书锚点数 | 336 |
| 最大锚点 | `chapter10#h3-6`，16,718 字节 / 159 行 |
| chapter4 最大锚点 | `chapter4#h2-6`，15,838 字节 / 112 行（实测 `prompt_tokens = 4536`） |
| 超过 24,000 字节的锚点 | **0 个** |

### 二 · 八次真实运行的覆盖分布（这是本书最重要的一条**分布**事实）

盘上 8 份 chapter4 的真实回执（`model.calls > 0`、非复用、非失败），逐份复算 `perAnchor`：

| runId | calls | perAnchor | 有产出 | 零产出锚点 |
|---|---|---|---|---|
| `run-0daf5febec8a` | 20 | 20 | 19 | `h2-9` |
| `run-11ebe0306e01` | 20 | 20 | 18 | `h3-7`、`h2-9` |
| `run-3cf2f50b3870` | 20 | 20 | 19 | `h2-9` |
| `run-470138ece6a3` | 20 | 20 | 19 | `h2-9` |
| `run-7afb98d262b5` | 20 | 20 | 19 | `h2-9` |
| `run-9a30407d7271` | 20 | 20 | 19 | `h2-9` |
| `run-bfba30f1feca` | 20 | 20 | 19 | `h2-8` |
| `run-da280b5930ca` | 20 | 20 | 19 | `h2-8` |

三条读数：

1. **「已处理锚点数 = 索引锚点数」在 8/8 里成立**（20 = 20）。这是卡 07 用来**机械排除静默漏节**的那条判据，它站得住。
2. **8/8 的运行都恰好有 1–2 个锚点零产出，且从来不是同一个。** 零产出次数的分布是 `h2-9`（思考题）6 次、`h2-8`（本章小结）2 次、`h3-7`（多模态感知，305 字节）1 次。
3. 因此「整章跑完后 9 个二级锚点**全部有产出**」**在真实数据上不成立**——每一次真实运行都至少有一个二级锚点产出为空。

### 三 · 对卡 07 第 9 条验收措辞的更正（**原文如此、实测为假、已改正**）

卡 07 第 9 条原文写的是：

> 对 `chapter4.md`（…9 个 `##`…）跑整章，断言 9 个二级锚点**全部被覆盖到** —— 即没有整节被静默跳过

**「被覆盖到」有歧义，而两种读法给出相反结论**：

| 读法 | 对真实数据的结论 | 是否成立 |
|---|---|---|
| 该锚点**被处理过**（发出了调用） | 9/9 全部被处理 | ✅ 成立（且 8/8 次运行成立） |
| 该锚点**产出了对象** | 8/8 次运行里都有 1 个二级锚点为空 | ❌ **不成立** |

紧跟其后的第 21 条（「断言『已处理锚点数 = 索引中的锚点数』，以机械方式排除静默漏节」）表明**原意是第一种读法**——「静默跳过」指的是没被处理。因此本轮的处置是：

- **不改验收意图**，第 21 条的机械判据照做，并由测试与「整章跑完即断言 `perAnchor.length === anchorCount`，否则抛错」硬实现；
- **把两件事在回执里分开**：`coverage.processedAnchors`（被处理）与 `coverage.withoutObjects`（没被指向）；
- **不把第二种读法写成通过**。它是一种**真实且每次都会发生的分布**，不是缺陷，但它必须被看见——所以它是固定字段，不是被解释掉的噪声。

**第 9 条按第二种读法写进任何交付物都是错的。** 这一条留痕于此，而不是静默改写。

## 本轮修掉的缺陷

### 测试抓到的：切分收尾少切一刀（**真实缺陷**）

`splitAnchorIntoSlices` 的收尾分支无条件 `spans.push([from, end0])`，没有检查「从本片起点到锚点末尾」是否仍超预算。

实测复现（预算 265 字节，六段正文，六处可用切点）：

```
修前：138 / 255 / 382   ← 最后一片比预算大 44%，而它明明还能在 pendingEnd 处再切一刀
修后：138 / 255 / 255 / 126
```

**它不会报错**——只会让这次调用更贵，且**切分机制在它本该生效的地方悄悄失效**。测试里那条「非超大单段不得超预算」的断言就是为它写的。

### 我自己的操作缺陷

- 第一次写 `checkPartialUsable` 的片校验时用了 `index.lines ?? partial.lines ?? []`：索引根本不带 `lines`，退化成空数组后 `splitAnchorIntoSlices` 会把每一片都算成 1 片，从而**拒绝一切合法的片中断点**。改成显式传入 `lines`，并在不传时**跳过**片校验（而不是用空数组假装校验过）。
- 片中断点校验最初写成「信 `partial.inFlight` 的字段」，改成用**同一个预算复算片数**再比对——片数是「源文 + 预算」的函数，源文没变而预算变了时，旧半成品记的位置可能已经不存在。
- 中途一次 `python3` 批量改写把 `checkPartialUsable` 的**全部**返回点加上了 `inFlight` 字段：11 个返回点里有一个（成功分支）本来就带，替换脚本实际命中 10 个。已核对 11 个返回点全部形状一致（改测试时才发现形状不一致会让 `deepEqual` 型的断言**按字段多余而失败**，而不是按语义失败）。

### 由既有测试暴露的

- `checkPartialUsable` 的返回形状变了 → `layer2-real.test.mjs` 的 `deepEqual` 断言失败。这条失败是**有价值的**：它证明那条断言真的在钉形状，而不是在钉一个恒真的东西。

## 未决项

1. **零产出锚点该不该有阈值告警。** 本轮的处置是**不给阈值**：`h2-8`/`h2-9` 这类末节本就可能不承载知识对象（那是正确的零产出），而一个正文节出现在清单里则几乎一定是漏抽。两者的区别只能靠人看清单。要定阈值，先要有跨章的分布——卡 09 的全书运行才是取数的地方。
2. **`h3-7`（多模态感知，305 字节）的零产出**：它是全书最小的锚点之一。零产出与「节太短」是否相关、相关到什么程度，本轮 n=1，不作结论。
3. **切分对**质量**的影响没有测过**：缺省预算下全书没有锚点被切分，因此「切片产出的对象质量是否低于整节产出」这个问题在本轮的语料上**不可测**。它在换一本更大的书时才会变成真问题，届时应先跑「同锚点、整节 vs 切分」的对照。
4. **片级续跑的内存占用**：半成品的 `objects` 数组每片重写一次。20 个锚点的量级下无所谓；一个几千锚点的语料需要改成追加式落盘。本轮不做。

## 复现方式

```bash
# 全部测试（321 项，零网络、零凭据）
npm test

# 只跑本卡的验收
node --test pipeline/tools/test/single-chapter-batch.test.mjs

# 缺省预算下确认「一片都不切」
node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md --repo-root /tmp/x
#   → 回执 layer2.splits 为 []，调用 0 次（替身路径不按锚点调用）

# 触发切分（预算 2000 字节）
node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md --repo-root /tmp/x --max-anchor-bytes 2000
```

## 复算口径

**字节 → token 拟合**（对应「实测口径」一）：

```bash
node --input-type=module -e '
import { readFileSync } from "node:fs";
const raw=JSON.parse(readFileSync("pipeline/registry/run-7afb98d262b5.layer2-raw.json","utf8"));
const idx=JSON.parse(readFileSync("pipeline/knowledge/chapter4.anchors.json","utf8"));
const by=new Map(idx.anchors.map(a=>[a.anchor,a]));
const pts=raw.anchors.filter(a=>by.has(a.anchor)&&a.usage).map(a=>({x:by.get(a.anchor).contentBytes,y:a.usage.prompt_tokens}));
const n=pts.length, sx=pts.reduce((s,p)=>s+p.x,0), sy=pts.reduce((s,p)=>s+p.y,0);
const sxx=pts.reduce((s,p)=>s+p.x*p.x,0), sxy=pts.reduce((s,p)=>s+p.x*p.y,0);
const b=(n*sxy-sx*sy)/(n*sxx-sx*sx), a=(sy-b*sx)/n;
console.log("prompt_tokens =",a.toFixed(1),"+",b.toFixed(5),"× bytes  ；1 token ≈",(1/b).toFixed(2),"字节");
console.log("残差 max|.| =",Math.max(...pts.map(p=>Math.abs(p.y-(a+b*p.x)))).toFixed(1));
'
```

**八次真实运行的覆盖分布**（对应「实测口径」二）：

```bash
node --input-type=module -e '
import { readdirSync, readFileSync } from "node:fs";
const idx=JSON.parse(readFileSync("pipeline/knowledge/chapter4.anchors.json","utf8"));
for (const f of readdirSync("pipeline/registry").filter(x=>x.endsWith(".receipt.json")).sort()) {
  const r=JSON.parse(readFileSync("pipeline/registry/"+f,"utf8"));
  if (!(r.source?.path||"").includes("chapter4") || r.engineeringFailure || r.layer2?.reused===true || !(r.model?.calls>0)) continue;
  const pa=r.layer2.perAnchor||[];
  console.log(r.runId, "calls="+r.model.calls, "perAnchor="+pa.length, "有产出="+pa.filter(a=>a.objectCount>0).length,
    "零产出=["+pa.filter(a=>a.objectCount===0).map(a=>a.anchor).join(",")+"]");
}
'
```

**锚点体量分布**（对应「实测口径」一的表）：

```bash
node --input-type=module -e '
import { readdirSync, readFileSync } from "node:fs";
const files=readdirSync("pipeline/knowledge").filter(f=>f.endsWith(".anchors.json"));
let n=0,max={bytes:0},over=0;
for(const f of files){const idx=JSON.parse(readFileSync("pipeline/knowledge/"+f,"utf8"));
 for(const a of idx.anchors){n++; if(a.contentBytes>max.bytes) max={bytes:a.contentBytes,anchor:a.anchor};
  if(a.contentBytes>24000) over++;}}
console.log("索引文件数",files.length,"锚点总数",n,"最大",max.anchor,max.bytes,"超 24000 的",over);
'
```

实测输出：`索引文件数 13 锚点总数 336 最大 chapter10#h3-6 16718 超 24000 的 0`。
