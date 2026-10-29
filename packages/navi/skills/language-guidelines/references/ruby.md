# Ruby Style Guide

> Source: The Ruby Style Guide (https://rubystyle.guide) plus RuboCop Ruby Style Guide (https://github.com/rubocop/ruby-style-guide)

## Quick Rules

- Indent with 2 spaces, never tabs. Limit lines to 80 characters.
- Use `snake_case` for symbols, methods, and variables; `CapWords` for classes and modules; `SCREAMING_SNAKE_CASE` for constants.
- One class or module per file; the file name is the class name in `snake_case` - `order_repository.rb`.
- Never use `;` to terminate a statement. One expression per line.
- Do not use `return` for the last expression of a method; let the method return its value implicitly.
- Use `raise` (not `fail`) and never rescue `Exception`; rescue the narrowest class possible.
- Predicate methods end in `?`; dangerous variants end in `!` and a safe version must exist.
- Do not mutate arguments or the caller's collections. Duplicate before you modify.

## Formatting

- Indentation: 2 spaces per level, soft tabs.
- Line length: 80 characters maximum; teams may go to 100 or 120 but never beyond.
- No trailing whitespace. End each file with a newline. Use Unix line endings.
- Spaces around operators, after commas, colons, and semicolons. No spaces after `(` `[` or before `]` `)`.
- `{` and `}` are surrounded by spaces: `{ one: 1, two: 2 }`. No padded spacing inside interpolation: `"#{user.first_name}"`.
- Indent `when` and `else` to the same level as `case`. No space after `!`, no space inside range literals (`1..3`).
- Multi-line method chains: put the `.` at the start of the continuation line and align consistently.
- Use `do...end` for multi-line blocks, `{...}` for single-line blocks. Hash literals use `key: value`.
- Blank line between method definitions; no more than one consecutive blank line.

## Naming

- Symbols, methods, variables: `snake_case` - `order_total`, `:paid_status`.
- Classes and modules: `CapWords` - `OrderRepository`. Keep acronyms uppercase - `HTTPClient`, `XMLParser`.
- Constants: `SCREAMING_SNAKE_CASE` - `MAX_RETRIES`. Files and directories: `snake_case`.
- One class per file, named after the class.
- Predicate methods end in `?` - `valid?`, `empty?`. Never prefix with `is_`, `has_`, or `can_`.
- The parameter of a symmetric binary operator is named `other`: `def +(other)`. Instance variables: `@name`; avoid class variables `@@`.

## Types and Data

- Ruby is dynamically typed; use duck typing and avoid `is_a?` checks unless genuinely required.
- Freeze immutable values: `FROZEN_STRING_LITERAL` magic comment at the top of the file.
- Prefer `Struct` or `Data.define` for value objects with a `keyword_init: true` constructor.
- Use keyword arguments for options with more than a couple of flags; avoid option hashes for booleans.
- Prefer `nil` for absence. Do not use `false` as a sentinel.
- Use `==` for value equality and `equal?` for identity. Use `case`/`when` for multi-way branching.
- Do not mutate collections owned by a caller: `dup` before `sort!`, `map!`, `<<`.
- Avoid class variables and `define_method` metaprogramming; prefer plain methods and modules.

## Comments and Documentation

- Write self-documenting code; delete comments that restate the code.
- Comment the *why*: a workaround for non-obvious library behavior, or the source of an algorithm.
- Comments are in English, one space after `#`, capitalized, with punctuation.
- Annotation keywords go on the line above the code: `# FIXME: crashes since v3.2.1`.
- Supported annotations: `TODO`, `FIXME`, `OPTIMIZE`, `HACK`, `REVIEW`. Document any custom keyword in the project README.
- Use RDoc (`#` comments at the top of a method) for API documentation. Avoid RD block comments (`=begin`/`=end`).
- Keep comments up to date; an outdated comment is worse than none.

## Error Handling

- `raise SomeError, "message"` - class plus message as two arguments, never an instance.
- Do not specify `RuntimeError` explicitly in the two-argument form. Prefer `raise` over `fail`.
- Use implicit `begin` blocks in methods (`def` ... `rescue` ... `end`) rather than an explicit `begin`.
- Never rescue `Exception`; rescue `StandardError` or a more specific class.
- Order rescue clauses from most specific to least specific.
- Do not suppress exceptions silently. A bare `rescue` body must either handle the error or explain why it is safe to ignore.
- Avoid `rescue` as a modifier (`foo rescue nil`); it hides too much. Do not use exceptions for normal control flow.
- `ensure` blocks must not `return` - the return swallows the in-flight exception.

## Testing

- Layout: `spec/` for RSpec, `test/` for Minitest. One file per class: `spec/models/order_repository_spec.rb`.
- RSpec: `describe OrderRepository do ... end` with `it "returns the order" do ... end`.
- Minitest: `class OrderRepositoryTest < Minitest::Test` with `def test_returns_the_order`.
- Use `let` for setup, `subject` for the unit under test, and `before`/`after` for lifecycle.
- Arrange / Act / Assert, separated by blank lines.
- Use `expect { ... }.to raise_error(SpecificError)` rather than a bare `raise_error`.
- Prefer real objects and doubles over heavy mocking; stub only external calls. RuboCop is the reference implementation of this guide; run it in CI.

## Anti-Patterns

- `def method; return value; end`. Instead: let the last expression be the return value.
- Rescuing `Exception` or `StandardError` with an empty body. Instead: rescue the specific error and handle it.
- `has_many` / `is_valid` style predicate prefixes. Instead: `many?`, `valid?`.
- `def ==(other)` on a class with no `hash` / `eql?`. Instead: implement all three together.
- Modifying an argument in place. Instead: `dup` the argument first.
- Using `@@class_variable`. Instead: use a class method or a constant.
- A method longer than a screen. Instead: extract helper methods with meaningful names.

## Code Example

```ruby
# frozen_string_literal: true

module Shop
  # Repositories read and write orders.
  class OrderRepository
    class OrderNotFound < StandardError; end

    MAX_RETRIES = 3

    # @param orders [Array<Order>] initial orders
    def initialize(orders = [])
      @orders = orders.to_h { |order| [order.id, order] }
    end

    # Finds an order by id.
    #
    # @param id [Integer] the order identifier
    # @return [Order]
    # @raise [OrderNotFound] when no order matches the id
    def find(id)
      @orders.fetch(id) do
        raise OrderNotFound, "Order #{id} not found"
      end
    end

    # @return [Boolean] true when the order is paid in full
    def paid?(order)
      order.amount_paid >= order.total
    end
  end
end
```

## Sources

- https://rubystyle.guide/
- https://github.com/rubocop/ruby-style-guide
- https://github.com/airbnb/ruby
- https://rubocop.org/
