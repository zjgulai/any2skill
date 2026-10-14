---
name: ch12-03-improving-error-handling-and-modularity-s1
description: 模块化CLI重构：最好能将配置变量组织进一个结构，使它们的目的更明确；适用于随着 main 函数增长，需要引入更多变量到作用域时、在二进制项目完成关注分离过程后，界定 main 函数职责范围时、当二进制项目的 main 函数开始变得庞大，需要进行关注分离时。
---

# 模块化CLI重构

## 何时使用

- 随着 main 函数增长，需要引入更多变量到作用域时。
- 在二进制项目完成关注分离过程后，界定 main 函数职责范围时。
- 当二进制项目的 main 函数开始变得庞大，需要进行关注分离时。
- 当函数后续逻辑依赖访问 slice 的索引 `1` 和 `2` 时。
- 当 `Config::new` 与 `main` 交流，需要表明存在问题时。
- 当 `main` 函数包含不属于设置配置或处理错误的所有逻辑时。
- 当被调用函数（如 `run`）成功时返回 `()`，调用者只关心检测错误，而不需要未封装的值时。
- 完成一步小的、增量重构改变之后
- 当考虑用 clone 解决所有权问题时
- 当一个普通函数的目的是创建某个结构体的实例时
- 当函数中的操作可能失败，且你希望把错误返回给调用者处理而不是让程序 `panic!` 时
- 当项目已经完成模块化重构后

## 核心原则

**最好能将配置变量组织进一个结构，使它们的目的更明确。**

当作用域中有更多变量时，将更难以追踪每个变量的目的。

**对二进制项目进行关注分离之后，保留在 main 函数中的责任应被限制为：使用参数值调用命令行解析逻辑；设置任何其他配置；调用 lib.rs 中的 run 函数；如果 run 返回错误则处理该错误。**

该模式将关注分离：main.rs 处理程序运行，而 lib.rs 处理所有真正的任务逻辑；由于 main 函数不能直接测试，将程序逻辑移动到 lib.rs 中使其可测试，而 main.rs 中保留的代码足够小，阅读即可验证正确性。

**在二进制项目中，当 main 函数开始变得庞大时，应遵循关注分离指导性过程：将程序拆分为 main.rs 和 lib.rs，将程序逻辑放入 lib.rs；当命令行解析逻辑较小时可以保留在 main.rs，当它变得复杂时同样应将其从 main.rs 提取到 lib.rs。**

这是 Rust 社区开发的指导性过程，用于在 main 函数开始变得庞大时对二进制程序进行关注分离。

**在访问 slice 的索引 `1` 和 `2` 之前，应先检查 slice 长度是否足够；若不够长，应显式 panic 并给出更明确的错误信息，而不是暴露 `index out of bounds`。**

提供更好的错误信息，避免默认的 `index out of bounds` 信息。

**当 `Config::new` 与 `main` 交流且可能失败时，使用 `Result` 类型表明问题，而不是调用 `panic!`。**

返回 `Result` 后，`main` 可以将 `Err` 成员转换为对用户更友好的错误；`panic!` 会产生关于 `thread 'main'` 和 `RUST_BACKTRACE` 的文本。

**提取一个叫做 `run` 的函数来存放目前 `main` 函数中不属于设置配置或处理错误的所有逻辑。**

一旦完成这些，`main` 函数将简明得足以通过观察来验证，而我们将能够为所有其他逻辑编写测试。

**当 `run` 成功时返回 `()` 且调用者只关心检测错误时，应使用 `if let` 检查 `run` 是否返回 `Err` 值，并在出错时调用 `process::exit(1)`，而不是使用 `unwrap_or_else`。**

`run` 并不返回像 `Config::new` 返回的 `Config` 实例那样需要 `unwrap` 的值；因为 `run` 成功时返回 `()`，且调用者只关心检测错误，所以不需要 `unwrap_or_else` 来返回未封装的值，因为它只会是 `()`。

## 实践模式

**提取参数解析器**

一种将命令行参数解析与映射逻辑从 main 函数提取到独立函数的手法：main 将整个参数 vector 传给该函数，由该函数决定哪个参数放入哪个变量并返回值；main 只接收返回值，不再负责参数与变量的对应。

- 在 parse_config 中将索引 1 的参数值对应到 query、索引 2 的参数值对应到 filename，再由该函数将这些值返回到 main。

**Config**

Config 是一个包含 query 和 filename 两个 String 字段的结构体，parse_config 函数返回 Config 实例。

- parse_config 返回 Config { query, filename }

**unwrap_or_else**

定义于标准库 Result<T, E> 上的方法，用于进行自定义的非 panic! 错误处理；当 Result 为 Ok 时返回 Ok 内部封装的值，当 Result 为 Err 时调用作为参数传入的闭包，并将 Err 内部值传递给闭包参数 err。

- 当 Result 为 Err 时，Err 的内部值（如 not enough arguments）会传递给闭包参数 err

**process::exit**

标准库 process 模块中的函数，调用后会立即停止程序，并将传递给它的数字作为退出状态码；其行为类似于基于 panic! 的错误处理，但不会再得到所有额外输出。

- 在错误情况闭包中，打印 err 值后调用 std::process::exit

**Box<dyn Error>**

`Box<dyn Error>` 是一种 trait 对象，表示函数会返回实现了 `Error` trait 的类型，无需指定具体将会返回的值的类型，因而在不同错误场景中可能有不同类型的错误返回值。

- 在示例 12-12 中，`run` 函数的返回类型为 `Result<(), Box<dyn Error>>`。

**库 crate**

一个拥有可以测试的公有 API 的 crate

- 在 Config、其字段、其 new 方法和 run 函数上使用 pub 关键字的 crate

## 常见陷阱

- **main 函数同时承担多个任务（解析参数与打开文件）。**
  - 后果：函数承担更多责任后，更难以推导、测试，并更难以在不破坏其他部分的情况下修改。
  - 纠正：分离功能，使每个函数只负责一个任务。
- **将 `index out of bounds: the len is 1 but the index is 1` 这个针对开发者的错误信息展示给终端用户。**
  - 后果：不能真正帮助终端用户理解发生了什么和他们应该做什么。
  - 纠正：修复错误处理，解决该开发者错误信息无法帮助终端用户理解发生了什么和应该做什么的问题。
- **使用 `panic!` 处理使用问题**
  - 后果：会向用户暴露不希望的额外信息，并且 `panic!` 更趋向于程序问题而非使用问题。
  - 纠正：返回 `Result` 以表明成功或错误。

## 配套代码

> 本段无来源：信息源未提供目录化的配套代码（`sources/<源键>/code/` 无可消费目录）。按**源条件骨架**（ADR-029），本段以来源说明代替空段——请勿读成「源里有代码但没写」。

## 深度阅读

- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 重构改进模块性和错误处理（第 1–14 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 二进制项目的关注分离（第 15–31 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 提取参数解析器（第 32–60 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 组合配置值（第 61–118 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 创建一个 `Config` 的构造函数（第 119–158 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 从 `main` 提取逻辑（第 274–305 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 将代码拆分到库 crate（第 376–448 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 修复错误处理（第 159–174 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 改善错误信息（第 175–206 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 从 `new` 中返回 `Result` 而不是调用 `panic!`（第 207–237 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · `Config::new` 调用并处理错误（第 238–273 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 从 `run` 函数中返回错误（第 306–350 行）
- `sources/rust-book-cn/book/ch12-03-improving-error-handling-and-modularity.md` · 处理 `main` 中 `run` 返回的错误（第 351–375 行）
