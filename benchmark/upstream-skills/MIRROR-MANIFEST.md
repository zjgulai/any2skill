# 镜像清单 · 上游《深入理解 AI Agent》的 skills/

本目录是**上游仓库的镜像**，不是本项目产出。它是 ADR-001 盲测基准（golden benchmark）的对照物。

## 为什么在这里，而不是 `sources/`

`sources/ai-agent-book-zh/skills/README.md` 此前躺在**生成链路的取源根**里，而 `benchmark/` 是空目录。
ADR-001 的原则是「物理隔离（正文 `book/` 与基准 `benchmark/` 分目录、基准只读）**是让对照组有效的前提**」。
2026-10-12 用户拍板**移进 `benchmark/`**（ADR-019「未决」第 4 条的处置），同日执行 `git mv`；
2026-10-13 按用户拍板把 **22 个 skill 目录本体**一并镜像进来——验收 4（与 benchmark 22 个对照后
差异可解释）的对照物至此完整。

## 来源与校验

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/bojieli/ai-agent-book` |
| 钉住的 commit | `dbc046eb896ac4e39aa19c7774c8bf49583b89a6`（与 ADR-020 同一 pin） |
| 取法 | `git init` + `git fetch --filter=blob:none --depth 1 origin <pin>` + `git sparse-checkout set skills` + `git checkout FETCH_HEAD` |
| 镜像日期 | 2026-10-13 |
| 目标路径 | `benchmark/upstream-skills/` |

**两处交叉核对（实测）**：

1. 此前已入库的 `README.md` 与这次取回的同名文件**逐字节相同**
   （同为 `sha256:37837709da219e4acd99c54129f4296d361ec917553ffa7e0b27fd06b3e03254`，3,783 字节）——
   早先的 `git mv` 没有改动过任何字节。
2. 23 个文件合计 **248,436 字节**，与仓库自分析期就持有的记录一致
   （`analysis/05-source-analysis.md`：「22 个 `skills/*/SKILL.md`，合计 248436 B，其中 README 3783 B」）——
   两个独立时点的快照互证。

⚠ **本目录是只读镜像，不得就地修改。** 要更新就重新拉取并重跑下面的校验。

## 口径：取了什么

上游 `skills/` 下**只有** `README.md` 与 22 个 `<name>/SKILL.md`（分析期实测：每个 skill 是
自包含单文件，无 `references/`、无 `scripts/`），所以下面 23 行就是全部：

| 文件 | 字节 | sha256 |
|---|---:|---|
| `README.md` | 3783 | `sha256:37837709da219e4acd99c54129f4296d361ec917553ffa7e0b27fd06b3e03254` |
| `agent-evaluation/SKILL.md` | 16568 | `sha256:04712fc85be9fc5e1c5da83843c3524f2cc19042589a08bd39e686966df982f0` |
| `agent-evolution/SKILL.md` | 13492 | `sha256:7abaf5e36c2e55a44cfddffc7886359cb7f466402ed966fbacd85668bbc82c62` |
| `agent-state-bar/SKILL.md` | 10541 | `sha256:624a76c1706f23fe428b13f7764317363303f2957f09af2e972086c2ca5bd13b` |
| `async-event-agent/SKILL.md` | 11341 | `sha256:f813de15bb6b7874dd5b5fa627914dfa2aab0e2ec18854e8289d2c362973f569` |
| `bad-case-to-dpo/SKILL.md` | 12302 | `sha256:51f79ba176bbd10b558a374e274afb05f4653b04a7e52b022a7a27925879372d` |
| `coding-agent-harness/SKILL.md` | 7662 | `sha256:0acb76ed2496a2a6269576eac41b431b70272d05c55c369bf26af6569bfc2788` |
| `computer-use/SKILL.md` | 10299 | `sha256:aa65a04de8cb10412e57638810f7eecbd4e2ef20d2b189cba6db15cb15399e3e` |
| `context-compression/SKILL.md` | 10278 | `sha256:b68d34311763d80c8f65da811d0d7a609a36d4a108f270fb90bd061b2b7b9aa9` |
| `context-engineering/SKILL.md` | 9948 | `sha256:3c36a03787a308f007862d704e68c14bb033b8211486e209078c7f331ca2bf99` |
| `error-recovery/SKILL.md` | 10382 | `sha256:d021773b43acdbb53a1d4b55ceaa748b86e423ad2299b297b92ed3f84860d6dc` |
| `eval-dataset-design/SKILL.md` | 11102 | `sha256:26dce0ca97c8ae561c8a12e251900bb4b6cd0be6d6efb2b07b666c6615aefd72` |
| `knowledge-org/SKILL.md` | 13716 | `sha256:c2b706450fdbf64ba2a557e6773654829cafb85ebc2d33097c39cf6ec3c20635` |
| `kv-cache-design/SKILL.md` | 9595 | `sha256:9e44bc53c0df2b0c24090331d5fc1c5d4717e63f241c2d213ac08ef57fd2bb3d` |
| `loop-engineering/SKILL.md` | 9063 | `sha256:30d48e05b60b1e89c6bb5334dd1556571944f7b6deebdcf7e57516541591190f` |
| `mcp-skill-hub/SKILL.md` | 7318 | `sha256:cae89584a8c11949b4b2204591179fb6221ce6e1b36f7054723e7fd9c4f05b09` |
| `memory-system/SKILL.md` | 11907 | `sha256:e2452854308766c3aab3edcc48fb73cc7e258e4b7e92e386252d07fa86a81de0` |
| `multi-agent-design/SKILL.md` | 12002 | `sha256:c23551dec7b5090e768d21f4013e5fceded090ed224eb2d956cd2624641265d9` |
| `post-training-strategy/SKILL.md` | 15788 | `sha256:34b7b049bb42a414ff0f0cd8717147561d70c67c1aa3d787cf82dd807aef13c4` |
| `rag-pipeline/SKILL.md` | 9342 | `sha256:69394a37b1bcbb5f22370517992a63e4373f49e9d6149526b7d53ef19e770156` |
| `reward-design/SKILL.md` | 10880 | `sha256:a8abe578598e80119b49189e496bae27d3bbcf91e7fe634c9ec57b107d8fa874` |
| `tool-design/SKILL.md` | 11751 | `sha256:2a39e676512a9f991397c59d1bad0917999d17ff6d5eddffca8675bb60d5b5e0` |
| `tool-discovery/SKILL.md` | 9376 | `sha256:2ec51723dba633afb3777864d9ccf8d6f908820c0af235b271b38705aedbcea0` |

## 对照纪律（ADR-001 / ADR-004）

**这个目录不得被生成链路读取**（卡 01 的路径守卫 + 卡 09 的访问账本双重把关）。
「产出 vs 原书」的比对只在**全部产出冻结之后**执行，且比对者必须是**独立于构建者的 agent**——
在此之前，本目录只作为对照物被保存，不参与任何生成步骤。
