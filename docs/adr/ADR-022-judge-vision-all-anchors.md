# ADR-022 · 判定者的视野扩到全部锚点区间，判定对象由「主引文」改为「锚点区间」

- 状态：已采纳（2026-10-10）
- 触发：已发布 skill 的「常见陷阱」段只有 1 条（建议值 6），追因到跨章反模式池 16 条里被拒 5 条
- 影响面：
  - `pipeline/tools/judge.mjs`：`JUDGE_PROMPT_VERSION` v1 → v2、`JUDGE_INPUT_KEYS`
    由 `['claim','quote','anchorText']` 改为 `['claim','quote','anchors']`（**仍是三个键**）
  - `pipeline/tools/verifier.mjs`：新增回执字段 `judgedAnchors`；`checkedAgainst` 语义**不变**
  - `pipeline/tools/tier-probe.mjs`：支持多份 `--anchors`、`--tiers default`、逐对象判定理由落盘
  - `pipeline/build-skill.mjs` + `pipeline/tools/skill-builder.mjs`：装配与校验支持跨章出处
  - `PIPELINE_VERSION` 7 → 8（判据一改，旧回执与新回执必须身份可区分）

---

## 背景：这次不是「引文不够」，是「主张比引文宽」

诊断取自 `run-5d72a0637d50.antipattern-verdicts.json`（v1 那一次）的 16 条判定：被拒 5 条，
而**每一条的引文逐字比对都是 strict 通过**（`quoteComparison.strict = true`，`deterministic.ok = true`）。
也就是说被拒的原因不在引文真伪，在语义层：

| 对象 | 锚点段数 | 被拒时的理由（v1） |
|---|---:|---|
| `AP-SYNTH-T02-01` | 2 | 未支持「任务成功率显著下降、经常违反关键业务规则」这一**更具体**的后果断言 |
| `AP-SYNTH-T02-02` | 1 | 未涉及「未细化到可执行程度」等断言，**只能部分支撑** |
| `AP-SYNTH-T02-03` | 2 | 主张的 pattern 部分**比引文更宽泛绝对** |
| `AP-SYNTH-T02-04` | 1 | 未提及「反复尝试失败」及中文弯引号的**具体示例**，主张范围更宽 |
| `AP-SYNTH-T12-06` | 1 | **方向相反**（引文说不能修改，主张说允许修改）——真错 |

四条是「主张越界」，一条是真错。而 `AP-SYNTH-T02-01` 的拒绝理由要的那句话
——「任务成功率下降超过 30%，Agent 经常违反关键业务规则」——**逐字就在该对象第二条锚点
（`chapter2#h3-17`）里**。旧契约把判定输入固定成 `{claim, quote, anchorText}`，而
`anchorText` 只解析 `sourceRefs[0]`（`verifier.mjs` 原第 565 行），判定者**按结构看不到第二条锚点**。

**结构性后果：旧口径下跨章综合是净损失。** 单章提取没有这个问题（主张天然只由那一个锚点承载），
实测 39/39 全过；跨章 16 条却拒 5 条——而跨章综合唯一能做的事就是「把不同章节的同一个坑合并」，
那按旧契约**不可被验证**。

---

## 决策

### 1. 判定者的视野 = 对象声明的**全部**锚点区间

`JUDGE_INPUT_KEYS` 的 `anchorText`（单段）改为 `anchors`（数组，按 `sourceRefs` 声明顺序，
第一条是主锚点）。**键数仍是三个**：放宽的是取值个数，不是输入形状，白名单守卫
（`assertJudgeInputShape`）照旧拦得住「在三样之外多塞一样」。

`anchors` 的元素只取 `{anchor, text}` 两个叶子字段，不摊开调用方传来的对象——与 `buildClaim`
同一条纪律：构造式隔离不会被上游新增字段绕过。

### 2. 判定对象由「主引文」改为「锚点区间」——这是本次**最大**的语义变化

v1 的措辞是「判定该**引文**是否支撑该主张」，v2 是「判定这些**锚点原文**是否支撑该主张」。
区间 ⊇ 引文，所以这条**对单锚点对象也放宽**。它是有意的，不是副作用：判据要回答的问题是
「该主张是否被书里这段文字承载」，而不是「生产者引的那一小段是否字字承载它」。

依据是引文长度被 `antipattern-synthesis.mjs` 限在 400 字，合法主张的支撑完全可能落在
被引片段之外——只认引文会把这种主张一并误杀，与 `AP-SYNTH-T02-01` 同类。

**明确放弃的东西：「证据必须点名」在判定环节失去约束力。** 判定者现在可以从生产者没有点名的
段落里找到支撑。逐字引文纪律本身未失效（第 3 层仍机械执行），但「主张必须由所引的那一段承载」
这条要求退出了判据。实测代价见「后果」。

