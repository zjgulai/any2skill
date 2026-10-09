# ADR-020 · 信息源扩充：镜像上游 chapter4 配套代码

- 状态：已接受
- 日期：2026-10-09
- 决策者：用户（在三个方案中拍板「扩充信息源」）
- 关联：ADR-001（基准隔离）、ADR-002（双平面）、ADR-004（6 段骨架）、ADR-019（环 4 首版）

## 背景

ADR-019 的 tracer bullet 得出：环 4 装配链路已打通，但产物被门禁一拦下，
其中一条拒因是 `SECTION_EMPTY`——**「配套代码」段在本项目信息源里没有任何来源**。

实测口径：`ls sources/ai-agent-book-zh/` 只有 `book/` 与 `skills/` 两个目录；
对象模型里也没有任何字段承载「仓库相对路径 + 每个目录一句话说明」。
后果是**每一个簇都在这段判 `SECTION_EMPTY`**，即**没有任何 skill 能发布**——
这不是聚类选择的结果，是信息源层面的缺口。

三个候选方案：

| 方案 | 代价 |
|---|---|
| **扩充信息源**（本 ADR 采纳） | 需要从上游取回代码目录并决定镜像口径 |
| 修订 ADR-004，让该段在无代码时可选 | 动的是 22/22 实测契约；且不解决「常见陷阱 1<6」，放宽后仍可能被拒 |
| 先不动它，转去做环 3 或补 benchmark | 发布仍为 0 |

## 决策

