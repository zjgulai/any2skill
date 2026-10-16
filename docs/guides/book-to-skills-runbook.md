# Runbook · md 书 → 高质量 skills（完整工作流）

本页是项目的**主流程**：给到一个 md 书目录，按八个阶段推进到发布、评测与披露。
每一步都对应盘上的命令与产物；每阶段的验收就是它自己的产物。**本页不是技能**
（无 frontmatter、不参与触发）。

> 要连能力图谱与技能资产一起一页纵览？见 [`playbook.html`](../../playbook.html)（HTML 全景版）。
> 本页仍是主流程的操作真源。

## 「高质量」的操作性定义（先对齐口径）

| 维度 | 由什么保证 |
|---|---|
| ① 结构合规 | 门禁一：六段/任务骨架齐全、frontmatter 硬限、体积、契约段计数一致、出处逐条可解析 |
| ② 任务化可用 | 策展层：任务式命名（英文动宾 slug + 中文任务名）、输入/步骤/交付物/检查、显式边界 |
| ③ 字面保真 | 该条款默认内置（卡 28 实证：防「技能词汇覆盖任务字面」失效族——四个拒绝例的共同死因） |
| ④ 效用实测 | 门禁二（触发盲测）/ 门禁三（效用与有害性，复跑制）；**未测的轴不许写得像测过** |
| ⑤ 全程可复算 | 回执 + 账本 + 冻结 + lineage；任何数字有盘上出处 |
| ⑥ 诚实披露 | passed / low-utility / rejected 三态如实标注；low-utility = 本测量设计下未测出增量（ADR-030） |

## 阶段总览

| # | 阶段 | 主命令 | 关键产物 | 模型调用 |
|---|---|---|---|---|
| 0 | 前置 | — | 环境与凭据就绪 | 0 |
| 1 | 入场 | `run-new-book onboard` | `sources/<key>/book/` + SOURCE-MANIFEST | 0 |
| 2 | 环 1/2 | `run-book --source-key` | 锚点、对象、回执、逐文件账本 | ≈2 次/锚点 |
| 3 | 环 3 | `propose-clusters --source-key` | clusters / candidates | ≈1 次/章 |
| 4 | 合成 | `propose-themes` + `synthesize-antipatterns` | 主题清单 + 跨章反模式池 | ≈1–2 次/主题 |
| 5 | 筛查 | `run-new-book pipeline`（内置）/ 手工逐份干跑 | `screening.<key>.json` | **0** |
| 6 | 策展 | `run-new-book scaffold` → 编辑 → `build-task-suite --dry-run` | 清单 + 工作流 + 核对单 → 全过门禁一 | 0 |
| 7 | 发布与评估 | `build-task-suite --publish` → `run-gate2 --suite` → `run-gate3` | 发布物 + 门禁二三报告与判定 | ≈15/skill + ≈13/skill |
| 8 | 收束 | `freeze-outputs` + 记录 | 评测记录、披露、冻结 | 0 |

---

## 阶段 0 · 前置

- Node ≥ 22；`npm test` 全绿（572 项，零网络）。
- 凭据：生产者 `ANY2SKILLS_LLM_API_KEY`、判定者（缺省继承生产者路由）。**值不写进任何文件**。
- 约定：每本书一个 `sourceKey`（小写连字符，如 `rust-book-cn`）；一切产物按源命名空间。

## 阶段 1 · 入场

```bash
node pipeline/run-new-book.mjs onboard --dir /path/to/book-dir --key <key>
```

- **产物**：`sources/<key>/book/**.md`（保留子目录）+ `sources/<key>/SOURCE-MANIFEST.md`
  （逐文件 sha256，可复算）。
- **验收**：清单文件数与目录 .md 数一致；`.txt` 等非 md 不入场。
- 若书来自上游 git：可按既有镜像口径（blobless clone + 逐文件哈希 + MIRROR-MANIFEST）单独执行，
  结果落在同一 `sources/<key>/book/`——镜像方式更可审计，`onboard` 适合本地目录。
- **陷阱**：目标已存在时命令拒绝覆盖——换 key 或先人工处置，不要手删要保留的产物。

## 阶段 2 · 环 1/2（锚点 + 对象 + 独立判定）

```bash
node pipeline/run-new-book.mjs pipeline --key <key> --model <id> --base-url <url>
# 或手工：node pipeline/run-book.mjs --source-key <key> --layer2 deepseek --llm-model <id> --llm-base-url <url>
```

- **产物**：`pipeline/knowledge/<file>.anchors.json` / `.objects.json`、
  `pipeline/registry/run-*.receipt.json`、逐文件子账本 + 编排账本。
