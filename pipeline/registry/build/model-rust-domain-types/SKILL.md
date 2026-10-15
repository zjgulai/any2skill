---
name: model-rust-domain-types
description: 用 Rust 类型系统建模领域数据与行为：结构体定义与更新语法、方法与关联函数、枚举携带数据、用 Option 消除空值。适用于设计配置/实体/状态类型、为类型组织 impl、以及把散落函数收拢为方法时。
---

# 用结构体、方法与枚举建模 Rust 领域类型

## 何时使用

- 把领域概念落成 struct/enum 定义时
- 为类型添加方法、构造器或关联函数时
- 用更新语法复制并修改实例、需要判断所有权影响时
- 用 Option 或枚举携带数据替代哨兵值/空指针式设计时

## 输入与前置条件

- 领域概念清单与它们之间的互斥/组合关系
- 每个类型的数据字段、所有权与是否需要 Copy
- 类型需要承载的行为（方法）清单

## 执行步骤

1. 为每个概念分类：数据组合用结构体；多个互斥变体用枚举；可空的单值用 Option。
2. 定义结构体字段与所有权：字符串用 String、借用用引用（引用字段需要生命周期参数）；决定哪些字段随更新语法被移动。
3. 使用结构体更新语法时把展开操作放到最后，并确认被展开的源实例是否仍可用（Move 语义）。
4. 为类型组织 impl：实例行为用方法（首个参数 &self/&mut self），构造与工厂用关联函数（::）。
5. 用 &self 借结构体参数以保留调用方所有权；只在需要修改或消费时用 &mut self/self。
6. 枚举携带数据时优先直接承载信息；需要表示「有或没有」时用 Option 而非哨兵值。

## 交付物

- 类型定义（字段、变体、所有权标注）
- impl 块（方法、关联函数、构造器）
- 字段所有权决策说明

## 检查、停止与回滚

- 更新语法后被展开的源实例不再被使用时，move 语义已核对
- 引用作为结构体字段时生命周期参数完整
- 互斥状态用枚举表达，没有用多个布尔组合模拟
- 空值语义由 Option 承担，没有哨兵值残留
- 停止条件：类型设计需要跨模块可见性调整（pub 层级变更）时，暂停并确认模块边界
- 停止条件：领域概念之间边界不清、无法归类结构体或枚举时，回到概念梳理而不是先写代码
- 回滚：已定义。保留类型定义旧版本；回滚即恢复旧定义并全量复编调用方。

## 依据与边界

**来源规则**

- 在 Rust 结构体更新语法中，`..user1` 必须放在最后，以指定其余字段应从 `user1` 的相应字段中获取其值。
- 在结构体更新语法中，如果 `user1` 的 `username` 字段中的 `String` 被移到 `user2` 中，创建 `user2` 后不能再使用 `user1`；如果给 `user2` 的 `email` 和 `username` 都赋予新的 `String` 值，从而只使用 `user1` 的 `active` 和 `sign_in_count` 值，那么 `user1` 在创建 `user2` 后仍然有效，因为这些字段是实现 `Copy` trait 的类型。
- 你定义的每一个结构体有其自己的类型，即使结构体中的字段有着相同的类型。
- 在结构体中存储被其他对象拥有的数据的引用时，需要使用生命周期；如果不指定生命周期，这样的存储引用写法无效。
- 当函数需要接收多个彼此相关联的参数时，应把它们组合在一起，使函数签名体现这种关联，从而更易懂、更易处理。
- 当函数接收结构体参数，且调用方需要在调用后继续使用该结构体时，应传入不可变借用而不是获取其所有权。
- 当结构体较大，需要更易读的调试输出时——建议：使用 `{:#?}` 替换 `println!` 字符串中的 `{:?}`
- 方法第一个参数总是 `self`，它代表调用该方法的结构体实例。
- 在 impl 块中定义方法时，方法的第一个参数必须有一个名为 self 的 Self 类型参数。
- Rust 没有与 `->` 运算符等效的运算符，而是使用自动引用和解引用功能。
- 关联函数使用结构体名和 `::` 语法来调用。
- 对 `Option<T>` 进行 `T` 的运算之前，必须先将其转换为 `T`。
- 只要一个值不是 `Option<T>` 类型，就可以安全地认定它的值不为空。

**来源陷阱**

- 在函数中为参数起与结构体字段相同的名字，却重复字段名称与变量。
  - 后果：重复字段名与变量使代码啰嗦，字段更多时更加烦人。
  - 纠正：使用 Rust 提供的字段简写语法来避免重复。
