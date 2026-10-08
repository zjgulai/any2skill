# 02：九种知识对象的 schema 与公共契约

**要构建什么：**把「一个知识对象长什么形状」变成机器可判定的契约：九种对象类型各一份 JSON Schema，加上所有对象共用的公共字段契约。每一份 schema 都配**一个正例与至少一个负例**，负例专门打该类型最容易被违反的那个必填字段。

这一卡不产出任何知识对象，它产出的是**判定依据**——后续第 2 层的输出契约与第 3 层的校验依据都来自这里，所以它必须先于任何提取工作存在。

**被谁阻塞：**无（可立即开工，与 01 并行）

**状态：**已构建（2026-10-08 构建；同日的「批次一 · 复位」按实测逐条补记验收，见文末）

- [x] 九种类型的 schema 齐备：`Concept` / `Metric` / `MentalModel` / `DecisionModel` / `Heuristic` / `Case` / `Playbook` / `EngineeringRule` / `AntiPattern`，各自按既定必填字段列表落字段
- [x] 公共契约齐备：`id` / `objectType` / `revision` / `status` / `createdAt` / `sourceRefs` 六项对所有类型必填
- [x] `status` 取值集合限定为 `draft` / `candidate` / `approved` / `superseded` / `blocked`
- [x] `identifier` 正则锁定为 `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$`，且**只约束对象 `identifier`**——`sourceRefs[].anchor` 允许中文字符，两者不得混为一谈（须有专门测试钉住这一点）
- [x] `hash` 统一 `sha256:` 前缀
- [x] `MentalModel` 的 `limits` 与 `counterexample` 为**必填**（缺任一项即不通过）
- [x] `Heuristic` 的 `confidence` 限定 0–1；`EngineeringRule` **不得**带 `confidence`（硬规则标置信度是语义失真）
- [x] 对象类型集合**封闭**：未知 `objectType` 被拒绝，多余字段被拒绝
- [x] `SkillCandidate` **不出现**在这批 schema 里（它属环 3，本规格不产出）
- [x] 每种类型各有一个正例与至少一个负例；负例覆盖该类型最易违反的必填字段
- [x] 跨对象不变量有测试：对象缺 `sourceRefs` 被拒；`identifier` 含小写或单段（无连字符）被拒
- [x] 测试：以正例包 + 固定负例集 + 跨对象不变量的口径组织；用通用 JSON Schema 校验器而非自写字段检查

---

## 构建记录（2026-10-08；验收于同日「批次一 · 复位」逐条实测补记）

### 逐条验收的实测口径

| 验收项 | 实测（读 `pipeline/schemas/` 下产物） |
|---|---|
| 九种类型齐备 | `knowledge-object.schema.json` 的 `$defs` 恰好含 9 个类型定义，`oneOf` 9 个分支 |
| 六项公共必填 | `common.schema.json` → `$defs.baseObjectProperties.required` = `["id","objectType","revision","status","createdAt","sourceRefs"]` |
| `status` 五值 | `$defs.status.enum` = `["draft","candidate","approved","superseded","blocked"]` |
| `identifier` 正则 | `$defs.identifier.pattern` = `^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)+$` |
| `anchor` 允许中文 | `sourceRef.properties.anchor` 为 `{type:string, minLength:3}`，**无 `pattern`**，描述里写明「允许中文字符——它不受 identifier 正则约束」 |
| `hash` 前缀 | `$defs.hash.pattern` = `^sha256:[0-9a-f]{64}$` |
| `MentalModel` 必填 | `required` = `["trigger","inputs","reasoning","limits","counterexample"]` |
| `Heuristic.confidence` | `{type:number, minimum:0, maximum:1}` |
| `EngineeringRule` 无 `confidence` | 属性集合 = `statement/rationale/appliesWhen/violation/chapterRef/evidenceQuote`，**不含 `confidence`** |
| 类型集合封闭 | `oneOf` 9 分支 + `additionalProperties` 逐类型收紧；测试断言「每种类型都拒绝多余字段」 |
| `SkillCandidate` 不出现 | `$defs` 键集合中无 `SkillCandidate`（`false`） |

测试侧：`pipeline/tools/test/knowledge-object.test.mjs` 共 **39 个用例**，覆盖 schema 自检（`$ref` 可解析、未知关键字显式报错）、九类型正例包、六项公共必填逐项拒负例、`identifier` 五种非法形态、`MentalModel` 缺 `limits`/`counterexample`、`Heuristic` 与 `EngineeringRule` 的互斥、以及「`objectType` 必须九值枚举之一」。

正例包在 `pipeline/tools/test/fixtures/objects.mjs`，固定负例集在 `.../fixtures/reject-cases.json`。

### 一处口径必须说清楚：这里的「通用校验器」不是第三方校验器

本卡第 12 条验收写的是「用通用 JSON Schema 校验器」。**实际用的是本仓自带的显式子集校验器** `pipeline/tools/json-schema-subset.mjs`，不是 ajv 之类的第三方实现。

成立的部分：它是 schema 驱动的（输入 data + schema → `{valid, errors}`），不是逐字段手写检查；支持的关键字表 `SUPPORTED_KEYWORDS` 是**封闭集合**，超出即显式报错（原注释写明的理由：静默忽略未知关键字会让 schema 作者以为约束生效而其实被放行）。

**不成立的部分**：它不实现完整 JSON Schema，不支持 `format` / `patternProperties` / `if-then-else` / `contains` / `$dynamicRef` 等。因此「用通用校验器」这条**只在本仓约定范围内成立**，不应被读成「与 ajv 等价」。

自写而非安装的理由写在模块头部：本项目要求离线可重跑、不引入需网络安装的运行时依赖。这条取舍本卡开工时已定（决策 Q15），此处只是把实际状态如实记下。

### 与卡 01 同样的记账问题

本卡此前状态为 `ready-for-agent`、复选框全空，而交付物早已存在。详见 `docs/tickets/01-anchor-index.md` 文末「为什么是补记而不是新做」。