- **验收**：每文件回执在盘（`门禁通过 N` 可见）；失败文件为 0。
- **成本**：≈ 2 次调用/锚点（提取 + 判定）；105 文件 / 500 锚点的书 ≈ 千次级调用、数小时。
  节奏建议照本仓实践：**按波推进（每波 8–10 文件）**，每波跑完立即可做下游。
- **陷阱**：
  - 中途瞬断（空内容/传输断）→ 直接重跑，partial 复用、重复付费为 0；
  - 每文件独立账本路径——共用账本会互相覆写（0 条记录 = 方法错误，不是证据）；
  - 别把 `--layer2 stub` 用进真实产物（stub 会覆盖真对象——README 有案）。

## 阶段 3 · 环 3（聚类 + 候选）

```bash
node pipeline/propose-clusters.mjs --source-key <key> --model <id> --base-url <url>
```

- **产物**：`clusters.<key>.json`、`skill-candidates.<key>.json`。
- **验收**：覆盖检查全过（未归类 0 / 未解析 id 0 / 重复归属 0 / 无候选单元 0）。
- **陷阱**：旧 8 章输入身份一致会 0 调用复用——重跑便宜；目录哈希变化会使门禁二全量重答（见阶段 7）。

## 阶段 4 · 跨章合成（可关，但强烈建议）

```bash
node pipeline/propose-themes.mjs --source-key <key> --model <id> --base-url <url>
node pipeline/synthesize-antipatterns.mjs --source-key <key> --model <id> --base-url <url>
```

- **为什么**：教科书式章节**不在章内供给反面教材**（卡 21 实证）——跨章反模式池是「陷阱段」
  的正解（ADR-016），实测把门禁一通过率从 5/11 拉到 18/22。
- **产物**：`themes.<key>.json`、`antipatterns.<key>.objects.json` + 判定表。
- **验收**：判定表 总/过/拒 三数可查；「被拒对象也在文件里」（判定表决定谁可用，卡 22 口径）。

## 阶段 5 · 门禁一筛查（零成本）

`pipeline` 子命令已内置：逐候选 `build-skill --dry-run` 汇总
`pipeline/registry/screening.<key>.json`（`passed / failed / failAt`）。

- 拒因分两类：**可修**（章内真缺内容——如陷阱空，可补抽/合成补）与**内容缺口**（源里就没有）。
  拒因逐条看 `failAt`：`## 常见陷阱` 空→找反模式章或合成；`## 核心原则` 空→该簇无规则对象。
- **陷阱**：`build-skill --dry-run` 的 exit 3 也是「正常」——它表示门禁一拒，别当崩溃处理。

## 阶段 6 · 策展（人工面唯一的重头，核对单驱动）

```bash
node pipeline/run-new-book.mjs scaffold --key <key>
# → pipeline/curation/<key>/：task-skill-suite.v1.json（草稿）
#                              drafts/<slug>.json（工作流草案，字面保真条款默认内置）
#                              EDITORIAL-CHECKLIST.md（逐项收敛清单）
```

编辑按核对单收敛：任务式命名 → 步骤改写为可操作动作 → 补全输入/交付物/检查/边界 →
**去掉 `draft` 标记并把工作流移入 `workflows/`**。然后：

```bash
node pipeline/build-task-suite.mjs --manifest pipeline/curation/<key>/task-skill-suite.v1.json --dry-run
```

- **验收**：全体成员过门禁一（`✅` 全行）；段计数与契约一致由构建器自证。
- **硬边界**：`draft:true` 的工作流**一律构建失败**——草稿与可发布物之间没有静默通道。
- **合并/拆分随策展进行**：合并 = 编辑清单所有权 + 联名重写工作流；每一次合并/重组都要
  重新过一遍「对象并集 = 来源并集、主对象不相交」（套件测试的同一组断言，新书建议照样写测试）。

## 阶段 7 · 发布与评估

```bash
node pipeline/build-task-suite.mjs --manifest pipeline/curation/<key>/task-skill-suite.v1.json --publish
node pipeline/run-gate2.mjs --suite --suite-key <key> --suite-manifest pipeline/curation/<key>/task-skill-suite.v1.json --model <id> --base-url <url>
node pipeline/run-gate2.mjs --suite --suite-key <key> --suite-manifest … --blind-mode strict --model … 
node pipeline/run-gate2.mjs --suite --suite-key <key> --compare
node pipeline/run-gate3.mjs --source-key <key> --model <id> --base-url <url>
```

