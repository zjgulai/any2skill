# 镜像清单 · 上游《深入理解 AI Agent》chapter7/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter7/ 上游共 **309** 文件 / **52,021,524** 字节（49.6 MB）——**本轻镜像只入库其中的 12 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `agent-cost-analysis/` | 17 | 0.2 MB | ✅（20.4 KB） |
| `android-world/` | 35 | 10.3 MB | ✅（37.0 KB） |
| `elo-leaderboard/` | 52 | 1.2 MB | ✅（28.5 KB） |
| `experiment-7-2-human-benchmark/` | 16 | 0.2 MB | ✅（27.3 KB） |
| `model-action-threshold/` | 25 | 0.2 MB | ✅（7.4 KB） |
| `model-benchmark/` | 10 | 0.2 MB | ✅（22.1 KB） |
| `openvla-robotwin2-eval/` | 19 | 0.7 MB | ✅（7.7 KB） |
| `public-health-reporting-eval/` | 15 | 0.0 MB | ✅（7.8 KB） |
| `tau2-bench-eval/` | 4 | 0.4 MB | ✅（8.2 KB） |
| `tts-quality-eval/` | 29 | 1.3 MB | ✅（15.9 KB） |
| `user-memory-policy-eval/` | 6 | 0.1 MB | ✅（4.7 KB） |
| `user-memory-system-evaluation/` | 81 | 35.0 MB | ✅（17.5 KB） |

合计：**12** 个二级目录，上游 **309** 文件 / **52,021,524** 字节；
已镜像 README **12** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter7/agent-cost-analysis/README.md` | 20878 | `sha256:576b1546aa8dd62589bdbcc022a5823733599aa77cc2c06b9859646b25502e3e` |
| `chapter7/android-world/failure-attribution/README.md` | 19920 | `sha256:20ce68d61ef8b67cb0483633583115bb7ee0ca3672a4d55d611546a32fc8431d` |
| `chapter7/android-world/README.md` | 37861 | `sha256:7784c5fa3cfc720a84414fdca0b18b993e011fb5331f8da865d40c081df3fba6` |
| `chapter7/elo-leaderboard/README.md` | 29205 | `sha256:8028977cf911911f86399a4710661e24029a3ea7fbe487f0d02545678f185a8c` |
| `chapter7/experiment-7-2-human-benchmark/README.md` | 27953 | `sha256:799cff6f801b8033ecf02925de6a1b88ffa7f9a68d7283551ab5868d115167bb` |
| `chapter7/model-action-threshold/README.md` | 7558 | `sha256:2ed1ebdaa0b2c2b853f110221a4edd7e129b182fa9831b8fe684d655e0b72f48` |
| `chapter7/model-benchmark/README.md` | 22681 | `sha256:615253766ecb127ab7a9bdfa35ffc2ac5d44dc1d9e370f531236b69b9995bccf` |
| `chapter7/openvla-robotwin2-eval/README.md` | 7870 | `sha256:f57ef33619e933f15f9f6ab6b3d812ab7d2b793ffe06dfd082a296d732709e1e` |
| `chapter7/public-health-reporting-eval/README.md` | 8022 | `sha256:242fbd2260ea310b5a021045578ce7a1bc742c0e1d429aab9c4cc42779a2633a` |
| `chapter7/README.md` | 14407 | `sha256:b1b6f8bd5288566e1d82789239ea5f25ad2dbdc41aac9e26b2bf8f7348652039` |
| `chapter7/tau2-bench-eval/README.md` | 8421 | `sha256:7bd8d013dcc2d66f1d41725a534f18d752f0c70a12497d59c1028556f0ab1f31` |
| `chapter7/tts-quality-eval/README.md` | 16275 | `sha256:a8d108b77c4dd5eb201a731912ff3eafaa91c5852c4dc18a37717139da60342d` |
| `chapter7/user-memory-policy-eval/README.md` | 4855 | `sha256:6772ef321dfeb86ddb5671f3a78fff4f2bb4e06a6f777ceae5e3b961ed8e2e87` |
| `chapter7/user-memory-system-evaluation/README.md` | 17959 | `sha256:47c8c5d5185425e274098d2a95a9eabe9f76299411e21c50e0d5618c676194c1` |