- 用元组索引表示宽高这类有业务含义的值，却不在代码中表达数据意义
  - 后果：使用者必须牢记 `width` 的元组索引是 `0`、`height` 的元组索引是 `1`；数据意义没有被表达，容易忘记或混淆宽高而造成错误
  - 纠正：让代码表达数据意义，避免只靠元组索引区分宽高
- 在自定义结构体中直接使用 `&str` 等引用类型作字段，却不给结构体声明生命周期参数。
  - 后果：编译器因缺少生命周期标识符而报错，代码无法编译；引用的数据有效性也无法与结构体保持一致。
  - 纠正：在结构体上引入生命周期参数（如 `struct User<'a> { ... &'a str ... }`），或者直接使用拥有所有权的类型（如 `String`）存储数据。
- 用元组或互相分离的变量表示本质上相互关联的数据，而不给出字段名称。
  - 后果：代码没有表达数据意义，使用者必须记住索引与值的对应关系，容易混淆或忘记，从而产生错误。
  - 纠正：定义结构体，为整体和每个字段提供有意义的名称，让函数签名直接表达数据间关联。
- 直接用 {} 打印自定义结构体，或期望通过 derive 获得 Display 实现。
  - 后果：编译失败；Rust 不会猜测结构体的显示格式，也不会为 Display 提供可派生的默认实现。
  - 纠正：调试时派生 Debug 并使用 {:?} 或 dbg!；给终端用户输出时手动实现 Display，并考虑用户需要看到哪些部分。
- 把 `Option<T>` 当作普通的 `T` 使用，或假设它一定有值，不处理 `None` 分支。
  - 后果：可能把空值当成有效值进行运算，造成空值错误；Rust 会因 `Option<T>` 与 `T` 类型不同而拒绝直接运算，迫使显式处理缺失情况。
  - 纠正：先用 `match` 等结构显式处理 `Some(T)` 和 `None`，取出 `T` 后再进行普通运算。

**适用边界**

- 不覆盖 trait 抽象与泛型设计（见 design-rust-abstractions）
- 不覆盖模式匹配的穷举与位置规则（见 match-rust-variants）
- 不覆盖智能指针与共享所有权（见 manage-rust-memory-and-mutability）

**出处**

- `sources/rust-book-cn/book/ch05-01-defining-structs.md` · 定义并实例化结构体（第 1–40 行）
- `sources/rust-book-cn/book/ch05-01-defining-structs.md` · 变量与字段同名时的字段初始化简写语法（第 41–52 行）
- `sources/rust-book-cn/book/ch05-01-defining-structs.md` · 使用结构体更新语法从其他实例创建实例（第 53–76 行）
- `sources/rust-book-cn/book/ch05-01-defining-structs.md` · 使用没有命名字段的元组结构体来创建不同的类型（第 77–88 行）
- `sources/rust-book-cn/book/ch05-01-defining-structs.md` · 没有任何字段的类单元结构体（第 89–175 行）
- `sources/rust-book-cn/book/ch05-02-example-structs.md` · 一个使用结构体的示例程序（第 1–30 行）
- `sources/rust-book-cn/book/ch05-02-example-structs.md` · 使用元组重构（第 31–46 行）
- `sources/rust-book-cn/book/ch05-02-example-structs.md` · 使用结构体重构：赋予更多意义（第 47–64 行）
- `sources/rust-book-cn/book/ch05-02-example-structs.md` · 通过派生 trait 增加实用功能（第 65–155 行）
- `sources/rust-book-cn/book/ch05-03-method-syntax.md` · 方法语法（第 1–4 行）
- `sources/rust-book-cn/book/ch05-03-method-syntax.md` · 定义方法（第 5–68 行）
- `sources/rust-book-cn/book/ch05-03-method-syntax.md` · 带有更多参数的方法（第 69–99 行）
- `sources/rust-book-cn/book/ch05-03-method-syntax.md` · 关联函数（第 100–113 行）
- `sources/rust-book-cn/book/ch05-03-method-syntax.md` · 多个 `impl` 块（第 114–125 行）
- `sources/rust-book-cn/book/ch06-01-defining-an-enum.md` · 定义枚举（第 1–17 行）
- `sources/rust-book-cn/book/ch06-01-defining-an-enum.md` · 枚举值（第 18–193 行）
- `sources/rust-book-cn/book/ch06-01-defining-an-enum.md` · `Option` 枚举和其相对于空值的优势（第 194–266 行）
- `sources/rust-book-cn/book/appendix-03-derivable-traits.md` · 附录 C：可派生的 trait（第 1–20 行）
- `sources/rust-book-cn/book/ch06-02-match.md` · 匹配是穷尽的（第 91–106 行）
