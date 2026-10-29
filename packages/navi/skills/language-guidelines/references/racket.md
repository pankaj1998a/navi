# Racket Style Guide

> Source: How to Program Racket: a Style Guide (http://docs.racket-lang.org/style/index.html) plus Racket documentation conventions (https://docs.racket-lang.org/)

## Quick Rules

- Use `#lang` on the first line of every module. `racket/base` is the default; use `typed/racket` for typed code.
- Indent exactly as DrRacket does. The canonical rule: running DrRacket's "indent all" leaves the file unchanged.
- Put all closing parentheses on the last line of the expression, not on their own lines.
- Use full English words separated by dashes for names: `render-game-state`, never `renderGameState` or `render_game_state`.
- Put a purpose statement in a `;;` comment at the top of every module.
- Use `cond` over `if`, `define` over `let`, and named `define` functions over `lambda`.
- Keep functions and modules small: a module should be about 500 lines, a function about one screen (roughly 66 lines).
- Document public procedures with Scribble (`@provide` contracts, `@section` docs).
- Use `raise-arguments-error` (or `raise-user-error`) with a clear message; never fail silently.

## Formatting

- Indentation: follow DrRacket exactly. One level per nesting, no tabs.
- Tabs are forbidden - they break `diff` and `git` output.
- Maximum line width: 102 characters. A narrower file-local limit is allowed if noted in the file header.
- Put all closing parentheses on one line at the end of the code. It is acceptable to place a run of closers alone on a final line when the sequence is long and likely to change.
- One `if` alternative per line. A whole `if` may live on one line if it fits within 102 characters.
- All arguments to a function belong on a single line unless the line is too long; then one argument per line.
- Use `;;` for line comments, `#| ... |#` for block comments, and `#;` to comment out a following expression.
- Section separators use a line of `;;` followed by 99 dashes. File ends with a newline, no trailing whitespace.

## Naming

- Full English words separated by dashes: `send-message-to-client`, `traverse-forest`.
- Never use `_` in names; it is "bad Racketeering". Use it only in syntax or match patterns.
- Prefix a function with the type of its main argument: `board-free-spaces`, `board-serialize`.
- Suffix variables with their type: `position-nat-nat`, `name-string`.
- Predicate and boolean functions end in `?`: `win-or-lose?`, `is-placable?`.
- Mutators and setters end in `!`: `set!`.
- Classes end in `%`: `game-state%`. Interfaces end in `<%>`: `dc<%>`.
- Unit signatures end in `^`: `game-context^`. Units end in `@`: `testing-context@`.
- Kernel identifiers start with `#%`: `#%app`.
- Module files: `module-name.rkt` in the collection root, or `module-name/main.rkt` for a directory module.

## Types and Data

- Racket is dynamically typed by default, but use Typed Racket (`#lang typed/racket`) for new libraries where feasible.
- Use `struct` for a fixed, small combination of values; use lists for variable-length data.
- Define structs with `struct` + `provide` and accessors, not raw association lists.
- Use transparent structs for data and opaque structs (`#:transparent` omitted) for abstractions.
- Use contracts (`contract-out`, `contract-in`) on every exported procedure.
- Use `match` to destructure complex data rather than nested `car`/`cdr` calls. Prefer immutable data; use `set!` only where mutation is the point.

## Comments and Documentation

- Every module starts with a `;;` purpose statement describing what the module provides.
- Use `;;` for a comment that starts a line and a single `;` for a trailing comment on the same line.
- Add a comment to each export in the `provide` section, so the interface reads as a table of contents.
- Write released code with Scribble documentation; a change in external behavior must change the docs in the same push.
- Documentation should have a "Guide" section (purpose, use cases) and a "Reference" section (the minutiae), with an example per procedure.
- Use `@;` for section separators in Scribble. Include a `TESTME.txt` describing where the tests live and how to run them.

## Error Handling

- Raise errors with `raise-arguments-error`, `raise-user-error`, or `raise` with a struct; always include the argument name and the expected value.
- Prefer `raise-argument-error` for contract violations raised by hand.
- Use `exn:fail:contract?` predicates when catching; never catch bare `exn?` unless you re-raise.
- Use `with-handlers` for local error handling and `guard` for a scoped handler.
- `error` and `raise` messages are user-facing: write them for a programmer, not for yourself.

## Testing

- Test suites live in `collects/tests/` in the PLT repository; new collections get a new suite there.
- Use `rackunit` (`require rackunit`) with `check-equal?`, `check-true?`, `check-exn`.
- Name the test file after the module it exercises.
- When debugging, write the failing test first, then fix the code, then re-run the suite.
- Split known-failing tests into a `failure` directory and a `success` directory.
- Add stress tests for performance-sensitive code; they have no expected output and never "pass".
- Always run the test suite before committing.

## Anti-Patterns

- Lisp-style closing parens on their own lines. Instead: put all closers on the final line.
- `let`/`let*` where a `define` would do. Instead: use `define` for named bindings.
- `if` where `cond` fits. Instead: use `cond` (or `match`) so branches can bind names.
- An anonymous `lambda` for a multi-expression body. Instead: give it a name with `define`.
- Deeply nested expressions. Instead: bind intermediate results with `define`.
- `snake_case` or `camelCase` names. Instead: use dash-separated full words.
- `attach`-style globals or a file longer than a few hundred lines. Instead: split into modules with a clear interface.

## Code Example

```racket
#lang racket/base
;; Utilities for formatting game scores.

(require racket/format
         racket/string)

(provide
 ;; Renders a score as "3 - 1".
 (contract-out
  [format-score (-> integer? integer? string?)])

 ;; Parses "3-1" into a two-element list of integers.
 (contract-out
  [parse-score (-> string? (listof exact-nonnegative-integer?))]))

;; format-score: (Integer Integer -> String)
;; Renders the home and away scores of a match.
(define (format-score home away)
  (format "~a - ~a" home away))

;; parse-score: (String -> (Listof Integer))
;; Splits a score string such as "3-1" into its two numbers.
(define (parse-score text)
  (define parts (string-split text #px"-"))
  (unless (= (length parts) 2)
    (raise-arguments-error 'parse-score "expected a score of the form \"n-n\""
                           "text" text))
  (map string->number parts))
```

## Sources

- http://docs.racket-lang.org/style/index.html
- http://docs.racket-lang.org/style/correct-maintain-speed.html
- http://docs.racket-lang.org/style/Textual_Matters.html
- http://docs.racket-lang.org/style/Units_of_Code.html
- http://docs.racket-lang.org/style/testing.html
- http://docs.racket-lang.org/style/Choosing_the_Right_Construct.html
