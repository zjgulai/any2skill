---
name: chapter3-s1
description: 用户记忆体系设计：提取结果应同时满足选择性、抽象化和结构化三条规则；适用于提取用户记忆时、在实践中选择用户记忆存储格式时，面对不同类别和关键性的用户数据、当状态是带类型的状态时。
---

# 用户记忆体系设计

## 何时使用

- 提取用户记忆时。
- 在实践中选择用户记忆存储格式时，面对不同类别和关键性的用户数据。
- 当状态是带类型的状态时。
- 日志本身可能包含敏感信息时。
- 构建通用记忆存储方案时，特别是需要兼顾语义完整性和查询效率的场景。
- 当需要由模型负责写入新知识时。
- 当上线运行的用户记忆或共享知识库持续收到新信息时。
- 用户记忆和知识库的增量更新；涉及 User as Code、Markdown 知识库、用户记忆文件和规则文档的修改。
- 在知识更新的 Proposer 与 Reviewer 环节。
- 知识库检索时。
- 整理 Agent 核查旧摘要时。
- 当需要将类似“犯罪类型”的多选项分类字段转换为数值格式供算法处理时。
- 执行写入、增量更新或定期整理时。
- 构建第一章发现循环中的提案段时。

## 核心原则

**提取结果应同时满足选择性、抽象化和结构化三条规则。**

选择性要求丢弃“搜索返回 3 个选项”这类短期细节；抽象化要求把本次“靠窗座位”归纳为长期偏好；结构化要求用可检索的字段保存事实。

**关键且少量的数据（如用户偏好、关键人物关系）用 Advanced JSON Cards 以保证可检索性；大量且非关键的对话事实用 Simple Notes 以降低成本；多数生产系统采用混合模式——同一 Agent 内不同类别的信息走不同路径。**

关键且少量数据需要保证可检索性，大量非关键数据需要降低成本，因此不同类别的信息应走不同路径。

**带类型的状态把原本需要 LLM“读一遍再心算”的操作交给确定性函数。**

这些操作原本依赖 LLM 读一遍再心算，而非由确定性函数执行。

**日志脱敏应选择本地部署而非云端 API。**

日志本身可能包含敏感信息，发送到云端脱敏就违背了隐私保护初衷。

**以完整自然语言保存核心信息，辅以结构化元数据进行索引和检索；在需要多跳推理和精确消歧的垂直场景，将知识图谱作为专项索引手段，与自然语言记忆协同工作。**

保留语义完整性并兼顾查询效率；知识图谱作为通用存储方案会导致语义降级，且三元组提取准确性依赖 LLM。

**在负责写入知识的提示词里必须把要求写明确：每新增一个条目，都要先检索并链接到相关的已有条目，并更新所在目录的索引页，形成双向可达的引用网络。**

不同模型主动建立这类链接的意愿与能力并不相同，不少模型不会主动回指已有条目，只是孤立地追加文件；若不明确要求，知识会退化成互不相连的孤岛。

**完整的更新机制必须同时包含两条路径：事件触发的增量更新，以及周期触发的全量整理。**

只更新不整理会让内容越积越乱；只做定期重写会让新信息无法及时生效。

**生产环境不应让任何一个模型绕过审核，直接改主分支或线上向量库。**

把知识库当成代码库、把每次知识变更当成 Pull Request，以获得差异审查、版本历史、责任追溯和一键回滚能力。

**Proposer 和 Reviewer 都必须是 Agent，而不是两次固定的 LLM API 调用。**

知识更新需要 Proposer 主动搜索相关用户记忆文档和规则，Reviewer 追溯证据、对比多份文档、运行检查，并在发现新线索时继续查询；这需要文件搜索、版本比较、测试执行和证据检索工具。

**检索必须按调用者的权限过滤，绝不能让越权文档进入某个用户的上下文；权限过滤下推到检索层尤其重要。**

一旦敏感内容进入了 LLM 的上下文，就很难保证它不以某种形式泄露到最终回答里。