### 3. 回执：`checkedAgainst` 语义不变，新增 `judgedAnchors`

`checkedAgainst` 仍是「主锚点区间」（严格取 `sourceRefs[0]`，v1 语义逐字保留）；
新增 `judgedAnchors` 记录判定者实际收到的全部锚点区间。

两个字段都留着，因为这是两个不同的事实：前者答「主锚点是哪个」，后者答「判定者看了哪些」。
`judgedAnchors` **不去重、不排序**——它是「对象声明的支撑集合」的忠实投影，同一锚点被声明两次
是生产侧缺陷，让它出现在回执里比在这里静默抹平更有用。

### 4. `PIPELINE_VERSION` 7 → 8

版本号进 `runId`（`pipeline:v${PIPELINE_VERSION}`）。判据一改，同一批对象的判定结果就变了，
而旧回执必须原样保留而不是被覆盖——这是「重判是一次显式操作」的前提。

### 5. 装配层支持跨章出处（本次带出的连带修复）

`build-skill.mjs` 原先只把**本簇那一章**的锚点索引交给装配与校验
（`anchorIndexes: [index]`）。跨章反模式的出处按定义落在别的章节，于是「跨章反模式第一次真的进
skill」这一刻，门禁必然报 `SOURCEREF_UNRESOLVED`——而它失败得**看起来像内容错误**
（「锚点不可解析」），实际是我们没给足比对范围。校验器本身早就支持多份索引
（`verify-skill.mjs` 有 `Array.isArray(anchorIndexes)`），是调用方只给了一份。

三处一起改：索引集合补齐被引用到的各章（按源文**重建**，不读盘上可能过期的 `.anchors.json`）；
`assembleSkill` 的「深度阅读」段补上跨章反模式的出处（行号取自**锚点索引**，索引里查不到就跳过、
不臆造）；契约 provenance 新增 `anchorIndexHashes`（`anchorIndexHash` 单值字段语义不变，保持可比）。

这条缺口此前从未暴露，因为过去每次装配 `crossChapterAntipatternsKept` 都是 0。

### 6. 跨章综合的运行身份解耦（本次带出的第二处连带修复）

**改的是什么。** `synthRunId` 拆成两个：

| 函数 | 吃哪些输入 | 命名哪些文件 |
|---|---|---|
| `synthRawRunId` | 主题集合 + **生产者**提示词指纹 + 目录哈希 + 模型 | `<id>.antipattern-raw.json`、`<id>.antipattern-raw.partial.json` |
| `synthRunId` | 上面全部 + `judgeEnabled` + **判据提示词指纹** + `PIPELINE_VERSION` | `<id>.antipattern-receipt.json`、`<id>.antipattern-verdicts.json` |

两个摘要都掺入 `kind` 字段，使 raw 身份与产物身份**在任何配置下都不相等**——否则
「未启用判定者」的产物身份可能与 raw 身份同形，读者只凭文件名分辨不出装着哪一类。

**为什么不照「把 `PIPELINE_VERSION` 加进那一个 runId」的直接解法。** 续跑
（`replayThemeFromRaw`）只认 `prior.runId === 本次身份`，即**身份一换，已经付过钱的原始响应
就再也读不到**。而该模块的注释明写着它的用途：「付过钱的产出不得因**下游**改动而重花一次——
改合并规则、改标记规则、修一个物化 bug，都走这条路，而不是重新调模型」。判据提示词、
合并规则、版本号**全都属于下游**。把判据身份塞进那一个 id，等于每次改判据都要重买全部主题的
原始响应——直接与这条设计意图相反。所以判据侧进的是**产物**身份，raw 身份不动。

**顺带补的两处字段缺失**（都是实测的）：

- 跨章综合回执顶层**没有 `pipelineVersion`**（第 2 层回执 `run-830be7cff17d` 有），
  于是「这份回执是哪一版流水线产的」只能靠 `createdAt` 加 git 历史反推。新增回执
  `pipelineVersion` 与 `producerRunId`（后者让「这份回执对应哪份 raw」不必靠文件名猜）。
- 判定表顶层只有 `schemaVersion` / `runId` / `verdicts`，**自己不声明判据身份**。
  schema `antipattern-verdicts/v1 → v2`，新增 `producerRunId` / `judgeEnabled` /
  `judgePromptVersion` / `judgePromptFingerprint` / `pipelineVersion`。

**下游选择规则一并改掉（否则身份只是装饰）。** `build-skill.mjs` 原先按 **mtime 最新**挑判定表
（`findLatestAntipatternVerdicts`）。身份拆开之后 registry 里会**同时留着**不同身份的判定表，
「最新」不再等于「与对象文件同一次运行」——中间只要跑过一次 `--no-judge`，最新那份就是一张
没过判据的判定表，而装配器会把它的 `status: pass` 当成门禁通过。现在改为：以**对象文件自己声明的
`runId`** 为准取同身份的那份；取不到才回退最新，并把 `identityMatch: false` 记进契约
（`gate.antipatternVerdictsIdentityMatch`）**并**打印到 stderr——回退不许伪装成匹配。

