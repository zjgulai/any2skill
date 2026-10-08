# 03：单对象端到端编译（贯穿第 1/2/3 层的示踪弹）

**要构建什么：**第一条真正打通的垂直路径——命令行接收一个源文件，经三层处理后，产出**一个**知识对象、**一份**验证回执，并用退出码报告判定结果。

这一卡的目的是把三个层的接缝一次性钉死。第 2 层在本卡用**模型替身**（读固定输入的确定性替身）驱动，因此这一卡跑通时**不消耗任何模型调用、也不需要凭据或网络**——第 1、3 层能在零外部依赖下被严格断言。

**被谁阻塞：**01（锚点索引是有来源引用的前提）、02（对象 schema 是第 2 层输出契约与第 3 层校验依据）

> **本卡不作隔离性断言**
> 判定者在独立上下文执行、其输入不含生产者上下文——这两项由 **05** 专门承接并证明。
> 本卡只需保证第 3 层被当作**独立阶段**调用（不把生产者上下文传给验证环节）。

**状态：**done（测试全绿；见文末「构建记录」）

- [x] 一条命令接收源文件路径，跑完三层，产出知识对象与验证回执
- [x] 对象文件落 `pipeline/knowledge/`，回执落 `pipeline/registry/`；断言落盘文件集合恰为这两个平面内的产物
- [x] 第 2 层经**模型替身**驱动：给定固定输入产出固定对象；整卡运行**不发出任何真实模型调用**
- [x] 对象**强制携带 `sourceRefs`**；缺该字段的对象被**硬拒绝、无豁免**
- [x] 对象 `id` 由「锚点标识 + 对象序号」确定性生成；同一输入重跑两次产出相同 `id`
- [x] 第 3 层确定性判据全部可用：对象通过其类型 schema 校验、`identifier` 合法、`sourceRefs` 可解析到 01 产出的锚点、锚点内容哈希与索引一致、`evidenceQuote` 在锚点区间内**逐字命中**
      （口径于卡 04 期间按实测修订：比对时忽略 markdown 强调标记与空白差异，理由与边界见 `docs/specs/01-pipeline-spec.md` 的 D6 口径补充）
- [x] **退出码正确二分类**：全部通过 = 0；有对象被拒 = 一个可区分的非零码；运行失败（源文件不存在、锚点索引产不出、第 2 层调用失败）= **另一个**可区分的非零码
- [x] 回执给出每个对象的通过/拒绝状态，以及拒绝项的**理由码**；并含运行标识、源文件哈希、产物指针与计数
- [x] 测试：端到端跑通并断言退出码与产物齐备；注入一份「引文不逐字命中」的对象，断言其被拒并**带正确理由码**
- [x] 测试：注入一份缺 `sourceRefs` 的对象，断言其被拒

---

## 构建记录（2026-10-08）

**入口：**`node pipeline/run.mjs <内容源.md> [--json] [--repo-root <dir>] [--objects-fixture <file>]`
**退出码：**`0` 全通过 / `3` 有对象被拒（内容问题）/ `4` 运行失败（工程问题）。两侧互不相等由测试钉住（`assert.notEqual`），否则 CI 无法区分「这本书抽得不好」与「脚本坏了」。

### 交付时补掉的 4 个实现缺口

1. **路径守卫的两侧口径不一致（真实缺陷，阻断整卡）。**
   `assertAllowedSource` 对输入做 `realpath`，却拿未 `realpath` 的仓库根去比对。macOS 上 `os.tmpdir()` 返回 `/var/folders/…` 而 `realpath` 是 `/private/var/folders/…`，两者字面不等 → **合法内容源被误判越界**（实测报错：`内容源必须位于 sources/ai-agent-book-zh/book/ 之内，实际为：/private/var/folders/…`）。
   修法：新增导出 `resolveRealPath`，让仓库根、白名单根、基准目录与输入走**同一套解析**；`runPipeline` 入口把仓库根归一一次并向下贯穿，使落盘路径与回执里的相对路径共用同一个根。
   **修前后实测**（`node --test pipeline/tools/test/single-object-tracer.test.mjs`）：修前 `pass 8 / fail 15 / cancelled 12`；修后 `pass 30 / fail 5`。12 项 cancelled 是该守卫在套件级 `before` 里抛错所致的连带跳过，不是独立缺陷。

2. **未定义 `objectType` 被静默放行（真实缺陷）。**
   `objectType` 不在九类封闭集合内时 `schema` 为 `null`，判据 ④ 整段跳过 → 一个 `SkillCandidate` 对象可以**不经过任何字段校验**通过第 3 层。这是第 3 层最大的一个洞，且与 02 已声明的「对象类型集合封闭：未知 `objectType` 被拒绝」相矛盾。
   修法：类型不在集合内时**显式补一条 `SCHEMA_INVALID`**，不因「我们不知道该用哪个 schema」而放行。