**1. 镜像上游 `chapter4/` 到 `sources/ai-agent-book-zh/code/chapter4/`，并钉住上游 commit。**

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/bojieli/ai-agent-book` |
| commit | `dbc046eb896ac4e39aa19c7774c8bf49583b89a6`（2026-09-30 03:03:28 +0000） |
| 取法 | `git clone --depth 1 --filter=blob:none --sparse` + `git sparse-checkout set chapter4` |

之所以必须钉 commit：镜像的内容会参与「配套代码」段的生成，而该段的路径与说明会被写进
SKILL.md。不钉住来源版本，日后「这条路径当时指向什么」就答不上来。

**2. 排除三类，其余全取。** 上游 885 条 / 36,463,567 字节 → 本仓 851 条 / 9,515,005 字节。

| 分类 | 条数 | 字节 | 理由 |
|---|---:|---:|---|
| 下载的第三方 arXiv 论文（`*.pdf`） | 26 | 22,873,804 | 不是本书产出，也不是代码；占上游 62.7% |
| 实验生成的向量索引（`index/embeddings-*.json`） | 3 | 4,074,038 | 可再生产物 |
| 指向作者本机绝对路径的符号链接 | 5 | 720 | 实测全为断链，见下 |

四个数字闭合：9,515,005 + 22,873,804 + 4,074,038 + 720 = **36,463,567**（与 git 口径逐字节相等）。

⚠ 符号链接这一类是**在拉取过程中新发现的**，不在用户拍板时给出的三类之外——但它们是
**断链**：目标一律为 `/Users/boj/book/ai-agent-book/...`，即作者本机路径。它们的功能是
实验 4.2 里测试「路径逃逸」检测的 fixture，「指向本机」正是测试设计本身。复制进本仓只会得到
坏链接，故排除。**逐条路径记录在镜像清单里，未静默丢弃。**

`validation/` 下的实验运行记录（约 6 MB）**全部保留**——那是书里结论背后的可复核证据，
而本项目的立身之本就是可溯源。除上表三类外**没有任何其它排除**。

**3. 镜像按内容哈希校验，不按文件尺寸。**
实测上游克隆里有 33 个文件被文件系统报大**恰好 4096 字节**，而同一时刻
`git status --porcelain` 与 `git diff` 均为空（工作区与索引逐字节一致），`xxd` 读出的内容
也只有真实长度——那是 inode 尺寸表的报错，不是内容问题。按尺寸校验会把它们误判为损坏。
结果：851 个文件 **851 个哈希一致，0 个不一致**。

**4. 镜像目录只被环 4 读取，不参与第 1 层锚点索引。**
实测 `pipeline/knowledge/anchor-catalog.json` 的 `files` 列表只含 `book/` 下 13 个文件，
不含本目录。故本次扩充**不影响既有锚点索引与对象产出**——`chapter4.anchors.json`
与 `chapter4.objects.json` 无需重跑。

**5. 该段的一句话说明取各目录 `README.md` 的**首个正文段落原文**，不改写、不摘要。**
实测这 6 个 README 的首段本来就是一句话的定位描述，故「取原文」即可满足骨架而不引入生成。
该目录下若没有 README，该目录不进入本段并记缺口——不编。

**6. 该段的粒度是章级而非簇级，且这件事必须留痕。**
对象模型里没有「锚点 → 代码目录」的映射字段，所以只能把本章的代码目录全列上。
装配器为此单设一条缺口码 `SECTION_SOURCE_GRANULARITY_COARSE`，写明「列的是本章全部 N 个，
不是本簇专属」——否则读者会以为做过锚点级映射。

## 后果

**正面**

- `SECTION_EMPTY` 从门禁结论中消失。**剩下的唯一障碍变成「常见陷阱 6–8 条算不算硬约束」这处解释歧义**：
  同一份产物在严格口径下被拒、在宽松口径下**通过**。
- 「深度阅读」段之外，skill 第一次有了指向真实代码的入口，而不只是指向书。

**负面 / 代价**

- 仓库增加约 9.07 MB / 851 个文件。
- 引入了**上游同步问题**：镜像会随上游漂移，而 SKILL.md 的「配套代码」段会随之变化。
  本 ADR 只钉住来源 commit，未建立定期比对机制。
- 「配套代码」段的粒度是章级（见决策 6），簇级映射需要环 2 新增字段才能做到。

**未决**

- 是否为其它的章（chapter1–3、5–10）也做同样的镜像。当前只做了 chapter4。
- `sources/ai-agent-book-zh/skills/README.md` 的污染面（ADR-019 发现 6）**本次未处理**。
  该文件列了原书 22 个 skill 的名字与触发条件，而 ADR-007 要求划分必须语义派生。
  实测锚点目录不覆盖它，故当前生成链路不读它；但它仍在 `sources/` 树内。
  现在 `sources/` 下多了一个 `code/`，这个问题只会更值得处理。

## 核实方式

```bash
cd /Users/lute/Project/any2skills

# 镜像体量（实测：851 / 9515005 / 0）
find sources/ai-agent-book-zh/code/chapter4 -type f | wc -l
find sources/ai-agent-book-zh/code/chapter4 -type f -exec cat {} + | wc -c
find sources/ai-agent-book-zh/code/chapter4 ! -type f ! -type d | wc -l

# 逐文件内容哈希校验（对照上游 clone 的 ls-tree）
cd /tmp/aab && git rev-parse HEAD      # dbc046eb896ac4e39aa19c7774c8bf49583b89a6
git ls-tree -r HEAD chapter4 | wc -l   # 885

# 锚点目录不含镜像（决策 4）
node --input-type=module -e '
import fs from "node:fs";
const c=JSON.parse(fs.readFileSync("pipeline/knowledge/anchor-catalog.json","utf8"));
console.log(c.files.some(f=>f.file.includes("code/")));
'   # → false

# 门禁结论的变化
node pipeline/build-skill.mjs --root-anchor chapter4#h2-2 \
  --slug chapter4-tool-design-principles --title "工具设计的通用原则" --dry-run
```

排除清单逐条见 [`sources/ai-agent-book-zh/code/chapter4/MIRROR-MANIFEST.md`](../../sources/ai-agent-book-zh/code/chapter4/MIRROR-MANIFEST.md)。