**整理 Agent 需要逐段对照原始对话、execution trajectory、业务文档和工具输出，检查旧摘要是否遗漏关键事实、丢失否定词或时间条件、把推测错当成了事实；不能只在已有摘要之间相互改写。**

不能只在已有摘要之间相互改写，否则早期的遗漏和误读会一代代传下去。

**对于具有多个选项的分类字段，应使用独立的开关位表示每个选项，而不是使用递增数字编码。**

递增数字编码会让算法误以为选项之间存在大小或严重程度关系；开关位只表示属于哪一类，不暗示大小关系。

**写入不能跳过来源、时间、冲突和隐私检查；增量更新吸收新证据，定期整理回到原始数据去重、合并并重建索引，待验证的 diff 通过独立审核后才发布。**

写入、增量更新和定期整理都必须完成来源、时间、冲突和隐私检查，且待验证的 diff 必须通过独立审核后才发布。

**就全书的结构而言，本章建的是第一章发现循环中的提案段：把一条证据变成一次最小、可审查、可回滚的修改，而不负责判断系统整体是否变好。**

提案段的职责是把一条证据变成可审查、可回滚的最小修改，不负责判断系统整体是否变好。

## 实践模式

**知识库**

- 完整内容见 `references/practice-patterns.md`。

**用户记忆提取**

- 完整内容见 `references/practice-patterns.md`。

**第一层：基础回忆**

- 完整内容见 `references/practice-patterns.md`。

**第三层：主动服务**

- 完整内容见 `references/practice-patterns.md`。

**轨迹**

- 完整内容见 `references/practice-patterns.md`。

**用户长期记忆**

- 完整内容见 `references/practice-patterns.md`。

**User as Code**

- 完整内容见 `references/practice-patterns.md`。

**情景记忆**

- 完整内容见 `references/practice-patterns.md`。

**语义记忆**

- 完整内容见 `references/practice-patterns.md`。

**Mem0 v3**

- 完整内容见 `references/practice-patterns.md`。

**Memobase**

- 完整内容见 `references/practice-patterns.md`。

**重要性评分筛选**

- 完整内容见 `references/practice-patterns.md`。

**PII 检测与脱敏**

- 完整内容见 `references/practice-patterns.md`。

**文件系统范式**

- 完整内容见 `references/practice-patterns.md`。

**判决因子重要性层次模型**

- 完整内容见 `references/practice-patterns.md`。

**多模态记忆**

- 完整内容见 `references/practice-patterns.md`。

## 常见陷阱

- **简单的累积式存储**
  - 后果：会导致记忆爆炸，不仅消耗存储空间，还降低检索准确性
  - 纠正：采用多层次的记忆压缩策略
- **把需要存储的多模态信息直接写进模型权重（如为每个用户训练专属 LoRA），试图让模型存储事实。**
  - 后果：这样训练的 fact-LoRA 在直接提问时几乎能完美复述，但需要在这些事实上做间接推理时便会失灵，因为冻结的骨干模型从未学过如何查阅这个临时挂载的适配器。
  - 纠正：采用预训练阶段已学会通过哈希查表调取记忆、并由能感知上下文的门控机制决定何时调取的 Engram 模型，把多模态信息嵌入写入空闲的哈希 N-gram 槽位，使新写入的事实在该被想起时被想起。

## 配套代码