这条改动有可复现的负向验证（见「核实方式」末段）。

### 7. 合成层 §3 与判定者视野对齐，并按新对象集重建发布件

**改的是什么。** `buildSynthSystemPrompt` 的第 3 条（`pipeline/tools/antipattern-synthesis.mjs`）：

| | 措辞 |
|---|---|
| 旧 | 「**主张必须收窄到主锚点能承载的粒度。** …独立判定者会拿**主锚点那一段原文**来判断…主张里的每一条断言都要能从**主引文**里读出来…宁可产出几条窄而实的」 |
| 新 | 「**主张的支撑范围 = 你声明的全部锚点段落。** …① **引文是「点名」，不是「唯一依据」。** 把两章的结论合成一个更大的断言是**允许的**…② **但不得超出这些段落。** …若某条断言只能由你自己的概括推出、任何一段声明原文里都没有对应文字，就删掉它。」 |

**为什么必须改。** 旧 §3 是照着**旧**判定者的输入写的（「判定者只拿主锚点那一段」）。判定者的视野
放宽之后，这条要求就成了一条**比判据更紧的自我限制**——它不会产出错误对象，但会让跨章综合的收益
（合并两章结论）**结构性地拿不到**。第 ② 条是这次新加的，用来堵本文已量化的那个代价
（2 条主张仅凭区间即被接受、支撑落在引文之外）。

**代价（已付）。** §3 属于系统提示词，指纹进**生产者身份**，所以改它等于宣布此前所有主题的原始
响应作废：`prompt-76496276ce50 → prompt-654165a7668c`，`run-5d72a0637d50`（旧 raw 身份
与判定表身份在那时是同一个）→ raw `run-e7665bc7aada` / 产物 `run-6bc0e8a0e8b9`。
T02/T12 必须重买。**实测用量 85,210 tokens**（生产者 15,725 入 / 28,329 出；判定者 31,154 入 /
10,002 出）——事前推算给的是 0.15–0.25M，**偏高约 2–3 倍**。

**可比性评估（实测，逐项口径见「核实方式」）。**

| 指标 | 旧（§3 未对齐） | 新（§3 已对齐） |
|---|---|---|
| 对象数 | 16 | 14 |
| 跨章对象（去重后章节数 ≥2） | 4/16 = **25%** | 7/14 = **50%** |
| sourceRefs（均值 / 中位 / 最大） | 1.4 / 1 / 3 | 1.7 / **2** / 3 |
| pattern 字数（均值 / 中位 / 最大） | 40.2 / 39 / 60 | 45.6 / 47 / 69 |
| harm 字数（均值 / 中位 / 最大） | 41.7 / 45 / 58 | 48.7 / 45 / 88 |
| 主张（pattern+harm）字数（均值 / 中位 / 最大） | 81.9 / 83 / 113 | 94.4 / 95 / 140 |
| **主引文字数**（均值 / 中位 / 最大） | 104.9 / 86 / 258 | **106.2 / 91 / 170** |
| 判定（判定者 `judge-50ad9d57c1c8`，两批同判据） | 15 通过 / 1 拒 | 12 通过 / 2 拒 |

⚠ **逐条 id 对照没有意义，而这一点是做这次评估才明确下来的。**
`synthesizedIdFor(themeId, seq)`（`antipattern-synthesis.mjs:224`）把 id 派生为
`<前缀>-<主题>-<序号>`——**位置序号，不是内容身份**。`AP-SYNTH-T12-06` 在两批里是两条不同的
反模式（旧：`chapter9#h3-7`「允许业务 Agent 修改验证器」；新：`chapter5#h3-9` + `chapter2#h3-18`
「委托方忠诚」）。任何「同 id 的对象被改写了」式的读法都是错的；成立的只有聚合对照。

**读法（三条）。**

1. 预测兑现：跨章占比 25% → 50%、引用中位数 1 → 2、主张中位字数 83 → 95。这正是「允许合并两章
   结论」应当产生的形状。
2. **一个预期会出现、实际没有的信号**：主引文字数几乎没变（104.9 → 106.2）。放宽发生在**主张**
   一侧，生产者没有靠把证据引文拉长来蒙混——这与本文「负面/代价」第 1 条（「证据必须点名」退出
   判定环节）形成对照。
