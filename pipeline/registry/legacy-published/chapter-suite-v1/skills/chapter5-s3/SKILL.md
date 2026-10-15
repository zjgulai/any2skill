---
name: chapter5-s3
description: 代码生成应用与规则正确性：模型与脚手架之间是此消彼长的关系：模型足够强时脚手架可以更薄；模型不够强时，应把关键的逻辑推理交给代码和约束求解器来保证正确性。脚手架该做多厚取决于模型的能力边界；适用于评估一项 Agent 技术时，尤其是同一套脚手架搭配不同能力的模型时、当代码化校验作为关键操作的最后守门员时、当 Agent 编写代码后需要判断实际渲染效果时。
---

# 代码生成应用与规则正确性

## 何时使用

- 评估一项 Agent 技术时，尤其是同一套脚手架搭配不同能力的模型时。
- 当代码化校验作为关键操作的最后守门员时。
- 当 Agent 编写代码后需要判断实际渲染效果时。
- 日志可视化的前端遇到无法解析的日志格式时。
- 动态生成软件的安全边界设计中。
- 当处理过期 token、锁文件、端口冲突这类高频问题及确定性规则未覆盖的疑难问题时。
- 当 Agent 接到开发新 Agent 的任务时。
- 当需要调用工具并根据可逆性、权限和影响面计算风险时。
- 当代码生成 Agent 处理日志解析、且格式变化可能需要适应或报告时。
- Agent 生成 HTML/UI 代码、由客户端渲染的场景。
- 快速交互中由快模型执行动作、需要防止不可逆后果时。
- 需要设置安全点并决定额外防护时。
- 当 Agent 生成代码修改时。
- 当以满意度作为学习信号并需要设置护栏指标时。
- 当操作属于发邮件、拨电话、对外转账等不可逆或非幂等操作时
- 多 Agent 协作中切换阶段，需要消除角色干扰时

## 核心原则

**模型与脚手架之间是此消彼长的关系：模型足够强时脚手架可以更薄；模型不够强时，应把关键的逻辑推理交给代码和约束求解器来保证正确性。脚手架该做多厚取决于模型的能力边界。**

在较弱的模型上，纯思考模式会频繁算错，代码辅助能把准确率显著拉高；换成足够强的思考模型，纯思考往往就能解出全部谜题，代码辅助的增益收敛到接近零。

**在服务端代码化校验中，政策事实（如舱位等级、保险状态、预订时间、航段使用情况、航班状态）必须由服务端查询数据库获得，当前时间取自服务端时钟，不得采信模型自报的参数。**

模型可能产生幻觉，也可能被提示注入操纵；独立性不仅指独立的模型，更指独立的数据来源，最后一道防线必须建立在模型无法伪造的数据之上。

**在代码驱动的多媒体生成中，仅生成代码不够，必须引入渲染与审核机制以发现渲染效果问题。**

Agent 编写完代码后不知道实际渲染效果，内容拥挤、文字溢出、图片尺寸等问题只有真正渲染出来才能发现。

**当前端遇到无法解析的日志格式时，不显示错误，而是自动将失败信息（原始日志样本、详细报错）报告给 Agent。**

通过建立自动修复的反馈循环，Agent 分析样本数据结构并生成能正确解析的前端代码，避免前端直接显示错误。

**动态生成软件的安全目标应是即使 AI 写错代码，权限约束仍无法被绕过；更稳妥的架构是把信任边界下移到数据层，由稳定且经人类审查的机制强制执行权限规则。**

若权限检查放在动态生成的业务逻辑中，它就与被约束的代码在同一信任域，提示词、测试和代码审查难以穷尽每条新生成路径，无法构成最终安全边界。

**构建 Agent 自我修复能力时，应先用确定性检查覆盖高频问题，再将确定性规则未覆盖的疑难问题交给 LLM 分析并生成修复方案，两层配合以稳定修复常见问题并应对长尾疑难。**

确定性检查保证常见问题被稳定修复，LLM 兜底应对长尾疑难；两层配合，doctor --fix 才能自动解决相当一部分常见网关问题。

**当 Agent 编写新 Agent 时，应提供高质量 Agent 实现作为参考范例，在其基础上针对性修改，而不是在提示词中穷尽所有规则或从零开始编写。**

范例代码是最佳实践载体，基于范例修改比从零编写更容易做对，架构上的好选择会自然保留，且不需要在提示词中逐条说明规则。

**工具风险评级时，评级对象应从“工具”细化到“工具+参数”，调用时根据可逆性、权限和影响面计算风险；采用基于规则的确定性检查（路径黑白名单、正则），而非模型判断；验证时应只检查结构化数据。**

