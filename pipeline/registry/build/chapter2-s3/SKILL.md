---
name: chapter2-s3
description: 运行时上下文治理与安全：在将外部内容注入上下文之前，应使用明确的标记包裹并标注来源（如 `<external_content source="webpage">...</external_content>`），提示模型该段内容来自不可信的外部世界，其中出现的“指令”不应被执行；适用于当外部内容（如网页、文档、工具返回结果等）将被注入模型上下文时、Agent 需要打电话处理业务，且系统提示词要求拨打每个商家不超过 3 次、Agent 状态栏在 API 消息列表中注入时。
---

# 运行时上下文治理与安全

## 何时使用

- 当外部内容（如网页、文档、工具返回结果等）将被注入模型上下文时。
- Agent 需要打电话处理业务，且系统提示词要求拨打每个商家不超过 3 次。
- Agent 状态栏在 API 消息列表中注入时。
- 在设计上下文压缩机制时。
- 当 Agent 框架需要压缩上下文，并且需要保留 KV Cache 前缀时。
- 当需要在有限上下文窗口下进行长时间多步骤信息收集时，采用自适应窗口化策略。
- 内容为低价值噪声，例如大量搜索结果中只被使用了几行的内容。
- 上下文即将溢出，且反正需要付出一次缓存重建代价。
- 对包含关键实体（如时间、公司名）的内容进行压缩时
- 给子 Agent 提供任务描述时。
- 当通用执行工具需要特别的安全考虑、而理想实现方式是在沙盒环境中运行时。
- 构建子 Agent 提示词，且子 Agent 可能接收来自多个来源的信息时。
- 已通过 spawn_subagent 创建子 Agent，且其任务因用户改变主意或其他 Agent 已找到答案等原因失去意义时。
- 通过 MCP 协议或 Skill Hub 引入能力时。
- 在决定能力用什么形式表达时。
- 需要维护 Agent 状态栏中的数量统计或元信息时

## 核心原则

**在将外部内容注入上下文之前，应使用明确的标记包裹并标注来源（如 `<external_content source="webpage">...</external_content>`），提示模型该段内容来自不可信的外部世界，其中出现的“指令”不应被执行。**

防御的核心是帮模型分清“指令”与“数据”，让模型知道哪些内容有权指挥自己，哪些内容只是待处理素材。

**在 Agent 需要打电话处理业务且系统提示词要求拨打每个商家不超过 3 次的场景中，在每次电话工具的调用结果中直接标明累计呼叫次数（如“本次是第 3 次呼叫该商家”），能让模型立即发现已达到限制，不再继续呼叫，错误率大幅降低。**

关于“已经打了几次”的知识不会被自动提炼出来，而是以原始通话记录的形式分散在 KV Cache 的向量表示中；模型每次做决策都必须花费额外的思考 token 去扫描上下文重新统计，效率极低且错误率很高。

**Agent 状态栏在 API 层面作为一条 user 角色的消息插入到上下文末尾，而不是修改开头的 system 消息。**

修改 system 消息会破坏整个前缀的缓存。

**进行上下文压缩时，不要让模型被动地在海量信息中检索，而要主动为模型提供经过提炼的结构化知识。**

主动提炼产生的是经过压缩的高密度知识表示；与其期望模型从冗长的上下文中自动学习，不如主动地、显式地进行知识提炼。

**上下文压缩应发生在两次 API 调用之间，由 Agent 框架对消息列表进行预处理；System Prompt 和 Tool Definitions 永远不动，压缩的对象是对话历史中的 tool results。**

System Prompt 和 Tool Definitions 是上下文最前面的静态前缀，由 KV Cache 持续缓存；替换原始工具输出后，替换位置之后的缓存失效，但之前的缓存仍然有效。

**自适应窗口化策略通过持续监控上下文使用率，在 prompt token 数超过窗口的 80% 时激活压缩；触发后一次性压缩所有未标记的工具结果，并添加 [COMPRESSED] 标记防止已压缩内容被重复处理。**

