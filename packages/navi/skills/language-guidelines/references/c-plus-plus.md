# C++ Style Guide

> Source: Google C++ Style Guide (https://google.github.io/styleguide/cppguide.html) plus C++ Core Guidelines (http://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines) and LLVM C++ Coding Standards (https://llvm.org/docs/CodingStandards.html)

## Quick Rules

- Use 2-space indentation, spaces only, and keep lines to 80 characters.
- File names are lowercase with underscores: `my_useful_class.cc`, `my_useful_class.h`, `my_useful_class_test.cc`.
- Types are `PascalCase` (`UrlTable`); variables and parameters are `snake_case`; class data members end with `_`.
- Constants are `kPascalCase` (`kDaysInAWeek`); functions are `PascalCase` (`AddTableEntry`).
- Namespaces are `snake_case`; never use `using namespace` in a header.
- Put code in a namespace; mark file-local entities `static` or in an unnamed namespace.
- Use `const` for read-only data, `constexpr` for compile-time constants; prefer `auto` only when the type is obvious.
- Do not define implicit conversions: mark single-argument constructors and conversion operators `explicit`.
- Do not use exceptions for error reporting in new code; return a status type instead.
- Comment every non-obvious class, function, and constant; explain why, not what.

## Formatting

- Indentation: 2 spaces per level, spaces only.
- Line length: maximum 80 characters (exceptions: long string literals, includes, header guards).
- Braces: attached to the statement, except class/struct/namespace/enum bodies and `case` labels, which use the "no indent" style.
- Access specifiers are indented one level inside the class body (`public:`, ` private:`, ` private:`).
- One statement per line; one declaration per variable is not required but each should be initialized.
- Pointer/reference alignment: `char* c;` (Google style attaches `*`/`&` to the variable name).
- Include order: related header, C system headers, C++ standard headers, other libraries, project headers - each group separated by one blank line, sorted alphabetically within a group.
- Header guard format: `<PROJECT>_<PATH>_<FILE>_H_`.
- No trailing whitespace; end every file with a newline; use UTF-8 and avoid non-ASCII in source.

## Naming

- Types (classes, structs, enums, aliases, template type parameters): `PascalCase`, no underscores: `UrlTable`, `UrlTableError`.
- Variables, function parameters, and data members: `snake_case`. Class (not struct) data members have a trailing underscore: `num_entries_`.
- Struct data members have no trailing underscore.
- Constants (`constexpr`/`const` with static storage duration): `k` followed by `PascalCase` (`kMaxAllowedConnections`).
- Functions: `PascalCase` (`OpenFileOrDie`). Accessors may be `snake_case` (`count()`, `set_count(int)`).
- Namespaces: `snake_case`; top-level namespaces must be globally unique and project-owned.
- Enumerators: named like constants (`kOk`, `kOutOfMemory`), not like macros.
- Macros: `ALL_CAPS` with a project prefix (`MYPROJECT_ROUND(x)`).
- Generic type parameters: `T`, `TKey`, `TValue` style for template parameters.
- Booleans read as assertions: `is_valid`, `has_pending_requests`.
- Abbreviations: capitalize as one word (`StartRpc`, not `StartRPC`); avoid deleting letters inside words.

## Types and Data

- Use the narrowest type; prefer `int32_t`/`int64_t` or plain `int` over `long`.
- Prefer `std::string_view` for non-owning string parameters; avoid `const char*` APIs.
- Declare variables in the narrowest scope and initialize at declaration (`int i = f();`).
- Objects with static storage duration must be trivially destructible; mark them `constexpr` or `constinit`.
- Prefer `std::unique_ptr` for ownership transfer, `std::shared_ptr` only when shared ownership is real.
- Use `enum class` for scoped enums so enumerators do not leak into the enclosing scope.
- Raw pointers do not imply ownership; document ownership in comments when it is not obvious.
- Use `absl::Status`/`std::expected`-style result types for operations that can fail instead of exceptions.
- Avoid `auto` where it hides a meaningful type; declare the type when the reader needs it.

## Comments and Documentation

- Use `//` for comments; `/* */` is allowed but should be used consistently.
- Every file starts with license boilerplate; add a file comment describing the collection of abstractions it holds.
- Every non-obvious class or struct gets a comment explaining what it is and how to use it; include a short usage example when helpful.
- Comment function declarations with what the function does and how to use it (inputs, outputs, nullability, ownership, pre/postconditions); comment the definition with how it works.
- Document sentinel values (`nullptr`, `-1`) and invariants on data members when the type and name do not make them obvious.
- Use `// TODO(user):` for pending work; include a specific date or event when possible.
- Avoid redundant comments that restate the code; remove comments that duplicate the identifier.
- Use inclusive language: no "master/slave", "blacklist/whitelist"; use they/them for people.

## Error Handling

- Do not throw exceptions in new code; Google style forbids them in the standard library and discourages them broadly.
- Return a status/result type (`absl::Status`) and check it at every call site.
- Mark functions that cannot fail with `ABSL_MUST_USE_RESULT` on the status type.
- Use `CHECK`/`DCHECK` for invariants that must hold; use `CHECK` only for programmer errors.
- Validate arguments at the API boundary; do not trust callers inside the same module.
- Do not use `assert` for user input validation - asserts are removed in release builds.
- Report errors loudly: log the failure with enough context to debug it.

## Testing

- Test files live next to the code: `foo_test.cc` for `foo.cc`; use `*_test.cc` (the `_unittest` and `_regtest` suffixes are deprecated).
- Use GoogleTest: `TEST(FooTest, DoesSomething)` or `TEST_F` with a fixture named `FooTest`.
- Name tests after the behaviour, not the method: `HandlesEmptyInput`.
- One behaviour per test; use `EXPECT_EQ`/`ASSERT_EQ` as appropriate and give a message when the failure is not obvious.
- Prefer parameterized tests (`INSTANTIATE_TEST_SUITE_P`) over copy-pasted cases.
- Use `ASSERT_*` when continuing after failure would crash, `EXPECT_*` otherwise.
- Do not rely on test execution order; each test sets up its own state.
- Keep test doubles minimal and explicit; prefer real value types over mocks for simple data.

## Anti-Patterns

- `using namespace std;` in a header. Instead: qualify names or use a namespace alias inside a `.cc`.
- Raw owning pointers (`new`/`delete`). Instead: `std::unique_ptr` and `std::make_unique`.
- Throwing `std::runtime_error` to signal failure. Instead: return a status result.
- Constructor doing real work. Instead: use a factory function or an explicit `Init()` when errors are possible.
- Implicit conversions from single-argument constructors. Instead: mark them `explicit`.
- Global mutable state. Instead: pass dependencies in or use function-local statics with `constinit`.
- `typedef` for a template alias. Instead: `using Alias = Template<Args>;`.
- `NULL` and `0` for pointers. Instead: use `nullptr`.

## Code Example

```cpp
// Copyright 2026 Example Inc. All rights reserved.
//
// A small, dependency-free helper for reading configuration files.

#ifndef EXAMPLES_CONFIG_READER_H_
#define EXAMPLES_CONFIG_READER_H_

#include <string>
#include <string_view>
#include <vector>

namespace examples {

// Reads `key=value` lines from a text buffer.
//
// The reader ignores blank lines and lines starting with '#'. Keys are
// compared case-sensitively. The caller owns the returned vector.
//
// Example:
//   for (const auto& entry : config::Parse("mode=fast")) {
//     LOG(INFO) << entry.first << "=" << entry.second;
//   }
std::vector<std::pair<std::string, std::string>> Parse(std::string_view text);

}  // namespace examples

#endif  // EXAMPLES_CONFIG_READER_H_
```

## Sources

- https://google.github.io/styleguide/cppguide.html
- http://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines
- https://llvm.org/docs/CodingStandards.html
