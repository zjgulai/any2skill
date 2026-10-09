# 镜像清单 · 上游《深入理解 AI Agent》chapter4 配套代码

本目录是**上游仓库的镜像**，不是本项目产出。它存在的原因是环 4 的
「配套代码」段（ADR-004 的 6 段骨架之一）此前在本项目信息源里**没有任何来源**：
`sources/ai-agent-book-zh/` 下只有 `book/` 与 `skills/`，没有配套代码目录，
因此**每一个 skill 都在该段被门禁判 `SECTION_EMPTY`，一个都发布不出去**。
扩充本信息源是用户在两个可选方案中的拍板结果（另两个是修订 ADR-004 让该段可选、
或先不动它）。决策全文见 [`docs/adr/ADR-020-source-expansion-chapter4-code.md`](../../../../docs/adr/ADR-020-source-expansion-chapter4-code.md)。

## 来源

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/bojieli/ai-agent-book` |
| 钉住的 commit | `dbc046eb896ac4e39aa19c7774c8bf49583b89a6` |
| 该 commit 日期 | 2026-09-30 03:03:28 +0000 |
| 分支 | `main` |
| 取法 | `git clone --depth 1 --filter=blob:none --sparse` + `git sparse-checkout set chapter4` |
| 镜像日期 | 2026-10-09 |
| 目标路径 | `sources/ai-agent-book-zh/code/chapter4/` |

⚠ **本目录是只读镜像，不得就地修改。** 要更新就重新拉取并重跑下面的校验，
不要在上游代码上打补丁——那会让「镜像」与「我们的改动」混在一起，此后无法分辨。

## 口径：取了什么、没取什么

上游 `chapter4/` 共 **885** 个追踪条目、**36,463,567** 字节（34.7744 MB）。
本目录实际复制 **851** 个文件、**9,515,005** 字节（9.0742 MB）。

四个数字闭合：9,515,005 + 22,873,804 + 4,074,038 + 720 = 36,463,567。

| 分类 | 条数 | 字节 | 处理 |
|---|---:|---:|---|
| 已复制 | 851 | 9,515,005 | — |
| 下载的第三方 arXiv 论文（`*.pdf`） | 26 | 22,873,804 | **排除** |
| 实验生成的向量索引（`index/embeddings-*.json`） | 3 | 4,074,038 | **排除** |
| 指向作者本机绝对路径的符号链接 | 5 | 720（目标串长） | **排除** |

排除理由：

1. **PDF（22.87 MB，占上游 62.7%）**：是实验过程中从 arXiv 下载的第三方论文，
   既不是本书产出，也不是配套代码。保留它们会让本仓库为一批与正文无关的论文增加体积。
2. **向量索引（4.07 MB）**：实验运行时生成的产物，可由代码重算，属可再生产物。
3. **符号链接（5 个）**：实测全部指向作者本机绝对路径
   （`/Users/boj/book/ai-agent-book/chapter4/.../outside-witness.txt`），
   在任何其它机器上都是**断链**。它们是实验 4.2 的 fixture，用途是测试「路径逃逸」检测，
   其「指向本机」正是测试设计的一部分。把它们复制进本仓库只会得到 5 个坏链接。
   ⚠ 这三类之外**没有任何其它排除**——`validation/` 下的实验运行记录全部保留，
   因为那是书里结论背后的可复核证据，而本项目的立身之本就是可溯源。

### 被排除的 PDF 逐条（26）

```
1095498 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_20260730T061700Z/control/transformer_arxiv_download/papers/2607.27184v1.pdf
 797471 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_20260730T061700Z/control/transformer_arxiv_download/papers/2607.27185v1.pdf
1176383 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_20260730T061700Z/control/transformer_arxiv_download/papers/2607.27188v1.pdf
1095498 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_20260730T061700Z/treatment/transformer_arxiv_download/papers/2607.27184v1.pdf
 797471 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_20260730T061700Z/treatment/transformer_arxiv_download/papers/2607.27185v1.pdf
1176383 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_20260730T061700Z/treatment/transformer_arxiv_download/papers/2607.27188v1.pdf
1095498 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_v2_20260730T130600Z/control/transformer_arxiv_download/papers/2607.27184v1.pdf
 797471 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_v2_20260730T130600Z/control/transformer_arxiv_download/papers/2607.27185v1.pdf
1176383 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_v2_20260730T130600Z/control/transformer_arxiv_download/papers/2607.27188v1.pdf
1095498 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_v2_20260730T130600Z/treatment/transformer_arxiv_download/papers/2607.27184v1.pdf
 797471 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_v2_20260730T130600Z/treatment/transformer_arxiv_download/papers/2607.27185v1.pdf
1176383 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_v2_20260730T130600Z/treatment/transformer_arxiv_download/papers/2607.27188v1.pdf
1782104 chapter4/active-tool-discovery/validation/experiment_4_1/rerun_20260825/control/transformer_arxiv_download/papers/2608.23499v1.pdf
3046036 chapter4/active-tool-discovery/validation/experiment_4_1/rerun_20260825/control/transformer_arxiv_download/papers/2608.23512v1.pdf
 440268 chapter4/active-tool-discovery/validation/experiment_4_1/rerun_20260825/control/transformer_arxiv_download/papers/2608.23524v1.pdf
