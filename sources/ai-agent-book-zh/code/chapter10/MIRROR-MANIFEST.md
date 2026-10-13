# 镜像清单 · 上游《深入理解 AI Agent》chapter10/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter10/ 上游共 **859** 文件 / **110,335,489** 字节（105.2 MB）——**本轻镜像只入库其中的 8 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `autonomous-phone-registration/` | 32 | 0.2 MB | ✅（12.3 KB） |
| `book-translation/` | 188 | 4.3 MB | ✅（25.6 KB） |
| `generative-agents/` | 345 | 85.2 MB | ✅（13.0 KB） |
| `multi-role-transfer/` | 44 | 7.2 MB | ✅（42.8 KB） |
| `parallel-web-research/` | 25 | 0.3 MB | ✅（9.6 KB） |
| `staged-system-prompt/` | 158 | 7.4 MB | ✅（37.6 KB） |
| `talkact-reproduction/` | 28 | 0.3 MB | ✅（9.3 KB） |
| `voice-werewolf/` | 39 | 0.4 MB | ✅（15.1 KB） |

合计：**8** 个二级目录，上游 **859** 文件 / **110,335,489** 字节；
已镜像 README **8** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter10/autonomous-phone-registration/README.md` | 12572 | `sha256:7aecddf1d1223101ae10149d01d08dcc595b56b0ee7c87cbb9974dd452e2e851` |
| `chapter10/book-translation/README.md` | 26198 | `sha256:43d699a07ac12bd55e5b5367449536d87ca6f33ef026f45276ec1ea43472ffbd` |
| `chapter10/generative-agents/README.md` | 13324 | `sha256:78f92661523158bb336dac46c82c1ab47bb40540c6163c84bdae3a99705304f3` |
| `chapter10/multi-role-transfer/README.md` | 43779 | `sha256:2196e3dff3481d03235bb355b447b0c330e636c204dacb162191ca84ad79c00e` |
| `chapter10/parallel-web-research/README.md` | 9784 | `sha256:a1c7d8dc9c18c87a89a6854498625fce1b68a2b1d918c900444a483214d0cc08` |
| `chapter10/README.md` | 5265 | `sha256:20f9389d48b0f09d6c8f1d24e1f101eb11d34b8531a18f0c3049589dad3cd73d` |
| `chapter10/staged-system-prompt/README.md` | 38494 | `sha256:d5463be0a71758a615aec74d9c29ec67bb0bc806037c53896435f25fbc484415` |
| `chapter10/talkact-reproduction/README.md` | 9498 | `sha256:4c05da588aa35d1546ac714039b90fd208cd7cacd9e1ca7d3b1bff7396d50fa5` |
| `chapter10/voice-werewolf/README.md` | 15445 | `sha256:dabca44289a95a060b12feedece961d224c55a6544308aa6dc7b1836d992d1d7` |