3. **一处新拒绝，原因已独立复核。** `AP-SYNTH-T12-06` 报 `QUOTE_MISMATCH`，**不是排版差异**：
   源码是 `“谁在跟我说话，我就尽力帮谁”`（`chapter5.md:343`，中文**双**弯引号），模型引文写成
   `‘…’`（**单**弯引号）。按 ADR-018 的口径，弯引号之间的替换**有意不放宽**（那是字符替换，
   不是零宽差异），判据拒得对。**但不得归因给 §3**：含弯引号的引文两批各 9 条
   （旧 9/22、新 9/24），这是一次笔误，n=1 不足以归因。

**两批共有、比 §3 效果更值得单独立项的一个模式。** 两次都恰好有一条 **T12** 对象的
**主张与原文方向相反**：

| 批次 | 对象 | 原文说 | 主张说 |
|---|---|---|---|
| 旧 | `AP-SYNTH-T12-06` | 「**不能**修改…验证器」 | 「**允许**业务 Agent 修改…」 |
| 新 | `AP-SYNTH-T12-03` | 「**只读**结构化字段、刻意隔离自由文本」 | 「独立安全检查模块**读取**上下文、思考过程或自由文本」 |

同一主题、同一种失效、不同的对象；判定者两次都抓到了。T12 是章节最多的主题（6 章）。
这条不属本次范围，记在「未决」第 5 条。

**发布件重建（已执行）。** 对象集变了，盘上的 `SKILL.md` 就不再对应当前对象集，而门禁二的哈希链
校验尚未构建——不重建就没有任何机制会提示这件事。重建结果：**5883 → 5923 字节**，段落条目数不变
（陷阱 3 / 深度阅读 5 / 核心原则 3 / 实践模式 2 / 何时使用 5 / 配套代码 6），跨章保留仍是
`AP-SYNTH-T02-03`、`AP-SYNTH-T02-04` 两条，两个新字段的取值一致
（`antipatternObjectsRunId` = `antipatternVerdictsRunId` = `run-6bc0e8a0e8b9`，
`antipatternVerdictsIdentityMatch` = `true`）。发布件与暂存件**逐字节相同**
（`sha256:6a6e0c92…`），且与契约 `gateReceipt.markdownHash` **闭合**。

净增 40 字节与陷阱段三字段合计净增 16 字符（≈40 字节 UTF-8）量级一致；**未逐字节归因**。

---

## 后果

### 回归（判据修订前后，同一批冻结对象、同一模型 `deepseek-v4-pro`、同一档位「不发 reasoning_effort」）

| 组 | v1 | v2 | 说明 |
|---|---|---|---|
| chapter4 单章 39 条 | 39/39 supported | **39/39 supported** | 39 个对象实测全为单 `sourceRef`，判定输入与 v1 **逐字节相同**，因此这组是「只换提示词」的**纯净对照** |
| 跨章 16 条（`tier-probe`） | 11 supported / 5 rejected | **14 / 2** | 与章节回归同一构造路径 |
| 跨章 16 条（流水线 `synthesize-antipatterns`） | 11 / 5 | **15 / 1** | 实际进产物的那一次 |

单章对照组 39/39 不变，说明改写提示词**没有**引起单章语料上的回退。

### 逐条归因（5 条变动，每条都有实测依据）

| 对象 | v1 → v2 | 机制 | 依据 |
|---|---|---|---|
| `T02-01` | insuff → supp | **视野放宽（真修复）** | v2 理由原文写「第二段实验 2-4」——用了 v1 看不到的锚点 |
| `T02-02` | insuff → supp | 判定对象：引文 → 区间 | 区间 1226 字含「产品经理必须将决策规则**明确到可执行的程度**」，生产者引文 157 字不含 |
| `T02-04` | insuff → supp | 同上 | 区间 920 字含完整的弯引号静默转换案例与「模型反复尝试、反复失败」，引文仅 63 字 |
| `T02-03` | insuff → supp | **主锚点本就承载**，v1 卡全称量词 → 宽松度/稳定性 | 主锚点原文含「大多数工具调用失败的根因不是模型不知道工具能做什么，而是不知道工具不能做什么」逐字 |
| `T12-01` | supp → **insuff** | **判定者不稳定**（跨路径同输入翻转） | 原文确无「攻击更容易穿透」；`tier-probe` 三次观测均判 insuff，流水线一次判 supp |

下限守住了：真错 `AP-SYNTH-T12-06` 在两条路径下**都仍判 unsupported**。

### 收益（可证伪的预测，已兑现）

| 项 | 修订前 | 修订后 |
|---|---:|---:|
| 已发布 skill `crossChapterAntipatternsKept` | 0 | **2** |
| 已发布 skill `sectionCounts.pitfalls` | 1 | **3** |
| 已发布 skill `sectionCounts.reading` | 4 | **5**（新增 `chapter2.md` 回链，第 700–729 行）|
| 门禁一 | 通过（无跨章反模式可装）| **通过** |
| 体积 | 4794 | **5883 / 12288**（决策 7 重建后为 5923，见该节） |

