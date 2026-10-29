# Elixir Style Guide

> Source: Elixir Style Guide (https://github.com/christopheradams/elixir_style_guide) plus the official Elixir naming conventions (https://hexdocs.pm/elixir/naming-conventions.html) and the `mix format` documentation (https://hexdocs.pm/mix/Mix.Tasks.Format.html)

## Quick Rules

- Run `mix format` on every file; let the formatter own whitespace, indentation, and quoting.
- Use `snake_case` for atoms, functions, and variables; `CamelCase` for modules.
- End predicate function names with `?` (`valid?/1`); use an `is_` prefix for guard-friendly checks (`is_valid/1`).
- Always include a `@moduledoc` immediately after `defmodule`, followed by a blank line.
- Use `{:ok, value}` / `{:error, reason}` tuples for fallible operations instead of raising.
- Pipe data through `|>` rather than nesting calls; avoid using the pipe operator only once.
- Exception modules end with `Error`; error messages are lowercase with no trailing punctuation.
- Use `@spec` for public functions, placed after `@doc` and directly above the definition.
- One module per file; the file name is the module name in `snake_case`.
- Never call a zero-arity function without parentheses.

## Formatting

- The formatter uses 2-space indentation; spaces only; Unix line endings.
- Line length: 98 characters (configurable with `:line_length` in `.formatter.exs`).
- No trailing whitespace; every file ends with a newline.
- Spaces around operators, after commas, colons, and semicolons; no spaces inside brackets.
- No space after single-argument non-word operators (`0 - 1 == -1`); no spaces around the range operator (`5 in 1..10`).
- Blank lines separate `def` blocks so a function reads as logical paragraphs.
- No blank line directly after `defmodule`; keep the `@moduledoc` first, then a blank line.
- Multi-line lists, maps, and structs put each element on its own line with the brackets on their own lines.
- If one `case`/`cond` clause is multi-line, make all clauses multi-line and separate them with blank lines.
- `with` clauses are aligned under each other; a multi-line `do:` block is indented one level.
- Comments go above the line they describe, with one space after `#`.
- Keyword lists omit the square brackets when optional: `some_function(a: 1, b: 2)`.

## Naming

- Modules: `CamelCase`, keep acronyms uppercase (`SomeXML`, `HTTPClient`).
- Functions and variables: `snake_case`; atoms: `:snake_case`.
- Predicates: trailing `?`. Guard-compatible checks: `is_` prefix (`defguard is_valid(term)`).
- Private functions use `defp` and must not share a name with the public function; give them a distinct name.
- Structs: the module name is the struct name; the main type spec is named `t`.
- Module attributes order: `@moduledoc`, `@behaviour`, `use`, `import`, `require`, `alias`, attributes, `defstruct`, `@type`, `@callback`, then functions.
- `alias` lines are sorted alphabetically.
- ExUnit test modules end with `Test` and live in `test/` mirroring `lib/`.
- Conversion functions use `to_*`; copies use `dup`.

## Types and Data

- Prefer immutable data; use processes for concurrency and agents for state you truly need to mutate.
- Represent errors as `{:error, reason}` tuples so callers pattern match.
- Use `with` for chained fallible operations; it short-circuits on the first non-matching value.
- Use plain maps and keyword lists rather than structs unless the struct has behaviour or a fixed shape.
- Use structs with `defstruct`; list `nil`-defaulting fields as bare atoms and other fields as keyword pairs.
- Use `@type` specs for public functions; define them at the top of the module with `@typedoc`.
- Use `defguard` for reusable guard expressions.
- Avoid `String.to_atom` on user input; atoms are never garbage collected.

## Comments and Documentation

- Every module gets a `@moduledoc`; use `@moduledoc false` when the module is internal.
- Public functions get a `@doc` string; use heredocs with markdown for multi-line docs.
- `@doc` and `@spec` sit together, immediately above the function definition.
- Comments are capitalized sentences with punctuation; limit comment lines to 100 characters.
- Annotation keywords are uppercase followed by a colon and a space: `# TODO: Deprecate in v1.5.`
- Standard annotations: `TODO` (missing feature), `FIXME` (broken code), `OPTIMIZE` (slow code), `HACK` (code smell), `REVIEW` (needs verification).
- Put annotations on the line above the code they refer to.
- Prefer expressive code over comments; delete comments that restate the code.

## Error Handling

- Return `{:ok, value}` or `{:error, reason}` for expected failures.
- Use `raise` for programmer errors and unrecoverable states.
- Exception modules end with `Error`; `defexception [:message]`.
- Error messages are lowercase and have no trailing punctuation.
- Use `with`/`{:ok, x} = ...` for early returns in the happy path.
- Do not rescue exceptions you cannot handle; `rescue` only around the code that can fail.
- Never use `rescue` without a specific error type in library code.
- For validation, use guard clauses (`defguard`) so failures happen at the boundary.

## Testing

- Tests live in `test/` mirroring `lib/`; the test file mirrors the module: `lib/my_module.ex` -> `test/my_module_test.exs`.
- Test modules are named `MyModuleTest` and use `use ExUnit.Case, async: true`.
- Use `async: true` unless the test touches global state or the filesystem.
- Test names describe the behaviour: `test "returns an error for an empty list" do`.
- ExUnit assertions put the expression under test on the left: `assert actual_function(1) == true`.
- Use `assert {:ok, expected} = actual_function(3)` for pattern-match assertions.
- Use `describe` blocks to group related cases.
- Set up data with `setup` blocks; keep each test independent.

## Anti-Patterns

- `String.downcase(String.trim(s))`. Instead: `s |> String.trim() |> String.downcase()`.
- Using the pipe operator once. Instead: call the function directly.
- `unless` with an `else` branch. Instead: rewrite with the positive condition first.
- `do_stuff` without parentheses where it could be a variable. Instead: `do_stuff()`.
- A `defp` with the same name as the public `def`. Instead: give the private helper a distinct name.
- `@moduledoc` placed after `use`. Instead: `@moduledoc` goes first, right after `defmodule`.
- Raising an exception for an expected failure. Instead: return `{:error, reason}`.
- `Enum.map(l, fn x -> transform(x) end)` when a capture works. Instead: `Enum.map(l, &transform/1)`.

## Code Example

```elixir
defmodule MyApp.Users do
  @moduledoc """
  Functions for creating and validating user records.
  """

  alias MyApp.Repo.User

  @min_name_length 2

  @typedoc "A validated user record."
  @type t :: %User{id: integer(), name: String.t(), email: String.t()}

  @doc """
  Builds a user record from a name and an email address.

  Returns `{:ok, user}` when the inputs are valid, or `{:error, reason}`.
  """
  @spec create_user(String.t(), String.t()) :: {:ok, t()} | {:error, String.t()}
  def create_user(name, email) do
    with {:ok, clean_name} <- validate_name(name),
         {:ok, clean_email} <- validate_email(email) do
      {:ok, %User{name: clean_name, email: clean_email}}
    end
  end

  defp validate_name(name) when is_binary(name) do
    trimmed = String.trim(name)

    if String.length(trimmed) >= @min_name_length,
      do: {:ok, trimmed},
      else: {:error, "name is too short"}
  end

  defp validate_name(_name), do: {:error, "name must be a string"}
end
```

## Sources

- https://github.com/christopheradams/elixir_style_guide
- https://hexdocs.pm/elixir/naming-conventions.html
- https://hexdocs.pm/mix/Mix.Tasks.Format.html
- https://hexdocs.pm/ex_unit/ExUnit.html
