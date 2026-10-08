# ADR-008 · 实现层技术栈与 schema 契约的落地形态

- 状态：已接受
- 日期：2026-10-08
- 决策者：用户（就校验器实现拍板「自写 JSON Schema 子集校验器，零依赖」）
- 关联：ADR-002、ADR-003、ADR-005、ADR-006；规格 `docs/specs/01-pipeline-spec.md` 的 D5 / D12
- 落地任务卡：`docs/tickets/01-anchor-index.md`、`docs/tickets/02-object-contracts.md`

## 背景

规格 D12 要求「schema 以 JSON Schema 表达，使第 3 层能直接调用**通用校验器**而非自写字段检查」，同时要求「**不引入需要网络安装的运行时依赖**」。

实施前的环境实测证明这两条**不能同时成立**：

| 探测项 | 实测结果 |
|---|---|
| `node:test` | 可用（`typeof test === 'function'`） |
| `node:crypto` | 可用 |
| Node 内建 JSON Schema 校验 | **不存在**（`require('ajv')` 失败，无 `jsonschema` 内建模块） |
| Python `jsonschema` / `fastjsonschema` / `referencing` | **三个模块全部 `ModuleNotFoundError`** |
| 全局 `node_modules`（`npm root -g`、`/opt/homebrew/lib/node_modules`、`/usr/local/lib/node_modules`） | 三处均无 `ajv` / `jsonschema` |

⇒ 「用现成的通用校验器且零依赖」在本机不成立。这构成一个必须由用户拍板的分叉。

## 决策

### 1. 技术栈：Node.js + 零运行时依赖

- 语言与运行时：**Node.js**（实测 `v26.7.0`），ESM（`.mjs`）。
- **运行时依赖为零**：`node:test` 承担测试、`node:crypto` 承担 sha256、`node:fs/promises` 承担落盘。
- 理由：零依赖直接兑现 ADR-005「零外部运行时依赖、可离线重跑」的初衷；且 `package.json` 无需安装任何包即可 `npm test`，CI 与本地行为一致。

### 2. 校验器：自写 JSON Schema **显式子集**校验器

用户就分叉拍板：自写子集校验器，零依赖。

- 实现：`pipeline/tools/json-schema-subset.mjs`
- 支持的关键字是**封闭集合**，且对未知关键字**显式报错**，绝不静默忽略。
- 理由：静默忽略是自写校验器最危险的失败模式——schema 作者以为约束生效了，实际校验被悄悄放行。本项目「可审计的编译过程」不允许这种失败模式存在。
- 举证责任在本项目：`pipeline/tools/test/json-schema-subset.test.mjs` 对每个受支持关键字都有正例与负例，并有专门的守卫用例证明「未知关键字会报错」。

### 3. 契约的落地形态：单一封闭对象，而非 allOf 并列

规格只说「九种类型各一份 schema」，未规定公共契约与类型契约如何合成。实测暴露了一个会让契约**自我拒绝**的陷阱，因此定为：

```
产物 = allOf[ 公共契约分支（不封闭）, 合并后的封闭对象（基类字段 + 类型字段） ]
```

- `allOf` 中的 `additionalProperties` **只看得到本处理层次的 `properties`**。
  若把类型分支设为 `additionalProperties: false` 而公共字段只在上游分支声明，类型分支会以「未声明 `id` / `sourceRefs` / `evidenceGrade`」为由拒绝**自己允许的对象**；反之亦然。两侧都会自我拒绝。
- 因此组装时把公共契约的 `required` 与 `properties` **合并进**类型分支，得到单一封闭对象；公共分支保留但不封闭，只负责基类字段的存在性与类型。
- 嵌套对象（如 `sourceRef`）**保持开放** `additionalProperties`，以便结构演进；封闭性只施加在知识对象顶层。

### 4. schema 的文档内自洽

