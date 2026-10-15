---
name: ch08-03-hash-maps-s1
description: HashMap 核心操作：在 Rust 中使用 `HashMap` 前，必须先用 `use std::collections::HashMap;` 显式导入；适用于当 Rust 代码需要使用 `HashMap` 集合时、当使用 `collect` 构建 `HashMap` 时、将像 String 这样拥有所有权的值作为键或值插入哈希 map 时。
---

# HashMap 核心操作

## 何时使用

- 当 Rust 代码需要使用 `HashMap` 集合时。
- 当使用 `collect` 构建 `HashMap` 时。
- 将像 String 这样拥有所有权的值作为键或值插入哈希 map 时。
- 将值的引用插入哈希 map 时。
- 想要改变哈希 map 中的数据时。
- 对一个键已存在的哈希 map 再次插入该键的不同值时。
- 调用 `entry` 得到的 `Entry` 上的 `or_insert` 方法时，需要根据键是否已有值来决定返回现有值还是插入新值。

## 核心原则

**在 Rust 中使用 `HashMap` 前，必须先用 `use std::collections::HashMap;` 显式导入。**

`HashMap` 在三个常用集合中最不常用，因此没有被 prelude 自动引用。

**使用 `collect` 构建 `HashMap` 时，必须显式标注 `HashMap<_, _>` 类型。**

`collect` 可能产生多种数据结构，不显式指定目标类型时 Rust 无法推断。

**对于像 String 这样拥有所有权的值，插入哈希 map 时其值会被移动，哈希 map 会成为这些值的所有者；插入后原绑定不再有效，尝试使用它们会出现编译错误。**

插入时所有权转移给了哈希 map，原绑定失去所有权而不再有效。

**如果将值的引用插入哈希 map，值本身不会被移动进哈希 map；但这些引用指向的值必须至少与哈希 map 一样长久有效。**

插入的是引用而不是值本身，因此不移动值，但引用指向的值必须满足哈希 map 有效期间的有效性要求。

**改变哈希 map 中的数据时，必须决定如何处理一个键已经有值了的情况。**

每个键只能关联一个值；可选处理方式包括用新值代替旧值、保留旧值而忽略新值并只在键没有对应值时增加新值、或结合新旧两值。

**对哈希 map 的同一个键再次插入不同的值时，该键关联的旧值将被替换，哈希 map 只保留一个键值对。**

两次插入使用的是同一个键，因此哈希 map 只保留该键对应的一个值。

**`Entry` 的 `or_insert` 方法在键对应的值存在时返回该值的可变引用；在键对应的值不存在时插入参数作为新值并返回新值的可变引用。**

使用 `or_insert` 比编写自己的检查逻辑更简明，并且与借用检查器结合得更好。

## 实践模式

**HashMap get 方法的 Option 返回值**

HashMap 的 get 方法返回 Option<V>；当键有对应值时结果被装进 Some，当键没有对应值时返回 None。

- 蓝队分数对应的 get 结果为 Some(10)

**entry**

哈希 map 特有的 API，获取想要检查的键作为参数，返回 `Entry` 枚举，代表可能存在也可能不存在的值，可用于只在键没有对应值时插入。

- 检查黄队的键是否关联了一个值；如果没有，就插入值 50

**or_insert 方法**

`or_insert` 方法返回当前键对应值的一个可变引用（`&mut V`）；将该引用绑定到变量后，必须先用星号（`*`）解引用，才能对其指向的值进行赋值更新。

- 把 `or_insert` 返回的可变引用存入 `count` 后，通过解引用 `count` 对该键对应的值进行赋值更新。

## 常见陷阱

- **在值被移动（赋值给其他变量、插入哈希 map、发送到通道、移入拥有所有权的数据结构）之后，继续访问或使用原始绑定。**
  - 后果：编译器会以 `use of moved value`（E0382）拒绝代码，防止潜在的双重释放、无效变量以及并发线程对已发送值的后续修改或丢弃导致的数据不一致。
  - 纠正：移动后不再使用原绑定；如果多个位置需要共享同一数据，在单线程场景改用 `Rc<T>` 的引用计数共享，并用 `Rc::clone` 增加计数，而不是将所有权移入单一所有者。
- **把拥有所有权的值（如 `String`）作为键或值插入 `HashMap` 后，还继续使用原来的变量绑定。**
  - 后果：原变量已被移动到哈希 map，继续使用会导致编译错误。
  - 纠正：如果插入后仍需要原值，可以插入克隆；或者插入引用，并确保引用的值在哈希 map 有效期间保持有效。
- **使用 `collect` 从元组迭代器构建 `HashMap` 时省略目标类型标注。**
  - 后果：`collect` 可以收集成多种集合，编译器无法推断出 `HashMap`，导致编译错误。
  - 纠正：显式给出 `HashMap<_, _>` 类型标注；键和值的具体类型可用下划线占位，由迭代器推断。

## 配套代码

> 本段无来源：信息源未提供目录化的配套代码（`sources/<源键>/code/` 无可消费目录）。按**源条件骨架**（ADR-029），本段以来源说明代替空段——请勿读成「源里有代码但没写」。

## 深度阅读

- `sources/rust-book-cn/book/ch08-03-hash-maps.md` · 新建一个哈希 map（第 9–42 行）
- `sources/rust-book-cn/book/ch08-03-hash-maps.md` · 哈希 map 和所有权（第 43–64 行）
- `sources/rust-book-cn/book/ch08-03-hash-maps.md` · 访问哈希 map 中的值（第 65–106 行）
- `sources/rust-book-cn/book/ch08-03-hash-maps.md` · 更新哈希 map（第 107–110 行）
- `sources/rust-book-cn/book/ch08-03-hash-maps.md` · 覆盖一个值（第 111–129 行）
- `sources/rust-book-cn/book/ch08-03-hash-maps.md` · 只在键没有对应值时插入（第 130–151 行）
- `sources/rust-book-cn/book/ch08-03-hash-maps.md` · 根据旧值更新一个值（第 152–174 行）
- `sources/rust-book-cn/book/ch04-01-what-is-ownership.md` · 变量与数据交互的方式（一）：移动（第 109–172 行）
- `sources/rust-book-cn/book/ch16-02-message-passing.md` · 通道与所有权转移（第 90–132 行）
- `sources/rust-book-cn/book/ch15-04-rc.md` · 使用 `Rc<T>` 共享数据（第 13–90 行）
