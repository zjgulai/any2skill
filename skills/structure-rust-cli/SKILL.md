---
name: structure-rust-cli
description: 把单文件 Rust CLI 重构为可测试结构：main 职责瘦身、lib 与 main 拆分、Config 聚合参数、用 Result 替代 panic 并返回退出码。适用于命令行工具增长到难以测试、需要把逻辑交给测试覆盖时。
---

# 拆分 Rust CLI 并传递 Result 错误

## 何时使用

- CLI 的 main 函数职责过多、参数处理与业务逻辑混在一起时
- 想让命令行程序的核心逻辑被单元测试覆盖时
- 需要把 panic 式错误处理改为可诊断的 Result 与退出码时
- 处理越界/缺失参数等输入错误、需要给出稳定行为时

## 输入与前置条件

- 现有 main（或等价入口）的职责清单
- 命令行参数与配置项列表
- 错误处理现状（panic 点与用户可见的错误输出）

## 执行步骤

1. 列清 main 的职责：参数解析、配置构建、运行逻辑、错误报告，至少四类。
2. 拆分结构：把配置与运行逻辑移入库代码（src/lib.rs），main 只保留参数解析、调用运行、错误处理。
3. 聚合配置：把相关参数收拢成一个 Config 结构体，由构造函数完成校验与默认值。
4. 把错误处理改为 Result：业务函数返回 Result 而非 panic；在 main 统一处理错误并设置非零退出码。
5. 输入校验前置：数组索引、文件路径等在进入业务逻辑前显式检查，不用越界 panic 兜底。
6. 为库函数补测试：拆分的意义在于核心逻辑可被单元测试直接调用。

## 交付物

- 重构后的模块结构（lib/main 边界）
- Config 定义与构建函数
- Result 化错误处理与退出码约定
- 覆盖核心逻辑的测试

## 检查、停止与回滚

- main 只承担参数解析、调用运行、错误处理三类职责
- 业务路径中无 panic 式错误处理残留（或已说明必须 panic 的理由）
- 越界/缺参输入在业务逻辑前被校验，行为可预期
- 核心逻辑有直接调用它的测试
- 停止条件：重构需要改变对外命令行接口（参数名、子命令）时暂停，先确认兼容性
- 停止条件：存在超出本任务范围的并发或网络逻辑时，隔离后另行处理
- 回滚：已定义。保留重构前版本；回滚即恢复单文件结构并重新验证命令行行为。

## 依据与边界

**来源规则**

- 最好能将配置变量组织进一个结构，使它们的目的更明确。
- 对二进制项目进行关注分离之后，保留在 main 函数中的责任应被限制为：使用参数值调用命令行解析逻辑；设置任何其他配置；调用 lib.rs 中的 run 函数；如果 run 返回错误则处理该错误。
- 在二进制项目中，当 main 函数开始变得庞大时，应遵循关注分离指导性过程：将程序拆分为 main.rs 和 lib.rs，将程序逻辑放入 lib.rs；当命令行解析逻辑较小时可以保留在 main.rs，当它变得复杂时同样应将其从 main.rs 提取到 lib.rs。
- 完成一步小的、增量重构改变之后——建议：再次运行程序并验证参数解析是否仍然正常
- 当考虑用 clone 解决所有权问题时——建议：在第一轮编写时，复制一些字符串来取得进展是没有问题的，调用 clone 完全可以接受；优先拥有一个可以工作但有点低效的程序，而不是尝试过度优化代码。
- 当一个普通函数的目的是创建某个结构体的实例时——建议：将该函数改为与结构体关联的 `new` 函数，以便通过 `Type::new` 调用创建实例
- 在访问 slice 的索引 `1` 和 `2` 之前，应先检查 slice 长度是否足够；若不够长，应显式 panic 并给出更明确的错误信息，而不是暴露 `index out of bounds`。
- 当 `Config::new` 与 `main` 交流且可能失败时，使用 `Result` 类型表明问题，而不是调用 `panic!`。
- 提取一个叫做 `run` 的函数来存放目前 `main` 函数中不属于设置配置或处理错误的所有逻辑。
- 当函数中的操作可能失败，且你希望把错误返回给调用者处理而不是让程序 `panic!` 时——建议：使用 `?` 运算符代替 `expect`，从函数中返回错误值并让调用者处理它
- 当 `run` 成功时返回 `()` 且调用者只关心检测错误时，应使用 `if let` 检查 `run` 是否返回 `Err` 值，并在出错时调用 `process::exit(1)`，而不是使用 `unwrap_or_else`。
- 当项目已经完成模块化重构后——建议：后续工作集中在 src/lib.rs 中进行

**来源陷阱**

- main 函数同时承担多个任务（解析参数与打开文件）。
  - 后果：函数承担更多责任后，更难以推导、测试，并更难以在不破坏其他部分的情况下修改。
  - 纠正：分离功能，使每个函数只负责一个任务。
- 将 `index out of bounds: the len is 1 but the index is 1` 这个针对开发者的错误信息展示给终端用户。
  - 后果：不能真正帮助终端用户理解发生了什么和他们应该做什么。
  - 纠正：修复错误处理，解决该开发者错误信息无法帮助终端用户理解发生了什么和应该做什么的问题。
- 使用 `panic!` 处理使用问题
  - 后果：会向用户暴露不希望的额外信息，并且 `panic!` 更趋向于程序问题而非使用问题。
  - 纠正：返回 `Result` 以表明成功或错误。
- 直接索引集合元素而不先检查长度或边界。
  - 后果：索引无效时触发 panic，程序崩溃。
  - 纠正：在访问索引前确认索引在集合范围内，避免直接请求越界元素。

**适用边界**

- 不覆盖 CLI 参数解析库的选型与高级特性
- 不覆盖打包分发与安装脚本
- 不覆盖 daemon 化与信号处理

**出处**

- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 重构改进模块性和错误处理（第 1–14 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 二进制项目的关注分离（第 15–31 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 提取参数解析器（第 32–60 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 组合配置值（第 61–118 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 创建一个 `Config` 的构造函数（第 119–158 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 修复错误处理（第 159–174 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 改善错误信息（第 175–206 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 从 `new` 中返回 `Result` 而不是调用 `panic!`（第 207–237 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · `Config::new` 调用并处理错误（第 238–273 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 从 `main` 提取逻辑（第 274–305 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 从 `run` 函数中返回错误（第 306–350 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 处理 `main` 中 `run` 返回的错误（第 351–375 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 将代码拆分到库 crate（第 376–448 行）
- `sources/rust-book-cn/book/ch09-01-unrecoverable-errors-with-panic.md` · 使用 `panic!` 的 backtrace（第 39–133 行）
