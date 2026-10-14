---
name: ch17-03-oo-design-patterns-s1
description: Rust 状态模式实现与权衡：Post 的 `state` 字段是私有的，因而无法创建任何其他状态的 `Post` 实例；适用于外部代码试图创建不同状态的 `Post` 实例时、创建新的 `Post` 实例时、博文只有草案状态，且业务要求草案内容为空时。
---

# Rust 状态模式实现与权衡

## 何时使用

- 外部代码试图创建不同状态的 `Post` 实例时。
- 创建新的 `Post` 实例时。
- 博文只有草案状态，且业务要求草案内容为空时。
- 需要消费老状态并把它设置为新状态，且旧状态值必须被移出结构体时。
- 当在 `Post` 的 `&self` 方法中访问 `state: Option<Box<State>>` 字段时。
- 在实现发布博文工作流的状态模式时。
- 使用状态模式封装不同状态行为，并且需要在已有状态之间增加新状态。
- 当博文处于草案状态，需要阻止在生产环境意外显示其内容时。

## 核心原则

**Post 的 `state` 字段是私有的，因而无法创建任何其他状态的 `Post` 实例。**

私有字段阻止外部代码直接设置状态，因此无法创建其他状态的 `Post`。

**创建新 `Post` 时，`state` 字段必须设置为一个存放了 `Box` 的 `Some` 值，且该 `Box` 指向 `Draft` 结构体新实例，以确保从草案开始。**

`Box` 指向 `Draft` 实例，使新建的 `Post` 始终从草案状态开始。

**当博文仅处于草案状态时，`content` 方法应总是返回空字符串 slice。**

因为目前博文只能是草案状态，草案的内容应该总是空的。

**在 Rust 状态模式中需要取得状态字段所有权时，将状态字段包装为 Option，并调用 take 取出其中的 Some 值、留下 None，从而把旧状态移出 Post 而不是借用它。**

Rust 不允许结构体实例中存在值为空的字段，Option 的 take 会在取出 Some 后留下 None，使字段仍保持有值。

**在 `&self` 方法中需要 `Option<Box<State>>` 中值的引用时，应调用 `as_ref` 获得引用，而不是移动 `state`。**

`as_ref` 会返回 `Option<&Box<State>>`；如果不调用 `as_ref`，会因为不能把 `state` 移动出借用的 `&self` 参数而得到编译错误。

**发布博文工作流的规则逻辑应存在于状态对象中，而不是分散在 `Post` 中。**

发布博文工作流的规则通过状态模式实现，相关逻辑应由状态对象承载。

**在状态模式中，由于状态之间相互联系，当需要在两个已有状态之间插入新状态时，必须修改负责转换到新状态的已有状态代码。**

状态实现了状态之间的转换，一些状态会相互联系。

**草案博文应完全没有 `content` 方法；这样尝试获取草案博文内容会得到方法不存在的编译错误，并使生产环境不可能意外显示草案博文内容。**

获取草案内容会得到方法不存在的编译错误，这意味着相关代码甚至不能编译。

## 实践模式

**状态模式**

状态模式是一种面向对象设计模式：一个值具有内部状态，体现为一系列状态对象，其行为随内部状态而改变；每个状态对象负责自身行为以及何时转移到另一状态，持有该状态对象的值对这些具体行为与转移时机不知情。

- 实现一个增量式的发布博文的工作流

**add_text 方法**

向博文内容增加文本的方法，通过获取self的可变引用并调用content中String的push_str实现，该行为不依赖博文状态。

- 调用content中String的push_str并传递text参数

**self: Box<Self>**

一种 Rust 方法接收者语法，表示方法只能在持有该类型的 Box 上调用，并获取 Box<Self> 的所有权。

- State trait 的 request_review 方法使用 self: Box<Self> 获取 Box<Self> 所有权，使老状态无效化，以便 Post 的状态值可转换为新状态。

**将状态编码进不同的类型**

不同于完全封装状态和状态转移，而是将状态编码进不同的类型；这样 Rust 的类型检查会将任何在只能使用发布博文的地方使用草案博文的尝试变为编译时错误。

- 在只能使用发布博文的地方使用草案博文，会被 Rust 类型检查变为编译时错误。

**状态转移为不同类型的转换**

通过让状态转换方法获取当前实例的所有权并返回下一个状态类型，消费旧状态实例，使旧状态不可再被使用；只有通过合法转换才能得到具有目标方法的类型，从而将工作流编码进类型系统。

- DraftPost::request_review 消费 DraftPost 并返回 PendingReviewPost；PendingReviewPost::approve 消费 PendingReviewPost 并返回发布的 Post。

**编译时无效状态不可能**

利用 Rust 的类型系统和编译时类型检查，使无效状态无法通过编译，从而在部署到生产环境之前发现特定 bug；该实现可能不再将状态转换完全封装在单一类型中。

- 显示未发布博文的内容这一 bug 将在部署到生产环境之前被发现。

## 常见陷阱

- **完全按照面向对象语言的定义实现状态模式**
  - 后果：没有尽可能地利用 Rust 的优势
  - 纠正：进行代码修改，将无效的状态和状态转移变为编译时错误

## 配套代码

> 本段无来源：信息源未提供目录化的配套代码（`sources/<源键>/code/` 无可消费目录）。按**源条件骨架**（ADR-029），本段以来源说明代替空段——请勿读成「源里有代码但没写」。

## 深度阅读

- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 面向对象设计模式的实现（第 1–44 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 定义 `Post` 并新建一个草案状态的实例（第 45–79 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 存放博文内容的文本（第 80–102 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 确保博文草案的内容是空的（第 103–125 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 请求审核博文来改变其状态（第 126–183 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 增加改变 `content` 行为的 `approve` 方法（第 184–318 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 状态模式的权衡取舍（第 319–340 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 将状态和行为编码为类型（第 341–399 行）
- `sources/rust-book-cn/book/ch17-03-oo-design-patterns.md` · 实现状态转移为不同类型的转换（第 400–469 行）