- `common.schema.json` 与 `knowledge-object.schema.json` 内的 `$ref` 一律使用**文档内**形式（`#/$defs/...`），不使用 `any2skills:common#/...` 这类跨文档形式。
- 理由：跨文档 `$ref` 在自写子集校验器里无法解析；一旦解析失败被当成放行，公共契约（含 `sourceRefs` 必填）就等于没生效。
- 组装脚本 `pipeline/tools/compose-schemas.mjs` 负责把两份源头合成为 9 份自包含产物，并在写盘前做两项自检：**无跨文件引用**、**只使用受支持关键字**。
- 辅助定义按**传递闭包**收集：`sourceRef` 自己引用 `hash`，只扫一层会让 `hash` 缺失，从而使 `sourceRef.contentHash` 的格式约束静默消失。

## 对规格 D12 的两处显式偏离（留痕）

规格 D12 的原文是：采用本机已实测可用的工具链，且「schema 以 JSON Schema 表达，使第 3 层能直接调用通用校验器而非自写字段检查」。实际落地有两处偏离，均因环境实测所致：

1. **不是「通用校验器」，而是自写的显式子集校验器。** 环境实测证明本机不存在任何可用的通用校验器，且引入 ajv 会违反同一 D12 的零网络依赖要求。本偏离经用户拍板（决策 Q15）。
2. **九种类型不是 9 份独立维护的 schema，而是由 2 份源头组装出的 9 份产物。** 这是为满足「每种类型一个正例与至少一个负例」的可测试性与「公共契约只写一遍」的 DRY 要求；组装产物是自包含的，仍可直接交给校验器。

两处偏离均不改变 D12 的目的（让「凭什么算达标」可机器判定）。若日后决定引入 ajv，只需替换 `pipeline/tools/json-schema-subset.mjs` 的 `validate` 实现，9 份组装产物与全部测试无需改动——这是把偏离限制在单文件内的设计意图。

## 必须遵守的约束

- **不得**在没有显式决策的情况下引入需要网络安装的运行时依赖。
- 新增 JSON Schema 关键字时，必须同步更新 `SUPPORTED_KEYWORDS` 与 `json-schema-subset.test.mjs`，否则组装脚本会在组装期报错（这是刻意的：宁可在组装期失败，不要在校验期静默放行）。
- 组装产物**不得手工编辑**；一切修改走 `pipeline/tools/compose-schemas.mjs`。
- `sourceRefs[].anchor` 允许中文字符，**不受** `identifier` 正则约束；`identifier` 正则只管对象的 `id`。

## 核实方式

```bash
# 环境：两条 D12 要求为何不能同时成立（本次实测）
node -e "try{require('ajv');console.log('ajv 可用')}catch(e){console.log('ajv 不可用')}"
python3 -c "import importlib
for m in ['jsonschema','fastjsonschema','referencing']:
    try: importlib.import_module(m); print(m,'可用')
    except Exception as e: print(m,'不可用',type(e).__name__)"
for p in "$(npm root -g)" /opt/homebrew/lib/node_modules /usr/local/lib/node_modules; do
  ls "$p" 2>/dev/null | grep -iE 'ajv|jsonschema' || echo "$p: 无"
done

# 零依赖与可复跑
npm test                                  # 无需 npm install

# 组装自检（无跨文件引用 + 关键字受支持 + $ref 全部可解析）
node pipeline/tools/compose-schemas.mjs

# 逐条验收（ticket 01 / 02 的验收项）
node --test "pipeline/tools/test/*.test.mjs"
```

## 后果

**正面**
- 零依赖、可离线复跑，`npm test` 无需安装任何包。
- 校验器的能力边界是**显式且可测试**的：未知关键字报错，而不是静默放行。
- `allOf` 与 `additionalProperties` 的自我拒绝陷阱在组装期就被消除，9 份产物逐份通过自检。

**负面 / 代价**
- 校验器只支持子集；若日后需要 `format` / `if-then-else` / `patternProperties` 等关键字，需扩展实现并同步补测试。
- 校验器的**正确性由本项目自己举证**，不能引用 ajv 那样的成熟测试套件背书。已用逐关键字的正负例与子集用例覆盖，但覆盖面小于 ajv。
- 多了一层组装步骤：改 schema 后必须重新组装，不能只改源头。