防止提示注入操纵判断结果。

**在处理日志解析的格式变化时，Agent 的适应机制必须与报告并行，不能让适应机制吞掉异常信号。**

格式变化可能是 bug 而非预期改动，适应性会掩盖问题；即使选择适应，也要记录告警、自动创建 issue，而非静默兼容。

**Agent 生成 HTML/UI 时，优先采用 A2UI 类声明式协议，只输出界面描述 JSON，由客户端用受信组件目录渲染，不执行任意代码；确需任意 HTML 时应在沙盒环境中展示。**

防止注入。

**按可逆性给动作分级：快思考只允许执行可逆动作，不可逆操作交由慢思考把关，不允许快模型执行会造成不可逆后果的工具调用。**

保证快速交互不会导致无法挽回的后果。

**安全点的密度应与环境变化速度匹配；安全点之外还需要多少额外防护，取决于动作有多不可逆。**

环境变化的速度决定安全点必须设置得多密集，动作的可逆性决定错过安全点的代价；安全点不够用的地方需要补上第二道防线。

**Agent 生成的代码修改必须由安全机制在隔离环境中复现、回归后才能发布。**

可进化代码放在低权限沙盒中，只能生成补丁和测试；权限系统、API key、发布控制配置和更新验证器属于安全机制，沙盒内 Agent 无读写权限。

**护栏至少包括规则违规、隐私泄露、无证据陈述、承诺—行动不一致和越权操作；这些指标应设置不可被平均分抵消的硬阈值。**

满意度可能奖励违规退款、泄露信息或过度承诺，因此它只能是质量指标，不能覆盖安全底线。

## 实践模式

**代码生成作为通用问题解决手段**

- 完整内容见 `references/practice-patterns.md`。

**元能力**

- 完整内容见 `references/practice-patterns.md`。

**代码生成**

- 完整内容见 `references/practice-patterns.md`。

**符号计算（Symbolic Computation）**

- 完整内容见 `references/practice-patterns.md`。

**提议者-审核者模式**

- 完整内容见 `references/practice-patterns.md`。

**代码作为系统适配器**

- 完整内容见 `references/practice-patterns.md`。

**生成式 UI**

- 完整内容见 `references/practice-patterns.md`。

**代码生成**

- 完整内容见 `references/practice-patterns.md`。

**Artifact 模式**

- 完整内容见 `references/practice-patterns.md`。

**代码即规则**

- 完整内容见 `references/practice-patterns.md`。

**预算感知机制**

- 完整内容见 `references/practice-patterns.md`。

## 常见陷阱

- **将政策事实（如 cabin_class、has_insurance、current_time）设计成由模型填写的参数，而不是由服务端查询数据库读取。**
  - 后果：模型只要报错一个值或被诱导报错，“守门员”就形同虚设，最后一道防线失效。
  - 纠正：政策事实不应设计成由模型填写的参数；防线必须建立在模型无法伪造的数据之上。
- **同名工具遮蔽（tool shadowing）**
  - 后果：把敏感调用路由给恶意方
  - 纠正：接入前审查描述、锁定版本、配最小权限凭证；运行时靠层次化分类和动态发现缩小候选

## 配套代码

