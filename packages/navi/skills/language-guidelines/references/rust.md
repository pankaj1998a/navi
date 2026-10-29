# Rust Style Guide

> Source: Google Rust Style Guide (https://google.github.io/styleguide/rustguide.html), Rust Style Guide (https://github.com/rust-lang/rust/tree/master/src/doc/style-guide/src), and Rust API Guidelines (https://rust-lang.github.io/api-guidelines/)

## Quick Rules

- Format with `rustfmt` and never hand-tune whitespace; maximum line width is 100 characters.
- Indent with 4 spaces, never tabs.
- Types and traits: `UpperCamelCase`. Functions, methods, modules, fields, locals, macros: `snake_case`. Constants and immutable statics: `SCREAMING_SNAKE_CASE`.
- **No glob imports**: Never use `use foo::*`. Always import specific items explicitly.
- **Top-level functions**: Qualify calls to top-level functions with their module name (`module::function()`) rather than importing the function directly, so readers know where it originates.
- **Types**: Import type names and use them unqualified (`use path::to::MyType;` -> `let x: MyType;`).
- **Prefer Enum over Bool**: Avoid boolean flags in public APIs; use descriptive enums to avoid boolean blindness.
- **Error reporting**: Prefer `Result<T, E>` and `Option<T>` over panicking or sentinel values. Use `?` to propagate errors.
- **`expect()` over `unwrap()`**: In tests or when documenting provable invariants, prefer `expect("descriptive context")` over bare `unwrap()`.
- **Newtypes over type aliases**: Use newtypes (`struct UserId(u64);`) to enforce domain invariants and type safety.
- **Attributes**: Apply `#[must_use]` on types and functions whose return values must not be ignored. Apply `#[non_exhaustive]` on public enums and structs that may grow.
- **Unsafe code**: Every `unsafe` block MUST have a `// SAFETY:` comment explicitly stating the invariants and preconditions that ensure soundness.

## Formatting

- Indent: 4 spaces per level, block indent. Maximum line width: 100 characters (rustfmt standard).
- Function signature: `[pub] [unsafe] [extern ["ABI"]] fn foo(arg1: i32, arg2: i32) -> i32 {`.
- If a signature exceeds line width, break after the opening parenthesis, one argument per line, block indented, with a trailing comma.
- Struct fields and enum variants: one per line, block indented, with a trailing comma.
- `where` clauses: each predicate on its own line, block indented, with a trailing comma.
- Expressions over statements: `let x = if cond { 1 } else { 0 };` rather than an uninitialized `let`.
- Blocks in statement position always have newlines after `{` and before `}`.
- Import order: standard library (`std`, `core`, `alloc`), then external crates, then local workspace modules (`crate::`), grouped and separated by a blank line.

## Naming

- Types and traits: `UpperCamelCase` (`OrderRepository`, `HttpClient`). Acronyms are one word: `Uuid`, `Http`, not `UUID`, `HTTP`.
- Functions, methods, fields, locals, modules, macros: `snake_case` (`find_by_id`, `order_total`).
- Constants: `SCREAMING_SNAKE_CASE` (`MAX_RETRIES`).
- Type parameters: short `UpperCamelCase` (`T`, `K`, `V`). Lifetimes: short lowercase (`'a`, `'de`).
- Constructors: `new()` or `new_with_details()`. Conversion constructors: `from_other_type()`.
- Conversions: `as_` for cheap borrowed-to-borrowed, `to_` for expensive conversions, `into_` for consuming conversions.
- Getters: do not use a `get_` prefix: `fn first(&self) -> &First`, mutator `fn first_mut(&mut self) -> &mut First`.
- Error types: suffix with `Error` (`ParseError`).
- Test functions: describe the behavior under test: `fn missing_order_returns_error()`.

## Types and Data

- Prefer borrowing (`&T`) to ownership; take `&str` rather than `String` and `&[T]` rather than `&Vec<T>` for parameters.
- Avoid `Rc` and `Arc` unless shared ownership across threads or graphs is strictly necessary.
- Prefer named fields over tuple structs with multiple fields.
- Pair important `From` implementations with explicit constructor methods.
- Options structs should implement `Default`.
- Make invalid states unrepresentable with newtypes and enum states.
- Derive standard traits (`Clone`, `Debug`, `PartialEq`, `Eq`, `Hash`, `Default`) wherever possible.

## Comments and Documentation

- Public items get a `///` doc comment with a one-line summary ending in a period.
- Explain the **why**, not the **what**. Code explains what; comments explain invariants, guarantees, and rationale.
- Every `unsafe` block MUST have a `// SAFETY:` comment explaining why the operation is sound.
- Include executable doctests in public API documentation.
- `TODO` markers follow Google format: `// TODO(username): description`.

## Error Handling

- Return `Result<T, E>` from any fallible function. Never panic in library code.
- Implement `std::error::Error` for custom errors (e.g. via `thiserror`).
- Use `?` operator for clean propagation. Add contextual error messages (e.g. via `anyhow::Context`).
- Never use `panic::catch_unwind` as an alternative to structured error handling.

## Anti-Patterns

- Glob imports (`use foo::*`). Instead: explicit named imports.
- Calling bare `unwrap()`. Instead: use `?` or `expect("reason why invariant holds")`.
- Boolean parameters (`fn set_active(&mut self, active: bool)`). Instead: use descriptive enums.
- Ignoring errors with `let _ = fallible_op()`. Instead: handle or log errors explicitly.
- Unsafe code without a `// SAFETY:` explanation.
- Using complex iterator chains when an imperative loop is significantly clearer and easier to debug.

## Code Example

```rust
use std::collections::HashMap;
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountStatus {
    Active,
    Suspended,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    id: u64,
    name: String,
    status: AccountStatus,
}

#[derive(Debug)]
pub enum AccountError {
    NotFound(u64),
    InvalidStatus,
}

impl fmt::Display for AccountError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound(id) => write!(f, "account {id} not found"),
            Self::InvalidStatus => write!(f, "account status is invalid for this operation"),
        }
    }
}

impl std::error::Error for AccountError {}

pub struct AccountRegistry {
    accounts: HashMap<u64, Account>,
}

impl AccountRegistry {
    #[must_use]
    pub fn new() -> Self {
        Self {
            accounts: HashMap::new(),
        }
    }

    pub fn get_account(&self, id: u64) -> Result<&Account, AccountError> {
        self.accounts.get(&id).ok_or(AccountError::NotFound(id))
    }
}
```

## Sources
- https://google.github.io/styleguide/rustguide.html
- https://rust-lang.github.io/api-guidelines/
