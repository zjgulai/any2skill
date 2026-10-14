---
name: ch10-02-traits-s1
description: trait 共享行为与约束：在 trait 中声明方法签名时，方法签名后跟分号，而不是在大括号中提供其实现；适用于在 trait 中声明方法签名时、当 trait 与要实现该 trait 的类型均定义于当前 crate 本地作用域之外时、调用参数使用 `impl` 关键字和 trait 名称的函数，并传入未实现该 trait 的类型时。
---

# trait 共享行为与约束

## 何时使用

- 在 trait 中声明方法签名时。
- 当 trait 与要实现该 trait 的类型均定义于当前 crate 本地作用域之外时。
- 调用参数使用 `impl` 关键字和 trait 名称的函数，并传入未实现该 trait 的类型时。
- 函数有多个参数，且要求它们的具体类型一致时。
- 函数参数或泛型参数需要同时满足多个 trait 约束时。
- 函数返回值类型指定为返回 `impl Summary`，并尝试返回 `NewsArticle` 或 `Tweet` 时。
- 当只希望对实现了 `Copy` 的类型调用这些代码，并需要可编译的泛型 `largest` 函数时。
- 当泛型函数体中使用 `>` 比较两个 `T` 类型的值时。
- 当值没有实现 trait 对象所需的 trait 时。
- 判断一个 trait 是否能够组成 trait 对象时。
- 当组件集合只需要同质（相同类型）集合时

## 核心原则

**在 trait 中声明方法签名时，方法签名后跟分号，而不是在大括号中提供其实现。**

trait 声明实现该 trait 的类型所需的行为；每个实现该 trait 的类型都要提供自定义方法体，编译器会确保签名与定义完全一致。

**不能为外部类型实现外部 trait。**

该限制是相干性/孤儿规则的一部分，确保其他人编写的代码不会破坏你的代码，反之亦然；没有该规则，两个 crate 可能对相同类型实现相同 trait，Rust 将无从得知应使用哪个实现。

**函数参数使用 `impl` 关键字和 trait 名称（如 `impl Summary`）时，传入未实现该 trait 的类型（如 `String` 或 `i32`）调用该函数，代码不能编译。**

这些类型没有实现 `Summary` trait，而函数参数要求 `impl Summary`。

**当函数需要强制两个参数为相同类型时，只有使用 trait bound 语法才有可能。**

`impl Trait` 语法允许两个参数分别是不同类型；trait bound 通过同一个泛型 `T` 约束两个参数，使传给它们的具体类型必须一致。

**在 Rust 中，当函数需要参数同时满足多个 trait 时，可以用 `+` 将多个 trait bound 连接起来：参数位置可写作 `impl Summary + Display`，泛型参数位置可写作 `T: Summary + Display`。**

通过 `+` 组合多个 trait bound 后，函数体可以同时使用这些 trait 提供的能力，例如调用 `summarize` 并用 `{}` 格式化 `item`。

**使用 `impl Summary` 作为返回值类型只适用于返回单一类型；如果返回 `NewsArticle` 或 `Tweet` 就行不通。**

因为这种用法只适用于返回单一类型的情况。

**在 Rust 中，示例 10-15 的泛型 `largest` 函数要编译，需要传递给 `largest` 的 slice 值类型同时实现 `PartialOrd` 和 `Copy` 两个 trait。**

为了只对实现了 `Copy` 的类型调用这些代码，需要在 `T` 的 trait bounds 中增加 `Copy`；示例 10-15 的完整代码在类型实现 `PartialOrd` 和 `Copy` 时可以编译。

**在 Rust 泛型函数中，如果使用大于运算符 `>` 比较两个 `T` 类型的值，需要在 `T` 的 trait bound 中指定 `PartialOrd`。**

`>` 运算符被定义为标准库 trait `std::cmp::PartialOrd` 的一个默认方法。

**如果值没有实现 trait 对象所需的 trait，Rust 不会编译这些代码。**

使用 trait 对象和 Rust 类型系统来进行类似鸭子类型操作的优势是无需在运行时检查一个值是否实现了特定方法或者担心在调用时因为值没有实现方法而产生错误。

**只有对象安全的 trait 才可以组成 trait 对象；实践中判断对象安全只涉及两条规则：trait 中所有方法返回值类型不为 Self，且方法没有任何泛型类型参数。**

