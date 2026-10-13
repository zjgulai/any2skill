# 镜像清单 · 上游《深入理解 AI Agent》chapter1/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter1/ 上游共 **170** 文件 / **6,050,755** 字节（5.8 MB）——**本轻镜像只入库其中的 5 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `context/` | 66 | 1.8 MB | ✅（52.6 KB） |
| `image-gen-workflow/` | 28 | 0.4 MB | ✅（15.5 KB） |
| `learning-from-experience/` | 25 | 0.8 MB | ✅（30.0 KB） |
| `search-codegen/` | 25 | 1.2 MB | ✅（14.1 KB） |
| `web-search-agent/` | 26 | 1.6 MB | ✅（22.6 KB） |

合计：**5** 个二级目录，上游 **170** 文件 / **6,050,755** 字节；
已镜像 README **5** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter1/context/README.md` | 53857 | `sha256:843876829fc0baa77766e227eccbe3a6ea274aaa6eacce9f015770088e1b934a` |
| `chapter1/image-gen-workflow/README.md` | 15839 | `sha256:ffd6df9c360dcb3b13c811c9b6442d72a0795810d90d1a771e9f06ab3a5747aa` |
| `chapter1/learning-from-experience/README.md` | 30723 | `sha256:9a615c1ea7e71d52758e86844b59b4ff44bb241dc35510a7a83a017121dfd4ca` |
| `chapter1/README.md` | 4028 | `sha256:6281b1af8d4c84f1e1ec2f2228a36a548056659881ec5f0efc44de318b919509` |
| `chapter1/search-codegen/README.md` | 14402 | `sha256:7e71d53a0c2f112865b7165676fdc9a65d127dfdaba0d0545ef56d94e29bd4d3` |
| `chapter1/web-search-agent/README.md` | 23103 | `sha256:4b55432a9310b374d1412a33a0933e69ae910bc221d7806f812f7d92dcb612fd` |