- `sources/ai-agent-book-zh/code/chapter3/agentic-rag/` —— 一次检索往往只能回答问题的一部分。Agentic RAG 让模型根据当前证据决定是否追加检索、改写问题或查看相关条目。本实验关注多步取证与一次性检索的区别。
- `sources/ai-agent-book-zh/code/chapter3/agentic-rag-for-user-memory/` —— 用户问“按我上次的偏好安排吧”，相关偏好可能散落在多次对话中。本实验把 Agentic RAG 用在用户记忆上，学习怎样通过多步检索补齐背景。
- `sources/ai-agent-book-zh/code/chapter3/contextual-retrieval/` —— 文档中的“该规定”或“上述方法”离开上下文后常常难以理解。本实验在建立索引前给片段补充简短背景，观察检索能否更准确地找到它。
- `sources/ai-agent-book-zh/code/chapter3/contextual-retrieval-for-user-memory/` —— “他已经改了时间”这样的句子离开对话很难理解，而单独保存“周三开会”又可能丢掉来源。本实验结合带背景的对话检索和结构化记忆卡片，学习两种表示如何互补。
- `sources/ai-agent-book-zh/code/chapter3/dense-embedding/` —— 用户的问题与文档用词不同，仍可能表达相同含义。稠密检索把文本编码成向量，再根据向量之间的距离寻找候选内容。本实验让你分别观察语义表示和近似搜索的作用。
- `sources/ai-agent-book-zh/code/chapter3/log-sanitization/` —— 日志能帮助定位错误，也可能包含账号、联系方式或凭据。本实验学习怎样识别并替换敏感字段，同时让剩余信息仍足以解释程序发生了什么。
- `sources/ai-agent-book-zh/code/chapter3/mem0/` —— 引入记忆框架后，应用可以把信息提取与检索交给专门组件，但仍需理解框架实际保存了什么。本实验用 Mem0 连接对话与长期存储，观察一条信息怎样进入后续回答。
- `sources/ai-agent-book-zh/code/chapter3/memobase/` —— “用户偏好简短回答”和“用户昨天改了会议时间”都是记忆，却有不同的时间特征。本实验围绕画像与事件两类信息，解释记忆系统为什么需要多种表示。
- `sources/ai-agent-book-zh/code/chapter3/retrieval-pipeline/` —— 关键词检索擅长精确词项，向量检索擅长语义相近表达。混合检索尝试结合两者，再用重排序模型细看候选。本实验按阶段观察文档如何进入、离开最终结果列表。
- `sources/ai-agent-book-zh/code/chapter3/sparse-embedding/` —— 为什么搜索一个少见的产品型号，往往比搜索“产品”更容易定位文档？本实验从倒排索引和 BM25 出发，解释关键词检索怎样为候选文档排序。
- `sources/ai-agent-book-zh/code/chapter3/structured-index/` —— 有些问题只需一个段落，有些问题却要跨越多个章节。把文档切成平坦片段未必足够。本实验比较层次摘要与知识关系图，学习怎样为不同问题组织检索路径。
- `sources/ai-agent-book-zh/code/chapter3/structured-knowledge-extraction/` —— 一批案例可能反复出现相同的影响因素，但这些因素未必已经被整理成表格。本实验以案例文本为材料，学习从发现字段到结构化抽取，再到归纳典型模式的过程。
- `sources/ai-agent-book-zh/code/chapter3/user-memory/` —— 保存全部聊天记录，不等于下次对话能用上相关信息。本实验把交互与后台记忆处理分开，学习怎样从对话提取候选事实、更新存储，并在后续回答中检索它们。
- `sources/ai-agent-book-zh/code/chapter3/user-memory-evaluation/` —— 记忆系统可能保存了正确事实，却在需要时找不到；也可能找到片段，却误解了指代。本实验把记忆评估分层，让你定位失败发生在保存、检索还是综合使用阶段。

## 深度阅读

- `sources/ai-agent-book-zh/book/chapter3.md` · 用户记忆和知识库（第 1–14 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 用户记忆系统（第 15–42 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 记忆能力的评估：三层次框架（第 43–71 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 记忆的层次结构（第 72–87 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 用户记忆的四种存储格式（第 88–112 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 进阶知识表示形态：可执行代码（第 113–169 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 用户记忆的认知科学基础（第 170–191 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 记忆框架案例（第 192–220 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 记忆压缩与整理机制（第 221–230 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 隐私保护：日志脱敏（第 231–242 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 前沿探索：多模态记忆（第 665–676 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 结构化索引：从信息检索到知识建模（第 445–481 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 文件系统范式：用目录结构组织知识（第 482–504 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 知识应该如何更新（第 505–508 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 用户记忆和知识库的增量更新（第 509–525 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 用户记忆和知识库的定期整理（第 526–541 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 本章小结（第 677–686 行）
- `sources/ai-agent-book-zh/book/chapter3.md` · 从数据集中提取深度知识：从信息检索到知识发现（第 637–664 行）