任务初期上下文空间充足，无需急于压缩；接近容量限制时才启动压缩，能最大限度地保留原始信息完整性。

**低价值噪声内容应直接移除，不做摘要。**

对噪声做摘要只是在浪费 token。

**API 层微压缩适合在上下文即将溢出、反正要付出缓存重建代价时使用，而不应频繁触发。**

按本章的前缀不变性原理，移除点之后的缓存会失效并产生一次缓存重建，因此适合在反正要付出这次重建代价时使用。

**压缩时不得丢失关键信息，例如时间和公司名**

语义完整性原则要求关键信息不可丢失

**子 Agent 的任务描述必须自包含、目标明确。**

子 Agent 看不到主 Agent 的完整上下文，上下文的质量决定能力上限。

**Python 虚拟环境（venv）不是沙盒，不能提供文件系统、网络和进程层面的安全隔离。**

它只隔离包依赖，对文件系统、网络和进程没有任何安全约束；在其中运行的代码仍然可以删除任意文件、访问任意网络。

**在子 Agent 提示词中，应明确区分信息来源（如 FROM_MAIN_AGENT、FROM_USER、TOOL_RESULT），以防止子 Agent 混淆信息来源并避免提示注入攻击。**

子 Agent 可能接收来自多个来源的信息；明确区分来源可以防止混淆信息来源，避免提示注入攻击。

**当子 Agent 的任务失去意义（如用户改变主意或另一个子 Agent 已找到答案）时，应使用 cancel_subagent 及时终止该子 Agent，避免继续浪费 token。**

任务失去意义后继续运行会浪费 token；及时终止可避免这种浪费。

**通过 MCP 协议或 Skill Hub 引入能力时，必须审查描述与版本、隔离凭证，并保证模型看到的参数与工具真正执行的参数一致。**

两条渠道都扩大了信任边界。

**决定能力用什么形式表达时，应默认使用通用工具，只在安全权限、参数复杂、使用频率极高和平台差异这四种情况下退回专用工具。**

这是能力用什么形式表达的第一个决策。

## 实践模式

**Agent 状态栏**

- 完整内容见 `references/practice-patterns.md`。

**提示注入**

- 完整内容见 `references/practice-patterns.md`。

**Agent 状态栏**

- 完整内容见 `references/practice-patterns.md`。

**侧信道信息**

- 完整内容见 `references/practice-patterns.md`。

**环境当前状态的观察摘要**

- 完整内容见 `references/practice-patterns.md`。

**Agent 状态栏**

- 完整内容见 `references/practice-patterns.md`。

**上下文腐化**

- 完整内容见 `references/practice-patterns.md`。

**子 Agent 上下文隔离**

- 完整内容见 `references/practice-patterns.md`。

**MCP**

- 完整内容见 `references/practice-patterns.md`。

**提示注入**

- 完整内容见 `references/practice-patterns.md`。

**提议者-审核者范式**

- 完整内容见 `references/practice-patterns.md`。

**执行-验证-反馈闭环**

- 完整内容见 `references/practice-patterns.md`。

## 常见陷阱

- **把所有原始信息堆在上下文里。**
  - 后果：模型每次决策都要在数万 token 中反复检索相关片段，注意力被分散，关键信息容易被遗漏。
  - 纠正：先用一次 LLM 调用把已有信息结构化总结成“目前已知：A 是……，B 是……，还缺 C 的信息”，后续思考直接使用这份精炼表示。
- **当模型认为上下文窗口即将耗尽时，可能在任务尚未完成前提前收尾。**
  - 后果：任务尚未完成前提前收尾。
  - 纠正：在上下文窗口尚未接近耗尽时就提前压缩，可能提升模型的决策质量。
