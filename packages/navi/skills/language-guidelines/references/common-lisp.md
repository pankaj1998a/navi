# Common Lisp Style Guide

> Source: Common Lisp Style Guide (http://lisp-lang.org/style-guide/) plus Google Common Lisp Style Guide (https://google.github.io/styleguide/lispguide.xml)

## Quick Rules

- Names are lowercase with single dashes separating complete words: `user-count`, not `user-cnt`.
- Special (dynamic) variables are wrapped in asterisks: `*positions*`; constants in plus signs: `+golden-ratio+`.
- Indent two spaces per form; `if` branches are aligned under the condition.
- Use `when`/`unless` instead of a one-armed `if`; use `cond` for multiple branches.
- Put a four-semicolon (`;;;;`) file header comment at the top of every file.
- Docstring every function, package, class, and slot.
- One package per file, with an explicit `:import-from` list instead of `:use`.
- Use `defclass` with `:type` and `:documentation` slot options for structured data.
- Prefer `let` bindings over `setf` on globals; never `defvar` for constants.
- Keep lines under 100 columns; 80 is a common tighter limit.

## Formatting

- Indentation: 2 spaces per form.
- `if` puts both branches on their own lines, aligned under the condition:

```common-lisp
(if (> x 5)
    (format t "Greater than five")
    (format t "Less than or equal to five"))
```

- `let` bindings are aligned under each other.
- Use 1 space after a closing paren before the next form on the same line, if any.
- File header: a `;;;;` comment describing the file's purpose; no copyright or authorship in file comments.
- Comment hierarchy: `;;;;` for file-level headers, `;;;` for regions, `;;` for regions inside a function, `;` for short trailing notes.
- Prefer a trailing `;;` note on the same line rather than a comment block for one-line remarks.
- Do not comment out code; delete it (version control remembers it).
- Unix line endings; no trailing whitespace; file ends with a newline.

## Naming

- Functions and variables: lowercase, single dashes, complete words (`make-text-node`, not `mk-txt-node`).
- Special variables: `*name*`; constants: `+name+`.
- Predicates: suffix `p` for a single word (`evenp`), `-p` for multiple words (`largest-planet-p`).
- Do not prefix a function with its package name; the package provides the namespace.
- Accessors of a `defclass` are named after the class slot with the class name as prefix: `request-url` for slot `url` in class `request`.
- Package names are hierarchical and lowercase: `title.graphics.mesh`.
- `defpackage` names use the same lowercase-dash convention as other symbols.

## Types and Data

- Use `defclass` rather than `defstruct` when you want type declarations, documentation, and accessors.
- Always give slots a `:type` where possible; types are documentation and let SBCL check at compile time.
- Slot option order: `:accessor`/`:reader`/`:writer`, `:initarg`, `:initform`, `:type`, `:documentation`.
- Use `defparameter` for special variables and `defconstant` for constants.
- Prefer immutable data: return new values instead of mutating in place.
- Use `defstruct` for plain, fast records without documentation needs.
- Keep helper structures inside the package that owns them; do not leak implementation records.
- Prefer `list`/`vector` literal constructors only when the literal is cheap and readable.

## Comments and Documentation

- Docstring every public function: a string literal as the first form in the body.
- Docstrings should start with a capital letter and end with a period; describe arguments and return values.
- Use `;` for a short trailing note, `;;` for a comment about a region inside a function, `;;;` for a file region, `;;;;` for the file header.
- Keep the docstring on one line when short; otherwise start it on the line after the parameter list.
- Document design decisions and non-obvious behaviour; do not restate the code.
- `deftype`/`defmethod` definitions take docstrings the same way as functions.

## Error Handling

- Use `error` with a format string for unrecoverable situations: `(error "Unknown operator: ~a" op)`.
- Signal conditions for recoverable errors: `(error 'unknown-operator :op op)` and handle with `handler-case`/`restart-case`.
- Validate arguments at the entry point of a function, once, with `check-type`, `check-type`, or an explicit assertion.
- Never swallow a condition with a bare `handler-case`; either handle it meaningfully or re-signal.
- Use `unwind-protect` for cleanup instead of `ignore-errors`.
- Prefer returning multiple values over stuffing everything into a list.

## Testing

- Put tests in a `t/` directory, one file per package: `t/my-package.lisp`.
- Use a separate system definition `my-project-test.asd` that depends on the main system and a test framework.
- Name test functions `test-<behaviour>`: `(defun test-user-count () ...)`.
- Use `fiveam`, `rove`, or `prove` as the test framework; assert one behaviour per test.
- Group tests in the test file with a `; --- <area> ---` comment header.
- Keep fixtures local; rebuild state for each test so tests can run in any order.
- Run the test system in CI before merging.

## Anti-Patterns

- Abbreviating names (`usr-cnt`). Instead: use complete words (`user-count`).
- `setf` on a global from inside a function. Instead: pass the value as an argument or return it.
- `:use` in `defpackage`. Instead: `:use :cl` plus explicit `:import-from` lists.
- A `defclass` without `:type` or `:documentation`. Instead: document slots; types are documentation.
- `if` with only a true branch. Instead: use `when` (or `unless` for the negated form).
- A large condition inside `if`. Instead: extract it into a named predicate function.
- Commenting out dead code. Instead: delete it and rely on version control.
- `t` used as a return value to mean "no result". Instead: return the meaningful value or multiple values.

## Code Example

```common-lisp
;;;; users.lisp - Representation and operations for application users.

(defpackage #:users
  (:use #:cl)
  (:export #:make-user #:user-name #:user-email #:user-active-p #:deactivate))

(in-package #:users)

(defconstant +min-name-length+ 2)

(defstruct (user (:constructor %make-user))
  name
  email
  (active t))

(defun make-user (name email)
  "Create a user record with NAME and EMAIL.

  Signals an error when NAME is too short or EMAIL is not an address."
  (let ((clean-name (string-trim '(#\Space #\Tab) name)))
    (when (< (length clean-name) +min-name-length+)
      (error "Name ~a is too short." name))
    (unless (position #\@ email)
      (error "Email ~a is not an address." email))
    (%make-user :name clean-name :email email)))

(defun user-active-p (user)
  "Return true when USER is active."
  (user-active user))

(defun deactivate (user)
  "Mark USER as inactive and return it."
  (setf (user-active user) nil)
  user)
```

## Sources

- http://lisp-lang.org/style-guide/
- https://google.github.io/styleguide/lispguide.xml
