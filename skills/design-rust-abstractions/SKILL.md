---
name: design-rust-abstractions
description: 为 Rust 代码选择抽象方式：泛型与单态化、trait 契约与默认实现、孤儿规则、对象安全与 dyn 分发。适用于消除重复逻辑、定义插件/驱动接口、判断该用编译期约束还是运行期分发时。
---

# 用泛型、trait 与 trait object 设计抽象

## 何时使用

- 多段代码逻辑重复、需要泛型化时
- 定义跨实现共享的行为契约（trait）、需要写默认实现时
- 需要运行期多态（dyn）而编译器报对象安全错误时
- 为外部类型实现行为、触发孤儿规则报错时

## 输入与前置条件

- 需要抽象的重复逻辑或行为清单
- 实现该行为的类型集合（本地/外部）
- 是否需要在运行期存储异构实现（决定 dyn 需求）

## 执行步骤

1. 先判断抽象轴：参数化数据类型用泛型；描述共享行为用 trait；两者结合时在泛型上写 trait bound。
2. 写泛型时先声明参数再使用：函数与 impl 块的 <T> 声明位置正确；同名字段跨实例必须同型。
3. 设计 trait 契约：方法签名以分号结尾；需要共享实现时用默认方法；核对默认方法可被合理覆写。
4. 检查孤儿规则：只有本地 trait 或本地类型才可 impl；冲突时改用 newtype 包装。
5. 决定分发方式：编译期约束（impl Trait 或 trait bound）适合单类型特化；需要异构集合或插件表时用 dyn，并逐条核对对象安全规则（不限 Sized/不含泛型方法等）。
6. 核对单态化影响：泛型以代码膨胀换零运行时开销；dyn 以虚调用换体积，按场景说明取舍。

## 交付物

- 抽象设计（泛型参数、trait 定义、bound 布置）
- 分发方式决策（静态约束或 dyn）及理由
- 调用处签名更新清单

## 检查、停止与回滚

- 所有 impl 均满足孤儿规则（无外部类型×外部 trait）
- trait 需在运行期分发时通过对象安全规则，否则已改用静态约束并说明
- 泛型参数声明与使用位置无编译错误残留
- 默认实现的方法被覆写的场景有测试或使用证据
- 停止条件：抽象需要改动公开 API 或跨 crate 契约时暂停，评估兼容性
- 停止条件：对象安全规则不满足且无替代实现路径时，回到接口设计重新拆分
- 回滚：已定义。保留旧实现作为回退点；回滚即撤销抽象、恢复具体实现并复编译。

## 依据与边界

**来源规则**

- 在函数签名中使用类型参数时，必须在使用之前先声明该类型参数；类型参数声明位于函数名称与参数列表中间的尖括号 `<>` 中。
- 在结构体定义中，如果多个字段使用了同一个泛型类型参数，那么这些字段必须具有相同的具体类型。
- 为泛型 `Point<T>` 实现方法时，必须在 `impl` 之后声明泛型 `T`，这样 Rust 才会知道 `Point` 尖括号中的类型是泛型而不是具体类型。
- 结构体定义中的泛型类型参数并不总是与结构体方法签名中使用的泛型是同一类型；方法可以获取与调用它的 `self` 不同的 `Point` 类型作为参数。
- 使用 Rust 泛型在运行时没有运行时开销，执行效率与手写每个具体定义的重复代码一样。
- 在 trait 中声明方法签名时，方法签名后跟分号，而不是在大括号中提供其实现。
- 不能为外部类型实现外部 trait。
- 函数参数使用 `impl` 关键字和 trait 名称（如 `impl Summary`）时，传入未实现该 trait 的类型（如 `String` 或 `i32`）调用该函数，代码不能编译。
- 当函数需要强制两个参数为相同类型时，只有使用 trait bound 语法才有可能。
- 在 Rust 中，当函数需要参数同时满足多个 trait 时，可以用 `+` 将多个 trait bound 连接起来：参数位置可写作 `impl Summary + Display`，泛型参数位置可写作 `T: Summary + Display`。
- 使用 `impl Summary` 作为返回值类型只适用于返回单一类型；如果返回 `NewsArticle` 或 `Tweet` 就行不通。
- 在 Rust 中，示例 10-15 的泛型 `largest` 函数要编译，需要传递给 `largest` 的 slice 值类型同时实现 `PartialOrd` 和 `Copy` 两个 trait。
- 在 Rust 泛型函数中，如果使用大于运算符 `>` 比较两个 `T` 类型的值，需要在 `T` 的 trait bound 中指定 `PartialOrd`。
- 当组件集合只需要同质（相同类型）集合时——建议：使用泛型和 trait bound
- 如果值没有实现 trait 对象所需的 trait，Rust 不会编译这些代码。
- 只有对象安全的 trait 才可以组成 trait 对象；实践中判断对象安全只涉及两条规则：trait 中所有方法返回值类型不为 Self，且方法没有任何泛型类型参数。

