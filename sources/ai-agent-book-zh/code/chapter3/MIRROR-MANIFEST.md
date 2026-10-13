# 镜像清单 · 上游《深入理解 AI Agent》chapter3/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter3/ 上游共 **1147** 文件 / **214,818,715** 字节（204.9 MB）——**本轻镜像只入库其中的 14 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `agentic-rag/` | 317 | 8.8 MB | ✅（12.6 KB） |
| `agentic-rag-for-user-memory/` | 31 | 15.9 MB | ✅（10.8 KB） |
| `contextual-retrieval/` | 32 | 2.9 MB | ✅（11.3 KB） |
| `contextual-retrieval-for-user-memory/` | 107 | 48.5 MB | ✅（23.7 KB） |
| `dense-embedding/` | 25 | 0.2 MB | ✅（16.4 KB） |
| `log-sanitization/` | 28 | 0.3 MB | ✅（17.5 KB） |
| `mem0/` | 11 | 0.1 MB | ✅（11.3 KB） |
| `memobase/` | 11 | 0.1 MB | ✅（11.7 KB） |
| `retrieval-pipeline/` | 24 | 0.3 MB | ✅（16.4 KB） |
| `sparse-embedding/` | 17 | 0.1 MB | ✅（14.3 KB） |
| `structured-index/` | 26 | 7.9 MB | ✅（11.5 KB） |
| `structured-knowledge-extraction/` | 140 | 9.9 MB | ✅（20.1 KB） |
| `user-memory/` | 295 | 108.5 MB | ✅（12.3 KB） |
| `user-memory-evaluation/` | 83 | 1.3 MB | ✅（12.3 KB） |

合计：**14** 个二级目录，上游 **1147** 文件 / **214,818,715** 字节；
已镜像 README **14** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter3/agentic-rag-for-user-memory/README.md` | 11057 | `sha256:3a81b13adf5424e28d83fc46695dd5277f13af0e5055fe8a4e2cbbc07aa0837a` |
| `chapter3/agentic-rag/README.md` | 12945 | `sha256:3c6aaca80dbbdf685e96c8248fe6a9cfcd1c754567616ca33c3a333f967e9213` |
| `chapter3/contextual-retrieval-for-user-memory/README.md` | 24267 | `sha256:55acd681bec992dc9836fb2c025542f07039ef33ba2a286e04888f21bed348b9` |
| `chapter3/contextual-retrieval/README.md` | 11614 | `sha256:9845d1a0ab8f046eb582d84384c842c127325cde32bd46f5667fe690e35fc56c` |
| `chapter3/dense-embedding/README.md` | 16743 | `sha256:e57125a4678cb79b7eac06dea1f433ebf6deaa9f68a0d22936970b34ea5e70f5` |
| `chapter3/log-sanitization/README.md` | 17909 | `sha256:c2bcc3676c1b7042479bc5c38542cdc96488e8845bba4716ea72d3ebbd78d28e` |
| `chapter3/mem0/README.md` | 11619 | `sha256:8d1751fe2fc3083a294a112797e94e2fe99ce4b2b068c4a1fe61b1be7e2c8f93` |
| `chapter3/memobase/README.md` | 11956 | `sha256:8e30a5373fa572f0a4efeac141679fd0bc0d3662013614fc423a5c6f5929b690` |
| `chapter3/README.md` | 4410 | `sha256:fc3c104b7f09e60992e95dce124b5aea5a91a1a2c7f62adbcc410454c5492d78` |
| `chapter3/retrieval-pipeline/README.md` | 16764 | `sha256:c51a102287c00f68c77cddf25f7b8c940010e3c43d10a4dc598443b52d8e08ba` |
| `chapter3/sparse-embedding/README.md` | 14691 | `sha256:981f6d2eafa96491cf8fbbde76ff934dcda16566034ae62630980dba72d6c76b` |
| `chapter3/structured-index/README.md` | 11805 | `sha256:7864022f46a2ef962fbb1c6ae28d0f1d0efe72afe8edbb768934fc2ea659e97f` |
| `chapter3/structured-knowledge-extraction/README.md` | 20547 | `sha256:a4c80903618c68e8dc8b3c2998f7966056974bcdc439244d34f1e592d11afbbd` |
| `chapter3/user-memory-evaluation/README.md` | 12622 | `sha256:c6aee20b3fcccd0678cf2aba68ecb5f351d423ddb8ecdee42476b71ba4ff4c47` |
| `chapter3/user-memory/README.md` | 12557 | `sha256:37246e257cc82cf15a09f2bab04079be78a4e0b7853606b1bdbfeb81576567b0` |
