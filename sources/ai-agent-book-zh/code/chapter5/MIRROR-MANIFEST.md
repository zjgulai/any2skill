# 镜像清单 · 上游《深入理解 AI Agent》chapter5/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter5/ 上游共 **1438** 文件 / **237,145,343** 字节（226.2 MB）——**本轻镜像只入库其中的 16 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `adaptive-log-parser/` | 20 | 0.2 MB | ✅（18.5 KB） |
| `agent-creator/` | 19 | 0.1 MB | ✅（6.9 KB） |
| `cad-vs-diffusion/` | 27 | 0.2 MB | ✅（9.8 KB） |
| `code-for-logic/` | 23 | 2.2 MB | ✅（23.0 KB） |
| `code-for-math/` | 22 | 1.1 MB | ✅（21.9 KB） |
| `coding-agent/` | 64 | 0.4 MB | ✅（37.8 KB） |
| `conversational-ui/` | 60 | 0.8 MB | ✅（21.1 KB） |
| `dynamic-form/` | 14 | 0.1 MB | ✅（15.7 KB） |
| `erp-agent/` | 30 | 1.5 MB | ✅（13.8 KB） |
| `log-diagnosis/` | 35 | 0.2 MB | ✅（22.1 KB） |
| `paper-to-ppt/` | 665 | 76.7 MB | ✅（24.1 KB） |
| `paper-to-video/` | 89 | 42.6 MB | ✅（18.6 KB） |
| `permission-embedded-data-objects/` | 50 | 0.7 MB | ✅（6.9 KB） |
| `provider-failover/` | 84 | 0.9 MB | ✅（11.7 KB） |
| `small-model-codified-rules/` | 13 | 1.7 MB | ✅（28.3 KB） |
| `video-edit/` | 223 | 96.9 MB | ✅（24.3 KB） |

合计：**16** 个二级目录，上游 **1438** 文件 / **237,145,343** 字节；
已镜像 README **16** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter5/adaptive-log-parser/README.md` | 18907 | `sha256:96c5a2fa2130e6330a774d793e7d7d7436be3330a13fdbdb5281294116f0b76f` |
| `chapter5/agent-creator/README.md` | 7097 | `sha256:0cf1726d2a232e8a3eef3597a652dde800ac5d24e30462dc3fdc6306785fea28` |
| `chapter5/cad-vs-diffusion/README.md` | 9989 | `sha256:b9913bbf3d82d2dd08bf262016b59ede05cf755c8f03805e76568985269ac908` |
| `chapter5/code-for-logic/README.md` | 23582 | `sha256:040958c0711a561375f97185e6e280ebf411ba0f09853086182ea8a442075d66` |
| `chapter5/code-for-math/README.md` | 22388 | `sha256:971ab558e538a0acdd7e3b2852ab1d12508cfa5e56be2bcda1ed013ab8a4e824` |
| `chapter5/coding-agent/README.md` | 38758 | `sha256:63197a0332872c138735203283edd7d0efadc1be9dd3176d6ed4eb782a4b990a` |
| `chapter5/coding-agent/tests/README.md` | 8408 | `sha256:cbe92100f3a8e9edde366b8d1e4a81382b4975abb6fb8f8164a6654edc1cb6cf` |
| `chapter5/conversational-ui/README.md` | 21642 | `sha256:777809b57ad022f678a40771ecf19499cf460ecc3e49c53d466f341095c19f92` |
| `chapter5/dynamic-form/README.md` | 16039 | `sha256:8ec6ae3e4c601d6837911c77151d32c69c05e5490635500b69f4b0e21257515a` |
| `chapter5/erp-agent/README.md` | 14174 | `sha256:d6db15596f31d243b62c292d400688448970d92d41fb9670f8f2926325b71e1f` |
| `chapter5/log-diagnosis/README.md` | 22581 | `sha256:227810be6163c88572a7cf8d67fa4d8b3f8127f33f9bb84c6f275b68ffdc698e` |
| `chapter5/paper-to-ppt/README.md` | 24629 | `sha256:a6005e2245ca771231f8ec98a248cb8aed484163dc3933750e9937715a09a88a` |
| `chapter5/paper-to-video/README.md` | 19087 | `sha256:12e286f02ef8b7865243eba269c5b22be816fd3e85832ce11d8c5436ea58af12` |
| `chapter5/permission-embedded-data-objects/README.md` | 7088 | `sha256:dab1ff92c8746fc75b7d54ec5c1fbec445ffee8f894bbc6aea361832bd33e9cf` |
| `chapter5/provider-failover/README.md` | 11998 | `sha256:c0b876658ba9a54b51948b9fe9183592cce453c16f781d9d0ce0ae67132e112d` |
| `chapter5/README.md` | 6588 | `sha256:479dfad5d1aeb3b4f5ef85677f71efcae0f733422f762dbdf8805f8d37c353fb` |
| `chapter5/small-model-codified-rules/README.md` | 28980 | `sha256:b44be028e5e00754ad9cb45bbc485097fbc8b6d6ea3822fbdd6165eaa5b73c46` |
| `chapter5/video-edit/README.md` | 24929 | `sha256:4fc91c53be49dc4fa584071959e94ad4ed2d8bd20cfe0418b5b26b065d73816e` |