风险标记仍为 `PITFALL_COVERAGE_BELOW_ADVISORY`（3 条 < 建议 6 条）。按 ADR-021，条目数**不是判据**。

### 负面 / 代价（必须与收益一起读）

1. **「证据必须点名」退出判定环节。** 2 条主张仅凭区间即被接受（`T02-02`、`T02-04`）；
   实测区间分别为引文的 7.8 倍与 14.6 倍（1226/157、920/63）。这是决策 2 的直接代价。
2. **判定者不稳定，而本次量到的「噪声底 0」是小样本假象——仓里早有更好的估计。**
   既有实测（`pipeline/registry/tier-probe/judge-noise-floor.json`）：**同档两臂、37 个对象、
   5 处翻转 = 13.5%**。本次另跑的 16 条同档两臂给 0/16 —— 两者并不矛盾：按 13.5% 计，
   n=16 时期望翻转 2.16，**观测到 0 的概率约 9.8%**（复算见「核实方式」）。所以 0/16 是抽样不足，
   不是稳定性的证据；**README 里早已写过这个 13.5%**，本次先跑测量再看到它，取样规模选小了。

   同一口径也约束本次的 5 处 v1→v2 差异：按 13.5% 计期望 2.16 处，观测到 ≥5 处的概率约 **5.4%**
   ——落在尾部，**提示**存在真实效应，但**不足以**按条归因。真正支撑归因的是**机制级证据**
   （`T02-01` 的 v2 理由援引了 v1 看不到的第二段；`T02-02`/`T02-04` 的支撑实测落在引文之外的区间里），
   不是判定值本身的差分。因此本文**不主张**「v1→v2 的变动全部由措辞引起」：`T02-03` 与 `T12-01`
   两条保留「措辞 vs 不稳定」的双重可能。跨路径那一处（同输入、同提示词，`tier-probe` 判 insuff
   三次、流水线判 supp 一次）正是这 13.5% 的一个实例。
3. **合成层尚未重新对齐。** `antipattern-synthesis.mjs` 的系统提示词 §3 仍写着「主张必须收窄到
   主引文能承载的粒度」，即判定者已放宽而生产者仍按旧口径收窄。该方向只会让产出更保守、
   不会产生错误对象，故本轮未动（见「未决」）。
4. **跨章判定表与回执照旧与初判落在同一个 runId 上。** `synthRunId` 的组成是
   主题集合 + 生产者提示词指纹 + 目录哈希 + 是否判定（**布尔**） + 模型——**判据身份缺席**：
   一个布尔开关表达不了「哪一版判据」，于是 `judge-prompt/v1 → v2` 之后，
   判定表与回执写在同一个路径上。
   **但「数据会丢」这一半是错的**（更正留痕见文末）：`archiveIfExists` 早就在 `HEAD` 里
   （`git show HEAD:pipeline/synthesize-antipatterns.mjs` → 定义在 166 行、调用在 573–574 行，
   四个路径全跑），本次重判**确实自动归档了 v1**
   （`history/run-5d72a0637d50.antipattern-verdicts.2026-10-09T21-00-00-690Z.json`，
   sha256 前缀 `8129152dbe10cd34`，与手工那份逐字节相同）。
   真正的缺陷是**身份不可辨**：归档名只带时间戳，而判定表顶层只有
   `schemaVersion` / `runId` / `verdicts`——判据身份只能逐个对象打开 `judge.instanceId`
   的前缀反推。已修，见「决策 6」。

---

## 未决

1. **判据修订的归因流程缺少「先对照既有噪声底」这一步。** 13.5% 的翻转率（n=37）此前就已测出并
   写进 README，本次却先跑了 16 条的新噪声底、还把它读成了「稳定」。要补的不是再测一次，
   而是把**既有估计作为归因前提**：任何「判定值变了 N 条」的结论，先按该翻转率算出 n=N_total 下
   的期望与尾部概率，再谈原因。判据修订时若要刷新该估计，**样本量不得低于既有那次的 37**。
2. **合成提示词 §3 的重新对齐（已落地）。** 方向由用户拍板「对齐」，措辞由用户确认后执行，
   结果与可比性评估见「决策 7」。**可比性评估是这一项的组成部分**：结论是聚合指标可比
   （跨章占比、引用中位数、主张字数），**逐条 id 不可比**（id 是位置序号）。
3. **`T02-03` 的翻案是否可接受。** 它属宽松度而非视野：主锚点本就承载全句，v1 卡的是
   「普遍/只」这类全称量词。这类判定分歧要不要收敛成一条可判定的规则（如「全称量词必须逐字出现在
   锚点原文中」），未定。