对象安全是组成 trait 对象的必要条件；实践规则只涉及返回值类型不为 Self 和没有泛型类型参数。

## 实践模式

**trait**

trait 告诉 Rust 编译器某个特定类型拥有可能与其他类型共享的功能。可以通过 trait 以一种抽象的方式定义共享的行为。

- 可以使用 trait bounds 指定泛型是任何拥有特定行为的类型

**trait 定义**

trait 定义是一种将方法签名组合起来的方法，目的是定义一个实现某些目的所必需的行为的集合。

- 如果可以对不同类型调用相同的方法，这些类型就可以共享相同的行为。

**空 impl 块采用 trait 默认实现**

对 NewsArticle 实例使用默认实现时，可以通过 `impl Summary for NewsArticle {}` 指定一个空的 `impl` 块。

- 对 NewsArticle 实例使用 Summary trait 的默认实现，通过 impl Summary for NewsArticle {} 指定空 impl 块

**默认实现调用其他方法**

默认实现允许调用相同 trait 中的其他方法，哪怕这些方法没有默认实现，从而 trait 可以提供很多有用的功能而只需要实现指定一小部分内容。

- 定义 Summary trait，使其具有需要实现的 summarize_author 方法，然后定义 summarize 方法的默认实现调用 summarize_author 方法

**impl Trait 参数**

在函数参数中使用 `impl` 关键字和 trait 名称而不是具体类型，使参数支持任何实现了该 trait 的类型，并允许函数体调用该 trait 的方法。

- 例如 `notify` 函数的参数 `item` 使用 `impl Summary` 语法，而不是具体类型。

**where 从句**

Rust 中在函数签名之后指定 trait bound 的语法，用于替代写在泛型参数上的内联 trait bound，使函数签名更易读。

- fn some_function<T, U>(t: T, u: U) -> i32 where T: Display + Clone, U: Clone + Debug

**返回实现了 trait 的类型**

通过使用 `impl Summary` 作为返回值类型，指定函数返回某个实现了 `Summary` trait 的类型，但不指定其具体类型。

- returns_summarizable 返回了一个 `Tweet`，不过调用方并不知情。

**使用 trait bound 有条件地实现方法**

使用带有 trait bound 的泛型参数的 impl 块，可以有条件地只为那些实现了特定 trait 的类型实现方法。

- 示例 10-16 中 Pair<T> 总是实现 new 方法，但只有为 T 实现 PartialOrd 和 Display 的 Pair<T> 才实现 cmp_display 方法。

**blanket implementations**

对任何满足特定 trait bound 的类型实现 trait。

- 标准库为任何实现了 Display trait 的类型实现了 ToString trait。

**用枚举使 vector 可存储不同类型元素**

在编译代码时已知希望交替使用的类型为固定集合的前提下，通过定义枚举（如 SpreadsheetCell）存储整型、浮点型和文本成员，可以让一个 vector 的每个单元保存不同类型的数据，同时整体仍是一个代表一排单元的 vector。

- 定义 SpreadsheetCell 枚举来储存整型、浮点型和文本成员，使每个单元可以储存不同类型的数据，并仍能拥有一个代表一排单元的 vector

**GUI 库对多类型值调用 draw 方法的需求**

当库用户需要扩展有效类型集合，且库作者无法预知并定义所有用户希望创建的自定义类型时，库需要记录一系列不同类型的值，并能对其中的每一个值调用 draw 方法；调用方无需知道调用 draw 方法时具体会发生什么，只要该值拥有 draw 方法即可。

- GUI 库包含 Button、TextField 等类型，用户可能增加 Image、SelectBox 等自定义可绘制类型，GUI 通过遍历列表并对每个项目调用 draw 方法进行绘制

**trait 对象**

trait 对象指向一个实现了指定 trait 的类型的实例，以及一个用于在运行时查找该类型的 trait 方法的表；通过指定某种指针（如 `&` 引用或 `Box<T>` 智能指针）和 `dyn` keyword 以及指定相关的 trait 来创建。

- 通过 `&` 引用创建 trait 对象
- 通过 `Box<T>` 智能指针创建 trait 对象

**鸭子类型**

只关心值所反映的信息而不是其具体类型；如果它走起来像一只鸭子，叫起来像一只鸭子，那么它就是一只鸭子。

