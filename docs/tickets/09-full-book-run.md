# 09：全书运行与污染隔离验证

**要构建什么：**把整条链路跑到全书上并交付最终原料：对 13 个源文件全部处理，产出聚合的回执与对象集，并证明**生成链路从未读取盲测基准目录**。

这一卡同时兑现方案 §10 的验收标准 1（链路完整）与 5（隔离可验证）。它也是「环 2」这一环的收口点——完成后，环 3 的聚类才有原料可吃。

**被谁阻塞：**08（回执与理由码须先成形，否则全书跑出的海量结果无法解读）

> **隔离责任的归属（Q14 已定）**
> 路径守卫的**实现落在 01**：那里从链路第一跳就拒绝盲测基准目录，因此根本读不到它，而不是等到最后才检查。
> 本卡不重复实现守卫，只做**全书范围的复跑验证**：断言一次完整全书的运行期访问清单中不含基准目录，并把该检查固化为可复跑项。
> 分工是「01 挡住入口，09 证明全程」；若两处口径不一致，以 01 的解析规则为准。

**状态：已达成**（2026-10-12，commit d15b326）

- [x] 对 `sources/ai-agent-book-zh/book/` 下全部 **13 个**源文件完成提取（实测该目录 13 个 `.md`，合计 1,102,782 字节）
- [x] 产出跨文件的聚合回执，且可按文件维度查询统计
- [x] 全书运行**不可交互式确认**：单次运行完成，不中途等待人工输入
- [x] **污染隔离可验证**：以机械方式证明链路任一环节未读取盲测基准目录（例如输入路径解析层面禁止该路径，或运行期记录被打开的文件清单并断言不含基准目录）
- [x] 隔离方式写在**代码**里，不以文档约定代替
- [x] `skills/` 全程未被写入（本规格不含环 4 构建）
- [x] `benchmark/` 目录在运行全程**既未被读、也未被写**
- [x] 隔离验证不是一次性人工目测，而是可复跑的检查项
- [x] 同一输入重复运行，已通过对象的 `id` 与来源引用保持一致（不因并发或顺序而变化）
- [x] 全书回执给出反模式真实分布：总数、引用 ≥2 个章节的条数、跨章占比、被引用章节分布（承 06；**不设阈值**）
- [x] 测试：一次运行后断言对象集覆盖全部 13 个源文件；无任何源文件被静默跳过
- [x] 测试：断言运行期访问的文件清单中不含基准目录路径
- [x] 测试：串行处理与并行处理在可比较的产物上产出等价结果

---

## 构建记录（2026-10-11）

### 建成的东西

| 文件 | 行数 | 作用 |
|---|---:|---|
| `pipeline/run-book.mjs` | 718 | 全书编排：枚举 → 文件级并发 → 聚合回执 → 隔离检查 |
| `pipeline/tools/fs-ledger.mjs` | 158 | 账本的加载 / 合并 / 断言（`assertIsolation`） |
| `pipeline/tools/fs-ledger.cjs` | 179 | 预载钩子：拦 `fs` 的读写并记进程级账本 |
| `pipeline/tools/test/full-book-run.test.mjs` | 335 | 19 个用例，全部离线、零模型调用 |

`npm test` → **430 项通过 / 0 失败**（实测 2026-10-11 21:14，`npm test`）。

### 逐条对照

| # | 验收项 | 状态 |
|---|---|---|
| 1 | 13 个源文件全部完成提取 | **未达成**：7 个完成，6 个退出码 4（见下） |
| 2 | 聚合回执 + 按文件维度查询 | ✅ `book-receipt/v1`；`--from <receipt> [--file <key>]` |
| 3 | 不可交互式确认 | ✅ 单次运行到底 |
| 4 | 隔离以机械方式证明 | ✅ `--verify-isolation` 实测通过（见下） |
| 5 | 隔离方式写在代码里 | ✅ 账本自举（`armLedger` 自己 `--require` 重拉起），不靠使用者加开关 |
| 6 | `skills/` 全程未被写入 | ✅ 0 条写入（账本断言） |
| 7 | `benchmark/` 既未读也未写 | ✅ 内容访问 0 条 |
| 8 | 隔离是可复跑项 | ✅ `it('隔离检查是**可复跑项**，不是一次性人工目测')`；另有 `it('**仪器能失败**…')` 反证 |
| 9 | 重复运行身份一致 | ✅ 三个用例：`bookRunId` 相同 / 逐文件 `runId` 与对象集逐字节相同 / 聚合计数逐格相同 |
| 10 | 反模式分布（不设阈值） | ✅ 已产出，见下 |
| 11 | 测试：13 个文件全集覆盖 | ✅ `it('聚合回执的逐文件行与源目录清单**逐条对齐**')` |
| 12 | 测试：访问清单不含基准目录 | ✅ |
| 13 | 测试：串行 ≡ 并行 | ✅ |