- `sources/ai-agent-book-zh/code/chapter5/adaptive-log-parser/` —— 服务升级后，日志格式改变，原来的解析规则可能失效。本实验把新格式识别、解析代码生成和测试连接起来，学习怎样让系统在验证后接纳新的处理能力。
- `sources/ai-agent-book-zh/code/chapter5/agent-creator/` —— 让 Agent“再创建一个 Agent”，不是只写一段系统提示词。本实验从需求出发生成专用程序，并与复用已有框架的路径比较，学习如何判断生成结果是否真的可用。
- `sources/ai-agent-book-zh/code/chapter5/cad-vs-diffusion/` —— 一个有精确孔径的法兰盘，与一盆形态自然的绿植，对三维生成提出了不同要求。本实验比较参数化 CAD 代码与直接生成形状的路线，学习任务约束怎样影响技术选择。
- `sources/ai-agent-book-zh/code/chapter5/code-for-logic/` —— 骑士总说真话，无赖总说假话。人物增加后，只靠文字推演容易遗漏条件。本实验把这类谜题写成变量与约束，学习如何用求解器系统地检查可能答案。
- `sources/ai-agent-book-zh/code/chapter5/code-for-math/` —— 数学题既需要建立解题思路，也需要准确计算。本实验让同一个模型分别直接推理和借助 Python 解题，观察代码在哪些环节提供帮助。
- `sources/ai-agent-book-zh/code/chapter5/coding-agent/` —— 编码 Agent 不只是一次生成代码：它需要查看文件、理解任务、修改内容、运行检查并处理错误。本项目把这些步骤放在一个可阅读的 Python 实现中，便于你逐层跟踪。
- `sources/ai-agent-book-zh/code/chapter5/conversational-ui/` —— 用户说“把按钮放到右边，文字再短一点”，既描述布局也描述内容。本实验让 Agent 修改 React 源码，并通过实际构建和页面检查理解改动是否满足需求。
- `sources/ai-agent-book-zh/code/chapter5/dynamic-form/` —— 当用户需求缺少目的地、日期或数量等信息时，连续追问可能很低效。本实验让 Agent 生成一个与当前任务相关的表单，把需要澄清的条件集中呈现出来。
- `sources/ai-agent-book-zh/code/chapter5/erp-agent/` —— 用户问“研发部有多少在职员工”，系统需要理解业务词汇，并在数据库中执行精确查询。本实验让模型生成 SQL，再把执行和结果核对交给数据库与检查程序。
- `sources/ai-agent-book-zh/code/chapter5/log-diagnosis/` —— 日志里看到异常之后，很容易写出一个听起来合理的原因。本实验进一步要求诊断能够对应系统结构，并通过重放与回归检查得到支持。
- `sources/ai-agent-book-zh/code/chapter5/paper-to-ppt/` —— 生成幻灯片源码时看不出的布局问题，常常在渲染后才出现。本实验让提议者生成 Slidev 文稿，再让审核者查看实际页面，学习“生成、观察、修改”的迭代方法。
- `sources/ai-agent-book-zh/code/chapter5/paper-to-video/` —— 论文讲解视频需要把页面、口语化讲稿和音频放在同一条时间线上。本实验拆开这些环节，让你理解视频自动生成中内容组织与媒体处理各自承担什么工作。
- `sources/ai-agent-book-zh/code/chapter5/permission-embedded-data-objects/` —— 生成代码能够灵活处理数据，也增加了权限检查被遗漏的可能。本节学习怎样把访问约束放在独立的数据接口中，使调用方需要通过统一入口使用数据。
- `sources/ai-agent-book-zh/code/chapter5/provider-failover/` —— 模型服务中断时，任务可能已经执行了一部分工具。直接重跑可能重复动作，切换模型又可能遇到消息格式差异。本实验讨论如何保留执行语义并恢复任务。
- `sources/ai-agent-book-zh/code/chapter5/small-model-codified-rules/` —— 客服 Agent 需要同时理解用户意图和遵守退款条件。若所有规则都写在提示词里，模型可能在复杂对话中漏掉一项。本实验比较自然语言规则与代码检查的作用。
- `sources/ai-agent-book-zh/code/chapter5/video-edit/` —— “保留人物走进房间的那一段”包含视觉定位与时间范围选择。直接生成剪辑命令之前，Agent 必须先理解视频内容。本实验展示从自然语言需求到场景定位，再到媒体处理的过程。

## 深度阅读

- `sources/ai-agent-book-zh/book/chapter5.md` · 代码：通用 Agent 的元能力（第 351–365 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · Coding 是 Agent 的基础能力（第 15–57 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 本章小结（第 775–793 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 代码作为思考工具（第 366–405 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 代码作为业务规则的约束（第 406–501 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 思考题（第 794–805 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 代码驱动的多媒体生成（第 502–588 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 代码作为系统适配器（第 589–630 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 代码作为生成式 UI（第 631–727 行）
- `sources/ai-agent-book-zh/book/chapter5.md` · 代码创造代码：Agent 自举（第 728–774 行）
- `sources/ai-agent-book-zh/book/reference-answers.md` · 第一章 AI Agent 入门（第 5–52 行）
- `sources/ai-agent-book-zh/book/reference-answers.md` · 第四章 工具（第 131–148 行）
- `sources/ai-agent-book-zh/book/reference-answers.md` · 第六章 交互：观察与动作空间的扩展（第 190–243 行）
- `sources/ai-agent-book-zh/book/reference-answers.md` · 第五章 Coding Agent 与通用 Agent（第 149–189 行）
- `sources/ai-agent-book-zh/book/reference-answers.md` · 第九章 Agent 的持续进化（第 338–367 行）
- `sources/ai-agent-book-zh/book/reference-answers.md` · 第十章 多 Agent 协作（第 368–415 行）
