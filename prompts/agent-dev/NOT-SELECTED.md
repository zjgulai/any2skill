# 未入选对象清单（诚实声明）

> 口径：**618 个对象中，本包正文/常驻片段引用了 175 个**；
> 下表列出其余**可操作对象**（规则/启发/反模式/指标/决策/案例等）的 id 与一句话，
> 供遇到对应子问题时回查全文（`pipeline/knowledge/*.objects.json`，逐字引文在对象内）。
> Concept（概念，264 条）未逐条列出——它们主要承载术语定义，已在相应规则对象的引文中覆盖；
> 需要时按 id 直接回查（id 前缀即可定位章节文件）。

| 对象 id | 类型 | 一句话（截断） |
|---|---|---|
| INTRODUCTION-H1-1-ENGINEERINGRULE-02 | 规则 | 建立系统的评估机制。 |
| INTRODUCTION-H2-2-PLAYBOOK-01 | 剧本 |  |
| INTRODUCTION-H2-3-HEURISTIC-01 | 启发 | 推荐阅读《图解大模型》（图灵出版），以直观的图解方式理解 Transformer 架构、预训练与微调等核心概念 |
| INTRODUCTION-H2-3-HEURISTIC-02 | 启发 | 不必因此却步，关注架构设计原则和工程实践方法论，把本书作为起点 |
| CHAPTER1-H3-2-ENGINEERINGRULE-02 | 规则 | 通用基础能力用于组合与探索；专用工具用于约束高风险和强业务规则操作。 |
| CHAPTER1-H3-3-ENGINEERINGRULE-02 | 规则 | 基于 LLM 的 Agent 应在结构化的知识体系上展开，而不是盲目随机探索。 |
| CHAPTER1-H2-2-HEURISTIC-02 | 启发 | 将工程重心放在约束、验证与纠正上，确保工具调用安全、上下文得到管理、错误可纠正。 |
| CHAPTER1-H3-8-ENGINEERINGRULE-01 | 规则 | 涉及多步思考或动态决策的 Agent 任务一定要选择支持思考的模型。 |
| CHAPTER1-H3-8-ENGINEERINGRULE-02 | 规则 | 模型选型不能只比较准确率、价格和速度，还要在自己的真实任务上测试模型是否愿意执行、接口是否暴露所需能力，以及服务条款是否允许这种使用方式。 |
| CHAPTER1-H4-5-HEURISTIC-02 | 启发 | 先由自主 Agent 把工作流写出来，再由工作流去执行；Agent 读完任务后自行决定拓扑并生成编排代码，执行阶段退回工作流的确定性。 |
| CHAPTER1-H4-6-ENGINEERINGRULE-02 | 规则 | 选择 Agent 框架时，关键考量不在于框架本身的复杂度，而在于它能否用尽可能少的抽象层让你专注于业务逻辑。 |
| CHAPTER1-H4-7-ENGINEERINGRULE-01 | 规则 | 高风险操作需额外审查或人工确认。 |
| CHAPTER1-H3-11-ENGINEERINGRULE-01 | 规则 | 当需要理解 Agent = LLM + 上下文 + 工具 与 Agent = Model + Harness 的关系时，不应把后者当作与前一个公式并列的另一套划分，也不应把它当作覆盖全书十章的目录；它… |
| CHAPTER1-H2-3-ENGINEERINGRULE-02 | 规则 | 任何一次修改都要同时在“它应当改变的那批样本”和“它不应当影响的那批样本”上验证。 |
| CHAPTER1-H2-4-ENGINEERINGRULE-02 | 规则 | 安全问题从第一行代码就要考虑，而不是上线前打补丁。 |
| CHAPTER2-H3-2-ENGINEERINGRULE-02 | 规则 | 大模型 API 的每次调用都是无状态的，所有模型需要的信息必须在请求的消息列表中完整提供。 |
| CHAPTER2-H3-4-ENGINEERINGRULE-02 | 规则 | 生产代码中的 Agent 核心循环必须设置 max_iterations cap（最大迭代次数上限）。 |
| CHAPTER2-H3-5-ENGINEERINGRULE-02 | 规则 | 改变前缀会导致缓存失效，模型需要重新计算。 |
| CHAPTER2-H2-3-HEURISTIC-02 | 启发 | 将这些动态信息作为新消息追加到对话末尾，而不是修改已有的系统提示词 |
| CHAPTER2-H3-8-METRIC-02 | 指标 |  |
| CHAPTER2-H3-9-ENGINEERINGRULE-01 | 规则 | 当主 Agent 派生子 Agent 或进行旁路查询，且子 Agent 继承父 Agent 的上下文时，子 Agent 的提示词、工具定义、模型配置、消息前缀和思考配置必须与父 Agent 逐字节匹配… |
| CHAPTER2-H3-9-ENGINEERINGRULE-02 | 规则 | 当推理链也绑定在前缀上时，“只追加、不改写”就从性能建议变成了正确性要求。 |
| CHAPTER2-H3-10-ENGINEERINGRULE-02 | 规则 | 编辑已有 KV Cache 中的字段时，如果模型没有显式思考链（CoT），孤立地修改字段会被忽略。 |
| CHAPTER2-H3-11-ENGINEERINGRULE-02 | 规则 | 当提示词越写越长、覆盖的场景越来越多时，不应把所有内容塞进一个系统提示词，而应按需加载。 |
| CHAPTER2-H3-12-ENGINEERINGRULE-01 | 规则 | 当 Agent 无法完成任务时，应要求其回复控制在 1-2 句话，并且不要解释为什么不能做某事。 |
| CHAPTER2-H3-12-HEURISTIC-02 | 启发 | 使用大写字母（如 “NEVER do X”）而不是 “Please avoid doing X” 来引起模型注意。 |
| CHAPTER2-H3-14-ANTIPATTERN-02 | 反模式 | 系统提示词采用上百条零散规则堆砌，缺少流程图和优先级说明 |
| CHAPTER2-H3-15-ENGINEERINGRULE-01 | 规则 | 按提成计费仅限用于通过谈判降低现有账单的场景；退款和取消服务不得使用按提成计费，必须使用固定费用。 |
| CHAPTER2-H3-15-ENGINEERINGRULE-02 | 规则 | 金额计算必须按固定粒度执行：电话通话按每分钟 $0.05 计费，汇总后四舍五入到最接近的整数美元；“节省”只基于现有账单计算，不得把避免未来涨价算作省钱。 |
| CHAPTER2-H3-17-ENGINEERINGRULE-01 | 规则 | 在因果注意力的已缓存前缀末尾追加新内容不会改变任何已缓存 token 的 K、V。 |
| CHAPTER2-H3-17-ANTIPATTERN-02 | 反模式 | 保留所有规则内容但打乱组织结构，去除标题层次，把有序流程拆散成无序规则集合后呈现给模型。 |
| CHAPTER2-H3-18-ENGINEERINGRULE-02 | 规则 | 在将外部内容注入上下文之前，应使用明确的标记包裹并标注来源（如 `<external_content source="webpage">...</external_content>`），提示模型该段内… |
| CHAPTER2-H3-19-ANTIPATTERN-02 | 反模式 | Skill 元数据中的 description 字段写得太宽泛，例如 “help with backend”。 |
| CHAPTER2-H3-20-HEURISTIC-01 | 启发 | 只保留三到五条最重要的判断，并为关键原则配正例和反例 |
| CHAPTER2-H3-20-HEURISTIC-02 | 启发 | 从三到五篇自己最满意的原创文章开始，让 Agent 归纳生成初版，处理真实写作任务并由作者逐句改稿，将反复出现的改动整理回 Skill 并为每条规则保留正例、反例和适用范围。 |
| CHAPTER2-H3-21-ENGINEERINGRULE-01 | 规则 | 不同 Agent Harness 实现 Skills 时遵循“少量目录常驻、完整正文按需加载”的设计原则；其共同收益是无需在启动时加载所有 Skill 正文，也无需在每次调用新 Skill 时回头改写… |
| CHAPTER2-H3-21-ANTIPATTERN-02 | 反模式 | 将“对 KV Cache 友好”理解为“零成本”。 |
| CHAPTER2-H3-22-ANTIPATTERN-01 | 反模式 | 把所有专用代码工具的定义都放在系统提示词中 |
| CHAPTER2-H3-23-MENTALMODEL-01 | 心智 |  |
| CHAPTER2-H3-26-DECISIONMODEL-01 | 决策 |  |
| CHAPTER2-H3-26-HEURISTIC-02 | 启发 | 优先用代码维护状态栏；必须使用 LLM 时，只让它逐条抽取、由代码汇总，不要让它一次性批量统计。 |
| CHAPTER2-H3-27-ANTIPATTERN-01 | 反模式 | 把所有原始信息堆在上下文里。 |
| CHAPTER2-H3-27-ANTIPATTERN-02 | 反模式 | 当模型认为上下文窗口即将耗尽时，可能在任务尚未完成前提前收尾。 |
| CHAPTER2-H3-28-ENGINEERINGRULE-02 | 规则 | 进行上下文压缩时，不要让模型被动地在海量信息中检索，而要主动为模型提供经过提炼的结构化知识。 |
| CHAPTER2-H3-30-ENGINEERINGRULE-01 | 规则 | 低价值噪声内容应直接移除，不做摘要。 |
| CHAPTER2-H3-30-ENGINEERINGRULE-02 | 规则 | API 层微压缩适合在上下文即将溢出、反正要付出缓存重建代价时使用，而不应频繁触发。 |
| CHAPTER2-H3-31-ENGINEERINGRULE-01 | 规则 | 压缩时不得丢失关键信息，例如时间和公司名 |
| CHAPTER2-H3-31-ANTIPATTERN-02 | 反模式 | 把所有信息零散地放在 Agent 执行历史中，而不是定期记录到文档 |
| CHAPTER3-H2-1-ENGINEERINGRULE-02 | 规则 | 提取结果应同时满足选择性、抽象化和结构化三条规则。 |
| CHAPTER3-H3-3-MENTALMODEL-02 | 心智 |  |
| CHAPTER3-H3-4-ENGINEERINGRULE-02 | 规则 | 带类型的状态把原本需要 LLM“读一遍再心算”的操作交给确定性函数。 |
| CHAPTER3-H3-8-ENGINEERINGRULE-01 | 规则 | 日志脱敏应选择本地部署而非云端 API。 |
| CHAPTER3-H3-9-ENGINEERINGRULE-02 | 规则 | 无论采用哪种分块策略，分块都会切断片段与其原始上下文的联系。 |
| CHAPTER3-H2-3-CASE-02 | 案例 |  |
| CHAPTER3-H3-13-DECISIONMODEL-01 | 决策 |  |
| CHAPTER3-H4-3-ENGINEERINGRULE-02 | 规则 | Proposer 和 Reviewer 都必须是 Agent，而不是两次固定的 LLM API 调用。 |
| CHAPTER3-H3-18-ENGINEERINGRULE-02 | 规则 | 对于具有多个选项的分类字段，应使用独立的开关位表示每个选项，而不是使用递增数字编码。 |
| CHAPTER3-H2-4-ENGINEERINGRULE-02 | 规则 | 就全书的结构而言，本章建的是第一章发现循环中的提案段：把一条证据变成一次最小、可审查、可回滚的修改，而不负责判断系统整体是否变好。 |
| CHAPTER4-H3-3-ENGINEERINGRULE-02 | 规则 | 工具的参数传递必须保持透明，不得在模型不知情的情况下修改输入或输出。 |
| CHAPTER4-H2-4-ENGINEERINGRULE-01 | 规则 | 当工具数量超过一百个时，即使最先进的大语言模型也容易在工具选择上出错。 |
| CHAPTER4-H3-6-HEURISTIC-02 | 启发 | 优先采用 Skills 机制，因为它将渐进式披露内建为默认形态，实现成本更低，是一种更省心的工具发现思路。 |
| CHAPTER4-H4-3-CASE-02 | 案例 |  |
| CHAPTER5-H3-2-MENTALMODEL-02 | 心智 |  |
| CHAPTER5-H3-4-ENGINEERINGRULE-02 | 规则 | 故障只在同一批并行调用内传播，不上升到父级操作；一个调用失败时，只报告该失败，不应取消同一批其他调用或让整个任务中止。 |
| CHAPTER5-H3-5-ENGINEERINGRULE-01 | 规则 | 每个长连接都需要活性信号，而非仅依赖连接超时。 |
| CHAPTER5-H3-5-ENGINEERINGRULE-02 | 规则 | 错误处理的边界不是单次请求，而是整个恢复循环；在确认无法恢复之前，中间错误不应暴露给消费者。 |
| CHAPTER5-H3-6-ENGINEERINGRULE-01 | 规则 | 当模型在一次推理中需要输出多个工具调用时，第一个工具调用的参数一经完整生成并通过校验就应立即执行，与后续调用的生成过程重叠；彼此独立的调用应并行执行，以降低端到端延迟。 |
| CHAPTER5-H3-6-ENGINEERINGRULE-02 | 规则 | 每次推理前应在上下文末尾以 Agent 状态栏形式动态注入当前工作目录、git 分支、最近提交记录及未暂存和已暂存的变更概览，而不是硬编码在静态系统提示词中。 |
| CHAPTER5-H3-7-ENGINEERINGRULE-02 | 规则 | 代码分块时应按函数、类、方法等完整语义单元切分，而非按固定字符数盲目切割。 |
| CHAPTER5-H3-8-ENGINEERINGRULE-02 | 规则 | old string 在文件中存在且唯一则编辑成功，否则失败。 |
| CHAPTER5-H3-9-ENGINEERINGRULE-01 | 规则 | 代码执行沙盒应默认断网，并按需通过白名单代理放行有限目的地。 |
| CHAPTER5-H3-9-ENGINEERINGRULE-02 | 规则 | 对 Shell 命令做安全校验应采用语义解析，理解每个命令的参数类型和消费规则，而不是依赖关键字黑名单。 |
| CHAPTER5-H3-10-ENGINEERINGRULE-02 | 规则 | 模型与脚手架之间是此消彼长的关系：模型足够强时脚手架可以更薄；模型不够强时，应把关键的逻辑推理交给代码和约束求解器来保证正确性。脚手架该做多厚取决于模型的能力边界。 |
| CHAPTER5-H3-15-ENGINEERINGRULE-02 | 规则 | 当 Agent 编写新 Agent 时，应提供高质量 Agent 实现作为参考范例，在其基础上针对性修改，而不是在提示词中穷尽所有规则或从零开始编写。 |
| CHAPTER6-H1-1-HEURISTIC-02 | 启发 | 重新定义或扩展观察空间与动作空间 |
| CHAPTER6-H3-1-ENGINEERINGRULE-02 | 规则 | 将异步范式应用于 LLM 时，需要先检查模型和 API 是否支持异步消息时序；不能仅凭代码使用了 asyncio 就认定模型具备原生异步能力。 |
| CHAPTER6-H3-4-ENGINEERINGRULE-01 | 规则 | Agent 的响应不应局限于单一渠道。 |
| CHAPTER6-H3-5-ENGINEERINGRULE-01 | 规则 | 虚拟身份需要部署在隔离的执行环境中。 |
| CHAPTER6-H3-5-HEURISTIC-02 | 启发 | 配置住宅代理网络（使用真实家庭 IP）后再访问。 |
| CHAPTER6-H2-3-HEURISTIC-02 | 启发 | 将语音用于该输入输出回路 |
| CHAPTER6-H4-1-ENGINEERINGRULE-02 | 规则 | 端点判断的训练标签必须只使用决策时刻可见的信息 |
| CHAPTER6-H3-12-ENGINEERINGRULE-02 | 规则 | Omni 模型仍然假设轮流说话，通常要靠 VAD 划分发言权。因此，用户报数字时的中途停顿仍可能被误判为说完。 |
| CHAPTER6-H4-3-MENTALMODEL-01 | 心智 |  |
| CHAPTER6-H4-5-MENTALMODEL-01 | 心智 |  |
| CHAPTER6-H4-5-ENGINEERINGRULE-02 | 规则 | 在同时考察深度推理与实时对话的任务上，快慢思考分离（解耦）架构并不天然落后于端到端模型。 |
| CHAPTER6-H3-15-ANTIPATTERN-02 | 反模式 | 传统 TTS 过于流畅、零停顿 |
| CHAPTER6-H3-17-ENGINEERINGRULE-02 | 规则 | 在纯坐标预测方案中，当输入截图分辨率与模型训练时使用的分辨率不匹配时，应在工具层实现双向坐标缩放机制，并按宽高比选择目标分辨率。 |
| CHAPTER6-H2-5-HEURISTIC-02 | 启发 | 应优先让系统在有限的感知和控制带宽下持续完成闭环。 |
| CHAPTER6-H3-21-MENTALMODEL-02 | 心智 |  |
| CHAPTER6-H3-24-HEURISTIC-02 | 启发 | 采用动作分块：模型一次生成一小段未来动作，控制线程按较高频率执行这段动作，模型在后台准备下一段。 |
| CHAPTER6-H3-25-ENGINEERINGRULE-01 | 规则 | 行为克隆模型只学会模仿，不一定懂后果 |
| CHAPTER6-H3-25-ENGINEERINGRULE-02 | 规则 | 同一个动作不一定能直接搬到另一台机器人上 |
| CHAPTER6-H3-27-ENGINEERINGRULE-02 | 规则 | 即使结果改善，真机部署仍然需要进行真实相机标定、执行器测试和完整的安全闭环。 |
| CHAPTER7-H1-1-DECISIONMODEL-02 | 决策 |  |
| CHAPTER7-H3-1-ENGINEERINGRULE-02 | 规则 | 在定义模拟用户的 task_instructions 时，关于设备状态的任何回答都必须以工具返回结果为依据。 |
| CHAPTER7-H3-3-METRIC-02 | 指标 |  |
| CHAPTER7-H3-4-METRIC-01 | 指标 |  |
| CHAPTER7-H3-4-ENGINEERINGRULE-02 | 规则 | 对于会产生副作用的操作，不能简单地“重试直到成功”，而应在沙盒或可回滚环境中采样，并把每一次失败都记入可靠性指标。 |
| CHAPTER7-H3-5-ENGINEERINGRULE-02 | 规则 | 五个要素缺其一，评估便无法构成可重复的循环。 |
| CHAPTER7-H3-6-ENGINEERINGRULE-02 | 规则 | 工具失败时应返回清晰的错误信息，而非单一的失败标志。 |
| CHAPTER7-H3-9-ENGINEERINGRULE-01 | 规则 | 评估任务集需要包括不同难度的任务。 |
| CHAPTER7-H3-11-ENGINEERINGRULE-01 | 规则 | 用户不知悉的信息 Agent 无从推测，只能通过查询获得。 |
| CHAPTER7-H3-11-ENGINEERINGRULE-02 | 规则 | 成功条件应精确到可核实边界；例如用“测速结果为 excellent 才算解决”替代“网络已恢复”这类条件。 |
| CHAPTER7-H4-1-ENGINEERINGRULE-02 | 规则 | 定位静默失败的首个错误时，不能用搜索报错关键字代替，而应使用事实锚点比对或轨迹前缀二分。 |
| CHAPTER7-H4-2-ENGINEERINGRULE-01 | 规则 | 处理用户报告的引号格式问题时，不能直接做全局字符替换；至少要区分 ASCII 直引号、中文弯引号和 Markdown 反引号，并按作用域处理。 |
| CHAPTER7-H4-2-ENGINEERINGRULE-02 | 规则 | 当规则无法确定作用域时，应允许模型保留原文并请求澄清，而不是把猜测性修改算作通过。 |
| CHAPTER7-H4-3-ENGINEERINGRULE-01 | 规则 | 定位 `old_string` 失败时，应保存原始字节哈希、Unicode code point 序列和 tokenizer token ID 序列，并沿链路寻找首个差异。 |
| CHAPTER7-H4-3-ENGINEERINGRULE-02 | 规则 | 若模型在直接探针测试中输出正确而工具调用失败，应修复 tokenizer、序列化、Harness 或工具协议；只有首个差异出现在模型输出时，才把该案例转成第八章的复制训练数据。 |
| CHAPTER7-H3-16-ENGINEERINGRULE-02 | 规则 | 当配对评判由 LLM 而非人类投票完成时，标准缓解位置偏差的方法是交换顺序各评一次，取两次结果的平均；更严格的做法是只有两次判决一致时才计入，不一致则记为平局或送人工复核。 |
| CHAPTER7-H2-6-ENGINEERINGRULE-01 | 规则 | 模型选择不是简单地“选最强的模型”，而是要根据应用场景和评估结果在多个维度之间作出权衡。 |
| CHAPTER7-H3-17-ENGINEERINGRULE-02 | 规则 | 评估思考延迟时，应在自己的工作负载上实测各模型的思考 token 用量和对应收益，而非仅凭公开榜单推断。 |
| CHAPTER7-H3-18-ENGINEERINGRULE-02 | 规则 | 如需测 Harness 的调节作用，再用 `--policy explore-first` 单独跑一组；不要把两种 policy 混在同一模型比较里。 |
| CHAPTER7-H3-19-ENGINEERINGRULE-02 | 规则 | 几项上下文优化同时使用时，必须在完整任务中一起实测，不能把各自的节省比例直接相加。 |
| CHAPTER7-H3-20-DECISIONMODEL-01 | 决策 |  |
| CHAPTER7-H3-20-ENGINEERINGRULE-02 | 规则 | 模型选择不是一次性的决策，而是随着模型演进需要动态调整的持续过程。 |
| CHAPTER7-H2-7-METRIC-01 | 指标 |  |
| CHAPTER7-H3-22-ENGINEERINGRULE-01 | 规则 | 多轮对照实验固定相同的模型、任务参数、随机种子、步数上限和模拟器，并交替安排两组的运行顺序，使每轮只验证一个改动。 |
| CHAPTER7-H3-22-CASE-02 | 案例 |  |
| CHAPTER7-H3-23-ENGINEERINGRULE-01 | 规则 | 遇到 Agent 根本没有看到信息这类失败时，应先检查输入，而不是继续堆提示词。 |
| CHAPTER7-H3-23-ENGINEERINGRULE-02 | 规则 | 在完整元素树带来大量无用 token 时，删除无语义节点可以在不降低任务成功率的情况下使 token 约减少一半。 |
| CHAPTER7-H3-24-ENGINEERINGRULE-01 | 规则 | 在这轮完整复测之前，不能把子集上的 4/4 写成系统整体 100%。 |
| CHAPTER7-H3-25-ENGINEERINGRULE-02 | 规则 | 对于任何构建生产 Agent 的团队，每个主要特性都应是可独立关闭的，且团队应定期验证每个特性的实际贡献。 |
| CHAPTER7-H3-26-ENGINEERINGRULE-01 | 规则 | 在测试改动时，要把机制指标和目标指标区分开，不要把自己正在改变的东西当作优化目标；两者不一致时以目标为准。 |
| CHAPTER7-H3-27-ENGINEERINGRULE-01 | 规则 | 编译时开关在构建阶段将相关代码从产物中物理移除，内部专用的特性在外部构建中不存在。 |
| CHAPTER7-H3-27-ENGINEERINGRULE-02 | 规则 | 每个特性的曝光事件在每个会话中最多记录一次。 |
| CHAPTER7-H3-28-ENGINEERINGRULE-01 | 规则 | 系统提示应该能够确定性地渲染（给定相同的配置输入，永远产生相同的输出）。 |
| CHAPTER7-H3-29-ENGINEERINGRULE-01 | 规则 | 分析接口只接受经过特殊类型包装的值，类型名作为审计线索，明确表明该值已验证不是代码或文件路径。 |
| CHAPTER7-H3-30-ENGINEERINGRULE-02 | 规则 | 评估驱动的产品工程不是偶尔做一次评估，而是将评估嵌入到每一次产品决策中。 |
| CHAPTER7-H2-11-ENGINEERINGRULE-02 | 规则 | 训练环境的每个 episode 都必须能把环境重置到一个确定、干净的初始状态。 |
| CHAPTER7-H3-31-HEURISTIC-02 | 启发 | 保持适度随机化以提升泛化能力，避免过度随机化导致任务过于困难 |
| CHAPTER8-H3-1-ENGINEERINGRULE-02 | 规则 | 模型的输出本质上是一个概率分布：给定前文，模型对词表里每一个可能的 token 都给出一个概率，训练就是调整这个概率分布。 |
| CHAPTER8-H3-3-ENGINEERINGRULE-02 | 规则 | LoRA 必须应用到所有主要权重矩阵（尤其参数占比最大的 MLP 层）；只加在注意力层会掉点。 |
| CHAPTER8-H3-4-METRIC-02 | 指标 |  |
| CHAPTER8-H2-3-ENGINEERINGRULE-01 | 规则 | 在固定的小规模预算下，算法改进比单纯堆规模更具性价比 |
| CHAPTER8-H3-8-CASE-01 | 案例 |  |
| CHAPTER8-H3-8-HEURISTIC-02 | 启发 | 通用数据最好来自基模的原始预训练集。 |
| CHAPTER8-H2-7-DECISIONMODEL-02 | 决策 |  |
| CHAPTER8-H2-8-ENGINEERINGRULE-02 | 规则 | 在本实验的设定下（Llama-3.2-Vision-11B 这个量级的基础模型，加上严格的结构化输出要求），RL 需要先用 SFT 初始化；未经 SFT 直接做端到端 RL 完全失败。 |
| CHAPTER8-H3-9-HEURISTIC-02 | 启发 | 通常选择 On-policy，因为它意味着更低的分布偏差和更稳定的优化 |
| CHAPTER8-H4-1-ENGINEERINGRULE-01 | 规则 | 在任何参数更新之前，用同一批轨迹比较 sampler 与 trainer 的 token log probability，监控 rho_t 的均值、分位数、最大值、近似 KL 和被裁剪比例。 |
| CHAPTER8-H4-1-ANTIPATTERN-02 | 反模式 | 批大小改变计算归约方式、破坏数值的 batch invariance。 |
| CHAPTER8-H3-11-ANTIPATTERN-02 | 反模式 | 使用模型模拟环境训练 Agent 时，只依赖模拟器提供交互，不与真实环境交互校准 |
| CHAPTER8-H3-12-HEURISTIC-02 | 启发 | 应通过增加并行验证器 worker 来提升吞吐量，而不是继续堆 GPU。 |
| CHAPTER8-H3-13-ENGINEERINGRULE-02 | 规则 | 在多轮任务中，策略需要学会根据当前观测重新规划，而不是复现训练轨迹。 |
| CHAPTER8-H3-14-ENGINEERINGRULE-01 | 规则 | 在工具调用强化学习中，计算策略梯度时应屏蔽环境返回的反馈 token，只对模型自己的思考和工具调用参数回传梯度。 |
| CHAPTER8-H3-16-ENGINEERINGRULE-02 | 规则 | 测试必须读取真实文件或环境状态，不能只检查模型是否说了“已完成”。 |
| CHAPTER8-H3-19-ENGINEERINGRULE-01 | 规则 | 若基模连目标语言、领域概念或基本动作都没有，应先进行 Mid-training 或用离轨示范冷启动，再切换到在轨蒸馏。 |
| CHAPTER8-H3-19-CASE-02 | 案例 |  |
| CHAPTER8-H3-20-ANTIPATTERN-02 | 反模式 | 朴素 OPSD |
| CHAPTER8-H3-21-ENGINEERINGRULE-01 | 规则 | 在端到端回归任务中，Coding Agent 宣称完成前必须跑通验收测试，且验收测试对模型不可见、只在模型宣称完成时运行。 |
| CHAPTER8-H3-21-ENGINEERINGRULE-02 | 规则 | 评估针对“过早结束”的修复模型时，必须同时使用轨迹前缀边界集和保留集。 |
| CHAPTER8-H3-22-ENGINEERINGRULE-02 | 规则 | 中文自然语言中的引用可以转换为弯引号；嵌套引用按中文标点规则处理；英文原文、可执行代码、JSON/schema、路径、标识符和 Markdown 反引号中的内容必须原样保留；无法判断作用域时应保留原文… |
| CHAPTER8-H3-23-ENGINEERINGRULE-02 | 规则 | 只有模型收到的上下文与原始字符串完全一致，而模型输出是链路上首个出现差异的位置，才能把它标为模型的精确复制能力问题，作为后训练候选。 |
| CHAPTER9-H1-1-MENTALMODEL-01 | 心智 |  |
| CHAPTER9-H2-1-MENTALMODEL-01 | 心智 |  |
| CHAPTER9-H2-2-DECISIONMODEL-02 | 决策 |  |
| CHAPTER9-H4-1-ENGINEERINGRULE-01 | 规则 | 在航空客服中，一般政策争议无须转接人工；只有用户明确要求人工介入，或出现安全相关情形时才必须转接人工。 |
| CHAPTER9-H4-2-MENTALMODEL-01 | 心智 |  |
| CHAPTER9-H3-3-PLAYBOOK-01 | 剧本 |  |
| CHAPTER9-H4-3-ENGINEERINGRULE-01 | 规则 | 自我进化的上限，不取决于模型能写出多好的代码，而取决于承载它的系统具有多强的可组合性。 |
| CHAPTER9-H4-3-ENGINEERINGRULE-02 | 规则 | 可组合性必须是可传递的。 |
| CHAPTER9-H3-4-ENGINEERINGRULE-02 | 规则 | 对持续进化而言，应把经过评价的生产轨迹转化为训练数据：高质量示范进入 SFT，明确偏好形成成对数据，具有可靠环境奖励的交互用于 RL。 |
| CHAPTER9-H2-3-ENGINEERINGRULE-02 | 规则 | 自动课程、可执行技能和环境验证缺一不可 |
| CHAPTER9-H3-7-ENGINEERINGRULE-01 | 规则 | 原始网页、工具输出及其 LLM 摘要属于不可信证据，不能当作指令执行，也不能直接纳入 Skill 等长期能力；从这些输入中提取出的字符串绝不能作为指令执行。 |
| CHAPTER9-H3-8-PLAYBOOK-01 | 剧本 |  |
| CHAPTER9-H2-4-ENGINEERINGRULE-02 | 规则 | 现阶段更可行的路径，是在模型外围建立可验证的学习系统。 |
| CHAPTER10-H2-2-CASE-02 | 案例 |  |
| CHAPTER10-H2-3-DECISIONMODEL-02 | 决策 |  |
| CHAPTER10-H4-3-MENTALMODEL-02 | 心智 |  |
| CHAPTER10-H3-6-ENGINEERINGRULE-01 | 规则 | 应当将最强的模型和最精心设计的提示词分配给 Manager（规划者），而不是将资源平均分配给所有 Agent。 |
| CHAPTER10-H3-7-DECISIONMODEL-02 | 决策 |  |
| CHAPTER10-H3-8-ENGINEERINGRULE-02 | 规则 | A2A 并不取代本章介绍的三种通信机制，而是在它们之上、跨信任边界的标准化层。 |
| CHAPTER10-H3-11-ANTIPATTERN-01 | 反模式 | 同一模型、相似上下文生成的多个审核意见，不能自动视为相互独立的证据 |
| CHAPTER10-H3-11-CASE-02 | 案例 |  |
| CHAPTER10-H3-12-ANTIPATTERN-02 | 反模式 | 多 Agent 系统在目标互斥时可能从趋同走向对抗，把其他 Agent 的操作理解为蓄意阻挠。 |
| CHAPTER10-H3-13-ANTIPATTERN-01 | 反模式 | 多 Agent 场景下循环停不下来，失控的 Agent 有时会生成数千个子 Agent |
| CHAPTER10-H2-7-ANTIPATTERN-02 | 反模式 | 多 Agent 系统采用共享上下文保留细节，容易出现上下文膨胀和角色惯性。 |
| AFTERWORD-H2-2-HEURISTIC-02 | 启发 | 将 harness 作为短期最锋利的杠杆争取时间，同时构筑技术之外的护城河：独占数据、稳固渠道、用户信任、网络效应、人与 Agent 协作的物理世界场景。 |
| REFERENCE-ANSWERS-H1-1-HEURISTIC-01 | 启发 | 将参考答案视为仅供参考，并使用 LLM 结合书稿内容进一步讨论这些问题 |

共 179 条可操作对象未入选（另有 264 条概念对象，按需回查）。
