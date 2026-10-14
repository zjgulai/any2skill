---
name: ch13-02-iterators-s1
description: 使用标准迭代器处理序列：调用 `sum` 之后不再允许使用 `v1_iter`，因为调用 `sum` 时它会获取迭代器的所有权；适用于调用 `sum` 之后、调用迭代器适配器方法并需要获取其结果时、在 Rust 中为某个类型实现标准库的 `Iterator` trait 时。
---

# 使用标准迭代器处理序列

## 何时使用

- 调用 `sum` 之后。
- 调用迭代器适配器方法并需要获取其结果时。
- 在 Rust 中为某个类型实现标准库的 `Iterator` trait 时。

## 核心原则

**调用 `sum` 之后不再允许使用 `v1_iter`，因为调用 `sum` 时它会获取迭代器的所有权。**

调用 `sum` 时它会获取迭代器的所有权。

**使用迭代器适配器后，必须调用一个消费适配器方法才能获取迭代器适配器调用的结果。**

所有的迭代器都是惰性的。

**实现 `Iterator` trait 创建自定义迭代器时，唯一必须提供的方法是 `next` 方法；一旦提供了 `next`，就可以使用 `Iterator` trait 提供的所有其他默认实现方法。**

只需实现 `next` 方法，其余由 `Iterator` trait 提供的默认实现方法即可直接使用。

## 实践模式

**迭代器**

迭代器负责遍历序列中的每一项并决定序列何时结束；在 Rust 中迭代器是惰性的，创建后在调用方法使用它之前不会有效果。

- 在 Vec 上调用 iter 方法创建 v1_iter，该创建动作本身不产生效果，代码没有任何用处。

**next 方法**

next 是 Iterator 实现者被要求定义的唯一方法；它一次返回迭代器中的一个项，封装在 Some 中，当迭代器结束时返回 None。

- 示例 13-15 中 v1_iter.next() 依次返回 Some(&1)、Some(&2)、Some(&3)、None。

**消费适配器**

调用 `next` 方法的方法，因为调用它们会消费迭代器。

- sum 方法

**迭代器适配器**

`Iterator` trait 中定义的另一类方法，允许将当前迭代器变为不同类型的迭代器；可以链式调用多个迭代器适配器；因为所有迭代器都是惰性的，必须调用一个消费适配器方法才能获取迭代器适配器调用的结果。

- `map` 方法使用闭包来调用每个元素以生成新的迭代器

**filter 方法**

迭代器的 `filter` 方法获取一个闭包，该闭包使用迭代器的每一个项并返回布尔值；如果闭包返回 `true`，对应值会包含在 `filter` 提供的新迭代器中，如果返回 `false`，则不会包含在结果迭代器中。

- 示例 13-19 中，使用 `filter` 和一个捕获环境中变量 `shoe_size` 的闭包遍历 `Shoe` 结构体集合，只返回指定大小的鞋子。

**Iterator trait**

实现 Iterator trait 后，类型便成为一个迭代器，可以通过直接调用 next 方法使用其迭代器功能。

- 对 Counter 结构体的迭代器功能通过直接调用 next 方法进行测试

**自定义迭代器的默认 Iterator 方法可用性**

实现 `Iterator` trait 的 `next` 方法后，就可以使用标准库中任何拥有默认实现的 `Iterator` trait 方法，因为这些默认实现都使用 `next` 方法的功能。

- 在示例 13-23 中，将 `Counter` 实例产生的值与另一个 `Counter` 实例在省略了第一个值之后产生的值配对，将每对值相乘，只保留可被三整除的结果，然后将所有保留结果相加。

**zip 适配器的终止行为**

当任一输入迭代器返回 `None` 时，`zip` 也返回 `None`；因此 `zip` 只产生四对值，不会产生第五对值 `(5, None)`。

- `zip` 只产生四对值，而理论上第五对值 `(5, None)` 从未被产生。

## 常见陷阱

- **使用 `while` 循环和显式索引变量遍历数组或集合，手动维护索引和边界条件。**
  - 后果：索引值或测试条件错误会导致越界 panic；编译器在每次迭代增加运行时边界检查，使循环更慢。
  - 纠正：使用 `for` 循环或迭代器（`iter`、`into_iter`、`iter_mut`）让迭代器管理遍历逻辑。
- **调用 `map`、`filter` 等迭代器适配器后不调用 `collect`、`sum` 等消费适配器，期望代码已经生效。**
  - 后果：适配器闭包从未被调用，代码没有产生任何效果，只会得到未使用警告。
  - 纠正：在链末尾调用消费适配器（如 `collect`）来执行并收集结果。

## 配套代码

> 本段无来源：信息源未提供目录化的配套代码（`sources/<源键>/code/` 无可消费目录）。按**源条件骨架**（ADR-029），本段以来源说明代替空段——请勿读成「源里有代码但没写」。

## 深度阅读

- `sources/rust-book-cn/book/ch13-02-iterators.md` · 使用迭代器处理元素序列（第 1–34 行）
- `sources/rust-book-cn/book/ch13-02-iterators.md` · `Iterator` trait 和 `next` 方法（第 35–76 行）
- `sources/rust-book-cn/book/ch13-02-iterators.md` · 消费迭代器的方法（第 77–101 行）
- `sources/rust-book-cn/book/ch13-02-iterators.md` · 产生其他迭代器的方法（第 102–150 行）
- `sources/rust-book-cn/book/ch13-02-iterators.md` · 使用闭包获取环境（第 151–201 行）
- `sources/rust-book-cn/book/ch13-02-iterators.md` · 使用自定义迭代器中其他 `Iterator` trait 方法（第 300–352 行）
- `sources/rust-book-cn/book/ch13-02-iterators.md` · 实现 `Iterator` trait 来创建自定义迭代器（第 202–257 行）
- `sources/rust-book-cn/book/ch13-02-iterators.md` · 使用 `Counter` 迭代器的 `next` 方法（第 258–299 行）
- `sources/rust-book-cn/book/ch03-05-control-flow.md` · 使用 `for` 遍历集合（第 198–245 行）