### 隔离验证：通过

```
node pipeline/run-book.mjs --verify-isolation pipeline/registry/book-07faf309c5a1.book-receipt.json
→ 污染隔离检查通过：14 份账本 / 5642 条访问记录；benchmark/ 内内容访问 0 条
  （仅问路径的调用 40 条，不计）；skills/ 写入 0 条；sources/ 下的读取目标 14 个。退出码 0
```

注意这条检查**不是**回执里的那一个快照：编排进程自己的账本在进程退出时才落盘，比回执晚一步，
所以回执 `isolation.children` 只说「13 份子进程账本齐备」，最终结论要跑上面这条命令取。

### 全书首跑：`book-07faf309c5a1`

2026-10-11 20:47:49 → 22:18:10 CST（**墙钟 90.4 分钟**），并发 4，第 2 层 deepseek。
**顶层退出码 4。**

> **更正（2026-10-12）**：本行原文写的是「20:47 → 21:18 CST（墙钟约 31 分钟）」。
> **实测为假**——那个 21:18 是我看运行中途一次进度快照时估的，从未复算。
> 真值取自聚合回执自己的 `createdAt` / `finishedAt`：
> `2026-10-11T12:47:49.543Z` → `2026-10-11T14:18:10.821Z`，即 90.4 分钟。
> 已改正，不静默删除。下表逐文件的「秒」列不受影响（那是各文件自报的运行时长）。

| 文件 | 退出 | 秒 | 锚点 | 对象 | 通过 | 拒绝 | 模型调用 |
|---|---:|---:|---:|---:|---:|---:|---:|
| afterword | 0 | 164 | 3 | 5 | 5 | 0 | 3 |
| chapter1 | 3 | 1883 | 25 | 47 | 45 | 2 | 25 |
| chapter2 | **4** | 1143 | 42 | 0 | — | — | 0 |
| chapter3 | **4** | 143 | 29 | 0 | — | — | 0 |
| chapter4 | 0 | 0 | 20 | 39 | 39 | 0 | 20（**复用回放**） |
| chapter5 | 0 | 1672 | 20 | 37 | 37 | 0 | 20 |
| chapter6 | **4** | 2257 | 40 | 0 | — | — | 0 |
| chapter7 | **4** | 1615 | 48 | 0 | — | — | 0 |
| chapter8 | 3 | 3538 | 42 | 75 | 74 | 1 | 42 |
| chapter9 | 0 | 1460 | 17 | 32 | 32 | 0 | 17 |
| chapter10 | **4** | 1023 | 34 | 0 | — | — | 0 |
| introduction | **4** | 244 | 5 | 0 | — | — | 0 |
| reference-answers | 0 | 1116 | 11 | 21 | 21 | 0 | 11 |

5 个退出 0 / 2 个退出 3 / **6 个退出 4**。

### 失败归因：6 例同一根因（**2026-10-12 更正**）

6 份失败回执的 `engineeringFailure.kind` **全部是 `layer2-response`**。

> **更正（2026-10-12）**：本节原文把根因写成「模型在字符串值里写了未转义的字面换行」，
> **那是错的**。见 [`ADR-023`](../adr/ADR-023-unanchored-fence-regex.md)：
> 6 份原始响应（`run-failed-*.layer2-raw.json` 的 `rawText`）经 `JSON.parse` **全部合法**，
> 是**解析器**把它们切坏了。原文的逐条报错片段与时间**不变**，只是它的解释换了——
> 留下的表格仍可作为「六例同一形状」的原始记录。

| 时间（CST） | 文件 | 报错片段 |
|---|---|---|
| 20:52:56 | chapter3 | `Unexpected token 'e', "text\nExtra"` |
| 21:04:52 | chapter10 | `Unexpected token 'p', "python\nwo"` |
| 21:06:52 | chapter2 | `Unexpected token 'e', "text\n# 工具使"` |
| 21:33:48 | chapter7 | `Unexpected token 'e', "text\n文件原始字"` |
| 21:37:52 | introduction | `Unexpected token 'b', "bash\ngit "` |
| 21:42:30 | chapter6 | `Unexpected token 'e', "text\n桌面状态 "` |

