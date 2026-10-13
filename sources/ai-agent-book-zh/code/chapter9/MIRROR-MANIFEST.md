# 镜像清单 · 上游《深入理解 AI Agent》chapter9/（**轻镜像：只取 README**）

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
| 排除口径 | 全部非 README 文件（代码/数据/模型/二进制）。chapter9/ 上游共 **616** 文件 / **27,909,566** 字节（26.6 MB）——**本轻镜像只入库其中的 10 个 README**（见下表逐目录行） |

⚠ **本目录是只读镜像，不得就地修改。** 局限：代码本体不入库；将来若要**读取代码内容**
（如门禁三任务需要真实代码作夹具），须按同一 pin 重新拉取，而不是从这里凑。
每文件 sha256 在生成时逐一记录（生成脚本输出清单，2026-10-13 执行）。

## 逐目录口径（二级目录 | 上游文件数 | 上游总字节 | 顶层 README 是否已镜像）

| 目录 | 文件数 | 总字节 | README |
|---|---:|---:|---|
| `ai-style-skill/` | 23 | 1.3 MB | ✅（5.4 KB） |
| `browser-use-rpa/` | 371 | 3.1 MB | ✅（8.9 KB） |
| `harness-safety-gate/` | 25 | 0.3 MB | ✅（6.7 KB） |
| `hermes-self-evolution/` | 51 | 0.4 MB | ✅（7.8 KB） |
| `prompt-auto-optimization/` | 23 | 1.1 MB | ✅（7.3 KB） |
| `self-evolution-eval/` | 18 | 1.4 MB | ✅（7.7 KB） |
| `self-evolving-tools/` | 12 | 0.1 MB | ✅（25.0 KB） |
| `self-modifying-agent/` | 47 | 0.3 MB | ✅（6.4 KB） |
| `tau2-escalation-experience/` | 21 | 17.7 MB | ✅（4.8 KB） |
| `trajectory-verifier/` | 25 | 0.9 MB | ✅（4.7 KB） |

合计：**10** 个二级目录，上游 **616** 文件 / **27,909,566** 字节；
已镜像 README **10** 个。

## 逐文件哈希（本 light mirror 实际入库的全部文件）

| 文件 | 字节 | sha256 |
|---|---:|---|
| `chapter9/ai-style-skill/README.md` | 5539 | `sha256:5c9ac8e77ba4761437fdb5b1942988a946b4b0f4cff23f62a9cd555a11891726` |
| `chapter9/browser-use-rpa/browser-use/browser_use/actor/README.md` | 9079 | `sha256:c5af72916800b3c01e429a4fde203060ae38e5c66b273bf89734958b772420df` |
| `chapter9/browser-use-rpa/browser-use/browser_use/llm/README.md` | 484 | `sha256:3a4e97ec518c175d14577ce2656b00e7b48fd016b335d0a6821586a6ce9e5a55` |
| `chapter9/browser-use-rpa/browser-use/browser_use/README.md` | 877 | `sha256:dd18c43951f2201247f7294e0f10b4ee14e3238bacbc03b90c9168aa60ca00a1` |
| `chapter9/browser-use-rpa/browser-use/docker/README.md` | 1033 | `sha256:a366c72d8e35e086e93363fac5e9e3a9161e2a282f0952765de2e86c63f01a21` |
| `chapter9/browser-use-rpa/browser-use/docs/README.md` | 428 | `sha256:970fc0553f8a5a061df413c17b0bdaf1af8068947ed05c3831ecd71d77cf2509` |
| `chapter9/browser-use-rpa/browser-use/examples/apps/ad-use/README.md` | 2667 | `sha256:fa3bf1cf2ad62101d61059315fdc44e25882f9759e7d1d46e055a14276e71603` |
| `chapter9/browser-use-rpa/browser-use/examples/apps/msg-use/README.md` | 2436 | `sha256:e6ce2edf64512279aaeb7ef1b991552cd4534ef44a12ba118b9069edc283ee74` |
| `chapter9/browser-use-rpa/browser-use/examples/apps/news-use/README.md` | 2039 | `sha256:0f277ded6796b2ab555e9fe1fd0d6d600eb30cae61e107b7069df3d84bab1349` |
| `chapter9/browser-use-rpa/browser-use/examples/cloud/README.md` | 4097 | `sha256:76fc47f19a50b8c3a060bdea7578680c592ce56e5d6af41613f267630f913d58` |
| `chapter9/browser-use-rpa/browser-use/examples/integrations/slack/README.md` | 3599 | `sha256:6014e167980b968d6f11883c295e39b3693dc97065f3ed05d28088dec8bd8813` |
| `chapter9/browser-use-rpa/browser-use/examples/models/langchain/README.md` | 773 | `sha256:57780f02a13ace86addfdb503ccab63444218d293c2072f8a9400e35434d9153` |
| `chapter9/browser-use-rpa/browser-use/examples/ui/README.md` | 717 | `sha256:36697d20475dad4a63b77b797934653be910a18619f441e485b5fb9d6e80d0b3` |
| `chapter9/browser-use-rpa/browser-use/README.md` | 4669 | `sha256:95d82e56fb1e56b447355d2390d208abf653273e805a1be006561cbbc57324db` |
| `chapter9/browser-use-rpa/browser-use/tests/agent_tasks/README.md` | 712 | `sha256:a2be9f394a24e2c7c9335b01a816624af9075f3be45754628cb3a07d7e3d30ca` |
| `chapter9/browser-use-rpa/README.md` | 9100 | `sha256:b28dddce1774fc19af9f793adc1f81041a45177559d58abf4de7a115e1621bca` |
| `chapter9/harness-safety-gate/README.md` | 6827 | `sha256:3404fe69b104e746e7482bdbcf65289258ed2ee3fc6befc764a578755e9696cb` |
| `chapter9/hermes-self-evolution/README.md` | 7951 | `sha256:7a232bf542f57fb20366c434256790239f0fea73d070a189eb9e7ee97f2d7bd9` |
| `chapter9/prompt-auto-optimization/README.md` | 7467 | `sha256:15588e3f80de0e00ae86cb81512048b08acd80c8108abed6ded8253cb647debd` |
| `chapter9/README.md` | 5066 | `sha256:5e07be328e96433c8899ee6877603f6f0d2d26b3d3df9a1c91982b4eed0fd338` |
| `chapter9/self-evolution-eval/README.md` | 7891 | `sha256:99d2f76a453e0a1e06e58fb698a9a53456c89c3970144da94d8e18feff7237b5` |
| `chapter9/self-evolving-tools/README.md` | 25601 | `sha256:ab57d4e6d2c4c68558b51472f97e6a3925454cf01cfcabd4c75194e87fc1bd5d` |
| `chapter9/self-modifying-agent/README.md` | 6587 | `sha256:682c2d1a242c72a74eacac384aec14fe3b6e9e26a6c8906c4f8c5dfbee344e5e` |
| `chapter9/tau2-escalation-experience/README.md` | 4935 | `sha256:71f75340867fe883c601122ee3627478f96569c26f3dcd48a4472eddfc19e6e1` |
| `chapter9/trajectory-verifier/README.md` | 4850 | `sha256:f2d5c4ea69591f3a05659bacc46cbaf4b634565dcc9494822122fa57ddf4de99` |
