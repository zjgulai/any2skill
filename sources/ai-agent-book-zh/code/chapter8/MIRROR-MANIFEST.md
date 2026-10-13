# 镜像清单 · 上游《深入理解 AI Agent》chapter8/（**轻镜像：只取 README**）

本目录是上游仓库的**轻镜像**，不是本项目产出。它存在的原因是环 4 骨架的「配套代码」段
（ADR-004）缺少 chapter4 以外的来源；该段的消费面（`collectCodePointers`）恰好只需要
**每个目录的路径 + 一句说明**——而说明取自各目录 `README.md` 的首个正文段落。

## 来源与口径

| 项 | 值 |
|---|---|
| 仓库 / pin | `https://github.com/bojieli/ai-agent-book` @ `dbc046eb896ac4e39aa19c7774c8bf49583b89a6`（与 ADR-020 同一 pin） |
| 取法 | blobless partial clone + 逐文件 `git show FETCH_HEAD:<path>` 按需取 README 的 blob |
| 镜像日期 | 2026-10-13 |
| 镜像内容 | 本层及以上每一级目录的 `README.md`（含章根 README；**不含任何代码文件**） |
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter8/ 上游共 **1308** 文件 / **49,199,866** 字节（46.9 MB）——**本轻镜像只入库其中的 18 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `AdaptThink/` | 2 | 0.1 MB | ✅（48.3 KB） |
| `AWorld-train/` | 1 | 0.1 MB | ✅（87.7 KB） |
| `continued-pretraining/` | 17 | 0.2 MB | ✅（20.4 KB） |
| `cot-distillation/` | 51 | 12.7 MB | ✅（15.2 KB） |
| `curly-quote-sft/` | 18 | 1.7 MB | ✅（3.7 KB） |
| `exact-copy-sft/` | 17 | 1.0 MB | ✅（3.4 KB） |
| `Intuitor/` | 8 | 0.1 MB | ✅（78.3 KB） |
| `MiniMind-pretrain/` | 21 | 3.0 MB | ✅（154.1 KB） |
| `MultilingualReasoning/` | 4 | 0.1 MB | ✅（47.6 KB） |
| `orpheus/` | 5 | 0.0 MB | ✅（12.6 KB） |
| `premature-completion-dpo/` | 27 | 0.1 MB | ✅（7.6 KB） |
| `prompt-distillation/` | 37 | 8.5 MB | ✅（49.2 KB） |
| `retool/` | 1 | 0.3 MB | ✅（321.0 KB） |
| `RLVP/` | 1 | 0.0 MB | ✅（5.1 KB） |
| `sesame/` | 7 | 0.0 MB | ✅（11.5 KB） |
| `SimpleVLA-RL/` | 1028 | 12.2 MB | ✅（68.5 KB） |
| `SpatialReasoning/` | 1 | 0.2 MB | ✅（157.0 KB） |
| `speech-sft-experiment/` | 62 | 6.7 MB | ✅（6.6 KB） |

