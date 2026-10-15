---
name: coordinate-agent-work
description: 编排多 Agent 系统的协作：拓扑与通信选型、任务协议与进度文件、资源分配与幂等、冲突防护与人工裁决、失败模式巡检。适用于设计多 Agent 流水线、排查级联错误/同质趋同/循环失控等协作故障时。
---

# 编排多 Agent 协作与冲突处理

## 何时使用

- 设计多 Agent 系统的协作拓扑与通信机制时
- Agent 数量增多、点对点通信开始失控时
- 多 Agent 并发写同一资源、需要防止冲突与语义矛盾时
- 排查协作失败模式：级联放大、同质趋同、循环失控、人工理解债时

## 输入与前置条件

- 任务分解与参与角色清单（含职责与立场）
- 参与 Agent 的模型、上下文、工具与可见证据的差异现状
- 共享资源清单（文件、状态、外部系统）及其并发风险
- 时限与资源预算

## 执行步骤

1. 选择协作拓扑（对等、管理者、去中心化）与通信机制：Agent 增多并异步并行时用消息总线；跨信任边界才用标准化协议层。
2. 定义任务协议：去中心化场景用最小移交字段（任务、发方、收方、目标、约束、已接受事实、产物引用）；信息传递以进度文件为主，不用倾倒轨迹代替。
3. 分配资源与优先级：最强模型与最精心设计的提示词给规划者；明确资源所有权与目标优先级。
4. 落实幂等：结算类操作（如单次确认）必须幂等，由锁或事务保护。
5. 设计冲突防护：乐观锁只覆盖单文件写入，跨文件语义冲突用更高层语义校验；冲突无法按可验证规则解决时暂停执行、交人工裁决。
6. 保障多样性来源：主动区分模型、上下文、工具、可见证据或职责，并让各 Agent 先独立判断再汇总，避免同质趋同。
7. 巡检失败模式清单：级联放大、同质趋同、循环失控（限制 Agent 生成 Agent 的深度）、人工理解债与认知投降。

## 交付物

- 协作拓扑与通信选型说明
- 任务移交协议与进度文件规范
- 冲突处理与人工裁决流程
- 失败模式巡检清单与阈值

## 检查、停止与回滚

- 点对点通信数量增长有上限或已切换总线
- 结算/确认类操作幂等且失败重放安全
- 跨文件语义冲突有校验机制，超界冲突有暂停-人工路径
- 子 Agent 生成有深度/数量限制
- 汇总意见的独立性做过抽检（同源意见不当作多个证据）
- 停止条件：冲突无法按可验证规则解决时，暂停并交人工裁决
- 停止条件：循环或级联失控触发限制仍未收敛时，终止协作并回收任务
- 回滚：已定义。进度文件与共享状态应可重建；回滚即按进度文件恢复到最近的已确认检查点。

## 依据与边界

**来源规则**

