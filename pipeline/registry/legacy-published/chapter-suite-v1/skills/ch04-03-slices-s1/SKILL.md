---
name: ch04-03-slices-s1
description: Rust 切片类型使用：字符串 slice range 的索引必须位于有效的 UTF-8 字符边界内；适用于使用字符串 slice range 的索引创建 slice 时、存在某值的不可变引用，且同时需要获取可变引用时、当函数需要接受字符串 slice 或 `String` 值时。
---

# Rust 切片类型使用

## 何时使用

- 使用字符串 slice range 的索引创建 slice 时
- 存在某值的不可变引用，且同时需要获取可变引用时
- 当函数需要接受字符串 slice 或 `String` 值时

## 核心原则

**字符串 slice range 的索引必须位于有效的 UTF-8 字符边界内**

如果索引不在字符边界而从多字节字符中间创建 slice，程序会因错误退出；因此这里先只假设使用 ASCII，UTF-8 处理在第 8 章讨论

**当拥有某值的不可变引用时，就不能再获取一个可变引用**

`println!` 使用 `word` 中的引用，所以不可变引用在此时必须仍然有效；Rust 不允许 `clear` 的可变引用和 `word` 的不可变引用同时存在

## 实践模式

**字符串字面量**

字符串字面量的类型是 `&str`，它是一个指向二进制程序特定位置的 slice；由于 `&str` 是不可变引用，因此字符串字面量不可变。

- let s = "Hello, world!";

**其他类型的 slice**

更通用的 slice 类型可以对其他所有集合使用；对数组 `a` 取 `&a[1..3]` 得到的 slice 类型是 `&[i32]`，其工作方式与字符串 slice 相同：存储第一个集合元素的引用和一个集合总长度。

- `let a = [1, 2, 3, 4, 5]; let slice = &a[1..3];` 得到的 slice 类型为 `&[i32]`。

## 常见陷阱

- **用多个与底层数据状态无关的索引变量来跟踪字符串位置**
  - 后果：索引与数据可能不同步，维护起来啰嗦且易出错
  - 纠正：使用字符串 slice 解决该问题
- **从集合/字符串中提取独立的数字索引（如 `usize`）作为查找结果的表示，而不是返回与底层数据绑定的引用或 slice。**
  - 后果：索引与数据状态无关，在数据被修改（如 `clear`）后索引失效，造成逻辑 bug；这些 bug 通常不会立即暴露，编译器无法在编译期发现。
  - 纠正：返回字符串 slice（`&str`）或数组/集合 slice（`&[T]`），把结果的起始位置和长度与底层数据生命周期绑定，由编译器保证引用在修改/清空时失效。

## 配套代码

> 本段无来源：信息源未提供目录化的配套代码（`sources/<源键>/code/` 无可消费目录）。按**源条件骨架**（ADR-029），本段以来源说明代替空段——请勿读成「源里有代码但没写」。

## 深度阅读

- `sources/rust-book-cn/book/ch04-03-slices.md` · 切片 Slice 类型（第 1–66 行）
- `sources/rust-book-cn/book/ch04-03-slices.md` · 字符串 slice（第 67–151 行）
- `sources/rust-book-cn/book/ch04-03-slices.md` · 字符串字面量就是 slice（第 152–161 行）
- `sources/rust-book-cn/book/ch04-03-slices.md` · 字符串 slice 作为参数（第 162–185 行）
- `sources/rust-book-cn/book/ch04-03-slices.md` · 其他类型的 slice（第 186–203 行）
