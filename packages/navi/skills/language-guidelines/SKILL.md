---
name: language-guidelines
description: "Write clean, organized, idiomatic code in 50+ languages and environments. Strictly enforces Google Style Guides (https://google.github.io/styleguide/) across C++, Python, Go, Java, TypeScript, JavaScript, Rust, Shell, Swift, C#, Kotlin, Dart, HTML/CSS, and more. Use whenever writing, reviewing, or refactoring code in any language."
---
# Language Guidelines & Google Style Guides

Before writing ANY code, determine the language or environment of the task and **READ** the matching reference file from `references/` before generating code. Each file holds Quick Rules, Formatting, Naming, Types and Data, Comments and Documentation, Error Handling, Testing, Anti-Patterns, and Code Examples.

**Mandatory Rule for Coding Agents:** For all languages with official Google Style Guides (https://google.github.io/styleguide/), agents must strictly conform to Google's style, formatting, naming conventions, and idiomatic error handling.

## Reference files

| File | Language/Topic | Standard / Governing Authority |
| --- | --- | --- |
| ada.md | Ada | Ada Reference Manual / Style Guide |
| angular.md | Angular | **Google / Official Angular Style Guide** |
| apache.md | Apache configuration | Apache HTTP Server conventions |
| api-design.md | API design | REST & OpenAPI Best Practices |
| arduino.md | Arduino | Arduino Language Reference |
| brainfuck.md | Brainfuck | Esoteric Programming Standard |
| c-plus-plus.md | C++ | **Google C++ Style Guide** |
| c-sharp.md | C# | **Google C# Style Guide** & Microsoft Conventions |
| c.md | C | Linux Kernel / POSIX C standards |
| clojure.md | Clojure | Clojure Community Style Guide |
| cms.md | CMS and content systems | Headless CMS Architecture |
| common-lisp.md | Common Lisp | **Google Common Lisp Style Guide** |
| d.md | D | D Style Guide |
| dart.md | Dart | **Google / Effective Dart** |
| delphi.md | Delphi | Object Pascal Style Guide |
| dotnet.md | .NET environment | Microsoft .NET Design Guidelines |
| elixir.md | Elixir | Elixir Style Guide |
| elm.md | Elm | Elm Style Guide |
| emacs-lisp.md | Emacs Lisp | GNU Emacs Lisp Manual |
| erlang.md | Erlang | Erlang Efficiency & Style Guide |
| f-sharp.md | F# | F# Component Design Guidelines |
| fortran.md | Fortran | Modern Fortran Style Guide |
| frameworks.md | Web frameworks | Modern Web Architecture |
| frontend-development.md | Frontend development | Modern Frontend Engineering |
| git.md | Git | Conventional Commits & Git Hygiene |
| go.md | Go | **Google Go Style Guide, Decisions & Best Practices** |
| google.md | Google Style Guides (Master) | **Google Master Coding Style Overview** |
| groovy.md | Groovy | Groovy Style Guide |
| haskell.md | Haskell | **Google Haskell Style Guide** |
| html-css.md | HTML / CSS | **Google HTML/CSS Style Guide** |
| java.md | Java | **Google Java Style Guide** |
| javascript.md | JavaScript | **Google JavaScript Style Guide** |
| json.md | JSON | **Google JSON Style Guide** |
| julia.md | Julia | Julia Manual Style Guide |
| kotlin.md | Kotlin | **Google Android Kotlin Style Guide** |
| linux-kernel.md | Linux kernel style | Linux Kernel Coding Style |
| lua.md | Lua | Lua Style Guide |
| markdown.md | Markdown | **Google Documentation Style Guide** |
| mongodb.md | MongoDB | MongoDB Schema Design Best Practices |
| mozilla.md | Mozilla style conventions | Mozilla Coding Style |
| nim.md | Nim | Nim Style Guide |
| nodejs.md | Node.js | Node.js Best Practices |
| objective-c.md | Objective-C | **Google Objective-C Style Guide** |
| pascal.md | Pascal | Standard Pascal Style |
| perl.md | Perl | Perl Best Practices |
| php.md | PHP | PSR-12 / PER Coding Style |
| powershell.md | PowerShell | PowerShell Practice and Style |
| python.md | Python | **Google Python Style Guide** & PEP 8 |
| r.md | R | **Google R Style Guide** |
| racket.md | Racket | How to Design Programs / Racket Style |
| ruby.md | Ruby | Ruby Style Guide |
| rust.md | Rust | **Google Rust Style Guide** & API Guidelines |
| scala.md | Scala | Scala Style Guide |
| shell.md | Shell / Bash | **Google Shell Style Guide** |
| solidity.md | Solidity | Solidity Style Guide |
| sql.md | SQL | SQL Style Guide & Relational Best Practices |
| swift.md | Swift | **Google Swift Style Guide** |
| tools.md | Developer tooling | Development Tooling Conventions |
| typescript.md | TypeScript | **Google TypeScript Style Guide** |
| verilog.md | Verilog / SystemVerilog | **Google Verilog Style Guide** |
| vimscript.md | Vim script | **Google Vimscript Style Guide** |
| visual-basic.md | Visual Basic | Microsoft VB Conventions |
| xml.md | XML | **Google XML Document Format Style Guide** |

## Workflow

1. Detect the language or environment of the task (explicit request, file extension, or surrounding code).
2. Read the matching reference file, e.g. `references/go.md` or `references/python.md`.
3. Apply its Quick Rules and Google Style Guide constraints to all generated code.
4. On review, audit the code against the reference file's Anti-Patterns section and report violations.
5. If a task spans several languages or environments, read every relevant reference file first.

## Rules that apply everywhere

- Consistency with the surrounding code: Never introduce mixed styles in a single file.
- When a Google Style Guide exists for a language, its rules (naming, formatting, visibility, error semantics) take precedence over generic community habits.
- If an automated formatter exists for the project (`gofmt`, `rustfmt`, `prettier`, `black`, `clang-format`), run it rather than hand-formatting code.
- Never emit placeholder code, stubs, or invented non-existent APIs.
- Error handling is never swallowed; use the guide's documented pattern.
- Comments explain why, not what; restating the code adds no value.
- Naming follows the reference file's guide exactly, including casing rules.
