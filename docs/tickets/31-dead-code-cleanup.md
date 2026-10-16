# 31：无用代码清理（扫描、判据与执行记录）

**要构建什么：**对全仓 `pipeline/**/*.{mjs,cjs}` 做一次无用代码清理：找出**确实不再被使用**
的代码，删除或降级到最小面；不误删承重件与有意的留口。

**状态：**完成（2026-10-16）。`npm test` 577/0；终扫 0 残留。

## 方法（三轮静态扫描 + 人工复核 + 全量测试兜底）

1. **零外部引用的导出**：对每个 `export` 名，统计「本文件之外」的全部出现次数
   （静态 import / 动态 import 解构 / 别名 / 命名空间访问都会被 `\b名字\b` 计数覆盖）。
2. **未使用的 import**：import 名单里全文只出现 1 次（即 import 行本身）的条目。
3. **死私有函数/常量**：非 export 的顶层声明，全仓零引用。
4. **孤儿模块**：未被任何文件 import、也未被 spawn/CLI 引用的文件。
5. 逐类人工复核（抽查 grep、读上下文、查 git 历史与 ADR）；`node --check` 全量 +
   `npm test` 577 项兜底。

## 结果

| 类别 | 数量 | 处置 |
|---|---:|---|
| 全死符号（连本文件都不引用） | **3** | 删除：`run.mjs :: FAILURE_KINDS`（冻结常量表，`classifyFailure` 是唯一真源）；`verify-skill.mjs :: verifySkillFile`（注释自称「CLI 与测试共用入口」——实际上既无 CLI 也无测试用，陈述已过期）、`resolveSkillPath`（及其悬空的 `readFile`/`path` import） |
| 未使用的 import | **9** | 删除（freeze-outputs/run/layer2-extractor/model-stub/task-skill-builder/两个测试/theme-proposer） |
| 「仅本文件内部使用」的多余导出面 | **119** | 降级：`export` 关键字移除（绑定保留、行为不变）。这些名字看起来像公开 API，实际零消费方——误导后来者 |

**明确不删（复核后判定为承重/有意留口）：**

- `pipeline/tools/compose-schemas.mjs`：**不是孤儿**——ADR-008 规定的 schema 组装入口，
  `knowledge-object.test.mjs` 断言其产物落款字符串；若删，schema 与测试链断。
- `pipeline/tools/tier-probe.mjs`（ADR-009 的定档证据工具）、
  `pipeline/experiments/probe-task-headroom.mjs`（卡 25 头差探针，runbook/卡在引用）：
  实验性入口，有文档与历史用途，保留。
- 跨文件小重复（`usageOf`/`addUsage` 在 gate2/gate3 各一份等）：不是「无用」，抽取共享的
  收益低于改动风险，保留原样。

## 过程事故（如实）

降级脚本第一版有一个替换 bug：函数形态的 `export` 降级时**把函数名吃掉了**
（替换串漏拼 name）——`node --check` 全量语法检查立即抓到（28 个文件报
「Function statements require a function name」）。处置：`git checkout --` 恢复全部
受影响文件，修正脚本一次重放（import 清除 + 死块删除 + 降级，全脚本化），
再经语法全检与 577 项测试验证。**教训：机械改写后必须紧跟全量语法检查再跑测试。**

## 核实方式

```bash
npm test                             # 577 通过 / 0 失败
# 终扫（三轮扫描器复跑）：未用 import 0 / 全死 0 / 仅内部导出 0
node pipeline/build-task-suite.mjs --dry-run | tail -1   # 17/0 —— 承重链无损
node pipeline/run-gate2.mjs --suite --dry-run | tail -1
```