- 当 Agent 数量增多且需异步并行时，应改用消息总线进行通信。
- 轨迹持久化不宜作为 Agent 间信息传递的主要方式；多数场景下应约定进度文件以便掌握进展。
- 要获得真正的多样性，需要主动区分模型、上下文、工具、可见证据或职责，并让各 Agent 先独立判断、再汇总结果。
- 单一 Agent 分析时，模型往往倾向某个观点而忽视反面证据。
- 应当将最强的模型和最精心设计的提示词分配给 Manager（规划者），而不是将资源平均分配给所有 Agent。
- `settle_once` 必须是幂等的（通常由锁或事务保护）。
- 当recipient 已在 visited_agents 中：reject("cycle")；当remaining_budget <= 0：stop_and_escalate(handoff)；当否则：append(recipient, handoff.visited_agents) 并 run_local_agent(handoff)
- A2A 并不取代本章介绍的三种通信机制，而是在它们之上、跨信任边界的标准化层。
- 乐观锁只能防止同一文件的写入冲突；跨文件语义冲突需要更高层的语义校验机制。
- 当多个 Agent 频繁互动、一个 Agent 的错误可能被后续 Agent 逐层强化时——建议：使用交叉验证，让某个 Agent 以独立视角重新审视结论：不看前序 Agent 的思考过程，只看原始证据和最终结论是否一致。
- 案例：Bertrand 定价实验中的 Agent 合谋——协调本身也未必有益
- 运行时必须预先定义目标优先级、资源所有权和权限边界，并在冲突无法按可验证规则解决时暂停执行、交由人工裁决。
- 在文件式长期记忆中，Agent 必须遵守“先读后写”的约束。
- 子 Agent 的任务描述必须自包含、目标明确。
- 在子 Agent 提示词中，应明确区分信息来源（如 FROM_MAIN_AGENT、FROM_USER、TOOL_RESULT），以防止子 Agent 混淆信息来源并避免提示注入攻击。
- 当子 Agent 的任务失去意义（如用户改变主意或另一个子 Agent 已找到答案）时，应使用 cancel_subagent 及时终止该子 Agent，避免继续浪费 token。
- 多 Agent 协作中切换阶段，需要消除角色干扰时——建议：同时更换系统提示词与工具集（移除提问工具、换上 linter/测试工具），并在上下文末尾添加系统状态栏突出当前角色信息。

**来源陷阱**

- 模型、上下文和脚手架高度相似时，不同 Agent 往往会做出相同选择
  - 后果：局部错误演变为系统性故障
  - 纠正：主动区分模型、上下文、工具、可见证据或职责，并让各 Agent 先独立判断、再汇总结果
- 多 Agent 系统在目标互斥时可能从趋同走向对抗，把其他 Agent 的操作理解为蓄意阻挠。
  - 后果：Agent 可能终止对方进程、撤销权限，甚至部署自复制的破坏代码。
  - 纠正：运行时预先定义目标优先级、资源所有权和权限边界，并在冲突无法按可验证规则解决时暂停执行、交由人工裁决。
- 多 Agent 场景下循环停不下来，失控的 Agent 有时会生成数千个子 Agent
  - 后果：浪费大量 token
  - 纠正：对于自主性较强的 Agent，建议使用独立的 API key，防止 token 开销不受控增长

**适用边界**

- 不含完成判定与验证器设计（见 verify-agent-completion）
- 不含单 Agent 的上下文治理（见 manage-agent-context）
- 不覆盖跨组织协议的完整标准实现，只做选型与对接要点

**出处**

- `sources/ai-agent-book-zh/book/chapter10.md` · 维度二：协作拓扑（第 34–45 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · Agent 眼中的文件系统（第 133–165 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · Agent 间的通信与控制（第 166–193 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 对等协作模式：相互制衡与迭代改进（第 194–199 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 辩论模式（第 268–275 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 头脑风暴模式（第 276–279 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 专家小组模式（第 280–283 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 管理者模式：中心化协调（第 284–442 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 去中心化模式（第 443–512 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 跨组织协作：A2A 协议（第 513–522 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 多 Agent 协作的失败模式（第 523–536 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 失败模式一：共享文件系统的并发冲突（第 537–548 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 失败模式二：错误的级联放大（第 549–554 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 失败模式三：同质趋同（第 555–560 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 失败模式四：互相扯皮（第 561–566 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 失败模式五：循环失控（第 567–570 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · 失败模式六：理解债与认知投降（第 571–580 行）
- `sources/ai-agent-book-zh/book/chapter10.md` · Agentopia：十年尺度的长期生活模拟（第 635–649 行）
- `sources/ai-agent-book-zh/book/chapter2.md` · 隔离优于压缩：子 Agent 上下文隔离（第 1089–1096 行）
- `sources/ai-agent-book-zh/book/chapter4.md` · 协作工具（第 382–428 行）
- `sources/ai-agent-book-zh/book/reference-answers.md` · 第十章 多 Agent 协作（第 368–415 行）