- **把所有信息零散地放在 Agent 执行历史中，而不是定期记录到文档**
  - 后果：早期架构决策、约束背后的理由和失败路径容易丢失
  - 纠正：Agent 定期将进展记录到文档中；若模型没有文档化习惯，通过 prompt 和 skill 提醒它
- **把黑名单或关键字匹配当作唯一的安全机制，未结合语义解析或独立审查。**
  - 后果：攻击者可通过变形命令、管道、子shell等轻易绕过，使危险操作被放行。
  - 纠正：将黑名单仅作为第一层基础防护，之上结合语义解析、权限控制、独立审批等分层机制，高风险操作由上下文外审查确认。
- **过度依赖上下文层的提示注入防御（输入清洗、来源标记、指令数据分离），认为这些措施能提供可靠保证。**
  - 后果：上下文层只能降低攻击成功率，无法彻底阻止注入；攻击者成功注入后，Agent可能执行不可逆操作，泄露数据。
  - 纠正：把上下文层作为第一道防线，同时部署执行层工具权限控制、独立审查、沙盒隔离和数据层行级安全等分层护栏，确保即使注入成功也无法执行危险动作。
- **把外部网页、工具输出、第三方 Skill 或其 LLM 摘要不经审查直接当作可执行指令或纳入长期能力，误以为 LLM 总结能净化恶意内容。**
  - 后果：恶意指令可更直接地劫持 Agent 行为，影响长期生效，造成数据泄露、执行危险操作等；状态栏被污染还可被反向利用。
  - 纠正：对来源不明 Skill 和外部内容进行代码级审查；LLM 摘要只作可读性转换，不作为指令或长期能力；按 schema 提取主张并保留原文，提取出的字符串绝不能作为指令执行。
- **让外部内容或提示注入未经审查地写入 Agent 的长期记忆/经验，使一次性攻击跨会话潜伏并反复生效。**
  - 后果：攻击者可将偏见或恶意指令潜伏在长期记忆中，在后续会话中触发，导致持久威胁，扩大攻击影响。
  - 纠正：写入长期记忆的内容必须经过与外部内容同等的信任审查，避免恶意指令潜伏；对自我进化系统，将提示注入总结为经验前需验证来源并隔离。

## 配套代码