3. **引文比对的范围必须与证据的范围一致。**
   原实现恒以「所引锚点区间」为比对范围，锚点解析不到时该区间为空串，于是同一个缺陷被记两笔（`REFERENCE_UNRESOLVED` + `QUOTE_MISMATCH`）。
   修法分两档，并在 `failures[].detail` 里**如实声明用了哪一档**：
   - 有可解析锚点 → 该锚点区间（「引文不在此区间内」是成立的断言）；
   - 无可解析锚点 → **整份源文**（此时能成立的只有「引文在源文里根本不存在」）。
   退回全量不是放宽：夹具中「引文是意译」与「凭空编造的引文」仍被拒，只是不再把一个缺陷重复计数。

4. **`REASON_PRECEDENCE` 按「修复责任方分族」重排。**
   改为**出处族**（有出处 → 标识合法 → 出处指得到 → 出处版本没漂）整体优先于**字段族**（字段合 schema → 有引文 → 引文命中）。
   理由：出处解析不到时「这个对象是谁」尚未确定，此时按字段族归因会把根因报成表象（把「锚点不存在」报成「字段不合 schema」），而两者的修复责任方不同（前者是第 1 层/溯源契约，后者是第 2 层对象契约）。

### 测试侧更正 3 处（均为测试自身的缺陷，不是放宽断言）

- **`退出码二分类` 套件改为 `beforeEach(clearOutputs)`。** 该套件**故意**在同一个临时根下产出两个不同 `runId`（拒绝运行 / 失败运行），原来只在套件开始清一次，第二个用例会看到上一个用例的回执，`onlyReceipt()` 的「恰好一份」断言失真。其余套件全部产出同一个 `runId`，不需要逐用例清。
- **`路径守卫拒绝基准目录` 改断言 `/拒绝读取盲测基准目录/`。** 原来钉的是 `/内容源必须位于/`，但基准目录守卫**排在前面**且故意有专属诊断（污染隔离被破坏 ≠ 路径写错，修复动作不同）。用例名与实质断言（退出码 4、不静默）不变。
- **夹具计数由「1 通过 / 7 被拒」更正为「0 通过 / 8 被拒」。** 夹具 8 项的每一项都按设计带缺陷（见夹具内逐项 `comment`），原来的 `passed: 1` 与同一用例里的 `byCode` 期望（7 个键、求和为 8）**自相矛盾**——`byCode` 只统计主理由码，`Σ(byCode) === rejected` 是该回执的结构不变式。已按夹具设计意图取 0/8，并使 `Σ(byCode) = 8` 成立。
  「同一对象违反多条只归一类」用例的 `failures` 期望由 2 项更正为 3 项：该夹具对象的 `objectType` 是未定义类型，闭环缺口 2 之后必然额外命中 `SCHEMA_INVALID`（主码不受影响，仍为 `REFERENCE_MISSING`——这正是该用例要证明的分离）。

### 实测证据（可复跑）

```
$ npm test
ℹ tests 139   ℹ suites 28   ℹ pass 139   ℹ fail 0          # ticket 03 单文件：35/35

$ node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md
sources/ai-agent-book-zh/book/chapter4.md：锚点 20，对象 20（通过 20 / 拒绝 0）
对象：pipeline/knowledge/chapter4.objects.json
回执：pipeline/registry/run-6ec42c21c7ae.receipt.json      # exit=0

$ node pipeline/run.mjs sources/ai-agent-book-zh/book/chapter4.md \
    --objects-fixture pipeline/tools/test/fixtures/reject-cases.json
sources/ai-agent-book-zh/book/chapter4.md：锚点 20，对象 8（通过 0 / 拒绝 8）   # exit=3
```

- **确定性**：连跑两次，`chapter4.objects.json` 逐字节相同（`cmp -s` 为真）；回执除 `createdAt` 外逐字段相等，`runId` 与文件名不变。
- **锚点覆盖率**：`chapter4.md` → 锚点 20（`h1:1 h2:9 h3:7 h4:3`），与 01 卡声明的 9 个 `##`、7 个 `###` 一致。替身对每个可引用锚点产出 1 个对象，故 20 锚点 → 20 对象，类型分布 `EngineeringRule 9 / Playbook 4 / Heuristic 3 / Case 2 / Concept 1 / DecisionModel 1`（≥5 类）。
- **注入夹具逐项归因**：8 项的 `reasonCode` 与夹具各自 `comment` 声明的期望**逐项一致**（7 项显式声明 `期望 X` 全部命中；第 8 项声明的是主码优先级，实测主码为 `REFERENCE_MISSING`）。
- **零模型调用**：回执 `model.calls = 0`、`tokens = {input: 0, output: 0}`、`billing` 明写「未发出任何真实模型调用」。第 3 层源码经测试扫描确认不含 `fetch(` / `node:http` / `node:https` / `Math.random` / `Date.now`。

### 本卡不覆盖（留给后续卡）

- 判定者判据（LLM）与判定者实例标识 → **05**；回执如实记 `judge.implemented = false`、`judge.instanceId = null`，**不假装已通过**。
- 真实第 2 层（九类语义判定）→ **04**；本卡第 2 层是确定性替身，类型只按「标题层级 + 该层级内序号」固定映射，不做语义理解。
- 跨章聚合、单章批量、全量跑批 → **06/07/09**。
