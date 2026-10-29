# Google Style Guides (Master Reference)

> Source: Google Style Guides Index (https://google.github.io/styleguide/)

## Core Philosophy of Google Code

Google code style is designed to optimize codebases for **large teams**, **long-term maintainability**, and **reader comprehension**. The key principles across all Google style guides are:

1. **Optimize for the Reader, Not the Writer**: Code is read vastly more often than it is written. Explicit, clear code wins over clever, terse idioms.
2. **Clarity & Simplicity**: Choose direct, unambiguous constructs. Avoid complex metaprogramming, excessive operator overloading, or surprising implicit behavior.
3. **Consistency**: Code in a given language across repositories should look like it was authored by a single competent engineer.
4. **Safety & Robustness**: Favor compile-time checking over runtime errors; eliminate memory safety bugs, race conditions, and uncontrolled exceptions.
5. **No Dead Code & No Premature Speculation**: Implement only what is required today. No unused abstractions, premature generalizations, or commented-out code.

---

## Universal Rules Across All Google Style Guides

- **Indentation**:
  - 2 spaces: C++, Java, TypeScript, JavaScript, HTML/CSS, Shell, Swift, C#, Objective-C, Common Lisp, Haskell, R, XML, Verilog, Vimscript, Dart, Angular.
  - 4 spaces: Python, Kotlin.
  - Tabs: Go (`gofmt`).
- **Line Length**:
  - 80 characters: C++, Python, TypeScript, JavaScript, Shell, HTML/CSS, Haskell, Objective-C, R, XML, Vimscript, Dart.
  - 100 characters: Java, Rust, Swift, Kotlin, Common Lisp, Verilog.
  - Unlimited (idiomatic wrapping via `gofmt`): Go.
- **Naming Conventions**:
  - **Types/Classes/Interfaces**: `UpperCamelCase` / `PascalCase` across all languages.
  - **Constants**: `kPascalCase` (C++, C#) or `UPPER_SNAKE_CASE` (Python, Java, Rust, Go, TypeScript).
  - **Methods/Functions**: `camelCase` (Java, TypeScript, JavaScript, Swift, Kotlin, Dart) or `PascalCase` (C++, C#, Go exported) or `snake_case` (Python, Rust, Shell, C).
  - **Acronyms/Initialisms**: Consistent case in Go (`parseURL`, `HTTPClient`), treated as words in Java/TypeScript (`HttpUrl`, `XmlParser`).
- **Imports**:
  - Group imports logically: standard library first, then third-party libraries, then local project modules.
  - Sort alphabetically within groups.
  - Never use wildcard/glob imports (`from foo import *`, `use foo::*`, `import foo.*`).
  - Import packages or modules rather than individual functions in Python and top-level functions in Rust.
- **Comments & Documentation**:
  - Explain the **why**, not the **what**. Code explains what; comments explain non-obvious rationale, invariants, and edge cases.
  - Public APIs must have structured doc comments (Javadoc, JSDoc, Google docstrings, rustdoc, Go doc).
  - `TODO` format across all Google guides: `// TODO(username): description` or `TODO(username): description`.
- **Error Handling**:
  - Return explicit errors/statuses (`absl::Status`, `Result<T, E>`, `(T, error)`) rather than throwing unchecked exceptions or returning ambiguous sentinel values.
  - Check every error; never silence errors with empty handlers or `let _ =`.

---

## Master Index of Google Style Guides

| Language | Reference File | Canonical Google Guide URL |
| :--- | :--- | :--- |
| **C++** | [`c-plus-plus.md`](c-plus-plus.md) | https://google.github.io/styleguide/cppguide.html |
| **Python** | [`python.md`](python.md) | https://google.github.io/styleguide/pyguide.html |
| **Go** | [`go.md`](go.md) | https://google.github.io/styleguide/go/ |
| **TypeScript** | [`typescript.md`](typescript.md) | https://google.github.io/styleguide/tsguide.html |
| **JavaScript** | [`javascript.md`](javascript.md) | https://google.github.io/styleguide/jsguide.html |
| **Java** | [`java.md`](java.md) | https://google.github.io/styleguide/javaguide.html |
| **Rust** | [`rust.md`](rust.md) | https://google.github.io/styleguide/rustguide.html |
| **Shell / Bash** | [`shell.md`](shell.md) | https://google.github.io/styleguide/shellguide.html |
| **HTML / CSS** | [`html-css.md`](html-css.md) | https://google.github.io/styleguide/htmlcssguide.html |
| **C#** | [`c-sharp.md`](c-sharp.md) | https://google.github.io/styleguide/csharpguide.html |
| **Swift** | [`swift.md`](swift.md) | https://google.github.io/swift/ |
| **Kotlin** | [`kotlin.md`](kotlin.md) | https://developer.android.com/kotlin/style-guide |
| **Dart** | [`dart.md`](dart.md) | https://dart.dev/effective-dart |
| **Angular** | [`angular.md`](angular.md) | https://angular.dev/style-guide |
| **Common Lisp** | [`common-lisp.md`](common-lisp.md) | https://google.github.io/styleguide/lispguide.html |
| **Haskell** | [`haskell.md`](haskell.md) | https://google.github.io/styleguide/haskellguide.html |
| **Objective-C** | [`objective-c.md`](objective-c.md) | https://google.github.io/styleguide/objcguide.html |
| **R** | [`r.md`](r.md) | https://google.github.io/styleguide/Rguide.html |
| **JSON** | [`json.md`](json.md) | https://google.github.io/styleguide/jsoncguide.html |
| **XML** | [`xml.md`](xml.md) | https://google.github.io/styleguide/xmlguide.html |
| **Markdown** | [`markdown.md`](markdown.md) | https://google.github.io/styleguide/docguide/style.html |
| **Verilog** | [`verilog.md`](verilog.md) | https://google.github.io/styleguide/verilogguide.html |
| **Vim script** | [`vimscript.md`](vimscript.md) | https://google.github.io/styleguide/vimscriptguide.html |

---

## Agent Enforcement Policy

When any Navi coding agent (`build`, `tdd`, `reviewer`, `architect`, `debugger`, `optimizer`, etc.) produces, edits, or inspects code:
1. Identify the programming language of the file(s).
2. Look up the matching reference file from the table above.
3. **Strictly adhere** to the Quick Rules, Formatting, Naming, Types, and Anti-Patterns defined in that guide.
4. During reviews, report any deviation as a **Standards Violation**.
