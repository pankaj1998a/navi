# Emacs Lisp Style Guide

> Source: The Emacs Lisp Style Guide (https://github.com/bbatsov/emacs-lisp-style-guide) plus the Elisp Guide (https://github.com/chrisdone/elisp-guide) and the GNU Emacs Lisp manual coding tips (https://www.gnu.org/software/emacs/manual/html_node/elisp/Tips.html)

## Quick Rules

- Use spaces, never tabs; set `indent-tabs-mode` to nil.
- Use `lisp-case` for functions and variables: `some-var`, `some-fun`.
- Prefix top-level definitions with the library name (`projectile-project-root`) and mark private ones with `--`.
- Put `;;; -*- lexical-binding: t; -*-` on the first line of every file.
- Indent the body of forms with 2 spaces; indent special arguments (the `if` then-clause) with 4.
- End every library file with a `provide` statement and a `;;; file ends here` comment.
- Use `when`/`unless` instead of `if` with a `progn` body.
- Use `#'` to quote function names, never `'` for a function symbol.
- Write a docstring for every function; begin with an imperative sentence.
- Use `checkdoc` and `package-lint` before submitting a package.

## Formatting

- Indentation: 2 spaces for the body of a form; regular function arguments are vertically aligned under the first argument.
- If the first argument starts on a new line, align it with the function name.
- Forms with special arguments (`if`, `let`, `with-current-buffer`) put the special arguments on the same line as the form name or indent them 4 spaces; the body is indented 2 spaces.
- The `then` clause of an `if` is indented 4 spaces; the `else` clause is aligned with it.
- `let` bindings are vertically aligned.
- No space between a form name and its opening bracket when there is text before the bracket: `(foo (bar baz) quux)` is correct.
- Trailing parentheses stay on the same line as the last form.
- Blank line between top-level forms; no blank lines inside a function or macro body (except to group `cond`/`let` pairs).
- Line length: keep lines under 80 characters where feasible.
- No trailing whitespace; Unix line endings; file ends with a newline.

## Naming

- Functions and variables: `lisp-case` (`some-var`, `some-fun`).
- Top-level names are prefixed with the library name to avoid clashes: `projectile-project-root`.
- Private top-level definitions end with `--`: `projectile--internal`.
- Unused lexical variables are prefixed with `_`: `(lambda (x _y) x)`.
- Predicates end in `p` for a single word (`evenp`) and `-p` for multiple words (`buffer-live-p`).
- Face names do not end in `-face` (`widget-inactive`).
- Mode names end in `-mode`; minor modes end in `-mode` too.
- Custom variables are prefixed with the library name and end in `-option` or `-variable`.
- Keywords are usually symbols from the library namespace.

## Types and Data

- Enable lexical binding; never rely on dynamic binding in new code.
- Use `defstruct` for plain records and `cl-defstruct` when you want named accessors and constructor keywords.
- Prefer `alist` or `plist` for small key/value data; use `hash-table` for large maps.
- Use `cl-defun` with keyword arguments when a function takes more than three or four positional parameters.
- Use `cl-loop` for iteration, but `dolist`/`seq-do` when you are not concatenating results.
- Do not mutate global state implicitly; return new values or use `cl-defstruct` setters deliberately.
- Avoid `eval` on user data.

## Comments and Documentation

- Comment levels: `;;;` for section headings, `;;` for comments about a fragment, `;` for margin comments.
- Always one space after the semicolons.
- Comments longer than a word start with a capital letter and end with punctuation.
- Put the comment before the code it describes and align it with that code.
- Write a docstring for every function: a complete, imperative sentence (`"Verify that ..."`).
- Mention arguments in uppercase in the order they are used; always capitalize "Emacs".
- Do not indent continuation lines of a docstring - it looks wrong in `describe-function`.
- Avoid superfluous comments; if you need a comment, improve the code instead.
- Annotations use `;; FIXME:`, `;; TODO:`, `;; OPTIMIZE:`, `;; HACK:`, `;; REVIEW:` with a note and your initials and date.

## Error Handling

- Signal errors with `(error "Message" data)`.
- Use `condition-case` to handle a specific error type; do not catch everything.
- Use `user-error` for errors caused by the user, so `debug` shows the backtrace.
- Use `condition-case-unless-debug` when the backtrace is not useful.
- Validate arguments at the start of a function and signal an error with a clear message.
- Never silently swallow an error; if you handle it, say why in a comment.

## Testing

- Use `ert` for unit tests: `ert-deftest name-test () ...` inside the file or in a `*-test.el` file.
- Name test functions `<function>-test` and test files `<file>-test.el`.
- Use `ert-deftest` for pure functions and `ert-test` when you need setup/teardown.
- Keep each test small and focused on one behaviour.
- Use `should` from `ert` with the expected value first: `(should (equal (foo 1) 2))`.
- Provide `ert-deftest` fixtures via `ert-deftest` `:setup`/`:cleanup` keywords or `ert-test` bindings.
- Run `checkdoc` and `byte-compile` the package before release.

## Anti-Patterns

- A lambda in a hook or keymap. Instead: define a named function and reference it.
- `'(lambda (x) ...)`. Instead: use `(lambda (x) ...)` so the byte-compiler can optimize it.
- `(if pred (progn (foo) (bar)))`. Instead: `(when pred (foo) (bar))`.
- `(when (not pred) ...)`. Instead: `(unless pred ...)`.
- A `defun` with five positional parameters. Instead: use `cl-defun` with `&key` arguments.
- Dynamic binding of a global. Instead: enable lexical binding and pass values as arguments.
- Commenting out code instead of deleting it. Instead: delete it; version control remembers.
- Calling `require`/`load` at the top of a file. Instead: use `require` in the package header via `;;;###autoload` cookies and `provide`.

## Code Example

```emacs-lisp
;;; my-package.el --- A small Emacs package  -*- lexical-binding: t; -*-

;; Copyright (C) 2026 Example Authors

;; Package-Requires: ((emacs "28.1"))
;; Version: 1.0.0
;; Keywords: tools

;;; Code:

(require 'cl-lib)

(defgroup my-package nil
  "Utilities for the my-package package."
  :group 'tools
  :prefix "my-package-")

(defun my-package-count-lines (&optional buffer)
  "Count the lines in BUFFER, or in the current buffer.

Interactively, prompt for BUFFER when called with a prefix argument."
  (interactive)
  (with-current-buffer (or buffer (current-buffer))
    (line-number-at-pos (point-max))))

(defun my-package-setup ()
  "Configure global defaults for `my-package'."
  (setq my-package-verbose t))

(provide 'my-package)

;;; my-package.el ends here
```

## Sources

- https://github.com/bbatsov/emacs-lisp-style-guide
- https://github.com/chrisdone/elisp-guide
- https://www.gnu.org/software/emacs/manual/html_node/elisp/Tips.html
