# Clojure Style Guide

> Source: The Clojure Style Guide (https://github.com/bbatsov/clojure-style-guide) plus the community coding guidelines at https://clojure.org/community/contrib_howto and the style guide site https://guide.clojure.style

## Quick Rules

- Use 2 spaces to indent the body of a form; never use tabs.
- Use `lisp-case` for functions and variables; `CapitalCase` for types, protocols, records, and structs.
- End a predicate name with `?` (`even?`, `palindrome?`); end a side-effecting name with `!` (`save-user!`).
- Use `namespace` declarations in every source file; one namespace per file.
- Prefer `:require` with `:as` over `:use`; never call `require`/`refer` as functions in source.
- Use `nil` and `false` as the only falsey values; use `(seq coll)` to test for emptiness.
- Do not use commas in sequential collection literals (`[1 2 3]`, not `[1, 2, 3]`).
- Keep functions under 10 lines of code and positional parameter lists under 4.
- Use `->` and `->>` for threading instead of deep nesting.
- Avoid `def` inside functions and never shadow `clojure.core` names.

## Formatting

- Indentation: 2 spaces for the body of forms with a body (all `def` forms, `when`, `cond`, `let`, `with-*`).
- Function arguments on their own line are indented 1 space and vertically aligned under the function name.
- Multi-line call with arguments on the same line as the name: align the arguments vertically under the first argument.
- `let` bindings are vertically aligned under each other.
- Map literal keys are vertically aligned.
- A single blank line between top-level forms; no blank lines inside a definition body (except to group `cond`/`let` pairs).
- Gather trailing parentheses on one line.
- No space after an opening bracket or before a closing bracket; a space between text and a bracket.
- Unix line endings, file ends with a newline, no trailing whitespace.
- Bracket spacing: `(foo (bar baz) quux)`.

## Naming

- Namespaces: `project.module` or `organization.project.module`; segments use `lisp-case`.
- Functions and variables: `lisp-case` (`some-var`, `some-fun`).
- Protocols, records, structs, types: `CapitalCase`; keep acronyms uppercase (`HttpRequest`, `XMLParser`).
- Predicates: trailing `?`. Side-effecting/unsafe functions: trailing `!`.
- Conversion functions: `->` in the name (`f->c`), never `to`.
- Dynamic (rebindable) vars: earmuffs (`*a*`).
- Constants: no special notation; `(def max-size 10)`, not `MAX-SIZE` or `+max-size+`.
- Unused bindings: `_` for destructuring, `_name` when naming aids understanding.
- Idiomatic short names: `f`, `n`, `x`, `xs`, `m`, `k`, `v`, `s`, `coll`, `pred`, `& more`, `xf`.

## Types and Data

- Clojure is dynamically typed; use `spec` for runtime contract validation where it matters.
- Prefer immutable persistent collections; use atoms only for genuinely mutable state.
- Use `defmulti`/`defmethod` for open dispatch, `case` for closed dispatch.
- Prefer keyword arguments over long positional parameter lists: `(defn create-user [{:keys [name email role]}] ...)`.
- Use pre/post conditions (`{:pre [...]}`) instead of defensive checks inside the body.
- Prefer higher-order functions (`map`, `filter`, `reduce`) over manual `loop`/`recur`.
- Use `vec` rather than `(into [] coll)` when converting a sequence to a vector.
- Destructure maps and sequences in function arguments for clarity.

## Comments and Documentation

- Use `;;` for line comments; use `;;;` for section headers inside a file.
- Write comments as complete sentences, capitalized, with punctuation.
- Use `docstring` as the first form of a `defn`/`def` to document it; the docstring is the public API description.
- Use `^{:doc "..."}` metadata for protocol methods and other non-standard definitions.
- Use `(:require ...)` doc metadata sparingly; prefer a real docstring.
- Use `comment` blocks to keep REPL scratch work out of committed code.
- Avoid comments that restate the code; explain the "why".

## Error Handling

- Throw `ex-info` with a map of data for structured errors: `(throw (ex-info "Bad input" {:id id}))`.
- Validate inputs with preconditions (`{:pre [(pos? x)]}`) so failures are reported at the boundary.
- Never use `try`/`catch` to swallow exceptions; rethrow or convert to a return value.
- Represent expected failures as data (`{:error ...}`) rather than exceptions when the caller can recover.
- Use `ex-info` with `:cause` to wrap and preserve the original exception.
- Prefer `when`/`if-let`/`when-let` over manual nil checks.

## Testing

- Put tests in `test/<namespace>_test.clj` and use `clojure.test`.
- Name the test namespace `<subject>-test` and set it up with `(:require [clojure.test :refer :all])`.
- Use `deftest` names that describe behaviour: `(deftest user-can-be-created ...)`.
- Use `is` with an expected value on the right: `(is (= 3 (count xs)))`.
- Prefer `are` for table-driven tests over many similar `is` forms.
- Use `testing` blocks to group assertions by scenario inside one `deftest`.
- Keep fixtures small; build data with `let` or helper functions inside the test namespace.
- Run tests with `lein test`, `clojure -M:test`, or the project's runner; keep them fast and hermetic.

## Anti-Patterns

- `[1, 2, 3]` with commas. Instead: `[1 2 3]`.
- `:use` in the `ns` form. Instead: `:require` with `:as` and a narrow `:refer`.
- `(when-not (empty? coll) ...)`. Instead: `(when (seq coll) ...)`.
- `(if x (do (f) (g)))`. Instead: `(when x (f) (g))`.
- Deeply nested calls. Instead: thread with `->` or `->>`.
- `(def x 5)` inside a function. Instead: bind with `let`.
- A local named `map`, `filter`, or `first`. Instead: rename it; you are shadowing `clojure.core`.
- More than four positional parameters. Instead: take a map of options.

## Code Example

```clojure
(ns my-app.users
  "Helpers for creating and querying user records."
  (:require [clojure.string :as str]))

(def min-name-length 2)

(defn- normalize-name
  "Trim and lowercase a user-supplied name."
  [name]
  (-> name
      str/trim
      str/lower-case))

(defn valid-user?
  "Return true when NAME and EMAIL are acceptable for a user record."
  [name email]
  (and (>= (count (normalize-name name)) min-name-length)
       (str/includes? email "@")))

(defn create-user
  "Build a user record from NAME and EMAIL.

  Throws ex-info when the inputs are not valid."
  [name email]
  (when-not (valid-user? name email)
    (throw (ex-info "Invalid user"
                    {:name name :email email})))
  {:name (normalize-name name)
   :email email
   :active true})
```

## Sources

- https://github.com/bbatsov/clojure-style-guide
- https://guide.clojure.style
- https://clojure.org/community/contrib_howto