- 在 `Screen` 上的 `run` 实现中，`run` 并不需要知道各个组件的具体类型是什么，也不检查组件是 `Button` 或者 `SelectBox` 的实例，而是通过 `Box<dyn Draw>` 定义 `Screen` 为需要可以在其上调用 `draw` 方法的值。

**静态分发**

单态化所产生的代码进行静态分发；静态分发发生于编译器在编译时就知晓调用了什么方法的时候。

- 对泛型使用 trait bound 时，编译器进行单态化处理，为每一个被泛型类型参数代替的具体类型生成非泛型的函数和方法实现。

**动态分发**

动态分发是编译器在编译时无法知晓调用了什么方法，并生成在运行时确定调用方法代码的分发方式。

- 当使用 trait 对象时，Rust 必须使用动态分发。

## 常见陷阱

- **在泛型函数体中直接使用需要特定 trait 支持的操作（如 `>` 比较），却不给类型参数添加相应的 trait bound。**
  - 后果：编译器会报错 `binary operation `>` cannot be applied to type `T``，函数无法编译，因为它不能保证所有 `T` 都能执行该操作。
  - 纠正：先明确函数体需要的 trait 行为，并为泛型参数添加对应 bound，例如 `fn largest<T: PartialOrd>(list: &[T]) -> T`；若需要移动值，再考虑 `Copy` 或返回引用。
- **函数声明返回 `impl Trait` 后，在内部根据条件返回两个不同的具体类型。**
  - 后果：`impl Trait` 只对应单一编译时类型，无法表达“既可能是 A 也可能是 B”，代码不能编译。
  - 纠正：若确实需要返回多种实现某 trait 的类型，使用 trait 对象，如 `fn returns_summarizable(switch: bool) -> Box<dyn Summary>`，并在分支中用 `Box::new(...)` 返回。
- **将不满足对象安全规则的 trait（例如返回 `Self` 的 `Clone`）用作 trait 对象，如 `Vec<Box<dyn Clone>>`。**
  - 后果：编译器报错 `the trait `std::clone::Clone` cannot be made into an object`，因为 trait 对象会抹去具体类型，无法处理方法返回 `Self` 或带泛型参数的方法。
  - 纠正：检查 trait 是否对象安全：所有方法的返回值类型不为 `Self` 且没有泛型类型参数；不满足时应改变设计，改用满足规则的自定义 trait。
- **直接为自己的 crate 外部的类型实现外部的 trait，例如为 `Vec<T>` 实现 `Display`。**
  - 后果：违反孤儿规则，代码不被允许；没有该规则会导致不同 crate 对同一类型实现同一 trait 造成冲突。
  - 纠正：使用 newtype 模式：创建本地 `Wrapper` 元组结构体封装外部类型，再为该本地类型实现外部 trait；若不希望暴露所有方法，可只实现需要的委托方法。

## 配套代码

> 本段无来源：信息源未提供目录化的配套代码（`sources/<源键>/code/` 无可消费目录）。按**源条件骨架**（ADR-029），本段以来源说明代替空段——请勿读成「源里有代码但没写」。

## 深度阅读

- `sources/rust-book-cn/book/ch10-02-traits.md` · trait：定义共享的行为（第 1–6 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 定义 trait（第 7–30 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 为类型实现 trait（第 31–93 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 默认实现（第 94–170 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 使用 trait bound 有条件地实现方法（第 370–428 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · trait 作为参数（第 171–184 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · Trait Bound 语法（第 185–210 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 通过 `+` 指定多个 trait bound（第 211–226 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 通过 `where` 简化 trait bound（第 227–245 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 返回实现了 trait 的类型（第 246–289 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 使用 trait bounds 来修复 `largest` 函数（第 290–369 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · 为使用不同类型的值而设计的 trait 对象（第 1–10 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · 定义通用行为的 trait（第 11–97 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · 实现 trait（第 98–221 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · trait 对象执行动态分发（第 222–227 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · Trait 对象要求对象安全（第 228–273 行）
- `sources/rust-book-cn/book/ch10-01-syntax.md` · 在函数定义中使用泛型（第 5–114 行）
- `sources/rust-book-cn/book/ch19-03-advanced-traits.md` · newtype 模式用于在外部类型上实现外部 trait（第 469–510 行）