- **门禁二（触发盲测）**：两读数 + 对照。判读：先看 0 误触发/0 零命中；再看稳定对——
  **strict≥2 且两读数都存的稳定边**按「不相交最强配对」出合并建议（吸收者=对象数→严格命中
  数→字典序）。合并后集合**重跑两读数**（目录哈希变化→全量重答，如实计成本）。
- **门禁三（效用 A/B）**：K=6、复跑制。判定三态：passed（≥1 改进且无确认退化）/
  low-utility（无改进无退化）/ **rejected（退化复跑复现——ADR-006 硬拒，移入
  `registry/rejected/<slug>/` 并写 REJECTION.md 全证据）**。
- **字面保真条款**：任何「技法类」技能（有强既有词汇的）默认保留该条款——四个拒绝例的
  共同死因都是技能词汇改写任务字面（卡 28 修订后复评 3/3 去害，实证有效）。
- **重测协议（ADR-030）**：重测须有因（正文修订 / 仪器立版 / 用户显式要求）；同条件重测
  必须报告全部批次。
- **陷阱**：
  - 非 `--dry-run` 的 build 就是发布——先干跑（卡 19 误发布案）；
  - `--require ./pipeline/tools/fs-ledger.cjs` 的路径要 `./` 前缀；
  - 命令以环境变量开头时权限分类器可能拦截——给 `node …` 命令加一个固定前缀的允许规则；
  - 别用 shell heredoc 往既有文件追加中文（编码事故——用编辑器）。

## 阶段 8 · 收束

- **评测记录**：逐成员判定 + 两批次引用写进 `pipeline/registry/task-suite-assessment.v1.json`
  （或按书命名空间）；status/README/导航同步。
- **冻结**：把新书的 curation/清单、lineage、评测记录纳入冻结面，`freeze-outputs` 落新清单并
  `--verify` 逐一致；**旧冻结不动**（历史语义）。
- **提交**：产物、报告、记录、文档一次提交；提交信息带测试计数。

## 常见陷阱总表（跨阶段）

| 陷阱 | 一句话 |
|---|---|
| 固定路径是第二源的头号杀手 | 新产物面先问「按源命名了吗」（五处漏网史，卡 19–22） |
| 「跑通」≠「落盘齐」 | 声称「全量 N」就清点 N（环 1 只落盘 16/105 的教训） |
| 共用账本 | 每进程独立 `DSH_FS_LEDGER`；0 条 = 方法错误 |
| 参数透传 | 两跳以上透传，取值型开关必须连取值一起带 |
| 目录哈希进盲测输入 | 候选集合一变（合并/下架）→ 全部场景重答，成本如实计 |
| 环境凭据 | `ANY2SKILLS_LLM_API_KEY` 走环境；值不落盘不进日志 |
| 中文追加 | 既有文件用编辑器追加，不用 shell heredoc（编码事故实测） |

## 附录 A · 命令速查

| 命令 | 用途 |
|---|---|
| `run-new-book.mjs onboard/pipeline/scaffold/all` | 本 runbook 的编排入口 |
| `run-book.mjs --source-key` | 环 1/2 全书批处理 |
| `propose-clusters.mjs --source-key` | 环 3 |
| `propose-themes.mjs` / `synthesize-antipatterns.mjs` | 跨章合成 |
| `build-skill.mjs --cluster --dry-run` | 单候选门禁一 |
| `build-task-suite.mjs --manifest [--publish] [--bundle]` | 任务套件构建/发布 |
| `run-gate2.mjs --suite --suite-key --suite-manifest` | 门禁二（两读数 + `--compare`） |
| `run-gate3.mjs --source-key [--skill]` | 门禁三 |
| `freeze-outputs.mjs [--verify]` | 冻结与漂移校验 |
| `publish-task-suite.mjs` | **仅本仓** 30→19 历史迁移用，新书不用 |

## 附录 B · 本仓现状锚点

- 在售：17 个任务技能（`pipeline/curation/task-skill-suite.v1.json`）；
  旧 30 章节套件逐字节归档 `pipeline/registry/legacy-published/chapter-suite-v1/`。
- 关键决策索引：ADR-004（骨架）、ADR-016（跨章合成）、ADR-026/027（门禁二三）、
  ADR-028（体积）、ADR-029（源条件骨架）、ADR-030（低效用治理）、ADR-031（套件重组）、
  ADR-032（套件评测）。
- 两本书的实测基线：`docs/specs/02-benchmark-report.md`、
  `docs/specs/03-second-source-report.md`（成本、规律与陷阱的原始出处）。
