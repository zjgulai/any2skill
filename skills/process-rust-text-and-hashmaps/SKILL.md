---
name: process-rust-text-and-hashmaps
description: 安全处理 Rust 字符串与 HashMap：UTF-8 边界、拼接的所有权规则、字符与字节迭代、键值集合的插入/查询/覆盖策略。适用于日志与文本处理、构建缓存/计数/注册表、以及排查字符串索引 panic 或所有权失效时。
---

# 安全处理 Rust 文本与键值集合

## 何时使用

- 处理用户输入、日志、协议文本等多字节字符串时
- 拼接字符串并需要理解 + 与 format! 的所有权差异时
- 构建或更新缓存、计数器、注册表等键值结构时
- 排查「字符串不能索引」「插入后原变量不可用」这类报错时

## 输入与前置条件

- 文本数据的来源与编码假设（UTF-8）
- 需要构建的键值结构及其更新语义（插入、覆盖、仅缺失时插入、基于旧值更新）
- 性能敏感路径与数据规模

## 执行步骤

1. 字符串切片一律按字符边界操作：用 chars/char_indices 计算边界，不用字节下标直接切。
2. 需要迭代「用户感知字符」时用字素簇拆分；处理编码层字节时显式用 bytes 并注明用途。
3. 拼接文本优先 format!；用 + 时核对所有权：左操作数被消费、右操作数按引用借用。
4. 构建 HashMap：先 use 引入；collect 收集时标注 HashMap<_, _> 类型。
5. 按更新语义选策略：普通插入、仅缺失插入（entry + or_insert）、基于旧值更新（and_modify）、覆盖旧值。
6. 注意所有权流向：插入会移动键值；需要在插入后继续使用键时先 clone 或改存引用并管理其存活期。

## 交付物

- 文本处理实现（边界安全）
- 键值结构构建与更新代码
- 所有权与借用决策说明

## 检查、停止与回滚

- 没有任何按字节下标切多字节字符串的路径（或已证明该处必为 ASCII）
- 字符串 + 拼接后的所有权状态与后续使用一致，无编译错误残留
- HashMap 更新语义与需求一致（尤其 or_insert 与覆盖的区别）
- 插入后不再使用被移动的键值，或已显式 clone 并说明代价
- 停止条件：文本需要非 UTF-8 编码处理时暂停，说明超出本任务范围
- 停止条件：键值结构在并发下使用、需要跨线程共享时，转 coordinate-rust-threads
- 回滚：已定义。保留修改前实现；回滚即恢复原处理并重新复跑相关用例。

## 依据与边界

**来源规则**

- 在 Rust 字符串拼接中，`+` 运算符调用 `add` 函数，`add` 的 `s` 参数为 `&str`，因此只能将 `&str` 和 `String` 相加，不能将两个 `String` 值相加；`&String` 可通过解引用强制转换为 `&str`，所以 `s2` 在操作后仍然有效。`add` 获取 `self` 的所有权（因为 `self` 没有 `&`），导致 `s1` 的所有权被移动到 `add` 调用中，相加后不再有效。
- 对于更复杂的字符串连接，可以使用 `format!` 宏；`format!` 与 `println!` 的工作原理相同，但不同于将输出打印到屏幕上，它返回一个带有结果内容的 `String`，并且不会获取任何参数的所有权。
- 在 Rust 中，使用索引语法访问 String 的一部分会导致编译错误；Rust 的字符串不支持索引。
- Rust 拒绝编译对字符串进行字节索引的代码（如 `&"hello"[0]`）。
- Rust 不允许使用索引获取 `String` 字符
- 在 Rust 中对字符串使用字节范围索引时，如果索引没有落在 UTF-8 字符边界上，程序会在运行时 panic，可能导致程序崩溃。
- 当你需要操作单独的 Unicode 标量值时——建议：使用 `chars` 方法遍历字符串以访问每个 Unicode 标量值。
- 当你需要从字符串中获取字形簇时——建议：使用 crates.io 上提供字形簇功能的 crate。
- 在 Rust 程序中，开发者必须更多思考如何预先处理 UTF-8 数据，因为 Rust 将准确处理 String 数据作为默认行为。
- 在 Rust 中使用 `HashMap` 前，必须先用 `use std::collections::HashMap;` 显式导入。
- 使用 `collect` 构建 `HashMap` 时，必须显式标注 `HashMap<_, _>` 类型。
- 对于像 String 这样拥有所有权的值，插入哈希 map 时其值会被移动，哈希 map 会成为这些值的所有者；插入后原绑定不再有效，尝试使用它们会出现编译错误。
- 如果将值的引用插入哈希 map，值本身不会被移动进哈希 map；但这些引用指向的值必须至少与哈希 map 一样长久有效。
- 改变哈希 map 中的数据时，必须决定如何处理一个键已经有值了的情况。
- 对哈希 map 的同一个键再次插入不同的值时，该键关联的旧值将被替换，哈希 map 只保留一个键值对。
- `Entry` 的 `or_insert` 方法在键对应的值存在时返回该值的可变引用；在键对应的值不存在时插入参数作为新值并返回新值的可变引用。

