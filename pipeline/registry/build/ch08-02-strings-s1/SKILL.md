---
name: ch08-02-strings-s1
description: Rust String 处理：在 Rust 字符串拼接中，`+` 运算符调用 `add` 函数，`add` 的 `s` 参数为 `&str`，因此只能将 `&str` 和 `String` 相加，不能将两个 `String` 值相加；`&String` 可通过解引用强制转换为 `&str`，所以 `s2` 在操作后仍然有效。`add` 获取 `self` 的所有权（因为 `self` 没有 `&`），导致 `s1` 的所有权被移动到 `add` 调用中，相加后不再有效；适用于当使用 `+` 运算符连接 `String` 值，或需要理解第一个字符串为何在相加后失效、第二个字符串为何仍有效时、当需要连接多个字符串，且 `+` 运算符组合显得笨重时、当尝试对 String 使用索引语法（例如 s1[0]）时。
---

# Rust String 处理

## 何时使用

- 当使用 `+` 运算符连接 `String` 值，或需要理解第一个字符串为何在相加后失效、第二个字符串为何仍有效时。
- 当需要连接多个字符串，且 `+` 运算符组合显得笨重时。
- 当尝试对 String 使用索引语法（例如 s1[0]）时。
- 尝试对字符串使用索引访问以取得字符时。
- 当程序想通过索引访问 `String` 中的字符时
- 当使用 `[]` 和 range 获取字符串 slice，且范围边界可能不在字符边界上时。
- 处理 Rust 程序中的 String 数据时。
- 当你需要操作单独的 Unicode 标量值时
- 当你需要从字符串中获取字形簇时

## 核心原则

**在 Rust 字符串拼接中，`+` 运算符调用 `add` 函数，`add` 的 `s` 参数为 `&str`，因此只能将 `&str` 和 `String` 相加，不能将两个 `String` 值相加；`&String` 可通过解引用强制转换为 `&str`，所以 `s2` 在操作后仍然有效。`add` 获取 `self` 的所有权（因为 `self` 没有 `&`），导致 `s1` 的所有权被移动到 `add` 调用中，相加后不再有效。**

`add` 没有获取 `s2` 的所有权；该语句实际上获取 `s1` 的所有权、附加上从 `s2` 中拷贝的内容并返回结果所有权，这个实现比拷贝更高效。

**对于更复杂的字符串连接，可以使用 `format!` 宏；`format!` 与 `println!` 的工作原理相同，但不同于将输出打印到屏幕上，它返回一个带有结果内容的 `String`，并且不会获取任何参数的所有权。**

在有多个 `+` 和 `"` 字符的情况下，很难理解具体发生了什么；`format!` 版本更好理解。

**在 Rust 中，使用索引语法访问 String 的一部分会导致编译错误；Rust 的字符串不支持索引。**

String 类型未实现 std::ops::Index<{integer}> trait，因此不能被整数索引。

**Rust 拒绝编译对字符串进行字节索引的代码（如 `&"hello"[0]`）。**

按字节索引会返回字节值而非用户期望的字符（如返回 104 而不是 h），为避免这种意外值导致难以立刻发现的 bug，Rust 在开发期直接禁止。

**Rust 不允许使用索引获取 `String` 字符**

索引操作预期总是需要常数时间 (O(1))，但 `String` 无法保证这样的性能，因为 Rust 必须从开头到索引位置遍历来确定有多少有效的字符。

**在 Rust 中对字符串使用字节范围索引时，如果索引没有落在 UTF-8 字符边界上，程序会在运行时 panic，可能导致程序崩溃。**

Rust 的错误信息为 'byte index 1 is not a char boundary; it is inside 'З' (bytes 0..2)'，表明范围索引落在字符内部时会被拒绝。

**在 Rust 程序中，开发者必须更多思考如何预先处理 UTF-8 数据，因为 Rust 将准确处理 String 数据作为默认行为。**

这种权衡相比其他语言更多地暴露了字符串的复杂性，但使开发者在开发生命周期后期免于处理涉及非 ASCII 字符的错误。

## 实践模式

**String 集合操作**

String 中任何集合类型都有的操作，如创建、更新和读取。

- 创建
- 更新
- 读取

**Rust 字符串类型**