六例的报错前缀分别是 `text` / `python` / `bash`——**不是**「模型写坏的证据」，
而是**解析器切点落在哪里的证据**：旧 `parseModelPayload` 的围栏正则
`/```(?:json)?\s*([\s\S]*?)```/` **没有 `^` / `$` 锚定**，而技术书稿里几乎每个锚点都含代码块，
于是 JSON 字符串**内部**必然出现一对 ```` ``` ````。这个正则从响应头部一路匹配到字符串内那个
围栏的结束符，把一大段中间内容当「围栏壳」剥掉——剩下的残片以 `bash`（或 `text` / `python`）
开头，那个首字母就是 `Unexpected token` 报的那个字符。

**为什么一次失败就毁掉整个文件：** `parseModelPayload` 失败即抛 `Layer2Error`，
而该错误在 `run.mjs` 是终止性的——于是该文件的**全部**剩余锚点不再推进
（已完成的仍留在 `partial` 里，下次续跑）。

> 修复（ADR-023）是把解析实现提取为 `pipeline/tools/model-json.mjs`：先试**整份原样**，
> 再试**锚定**围栏，最后才退到首 `{` → 末 `}`。同一份缺陷正则当时抄在**四个**解析器里
> （第 2 层 / 判定者 / 主题提案 / 跨章综合），因此修的是一处、四处受益。
> **提示词未改动，`PIPELINE_VERSION` 不变**，已完成的 7 个文件断点续跑不受影响。

### 两条记账盲区（本次实测，未被回执显式表达）

1. **`totals.anchors = 138` 不等于全书的 336。** 全书 13 个源文件实测共 **336** 个锚点
   （逐文件复算：3+25+34+42+29+20+20+40+48+42+17+5+11），而 `aggregateTotals` 的
   `sum(f => f.coverage?.indexAnchors)` 只加得到**有 `coverage` 的那 7 个文件**——失败文件的
   `coverage` 是 `null`。逐文件行如实显示为 `—`，但顶层那个 138 没有任何「另有 198 个锚点无覆盖数据」
   的伴随字段，**容易被下游读成「全书只有 138 个锚点」**。
2. **失败文件的 token 不在 `totals.model` 里。** `totals.model` 的 138 次调用 / 322,705 输入 /
   908,923 输出只加得到成功路径；6 个失败文件各自的失败回执写着
   `billing: "unknown（失败路径没有记账，不得读成 none）"`。它们白花的量可以从 `partial` 的
   `usageSoFar` 取回（**已完成**锚点的部分）：合计 **85 次调用 / 178,138 输入 / 508,200 输出**。
   注意这是**下界**：那个把文件打死的调用自身没被记账（推算，推导链：每个失败文件至少有一次
   未计入的调用，故真实值 ≥ 85 + 6 = 91）。
   另外 `totals.model.calls` 里 chapter4 的 20 次是**回放**上一轮回执的数字（该文件本次 0 秒完成，
   `judge.enabled=false`），所以「今天真跑掉的调用」是 138 − 20 = **118**。

### 本次带出的产出规模（仅覆盖完成的 7 个文件）

- 对象 256 条（通过 253 / 拒绝 3，理由码全是 `QUOTE_MISMATCH`）
- 类型分布：EngineeringRule 105 / Concept 111 / Heuristic 14 / AntiPattern 14 / MentalModel 4 /
  Case 3 / DecisionModel 2 / Playbook 2 / Metric 1
- 反模式：章内 28 条（跨章 7 条，25.0%）；跨章综合 14 条（跨章 7 条，50.0%）
  ——两块来自两次不同身份的运行，`antipatterns` 里**分开报**是刻意的

⚠ 253 条「通过」里，**39 条是 chapter4 回放旧回执**，本次没被判定者看过
（`judge.calls` 合计 214，对应 6 个文件）。引用这个数时必须带上这一句。

### 未决（原首跑留下；未决 1 已由 ADR-023 解决）

1. ~~**`layer2-response` 的处置**~~——**已解决（ADR-023，2026-10-12）**。
   根因不是「模型写裸换行」，而是解析器的围栏正则未锚定；6 份原始响应本来就是合法 JSON，
   是 `parseModelPayload` 把它们切坏了。修复是提取 `model-json.mjs`，不动提示词，
   `PIPELINE_VERSION` 不变。
2. **`totals.anchors` 的伴随字段**：是否补一个 `anchorsUnknownFiles` / `anchorsUnknown`，
   使 138 不会被误读为全书规模。（二次运行后该字段已正确为 336，此项可低优先级处理）
3. **失败文件的花费是否需要进聚合回执**（哪怕标成下界）。（二次运行无失败文件，当前无影响）

---

## 构建记录（2026-10-12）

### 修复：ADR-023 围栏正则未锚定

本轮主要工作是找到并修复首跑失败的真实根因，复现归因如下：

```
node -e '
import("./pipeline/tools/layer2-extractor.mjs").then(m=>{
  const fs=require("fs");
  fs.readdirSync("pipeline/registry")
    .filter(x=>x.startsWith("run-failed-")&&x.endsWith(".layer2-raw.json"))
    .forEach(f=>{
      const t=JSON.parse(fs.readFileSync("pipeline/registry/"+f,"utf8")).rawText;
      // 原样 parse
      try{JSON.parse(t.trim()); console.log("✅ 本身合法:",f);}
      catch(e){console.log("❌ 本身不合法:",f);}
    });
});'
# → 6 份全部「本身合法」——是解析器把它们切坏的
```

详见 [`ADR-023`](../adr/ADR-023-unanchored-fence-regex.md)。

### 全书二次运行：`book-07faf309c5a1`（重用同一 book-receipt）

2026-10-12，并发 4，第 2 层 deepseek，**顶层退出码 3**（有对象被拒，流水线成功）。

| 文件 | 退出 | 锚点 | 对象 | 通过 | 拒绝 |
|---|---:|---:|---:|---:|---:|
| afterword | 0 | 3 | 5 | 5 | 0 |
| chapter1 | 3 | 25 | 47 | 45 | 2 |
| chapter2 | 3 | 42 | 72 | 70 | 2 |
| chapter3 | 0 | 29 | 52 | 52 | 0 |
| chapter4 | 0 | 20 | 39 | 39 | 0 |
| chapter5 | 0 | 20 | 37 | 37 | 0 |
| chapter6 | 3 | 40 | 74 | 70 | 4 |
| chapter7 | 3 | 48 | 82 | 80 | 2 |
| chapter8 | 3 | 42 | 75 | 74 | 1 |
| chapter9 | 0 | 17 | 32 | 32 | 0 |
| chapter10 | 0 | 34 | 61 | 61 | 0 |
| introduction | 0 | 5 | 7 | 7 | 0 |
| reference-answers | 0 | 11 | 21 | 21 | 0 |

**13/13 完成，0 退出码 4。** 理由码：`QUOTE_MISMATCH` 5 条 + `JUDGE_INSUFFICIENT` 6 条，全是内容质量问题。

**对比首跑：** 604 对象 / 593 通过（首跑 256/253，仅 7 文件）；336 锚点全部有覆盖数据（首跑 138 因 6 文件 coverage=null 而少计）。

### 隔离验证（二次运行）

```
node pipeline/run-book.mjs --verify-isolation pipeline/registry/book-07faf309c5a1.book-receipt.json
→ 污染隔离检查通过：14 份账本 / 3859 条访问记录；benchmark/ 内内容访问 0 条；skills/ 写入 0 条。
```

### commit d15b326（2026-10-12）

19 个文件，2779 行净增，包含：
- `pipeline/tools/model-json.mjs`（新建）：唯一响应解析实现
- `pipeline/run-book.mjs`（新建）：全书编排
- `pipeline/tools/fs-ledger.mjs/cjs`（新建）：访问账本
- `pipeline/tools/test/model-json.test.mjs`（新建，20 用例）
- `pipeline/tools/test/full-book-run.test.mjs`（新建，19 用例）
- 四个解析器改用 `model-json.mjs`（layer2/judge/theme/synth）
- 文档更正（ADR-023、本卡、handoff）

### 代码审查与修复批（2026-10-12 晚，提交 `f4a1034`）

对 `d15b326` 做了两轴代码审查（Standards / Spec，各自独立子代理）。发现与处置：

| 发现 | 处置 |
|---|---|
| `collectAntipatterns` 把跨章合成产物 `antipatterns.objects.json` 也算进「章内」统计——同一批对象被报两次，`fromLayer2.crossChapterIds` 全是一串 `AP-SYNTH-*`。**首跑「章内 28」与二次跑「章内 58」均因此虚高** | 排除该文件、单独成块；真值为 **14（首跑）/ 44（二次跑），跨章恒为 0**；`full-book-run.test.mjs` 新增夹具用例钉住这条边界 |
| 报告行按 `judge.enabled`（旧义＝「每个文件都跑了判定者」）印「未启用」，混合回放时把 560 次调用印成「未启用」，回执内 `enabled:false` 与 `calls:560` 并存 | `totals.judge` 拆为 `enabled`（至少一个文件跑了判定者）/ `allFilesJudged`（全部）/ `filesJudged`（计数）；报告行判据改为 `calls > 0`（`judgeSummaryLine`，有测试）；**回执升 `book-receipt/v2`**（旧 v1 口径已写进 README「已知约束」） |
| `bookRunId` 的 `gate:` 段按「透传里有没有 `--no-judge`」判：`--layer2 stub` 时会写出 `judgeApplied:true` + `gate:full`，而实际根本没有、也不可能有判定者调用（违反 ADR-014「实际值」约束） | 抽 `judgeAppliedFor()`：`stub` 与 `--no-judge` 一律 `deterministic-only`；纯回放运行的残留差异（预测 full、实际 0 次）由 `totals.judge.*` 的实际值承担——口径关系写进函数注释，不假装身份能覆盖它 |
| `model-json.test.mjs` 的 6 例回归锚点读 registry 里**未跟踪**的 `run-failed-*`——干净检出上 `assert.ok(rawFiles.length >= 6)` 必失败（回归锚点不可复现） | 复制为受控 fixtures（`pipeline/tools/test/fixtures/first-run-layer2-failures/`，附 `MANIFEST.json` 逐文件 sha256），测试改读 fixtures 并校验哈希 |
| `full-book-run.test.mjs` 一条恒真断言（`iso.ledgerFiles ?? iso.ledger.ledgerFiles` 自我相等）+ `/4 份账本/` 未锚定（实际匹配的是「14 份账本」） | 改为 `ledgerFiles === expectedProcesses`；断言锚定 `：14 份账本`，注释同步改为 13 子进程 + 1 编排 |
| 账本 `schemaVersion` 在 `fs-ledger.cjs` 与 `fs-ledger.mjs` 各写一份，且 `loadLedger` 不校验读入版本（漂移无检查会发现） | 单一真源 `pipeline/tools/fs-ledger-schema.cjs`；`loadLedger` 校验版本，不认识即抛（不按「没记录」处理） |
| 死代码与失真注释：`patchOpen` 两个分支体相同、`EXPECTED_READ_ROOTS` 全仓无消费者、`model-json` 默认导出无人引用、`fs-ledger.cjs` 注释引用不存在的测试文件；`antipattern-verdict-report` 对同一 argv 双调 `parseArgs`、裸 `4`/`0` 退出码 | 逐一清理（删除 / 改 `EXIT` 词表 / 注释指向真实用例 `full-book-run.test.mjs` 的「仪器能失败」负向对照） |

**修复批不改提示词、不改 `PIPELINE_VERSION`、不动对象产出**——因此身份不变：修复后以
**全回放**方式第三次运行（13 个文件各 0 秒复用，只有聚合与报告重算）。

### 第三次运行（2026-10-12 20:08，全回放）

- `npm test` → **457 通过 / 0 失败**（2026-10-12，含修复批新增 5 用例）
- `--verify-isolation` → 通过：**14 份账本 / 2048 条访问**；benchmark 内容访问 0；skills 写入 0
- 新回执（`book-receipt/v2`，身份仍是 `book-07faf309c5a1`，旧回执自动归档）：
  `judge: {enabled: true, allFilesJudged: false, filesJudged: 12, calls: 560}`；
  报告行 `判定者 调用 560 次（12/13 个文件过了判定者）`——不再出现「未启用 + 调用」并存
- 反模式：**章内 44 条（跨章 0）**；跨章综合 14 条（跨章 7，50%）

### 隔离验证·三次运行汇总

| 运行 | 账本 / 访问记录 | benchmark 内容访问 | skills 写入 |
|---|---|---|---|
| 首跑（2026-10-11） | 14 / 5642 | 0 | 0 |
| 二次（2026-10-12 19:07） | 14 / 3859 | 0 | 0 |
| 三次（2026-10-12 20:08，全回放） | 14 / 2048 | 0 | 0 |

### 追加未决（修复批带出）

1. **全书身份的 gate 段是配置层面的**：`stub` 与 `--no-judge` 已能准确判定，纯回放运行的
   「预测 full、实际 0 调用」差异由 `totals.judge.*` 的实际值承担（`judgeAppliedFor` 注释写明）。
   若将来要求身份覆盖「实际」，需要像卡 06 的 raw/判定身份拆分那样再拆一层——本轮不做。
2. **`totals.anchors` 伴随字段**与**失败花费进聚合回执**（首跑未决 2/3）仍开着，
   当前两轮无失败文件、该字段值正确，宜与下一次出现失败时的需求一起处理。