**来源陷阱**

- 在泛型函数体中直接使用需要特定 trait 支持的操作（如 `>` 比较），却不给类型参数添加相应的 trait bound。
  - 后果：编译器会报错 `binary operation `>` cannot be applied to type `T``，函数无法编译，因为它不能保证所有 `T` 都能执行该操作。
  - 纠正：先明确函数体需要的 trait 行为，并为泛型参数添加对应 bound，例如 `fn largest<T: PartialOrd>(list: &[T]) -> T`；若需要移动值，再考虑 `Copy` 或返回引用。
- 用单个泛型参数 `T` 定义结构体，却希望各字段能接受不同的具体类型。
  - 后果：实例化时所有字段都被绑定为同一个 `T`，传入不同类型会导致类型不匹配错误，无法表达两个字段独立类型。
  - 纠正：如果字段可以不同类型，应使用多个泛型参数，如 `struct Point<T, U> { x: T, y: U }`。
- 函数声明返回 `impl Trait` 后，在内部根据条件返回两个不同的具体类型。
  - 后果：`impl Trait` 只对应单一编译时类型，无法表达“既可能是 A 也可能是 B”，代码不能编译。
  - 纠正：若确实需要返回多种实现某 trait 的类型，使用 trait 对象，如 `fn returns_summarizable(switch: bool) -> Box<dyn Summary>`，并在分支中用 `Box::new(...)` 返回。
- 将不满足对象安全规则的 trait（例如返回 `Self` 的 `Clone`）用作 trait 对象，如 `Vec<Box<dyn Clone>>`。
  - 后果：编译器报错 `the trait `std::clone::Clone` cannot be made into an object`，因为 trait 对象会抹去具体类型，无法处理方法返回 `Self` 或带泛型参数的方法。
  - 纠正：检查 trait 是否对象安全：所有方法的返回值类型不为 `Self` 且没有泛型类型参数；不满足时应改变设计，改用满足规则的自定义 trait。
- 直接为自己的 crate 外部的类型实现外部的 trait，例如为 `Vec<T>` 实现 `Display`。
  - 后果：违反孤儿规则，代码不被允许；没有该规则会导致不同 crate 对同一类型实现同一 trait 造成冲突。
  - 纠正：使用 newtype 模式：创建本地 `Wrapper` 元组结构体封装外部类型，再为该本地类型实现外部 trait；若不希望暴露所有方法，可只实现需要的委托方法。

**适用边界**

- 不覆盖宏与派生机制的实现（derive 的内建行为按语言文档）
- 不覆盖高阶生命周期与 GAT 等进阶 trait 用法
- 不覆盖 trait object 的安全设计（见 secure-agent-actions 与 coordinate-rust-threads 的并发约束）

**出处**

- `sources/rust-book-cn/book/ch10-01-syntax.md` · 在函数定义中使用泛型（第 5–114 行）
- `sources/rust-book-cn/book/ch10-01-syntax.md` · 结构体定义中的泛型（第 115–188 行）
- `sources/rust-book-cn/book/ch10-01-syntax.md` · 枚举定义中的泛型（第 189–214 行）
- `sources/rust-book-cn/book/ch10-01-syntax.md` · 方法定义中的泛型（第 215–299 行）
- `sources/rust-book-cn/book/ch10-01-syntax.md` · 泛型代码的性能（第 300–341 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · trait：定义共享的行为（第 1–6 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 定义 trait（第 7–30 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 为类型实现 trait（第 31–93 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 默认实现（第 94–170 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · trait 作为参数（第 171–184 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · Trait Bound 语法（第 185–210 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 通过 `+` 指定多个 trait bound（第 211–226 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 通过 `where` 简化 trait bound（第 227–245 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 返回实现了 trait 的类型（第 246–289 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 使用 trait bounds 来修复 `largest` 函数（第 290–369 行）
- `sources/rust-book-cn/book/ch10-02-traits.md` · 使用 trait bound 有条件地实现方法（第 370–428 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · 为使用不同类型的值而设计的 trait 对象（第 1–10 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · 定义通用行为的 trait（第 11–97 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · 实现 trait（第 98–221 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · trait 对象执行动态分发（第 222–227 行）
- `sources/rust-book-cn/book/ch17-02-trait-objects.md` · Trait 对象要求对象安全（第 228–273 行）
- `sources/rust-book-cn/book/ch19-03-advanced-traits.md` · newtype 模式用于在外部类型上实现外部 trait（第 469–510 行）