合计：**18** 个二级目录，上游 **1308** 文件 / **49,199,866** 字节；
已镜像 README **18** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter8/AdaptThink/README.md` | 49504 | `sha256:67a957c12d289d2fda52c8952c3f3ecd8eced38498d3165c0e5f775d25eb63d4` |
| `chapter8/AWorld-train/README.md` | 89758 | `sha256:cba6646ea983e78a9f0744b19aa762f496bcba8346f7432cea0bd2ccb25da22f` |
| `chapter8/continued-pretraining/README.md` | 20916 | `sha256:4d240de177b655d8dd95bbfd1bd22cc71caf536f2090f0a9f55bec5cab9b53f6` |
| `chapter8/cot-distillation/checkpoints/exp8-9-qwen25-1.5b-kimi-k3-20260801-v1/checkpoint-2/README.md` | 5206 | `sha256:cb3cdefbcf1962832683ba0c254e668036400b8b081eef936ed72964b2419408` |
| `chapter8/cot-distillation/checkpoints/exp8-9-qwen25-1.5b-kimi-k3-20260801-v1/checkpoint-4/README.md` | 5206 | `sha256:cb3cdefbcf1962832683ba0c254e668036400b8b081eef936ed72964b2419408` |
| `chapter8/cot-distillation/checkpoints/exp8-9-qwen25-1.5b-kimi-k3-20260801-v1/checkpoint-6/README.md` | 5206 | `sha256:cb3cdefbcf1962832683ba0c254e668036400b8b081eef936ed72964b2419408` |
| `chapter8/cot-distillation/checkpoints/exp8-9-qwen25-1.5b-kimi-k3-20260801-v1/README.md` | 5206 | `sha256:cb3cdefbcf1962832683ba0c254e668036400b8b081eef936ed72964b2419408` |
| `chapter8/cot-distillation/README.md` | 15584 | `sha256:2744e07bd1c10b29606eacc0cf8de9d4f25fcf6171654911425270920d9386cc` |
| `chapter8/curly-quote-sft/README.md` | 3828 | `sha256:da10ef0e1bd5760a7de4b65fd055ff3e0ad936618b2bea2ae2ca9e81e86da1e5` |
| `chapter8/exact-copy-sft/README.md` | 3517 | `sha256:65559d41a39c7ee63100f23aa5e4c021ce2e062500f94acc191873be9c9146a4` |
| `chapter8/Intuitor/README.md` | 80141 | `sha256:5cbdf33dddd526f3ae670632f77542456c2370b169b8463e7ab85d89725999b7` |
| `chapter8/MiniMind-pretrain/README.md` | 157786 | `sha256:84bb389a73a28dc87e92a2d6701360fdd57144018f2fe2484f0f79ec4253c698` |
| `chapter8/MultilingualReasoning/README.md` | 48772 | `sha256:f4e7fff5650718a7eca89e538f8828eecdda945064374601fd90f3520f2f1ba6` |
| `chapter8/orpheus/README.md` | 12882 | `sha256:a9c7f4fc2f6e567593e744863a9c3002ba30781dd549650d122c78f068d5e8a3` |
| `chapter8/premature-completion-dpo/README.md` | 7732 | `sha256:8ee6e803e7008dd78cd888c7bc0af7f5f8fa135d5a8f751f3896fbdf7f6a1c3d` |
| `chapter8/prompt-distillation/README.md` | 50381 | `sha256:42a2e65d78719421718d8bc69f8d218b3cf79b80150602bb76dfaba53f38b91e` |
| `chapter8/prompt-distillation/validation/exp8-8-kimi3-smollm2-20260730/student_adapter/README.md` | 5224 | `sha256:f9b48a87d653b2af6971a2240d29ab5a8929fe7e156cc566102f50da655aefa2` |
| `chapter8/README.md` | 15055 | `sha256:a3bf36f88b31af5747d0b14aafbb950bdc69251d8f8c78001295c059444f0e6d` |
| `chapter8/retool/README.md` | 328716 | `sha256:5381a15af2e4630057cde45651b801e9090f1c8e6e074a7d51c61dcd7812ff8f` |
| `chapter8/RLVP/README.md` | 5248 | `sha256:5a778e5994e19a2907de6183dec830420d8ea804115f3acbf6981565e67a0c0e` |
| `chapter8/sesame/README.md` | 11780 | `sha256:51c42d68397ff0f15815daae1288e9383a651ca175d776fcce72b3f686df80f4` |
| `chapter8/SimpleVLA-RL/README.md` | 70175 | `sha256:ad3035191046af992ac94937a05295d3ee42298582acb0819924232b2c587226` |
| `chapter8/SpatialReasoning/README.md` | 160778 | `sha256:40bc9dd232f295e39af7755d39651d75c37d152878436f722031e6531d4c75b8` |
| `chapter8/speech-sft-experiment/README.md` | 6799 | `sha256:a2d3f8c8ca33bdae1e225a2d906dfd3ff92faab98bf21a660af406718da98a0d` |
| `chapter8/speech-sft-experiment/validation/exp8-6-20260804-v1/adapters/orpheus/README.md` | 5214 | `sha256:d62b94e4ab068c9379c9d6a92fa73dc9468f85ce204615543fa20db6e453e4fb` |
| `chapter8/speech-sft-experiment/validation/exp8-6-20260804-v1/adapters/sesame/README.md` | 5183 | `sha256:65a8c53feecbfc1e7a8cd64bc6a79baedbffd1ef6b9cc17b1ea0a5529e4d74ec` |
