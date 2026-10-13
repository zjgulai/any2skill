# 镜像清单 · 上游《深入理解 AI Agent》chapter2/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter2/ 上游共 **878** 文件 / **407,638,526** 字节（388.8 MB）——**本轻镜像只入库其中的 8 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `agent-skills-ppt/` | 95 | 17.4 MB | ✅（22.8 KB） |
| `attention_visualization/` | 62 | 80.8 MB | ✅（18.6 KB） |
| `context-compression/` | 18 | 0.2 MB | ✅（21.5 KB） |
| `kv-cache/` | 27 | 0.3 MB | ✅（25.4 KB） |
| `local_llm_serving/` | 35 | 0.9 MB | ✅（28.5 KB） |
| `prompt-engineering/` | 199 | 284.4 MB | ✅（20.3 KB） |
| `prompt-injection/` | 107 | 2.0 MB | ✅（19.5 KB） |
| `system-hint/` | 335 | 2.9 MB | ✅（18.3 KB） |

合计：**8** 个二级目录，上游 **878** 文件 / **407,638,526** 字节；
已镜像 README **8** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter2/agent-skills-ppt/README.md` | 23369 | `sha256:85548a2337bd1906ebd5543e7169ec344ca9276a20ba785fab638d51cdf5559c` |
| `chapter2/attention_visualization/README.md` | 19055 | `sha256:9786329ab5f3d49a4718753d96f792a5d18c936a6df5dfc2bff061ead54ddafb` |
| `chapter2/context-compression/README.md` | 22057 | `sha256:93a3fdc25e1f13e61ab66252bb41e29ff47b8a68928b53193ad64cb27fb4b7c7` |
| `chapter2/kv-cache/README.md` | 26037 | `sha256:13d2b56ae11041e4c5c8745cc80aae625102636c13bb62467b669aacf20cdb4d` |
| `chapter2/local_llm_serving/README.md` | 29201 | `sha256:4fa7bcae5e49dc5bbadebb4fd1df291091888d8d36b100640c77aea3185711ef` |
| `chapter2/prompt-engineering/README.md` | 20820 | `sha256:edd7aa32598e5c7db8e47a74b90ea1f661a4ea9dbfaf873fdf6f99b88c24e2d4` |
| `chapter2/prompt-engineering/tau_bench/envs/retail/data/readme.md` | 1420 | `sha256:448640f4b5e104f15e4476e2aa10f3b6616181135dc38262a86e71ed1b30737d` |
| `chapter2/prompt-injection/README.md` | 20014 | `sha256:0759b92015cc651c49283abb75834b714f4e84e59beedf516dde2704757def25` |
| `chapter2/README.md` | 3962 | `sha256:2eac6a5409ec6f0f8545fee7c7dbf7bba76f04dfab81669359796ba492386635` |
| `chapter2/system-hint/README.md` | 18776 | `sha256:866b01d1481f5fd101ded746c86ca3cac911ff4865a8a623483c8343a65e5419` |