4. **`crossChapterExcluded` 的口径**仍按判定表的 `status`，与新增的 `judgedAnchors` 无关；
   跨章反模式的采信目前是二值（过/不过），未利用「支撑它们的是第几段锚点」。
5. **T12 的「方向反转」是生产者的系统性弱项（本次评估带出，未立项）。** 两次运行各有一条
   T12 对象把原文的**禁止**读成**允许**（见「决策 7」末段的对照表）。两批各 1 条、n 太小，
   但「同一主题、同一失效模式、不同对象」这个形状不像偶然。建议单独立项：先量它在更大样本上的
   发生率（例如全书 13 个主题各跑一遍时不设阈值地数），再决定是加判据还是改提示词。
   **在本项完成前，不要把 T12 的跨章反模式当作可靠产出。**

---

## 核实方式

```bash
# 诊断：v1 的 16 条判定与逐条理由（被拒 5 条、引文 strict 全过）
node -e "
const v=require('./pipeline/registry/history/run-5d72a0637d50.antipattern-verdicts.2026-10-09T20-58-08-406Z.json');
const rej=v.verdicts.filter(x=>x.status==='reject');
console.log('被拒', rej.length, rej.map(r=>r.objectId+' '+r.failures[0].code).join(' | '));
console.log('引文 strict 全过:', rej.every(r=>r.quoteComparison.strict));
"

# 回归 A：单章 39 条（与 v1 输入逐字节相同的纯提示词对照）
node pipeline/tools/tier-probe.mjs --objects pipeline/knowledge/chapter4.objects.json \
  --anchors pipeline/knowledge/chapter4.anchors.json --tiers default \
  --judge-model deepseek-v4-pro --judge-base-url https://api.deepseek.com \
  --out pipeline/registry/tier-probe/regress-v2-chapter4.json --json
# → 39/39 supported

# 回归 B：跨章 16 条
node pipeline/tools/tier-probe.mjs --objects pipeline/knowledge/antipatterns.objects.json \
  --anchors pipeline/knowledge/chapter1.anchors.json,pipeline/knowledge/chapter2.anchors.json,pipeline/knowledge/chapter4.anchors.json,pipeline/knowledge/chapter5.anchors.json,pipeline/knowledge/chapter6.anchors.json,pipeline/knowledge/chapter7.anchors.json,pipeline/knowledge/chapter9.anchors.json \
  --tiers default --judge-model deepseek-v4-pro --judge-base-url https://api.deepseek.com \
  --out pipeline/registry/tier-probe/regress-v2-antipatterns.json --json
# → 14 supported / 1 insufficient / 1 unsupported

# 噪声底（同档两臂；**注意它只覆盖单路径内、单批次的 16 条，抽样不足**）
node pipeline/tools/tier-probe.mjs ... --tiers default,default \
  --out pipeline/registry/tier-probe/noisefloor-v2-antipatterns.json
# → 16/16 一致、0 不一致

# 噪声底的真口径：既有那份 n=37 的测量才是可用的估计
node -e "
const r=require('./pipeline/registry/tier-probe/judge-noise-floor.json');
const c=(r.disagreement||r.pairs[0]).counts;
console.log(c.total+' 对象,', c.disagree+' 翻转,', (100*c.disagree/c.total).toFixed(1)+'%');"
# → 37 对象, 5 翻转, 13.5%

# 用它复核「0/16 是小样本」与「5 处差异在尾部」
node -e "
const n=16,p=0.135,bin=(k)=>{let c=1;for(let i=1;i<=k;i++)c=c*(n-i+1)/i;return c*p**k*(1-p)**(n-k)};
let le4=0; for(let k=0;k<=4;k++) le4+=bin(k);
console.log('期望',(n*p).toFixed(2),'| 观测0的概率',(bin(0)*100).toFixed(1)+'%','| 观测>=5的概率',((1-le4)*100).toFixed(1)+'%');"
# → 期望 2.16 | 观测0的概率 9.8% | 观测>=5的概率 5.4%

# 同档两臂在另一批对象上的翻转率（n=37）
node -e "
const r=require('./pipeline/registry/tier-probe/judge-tier-probe.json');
const c=(r.disagreement||r.pairs[0]).counts; console.log(c.disagree+'/'+c.total);"
# → 1/37（低档 vs 高档那一对，2.7%）

# 单锚点断言的实测口径：39 个对象全部只有 1 条 sourceRef
node -e "
const d=require('./pipeline/knowledge/chapter4.objects.json');
const dist={}; for(const o of Object.values(d)) dist[o.sourceRefs.length]=(dist[o.sourceRefs.length]||0)+1;
console.log(JSON.stringify(dist));"   # → {"1":39}

# 假阴性的原文依据：被拒理由要的那句逐字在第二条锚点里
node -e "
const d=require('./pipeline/knowledge/antipatterns.objects.json');
const o=d.objects.find(x=>x.id==='AP-SYNTH-T02-01');
console.log(o.sourceRefs[1].anchor, '=>', o.sourceRefs[1].quote.slice(0,60));"
# → chapter2#h3-17 => 保留所有规则的内容但打乱组织结构…任务成功率下降超过 30%…

# 收益：装配与发布
node pipeline/build-skill.mjs --root-anchor chapter4#h2-2 \
  --slug chapter4-tool-design-principles --title "工具设计的通用原则" --json
# → gate.passed true / reasonCodes [] / pitfalls 3 / reading 5 / bytes 5883

# 发布件就是门禁验过的那一份（哈希链）
node -e "
const fs=require('fs'),crypto=require('crypto');
const s=fs.readFileSync('skills/chapter4-tool-design-principles/SKILL.md','utf8');
const c=require('./pipeline/registry/build/chapter4-tool-design-principles/skill-contract.json');
const h='sha256:'+crypto.createHash('sha256').update(s).digest('hex');
console.log(h===c.gateReceipt.markdownHash, h);"
# → true sha256:23726b0dba625128370b84011d4cd3422d1dde734b41eac11adb33c94db56112

# 测试
npm test   # → 383 通过（本轮 381 → 383，新增 2 条跨章装配用例）
npm test   # → 393 通过（决策 6 再 +10：身份解耦 6 条、装配器按身份取判定表 4 条）
npm test   # → 403 通过（决策 7 再 +10：对照工具的口径 7 条、CLI 拒绝 3 条）

# ── 决策 6（身份解耦）的核实 ──────────────────────────────────────────

# ① archiveIfExists 在本轮之前就存在，且四个路径全跑
git show HEAD:pipeline/synthesize-antipatterns.mjs | grep -n "archiveIfExists\|for (const p of \["
# → 166:async function archiveIfExists / 573:  for (const p of [rawPath, receiptPath, verdictsPath, objectsPath])

# ② 本次重判确实**自动**归档了 v1，而不是靠手工兜底
for f in pipeline/registry/history/run-5d72a0637d50.antipattern-verdicts.*.json; do
  printf "%s  %s\n" "$(shasum -a 256 "$f" | cut -c1-16)" "$(basename "$f")"; done
# → 8129152dbe10cd34  ...verdicts.2026-10-09T20-58-08-406Z.json   （手工那份）
#   8129152dbe10cd34  ...verdicts.2026-10-09T21-00-00-690Z.json   （archiveIfExists 那份，逐字节相同）

# ③ 判定表原先自己不声明判据身份
node -e "
const v=require('./pipeline/registry/history/run-5d72a0637d50.antipattern-verdicts.2026-10-09T21-00-00-690Z.json');
console.log(Object.keys(v).join(','));
console.log(v.verdicts[0].judge.instanceId);"
# → schemaVersion,runId,verdicts
# → deepseek-v4-pro/judge-90b1e1b49076#001      ← 判据身份只能从 instanceId 前缀反推

# ④ 跨章综合回执原先没有 pipelineVersion（第 2 层有）
node -e "
const r=require('./pipeline/registry/run-5d72a0637d50.antipattern-receipt.json');
console.log(Object.prototype.hasOwnProperty.call(r,'pipelineVersion'));"
# → false

# ⑤ 身份拆开后：判据换代让产物身份变、raw 身份不变
node --input-type=module -e "
import { synthRunId, synthRawRunId } from './pipeline/synthesize-antipatterns.mjs';
import { judgePromptFingerprint } from './pipeline/tools/judge.mjs';
const b={themeIds:['T12','T02'],promptFingerprint:'p',catalogHash:'c',modelId:'m'};
const f=(o)=>({...b,judgeEnabled:true,judgePromptFingerprint:judgePromptFingerprint(),pipelineVersion:8,...o});
console.log(synthRawRunId(b)===synthRunId(f()), synthRunId(f())!==synthRunId(f({judgePromptFingerprint:'judge-other'})));"
# → false true

# ⑥ 负向验证：判定表与对象不同源时，装配器不再静默
#    （可撤销：把真实判定表临时移出 registry、放一份 runId 不同的诱饵，跑完复原并核对 sha256）
# → ⚠ 跨章判定表与反模式对象**不是同一次运行的产物**：对象声明 run-5d72a0637d50，
#      取到的判定表是 run-decoydecoy00（registry 里有 1 份候选，按 mtime 回退挑选）
#   → 该次装配 pitfalls 3 → 1、crossChapterKept 2 → 0   ← 不同源的后果是可见的，不是猜的

# ── 决策 7（§3 对齐 + 重建发布件）的核实 ───────────────────────────────

# ① 提示词指纹确实变了（变了就说明旧 raw 作废，必须重买）
node --input-type=module -e "
import { synthPromptFingerprint } from './pipeline/tools/antipattern-synthesis.mjs';
console.log(synthPromptFingerprint({}));"
# → prompt-654165a7668c   （旧：prompt-76496276ce50，见 run-5d72a0637d50 回执）

# ② 聚合对照（逐条 id 不可比——id 是位置序号，见 synthesizedIdFor）
#    旧对象集 = pipeline/registry/history/antipatterns.objects.2026-10-11T06-10-02-384Z.json
node pipeline/tools/compare-object-sets.mjs \
  --old pipeline/registry/history/antipatterns.objects.2026-10-11T06-10-02-384Z.json \
  --new pipeline/knowledge/antipatterns.objects.json \
  --old-verdicts pipeline/registry/run-5d72a0637d50.antipattern-verdicts.json \
  --new-verdicts pipeline/registry/run-6bc0e8a0e8b9.antipattern-verdicts.json
# → 跨章 4/16 → 7/14；sourceRefs 中位 1 → 2；主张中位 83 → 95；主引文中位 86 → 91
#   判定 15/1 → 12/2

# ③ QUOTE_MISMATCH 的原因：弯引号被替换（不是排版差异）
grep -n "谁在跟我说话" sources/ai-agent-book-zh/book/chapter5.md
# → 343:…默认原则——“谁在跟我说话，我就尽力帮谁”；…        ← 源码是双弯引号
node -e "
const o=require('./pipeline/knowledge/antipatterns.objects.json').objects
  .find(x=>x.id==='AP-SYNTH-T12-06');
console.log(o.sourceRefs[0].anchor, JSON.stringify(o.sourceRefs[0].quote.slice(38,50)));"
# → chapter5#h3-9 "‘谁在跟我说话"                          ← 模型写成了单弯引号

# ④ 重建后的发布件哈希链闭合（注意读的是**契约**里的 gateReceipt，不是 gate-receipt.json 顶层）
node -e "
const fs=require('fs'),crypto=require('crypto');
const p='skills/chapter4-tool-design-principles/SKILL.md';
const c=require('./pipeline/registry/build/chapter4-tool-design-principles/skill-contract.json');
const h='sha256:'+crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
console.log(h===c.gateReceipt.markdownHash, fs.statSync(p).size);"
# → true 5923

# ⑤ 发布没碰别的文件
git status --short
# → 变更面只有 skills/…/SKILL.md 与 pipeline/registry/build/… 下三个文件
```