**来源陷阱**

- 把其他语言中用索引获取字符串字符的习惯直接搬到 Rust，写 `s1[0]` 访问 `String` 的单个字符。
  - 后果：`String` 不支持索引，代码无法编译；即使允许字节索引，返回的字节值也不一定对应有效 Unicode 标量值，也无法保证 O(1) 访问。
  - 纠正：根据需要显式选择：`chars()` 遍历 Unicode 标量值，`bytes()` 遍历字节；若确需切片，使用落在字符边界上的 range。
- 在值被移动（赋值给其他变量、插入哈希 map、发送到通道、移入拥有所有权的数据结构）之后，继续访问或使用原始绑定。
  - 后果：编译器会以 `use of moved value`（E0382）拒绝代码，防止潜在的双重释放、无效变量以及并发线程对已发送值的后续修改或丢弃导致的数据不一致。
  - 纠正：移动后不再使用原绑定；如果多个位置需要共享同一数据，在单线程场景改用 `Rc<T>` 的引用计数共享，并用 `Rc::clone` 增加计数，而不是将所有权移入单一所有者。
- 把拥有所有权的值（如 `String`）作为键或值插入 `HashMap` 后，还继续使用原来的变量绑定。
  - 后果：原变量已被移动到哈希 map，继续使用会导致编译错误。
  - 纠正：如果插入后仍需要原值，可以插入克隆；或者插入引用，并确保引用的值在哈希 map 有效期间保持有效。
- 使用 `collect` 从元组迭代器构建 `HashMap` 时省略目标类型标注。
  - 后果：`collect` 可以收集成多种集合，编译器无法推断出 `HashMap`，导致编译错误。
  - 纠正：显式给出 `HashMap<_, _>` 类型标注；键和值的具体类型可用下划线占位，由迭代器推断。

**适用边界**

- 不覆盖正则表达式等文本解析库的用法
- 不覆盖并发容器与锁
- 不覆盖 &str 基础语义的系统教学（见 diagnose-rust-borrows 的切片部分）

**出处**

- `sources/rust-book-cn/book/ch08-02-strings.md` · 使用字符串存储 UTF-8 编码的文本（第 1–6 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 什么是字符串？（第 7–14 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 新建字符串（第 15–69 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 更新字符串（第 70–73 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 使用 `push_str` 和 `push` 附加字符串（第 74–108 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 使用 `+` 运算符或 `format!` 宏拼接字符串（第 109–156 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 索引字符串（第 157–181 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 内部表现（第 182–204 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 字节、标量值和字形簇！天呐！（第 205–230 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 字符串 slice（第 231–250 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 遍历字符串的方法（第 251–295 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 字符串并不简单（第 296–301 行）
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
