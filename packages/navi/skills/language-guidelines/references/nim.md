# Nim Style Guide

> Source: Nim Style Guide (https://nim-lang.org/docs/nep1.html), the enhancement proposal (NEP 1) that governs the Nim standard library and official projects. The guide calls itself "a set of style conventions" for code that "should follow a consistent set of style guidelines when suitable"; conventions in the wild vary, but the rules below are the canonical ones.

## Quick Rules
- Indent with 2 spaces. The compiler rejects tab indentation.
- Keep lines at 80 characters or fewer.
- Type identifiers are PascalCase. All other identifiers are camelCase; constants may be PascalCase but are not required to be.
- Exception and error types end in `Error` or `Defect`.
- Enum members carry a prefix identifying the enum unless the enum is `{.pure.}`.
- Use `let` instead of `var` for bindings that never change.
- Use the implicit `result` variable rather than an explicit return where the control flow is straightforward; use `return` when its control-flow properties matter.
- Prefer a `proc` over a macro, template, iterator, or converter unless the extra power is genuinely required.
- Import standard library modules with the `std/` prefix: `import std/os`.
- Write `a..b` without spaces around the range operator. Prefer a multi-line triple-quoted string that starts with a newline, so the content lines up with the code. A getter for a private field `foo` is named `foo`; a getter with side effects or non-O(1) cost is named `getFoo`.

## Formatting
- Indentation: 2 spaces, enforced by the compiler (tabs are a compile error). Line length: 80 characters maximum.
- Braces: opening brace on the same line, closing brace on its own line at the enclosing indentation.
- One statement per line; a semicolon is only needed to separate statements on one line. Blank line between top-level procedures.
- Multi-line parameter lists indent the parameters one level and keep the closing parenthesis on the declaration line:

```nim
proc lotsOfArguments(
  argOne: string, argTwo: int, argThree: float,
  argFour: proc(), argFive: bool, argSix: int
): GenericType[int, string] = discard
```

- Multi-line calls continue at the same indentation as the call, not aligned to the opening parenthesis.
- Use `a..b` and `a..<b` with no surrounding spaces. Use `a .. -3` only when the right operand contains an operator.
- No trailing whitespace; file ends with a newline. Import grouping: `import std/[os, sysrand, posix]` for several modules, `import std/os` for one.
- Do not manually align declarations in a column; the compiler does not care and it rots.

## Naming
- Types: PascalCase - `FooBar`, `PathComponent`. Procs, iterators, converters, templates, macros: camelCase - `parseUrl`, `checkHttpHeader`.
- Variables and parameters: camelCase, must start with a lowercase letter - `aVariable`. Constants: camelCase or PascalCase, both allowed - `aConstant`, `FooBar`. `ALL_UPPERCASE` is tolerated for C/C++ wrappers but discouraged.
- Getters and setters: `foo` / `foo=` for a plain field, `getFoo` / `setFoo` when the operation has side effects or is not O(1).
- Exception types: `ValueError`, `KeyError`. Defects (bugs, not recoverable conditions): `AssertionDefect`. Pointer and reference variants of a type: base name plus `Ref` or `Ptr` - `Handle`, `HandleRef`, `HandlePtr`.
- Mutating views start with `m`: `mitems`, `mpairs`. In-place versus copy-returning operations: the copy-returning form is the past participle - `sort` and `sorted`, `reverse` and `reversed`. When the copy-returning form already exists, the in-place form gets an `In` suffix - `replaceIn`.
- Subject-verb order, not verb-subject: `fileExists`, not `existsFile`.
- Use standard abbreviations: `init`, `new`, `self`, `find`, `contains`, `add`, `cmp`, `put`, `get`, `len`, `size`, `cap`, `mem`, `items`, `pairs`, `del`, `incl`, `excl`, `cmd`, `exec`, `env`, `var`, `val`, `exe`, `dir`, `path`, `ext`, `sep`, `col`, `app`, `cfg`, `msg`, `arg`, `obj`, `param`, `proc`, `func`, `coord`, `rect`, `sym`, `lit`, `str`, `ident`, `indent`.
- Acronyms are ordinary words: `parseUrl`, not `parseURL`; `checkHttpHeader`, not `checkHTTPHeader`.

## Types and Data
- Use `let` for immutable bindings; use `var` only for bindings that are reassigned.
- Use `result` as the implicit return variable of a proc; assign to it and return it, or use `return` when the control flow needs it. Prefer `object` to `ref object` unless identity or mutation is required.
- Generic types use square brackets: `seq[int]`, `Table[string, int]`, `Option[int]`.
- Model optional values with `Option[T]` and `some`/`none` rather than a sentinel value.
- Use `distinct` types to prevent mixing up units or currencies: `type Meters = distinct float`.
- Use `enum` for closed sets, `{.pure.}` when the values are pure data with no behaviour. Use `concept` sparingly.
- Put `ref` on a parameter only when the proc genuinely mutates it; `var` parameters are a strong signal.

## Comments and Documentation
- Use `##` doc comments for the documentation system; they are attached to the declaration that follows.
- A doc comment starts with a one-line summary, then a blank `##` line, then the details.
- Document every exported proc, type, and constant. Internal helpers may go undocumented.
- Use `##` for a short comment on the line above a declaration; use `#` for a plain implementation comment. Comments explain why, not what. A comment that restates the code is noise.
- TODO format: `## TODO(owner): description`. Do not leave commented-out code in a file.

## Error Handling
- Use `raise` (or `raise newException`) to signal an error. `raise ValueError.new("message")` is the idiomatic form.
- Define a dedicated exception type per failure mode: `type ConfigError = object of CatchableError`.
- Exceptions derive from `CatchableError` when the caller can recover; from `Defect` when it indicates a bug in the program.
- Use `try`/`except` with a specific exception type: `except ValueError as e:`. Never use `except:` to swallow every error. `defer` is the mechanism for cleanup that must run on every exit path: `defer file.close()`. `assert` is for internal invariants and is compiled out with `--assertions:off`; never use it to validate user input.
- `quit` and `system` are for programs, not libraries. A library must not terminate the process.

## Testing
- Framework: the built-in `unittest` module (`unittest2` for more features); `check` and `mockery` are common nimble packages.
- Layout: a `tests/` directory with one test module per source module: `tests/testconfig.nim` for `src/config.nim`.
- Use `unittest` suites: `suite "Config loader": test "parses key=value": ...`.
- Name tests as short sentences describing the behaviour: `test "throws on a missing key"`.
- The test file must `import unittest` and end with `unittest.main()`. Run the suite through nimble: `nimble test`. Keep the code under test in a library module so the test module imports it normally.

## Anti-Patterns
- `var x = 5` for a value that never changes - instead `let x = 5`.
- A tab in the source - instead two spaces; the compiler rejects tabs.
- `ALL_CAPS` for every constant - instead camelCase or PascalCase.
- `parseURL` / `checkHTTPHeader` - instead `parseUrl` / `checkHttpHeader`; acronyms are words.
- `existsFile` - instead `fileExists`; use subject-verb order.
- A `macro` where a `proc` would do - instead use a proc; macros are a last resort.
- `except:` with no type - instead catch the specific exception you can handle.
- `assert` for input validation - instead `raise ValueError.new(...)`.

## Code Example
```nim
## Configuration loading for a service.
##
## Parses a simple ``key=value`` document into a string table.

import std/[strutils, tables]

type
  ConfigError* = object of CatchableError
    ## Raised when the configuration document cannot be parsed.

  Config* = ref object
    ## Parsed configuration values.
    values: Table[string, string]

proc parseConfig*(contents: string): Config =
  ## Parses a ``key=value`` configuration document.
  ##
  ## Raises ``ConfigError`` when a line is malformed.
  result = Config(values: initTable[string, string]())
  for line in contents.splitLines():
    let stripped = line.strip()
    if stripped.len == 0 or stripped.startsWith("#"):
      continue
    let separator = stripped.find('=')
    if separator < 1:
      raise newException(ConfigError, "malformed line: " & stripped)
    result.values[stripped[0 ..< separator].strip()] = stripped[separator + 1 .. ^1].strip()

proc serviceName*(config: Config; default = "unnamed-service"): string =
  ## Returns the configured service name, or ``default`` when it is absent.
  config.values.getOrDefault("name", default)
```

## Sources
- https://nim-lang.org/docs/nep1.html
- https://nim-lang.org/docs/manual.html
- https://nim-lang.org/docs/unittest.html