> **一处我自己的核实错误（留痕）**：④ 我第一遍写的是读 `gate-receipt.json` 顶层的 `markdownHash`，
> 那个字段在那里**不存在**，于是 `h === undefined` 为 false，我一度以为哈希链断了。
> 实际字段在**契约**的 `gateReceipt.markdownHash`（ADR-022 正文里本来就写对了）。
> **检查脚本与正文口径不一致时，先怀疑脚本。**

### 两处已更正的推断（留痕）

**其一：噪声底 = 0。** 本文档撰写过程中我先写下过「噪声底 = 0，故 5 条变动不是噪声」，
随后被推翻——而且推翻它的东西**仓里早就有了**：`judge-noise-floor.json` 的 13.5%（n=37），
README 也引用了这个数字。我当时的测量只有 16 条，而按 13.5% 计，16 条里出现 0 次翻转的概率
约 9.8%——**一个不罕见的结果，被我读成了「判定者稳定」**。

原文如此、实测为假，已改为「负面/代价」第 2 条与「未决」第 1 条的表述，不静默删除：
这里的教训不是「噪声底测错了」，而是**「先设计新测量」之前没先查仓里已有的估计**——
新测的数据量比既有的小，却因为「是自己刚跑的」而被赋予了更高的可信度。

**其二：「本次归档是人工动作，不是机制保证」。** 这句是我上一轮写进「负面/代价」第 4 条的原话，
本轮实测为假：`archiveIfExists` 在 `HEAD` 里就有，定义在 166 行、调用在 573–574 行，
**四个产物路径全跑**；本次重判在 `21:00:00` **自动**归档了 v1，与我手工在 `20:58:08` 复制的那份
逐字节相同（同为 `8129152dbe10cd34`）。上面「核实方式」① ② 两条就是它的反证。

已改为「负面/代价」第 4 条的表述，不静默删除。教训与上一条同源、但方向相反：
上一条是**把既有证据当成不存在**，这一条是**把不存在的缺陷当成存在**——
两者都是「没先去打开那份代码/那个文件就下断言」。

另外这句错话还有一层：它把注意力引向了错的地方。按「数据会丢」去找，会去加固归档；
而真正的缺口是**身份不可辨**（归档名只有时间戳、判定表不声明判据身份），
以及**下游按 mtime 挑判定表**——后者在身份拆开之后才会真的咬人。
