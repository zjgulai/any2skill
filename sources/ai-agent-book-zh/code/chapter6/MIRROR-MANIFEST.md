# 镜像清单 · 上游《深入理解 AI Agent》chapter6/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter6/ 上游共 **478** 文件 / **29,792,210** 字节（28.4 MB）——**本轻镜像只入库其中的 13 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `agent-with-event-trigger/` | 27 | 0.2 MB | ✅（34.8 KB） |
| `astra-async-steering/` | 66 | 1.1 MB | ✅（13.3 KB） |
| `async-agent/` | 27 | 0.2 MB | ✅（37.0 KB） |
| `claude-computer-use-native/` | 118 | 8.8 MB | ✅（7.7 KB） |
| `computer-use-open-model/` | 37 | 1.4 MB | ✅（9.8 KB） |
| `controllable-tts/` | 44 | 2.2 MB | ✅（7.1 KB） |
| `end-to-end-speech/` | 19 | 1.6 MB | ✅（6.8 KB） |
| `gemini-xlerobot-navigation/` | 13 | 4.7 MB | ✅（4.2 KB） |
| `live-audio/` | 44 | 2.8 MB | ✅（25.7 KB） |
| `phone-agent/` | 32 | 3.0 MB | ✅（7.6 KB） |
| `rgb-sim2real-grasping/` | 16 | 1.7 MB | ✅（3.4 KB） |
| `streaming-speech/` | 23 | 0.8 MB | ✅（6.0 KB） |
| `xlerobot-teleoperation/` | 12 | 0.1 MB | ✅（3.5 KB） |

合计：**13** 个二级目录，上游 **478** 文件 / **29,792,210** 字节；
已镜像 README **13** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter6/agent-with-event-trigger/README.md` | 35647 | `sha256:8b30be18ee4193f9ce8a9969830497f1c43cfd1af1b24e3c040176d4ecd2b099` |
| `chapter6/astra-async-steering/README.md` | 13656 | `sha256:a3224edcc3819a48e3a3bf935ff6803962bd6edfa87249cce3b9b8505af4295c` |
| `chapter6/async-agent/README.md` | 37878 | `sha256:fa5dc71e8f1efa53a74872be1ea050adf57cc714d7658592ce82fcacf06e65de` |
| `chapter6/claude-computer-use-native/README.md` | 7857 | `sha256:bb8a4d1e56d64ff4f74954a8bdd4d628d8d7198718fa2dd0b124a82f6bd0a252` |
| `chapter6/computer-use-open-model/README.md` | 10018 | `sha256:b5393aecf4f2b2030a6367e1c647b19b1c1541c2cca56be02c123dff06b06836` |
| `chapter6/controllable-tts/README.md` | 7269 | `sha256:17a59207d9da5578e70eb7c74edf6b6ab9a5688d494d718d6e730acb53c4d916` |
| `chapter6/end-to-end-speech/README.md` | 6992 | `sha256:329aac9a08336cdf5984dd42af59202c0b3ac312634cadb5a2c7cbb4bca9d5da` |
| `chapter6/gemini-xlerobot-navigation/README.md` | 4282 | `sha256:af2fd7e6d908172152b3fade2fce97069430170cd8a6a6fe72d519fded247871` |
| `chapter6/live-audio/README.md` | 26309 | `sha256:ceeb33f133bd50fd8ab183bc9801055632fb350ab9431bf4e3697b8f45b181b4` |
| `chapter6/phone-agent/README.md` | 7784 | `sha256:3d6d4ead188df0ebe329143837a210828469df8d5dda4a109ae2549ece160f03` |
| `chapter6/README.md` | 18457 | `sha256:6e938c5f3366caec75f22deeca1ecac9d4efc30f8027c5b2499349168b7aa668` |
| `chapter6/rgb-sim2real-grasping/README.md` | 3477 | `sha256:6287f91e7609484c48a2859c43e711ebdafe444804dedbe367051ae2fc36d7ed` |
| `chapter6/streaming-speech/README.md` | 6120 | `sha256:14c14e31fea5b4290fd8bda03712aed09e0e8f06ac6e8500011500133a4abd2e` |
| `chapter6/xlerobot-teleoperation/README.md` | 3596 | `sha256:191d6c149d961af1880e2ed8a0826eaf4587db88c6fdf62844410edd7545e515` |