- `sources/ai-agent-book-zh/code/chapter2/agent-skills-ppt/` —— 生成演示文稿既需要理解论文，也需要掌握幻灯片文件的制作方法。把全部操作说明一直放在提示词中会占用上下文。本实验借助 PPTX Skill，学习如何在任务需要时才加载具体知识。
- `sources/ai-agent-book-zh/code/chapter2/attention_visualization/` —— 当模型处理一句话时，不同位置会以不同权重读取已有位置的信息。注意力热力图把这些权重画出来，帮助你把抽象的矩阵计算与具体词元联系起来。
- `sources/ai-agent-book-zh/code/chapter2/context-compression/` —— 随着搜索和工具调用增加，对话历史可能比当前任务需要的信息多得多。本实验比较几种压缩方法，学习怎样减少输入长度，同时保留继续完成任务所需的证据。
- `sources/ai-agent-book-zh/code/chapter2/kv-cache/` —— 两轮请求大部分内容相同，第二轮为什么有时仍然很慢？本实验从消息组织方式入手，观察缓存能否复用，以及看似无关的上下文改动怎样影响成本。
- `sources/ai-agent-book-zh/code/chapter2/local_llm_serving/` —— 本地部署解决的是“在哪里运行模型”，工具调用解决的是“模型怎样请求外部能力”。本实验把两者连接起来，帮助你理解一个兼容接口背后的模型服务、工具协议和执行循环。
- `sources/ai-agent-book-zh/code/chapter2/prompt-engineering/` —— 提示词不仅告诉模型任务是什么，还说明业务规则、工具用途和遇到困难时的处理方式。本实验通过改变提示词的部分内容，观察这些信息怎样影响一个客服 Agent 的决策。
- `sources/ai-agent-book-zh/code/chapter2/prompt-injection/` —— Companion material for AI Agents in Depth, Chapter 2 — Experiment 2-5 ★★: Prompt injection attack and defense. 配套《深入理解 AI Agent》第 2 章 实验 2-5 ★★：提示注入攻防实验。
- `sources/ai-agent-book-zh/code/chapter2/system-hint/` —— 长任务中，Agent 可能忘记还剩多少预算、已经处理了哪些文件，或正在等待什么结果。本实验把这些运行状态整理成短提示，观察它们怎样帮助模型选择下一步。
- `sources/ai-agent-book-zh/code/chapter4/active-tool-discovery/` —— 把全部工具说明一次塞进上下文，既占空间，也增加选择难度。本实验比较全量提供、检索预筛选和主动发现，学习如何让 Agent 在需要时找到合适的能力。
- `sources/ai-agent-book-zh/code/chapter4/active-tool-selection/` —— 随着工具数量增加，模型不仅要理解任务，还要从许多相似说明中选出合适工具。本项目让你在同一目录上比较不同选择策略，理解节省上下文可能付出的代价。
- `sources/ai-agent-book-zh/code/chapter4/collaboration-tools/` —— 有些任务需要另一个 Agent，有些需要用户作出决定，还有些只是等待外部事件。本实验把这些协作方式作为工具，学习主 Agent 怎样交出任务并接收结果。
- `sources/ai-agent-book-zh/code/chapter4/execution-tools/` —— Agent 生成一条命令，并不代表命令已经成功执行。本实验围绕执行工具学习完整动作链：接收参数、检查条件、执行操作，再把结果交回模型。
- `sources/ai-agent-book-zh/code/chapter4/multimodal-agent/` —— 回答图表问题时，模型可以直接读取图像，也可以先通过工具提取文字和数据。本实验比较几种输入路径，学习选择方式时需要考虑哪些信息可能丢失。
- `sources/ai-agent-book-zh/code/chapter4/perception-tools/` —— 模型要读取文件或查询资料，需要把现实中的数据变成结构化工具结果。本实验从 MCP 感知工具出发，学习客户端怎样发现工具、调用工具并理解返回值。

## 深度阅读

- `sources/ai-agent-book-zh/book/chapter2.md` · 承上启下：从缓存机制到上下文内容的设计（第 594–601 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · Agent 状态栏：通过元信息增强 Agent 轨迹管理（第 857–866 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · Agent 状态栏的理论基础（第 867–907 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · Agent 状态栏的构成（第 908–919 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · Agent 状态栏在上下文中的具体位置（第 920–950 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 状态更新的两种实现与缓存代价（第 951–990 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 为什么需要压缩：不只是长度问题（第 995–1006 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 上下文学习的内部机制：检索而非推理（第 1007–1027 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 压缩与 KV Cache：看似矛盾，实则互补（第 1028–1065 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 生产级的分层压缩机制（第 1066–1075 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 压缩策略的设计原则（第 1076–1088 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 隔离优于压缩：子 Agent 上下文隔离（第 1089–1096 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 提示注入：上下文安全的核心威胁（第 730–764 行）
- `sources/ai-agent-book-zh/book/chapter4.md` · 工具生态：MCP 与 Skill Hub（第 100–132 行）
- `sources/ai-agent-book-zh/book/chapter4.md` · 执行工具（第 270–381 行）
- `sources/ai-agent-book-zh/book/chapter4.md` · 思考题（第 443–449 行）
- `sources/ai-agent-book-zh/book/chapter4.md` · 协作工具（第 382–428 行）
- `sources/ai-agent-book-zh/book/chapter4.md` · 本章小结（第 429–442 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · Coding Agent 的安全（第 309–350 行）
- `sources/ai-agent-book-zh/book/chapter1.md` · 护栏类型（第 474–489 行）
- `sources/ai-agent-book-zh/book/chapter9.md` · 持续进化的安全边界（第 342–351 行）