Rust 核心语言只有 `str` 字符串 slice，通常以借用形式 `&str` 出现；`String` 由标准库提供，是可增长、可变、有所有权、UTF-8 编码的字符串类型。Rustacean 所说“字符串”通常同时指 `String` 和 `&str`，两者都是 UTF-8 编码。

- 字符串字面量被储存在程序的二进制输出中，字符串 slice 也是如此

**String/Str 结尾命名惯例**

Rust 标准库中其他字符串类型通过以 `String` 或 `Str` 结尾来对应所有权和可借用的字符串变体；例如 `OsString` 与 `OsStr`、`CString` 与 `CStr`。这些类型能够以不同编码或内存表现形式存储文本。

- `OsString` 与 `OsStr` 对应所有权和可借用变体
- `CString` 与 `CStr` 对应所有权和可借用变体

**to_string 方法**

`to_string` 方法可用于任何实现了 `Display` trait 的类型，字符串字面量也实现了它，因此可以从这些类型创建 `String`。

- let data = "initial contents";
- let s = "initial contents".to_string();

**String::from 与 to_string 的等价性**

使用 `String::from` 函数从字符串字面量创建 `String` 与使用 `to_string` 最终做到完全相同的事情，因此如何选择是风格问题。

- let s = String::from("initial contents");

**更新字符串**

String 的大小可以增加，其内容也可以改变，并且可以使用 `+` 运算符或 `format!` 宏来拼接 String 值。

- 使用 `+` 运算符拼接 `String` 值
- 使用 `format!` 宏拼接 `String` 值

**push_str 方法**

Rust 中用于向 `String` 附加字符串 slice 的方法，它使 `String` 变长且不获取参数的所有权。

- `let mut s = String::from("foo"); s.push_str("bar");` 执行后 `s` 为 `foobar`。

**push 方法**

Rust 中用于向 `String` 附加单个字符的方法，它接受一个单独的字符作为参数。

- `let mut s = String::from("lo"); s.push('l');` 执行后 `s` 为 `lol`。

**String**

String 是对 Vec<u8> 的封装；len 返回字符串使用 UTF-8 编码所需的字节数。

- String::from("Hola").len() 返回 4，因为每个字母的 UTF-8 编码占用 1 个字节。
- String::from("Здравствуйте").len() 返回 24，因为每个 Unicode 标量值需要 2 个字节存储。

**字形簇**

从字形簇的角度理解字符串时，得到的是人们所说的构成单词的字母。

- न, म, स्, ते

**字符串 slice**

使用 `[]` 和一个 range 创建的 `&str`，按字节范围切分字符串；例如 `&hello[0..4]` 得到包含头 4 个字节的 `&str`，因示例字符串中的字母每个 2 个字节，前 4 个字节内容为 'Зд'。

- let s = &hello[0..4]; 当 hello 为 "Здравствуйте" 时，s 是 "Зд"

## 常见陷阱

- **把其他语言中用索引获取字符串字符的习惯直接搬到 Rust，写 `s1[0]` 访问 `String` 的单个字符。**
  - 后果：`String` 不支持索引，代码无法编译；即使允许字节索引，返回的字节值也不一定对应有效 Unicode 标量值，也无法保证 O(1) 访问。
  - 纠正：根据需要显式选择：`chars()` 遍历 Unicode 标量值，`bytes()` 遍历字节；若确需切片，使用落在字符边界上的 range。

## 配套代码

> 本段无来源：信息源未提供目录化的配套代码（`sources/<源键>/code/` 无可消费目录）。按**源条件骨架**（ADR-029），本段以来源说明代替空段——请勿读成「源里有代码但没写」。

## 深度阅读

- `sources/rust-book-cn/book/ch08-02-strings.md` · 使用字符串存储 UTF-8 编码的文本（第 1–6 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 什么是字符串？（第 7–14 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 新建字符串（第 15–69 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 更新字符串（第 70–73 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 使用 `push_str` 和 `push` 附加字符串（第 74–108 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 使用 `+` 运算符或 `format!` 宏拼接字符串（第 109–156 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 索引字符串（第 157–181 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 内部表现（第 182–204 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 字符串 slice（第 231–250 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 字节、标量值和字形簇！天呐！（第 205–230 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 遍历字符串的方法（第 251–295 行）
- `sources/rust-book-cn/book/ch08-02-strings.md` · 字符串并不简单（第 296–301 行）