1782104 chapter4/active-tool-discovery/validation/experiment_4_1/rerun_20260825/treatment/transformer_arxiv_download/papers/2608.23499v1.pdf
3046036 chapter4/active-tool-discovery/validation/experiment_4_1/rerun_20260825/treatment/transformer_arxiv_download/papers/2608.23512v1.pdf
 440268 chapter4/active-tool-discovery/validation/experiment_4_1/rerun_20260825/treatment/transformer_arxiv_download/papers/2608.23524v1.pdf
  19487 chapter4/execution-tools/validation/experiment_4_4/real_mcp_20260730T062500Z/workspace/invoice.pdf
  19487 chapter4/execution-tools/validation/experiment_4_4/real_mcp_20260730T070500Z/workspace/invoice.pdf
  13301 chapter4/execution-tools/validation/experiment_4_4/real_mcp_gui_20260802T093657Z/workspace/invoice.pdf
   1461 chapter4/perception-tools/validation/experiment_4_2/real_mcp_20260729T214301Z/fixtures/documents/sample.pdf
   1461 chapter4/perception-tools/validation/experiment_4_2/real_mcp_20260729T214721Z/fixtures/documents/sample.pdf
   1461 chapter4/perception-tools/validation/experiment_4_2/real_mcp_dashscope_20260730T061500Z/fixtures/documents/sample.pdf
   1461 chapter4/perception-tools/validation/experiment_4_2/real_mcp_dashscope_intl_20260730T065000Z/fixtures/documents/sample.pdf
   1461 chapter4/perception-tools/validation/experiment_4_2/real_mcp_dashscope_intl_20260730T070000Z/fixtures/documents/sample.pdf
```

### 被排除的向量索引逐条（3）

```
1354409 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_20260730T061700Z/index/embeddings-all-MiniLM-L6-v2-3da0897f88acbd0d32a3.json
1354409 chapter4/active-tool-discovery/validation/experiment_4_1/qwen3_4b_exact_v2_20260730T130600Z/index/embeddings-all-MiniLM-L6-v2-3da0897f88acbd0d32a3.json
1365220 chapter4/active-tool-discovery/validation/experiment_4_1/rerun_20260825/index/embeddings-all-MiniLM-L6-v2-f2d5d8db4024874c1de2.json
```

### 被排除的符号链接逐条（5）

目标串一律为 `/Users/boj/book/ai-agent-book/chapter4/perception-tools/validation/experiment_4_1/<run>/fixtures/outside-witness.txt`：

```
perception-tools/validation/experiment_4_2/real_mcp_20260729T214301Z/fixtures/mutation_workspace/escape-link
perception-tools/validation/experiment_4_2/real_mcp_20260729T214721Z/fixtures/mutation_workspace/escape-link
perception-tools/validation/experiment_4_2/real_mcp_dashscope_20260730T061500Z/fixtures/mutation_workspace/escape-link
perception-tools/validation/experiment_4_2/real_mcp_dashscope_intl_20260730T065000Z/fixtures/mutation_workspace/escape-link
perception-tools/validation/experiment_4_2/real_mcp_dashscope_intl_20260730T070000Z/fixtures/mutation_workspace/escape-link
```

## 校验方式（这份镜像是怎么被验过的）

**不按文件尺寸校验。** 实测上游 clone 里有 33 个文件被文件系统报大了**恰好 4096 字节**
（如 `active-tool-discovery/requirements.txt`：`stat` 报 4148 字节，`git cat-file -s` 报 52 字节，
而 `xxd` 读出来的内容就只有 52 字节）。同一时刻 `git status --porcelain` 为空、
`git diff` 为空，即**工作区内容与索引逐字节一致**——所以那是 inode 尺寸表的报错，不是内容问题。
按尺寸校验会把这 33 个文件误判成损坏，故改用内容哈希：

```bash
cd /tmp/aab                       # 上游稀疏克隆
git ls-tree -r HEAD chapter4      # 885 条，mode + blob sha + path

cd /Users/lute/Project/any2skills
# 对每个已复制文件算 git hash-object --no-filters，与上游 blob sha 比对
```

**结果：851 个已复制文件，851 个哈希一致，0 个不一致。**
校验脚本当次运行在 `/tmp`（本机 `/tmp` 有 2000+ 条目在churn，中间文件曾被写成二进制垃圾，
故脚本改为不落中间文件、直接管道取 `git ls-tree`）。

复算：

```bash
# 目标端实测
find sources/ai-agent-book-zh/code/chapter4 -type f | wc -l                    # 851
find sources/ai-agent-book-zh/code/chapter4 -type f -exec cat {} + | wc -c     # 9515005
find sources/ai-agent-book-zh/code/chapter4 ! -type f ! -type d | wc -l        # 0（无符号链接）
```

## 与生成链路的关系

- 本目录**不参与第 1 层的锚点索引**：锚点目录只覆盖
  `sources/ai-agent-book-zh/book/` 下 13 个文件（实测 `pipeline/knowledge/anchor-catalog.json`
  的 `files` 列表不含本目录）。
- 它只被环 4 的装配器读取，用途是填「配套代码」段：取各子目录 `README.md` 的**首个正文段落原文**
  作为「一句话说明」，不做改写、不做摘要。
- 因此本目录**不是** ADR-001 所说的 `benchmark/`（原书 22 个 skill 的盲测基准），
  两者不得混同：`benchmark/` 是**禁止进入生成链路**的对照物，而本目录是生成链路**必须读**的信息源。
