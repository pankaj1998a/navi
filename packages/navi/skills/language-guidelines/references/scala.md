# Scala Style Guide

> Source: Scala Style Guide (https://docs.scala-lang.org/style/) plus Effective Scala (https://twitter.github.io/effectivescala/)

## Quick Rules

- Indent with 2 spaces, never tabs.
- Use `UpperCamelCase` for classes, traits, and objects; `lowerCamelCase` for methods, values, and parameters.
- Acronyms are treated as ordinary words: `xHtml`, `maxId` - never `XHTML` or `maxID`.
- Underscores in names are strongly discouraged; they have special meaning in Scala syntax.
- Always give public methods an explicit return type; private and local methods may infer it.
- Prefer `val` over `var`; a `var` in a class body should be a deliberate, documented choice.
- Prefer immutability and pure functions; use `case class` for data, `sealed trait` for closed hierarchies.
- Use `Option` for absence and `Either` for two possible outcomes - never exceptions for expected conditions.
- Prefer `match` over long `if`/`else` chains; use `for` comprehensions over chained `map`/`flatMap`/`filter`.

## Formatting

- Indent: 2 spaces per level. Tabs are not used.
- Line wrapping: keep expressions under about 80 characters. When wrapping, indent continuation lines 2 spaces from the first.
- Constructor arguments stay on one line unless the line exceeds roughly 100 characters; then one argument per line with a trailing comma.
- `extends`/`with` clauses go on the same line, or one per line when the list is long, separated from the body by a blank line.
- Method modifiers in order: annotations (each on its own line), `override`, access modifier, `implicit`, `final`, then `def`.
- Field declarations come before method declarations in a class.
- Space after the colon in a type annotation: `val name: String = "x"`. `if`, `for`, `while` need a space after the keyword.
- Method invocation: no space around the dot, no space before the argument list, one space after each comma.
- Symbolic operators are invoked infix with spaces: `a + b`, not `a+b`. Arity-0 side-effecting methods keep their parentheses.
- Braces may be omitted for a pure-functional `if` with an `else` branch; `while` always uses braces.

## Naming

- Classes, traits, objects: `UpperCamelCase` - `OrderRepository`, `MoneyTransfer`.
- Methods and values: `lowerCamelCase` - `findById`, `orderTotal`.
- Constants: `UpperCamelCase` (Scala convention, not `SCREAMING_SNAKE_CASE`) - `MaxRetries`.
- Packages: all lowercase, no underscores - `com.example.shop`, `org.scalameta`.
- Accessors are named for the property: `def price: BigDecimal`. Mutators append `_=`: `def price_=(value: BigDecimal)`.
- Boolean accessors may be prefixed with `is` when there is no corresponding mutator: `def isEmpty: Boolean`.
- Type parameters: short `UpperCamelCase` - `T`, `A`. Prefer `+A`/`-A` variance annotations.
- Use `other` for the second operand of symmetric operators. Implicits get descriptive names.

## Types and Data

- Use `sealed trait` with `case object`/`case class` subtypes for closed algebraic hierarchies.
- Use `Option[T]` instead of `null`; use `Either[A, B]` (or `Try`) for expected failures.
- Use `sealed` on traits that define an algebraic data type to restrict subtypes to the same file.
- Prefer `Try` or `Either` over exceptions for recoverable failures; use exceptions only for programmer errors.
- Use `Option` combinators (`map`, `flatMap`, `fold`, `getOrElse`) rather than `get`.

## Comments and Documentation

- Scaladoc comments (`/** ... */`) for all packages, classes, traits, objects, and public methods.
- Start with a one-line summary, then a blank comment line and details. Scaladoc text begins on the first line of the comment.
- Describe what the method does, not what it should do. Use `//` for implementation comments explaining *why*, not *what*.
- Use `TODO` markers sparingly; prefer an issue tracker.

## Error Handling

- Model expected failures as values: `Either[Error, Result]` or `Try[T]`.
- Throw exceptions only for programming errors or unrecoverable states.
- When throwing, name the failing value and the expectation: `throw new IllegalArgumentException(s"quantity must be positive, got $quantity")`.
- Catch the narrowest exception type; never use `catch { case _: Throwable => ... }` to swallow.
- Use `scala.util.control.NonFatal` when you must filter fatal exceptions.
- Do not use `try`/`catch` for control flow.
- Provide `Either`-returning wrappers at API boundaries so callers are not forced to use exceptions.

## Testing

- Layout: `src/test/scala/...` mirrors `src/main/scala/...`.
- Framework: ScalaTest is the common choice; `FunSuite` or `AnyFunSuite` for unit tests, `AnyWordSpec` for behavior specs.
- Name the test class after the class under test - `OrderRepositorySpec`.
- Test names describe behavior: `test("returns NotFound for a missing order")`.
- Use `Either` assertions such as `result.left.value shouldBe ...` rather than `try/catch` in tests.
- Avoid global mutable state between tests; build fresh fixtures per test.

## Anti-Patterns

- `var` in a class body. Instead: `val` plus immutable collections.
- `null` for absence. Instead: `Option`.
- A long `if`/`else if` chain. Instead: `match` with `case` clauses.
- `asInstanceOf` to defeat the type system. Instead: pattern matching with `case`.
- `procedure syntax` (`def foo() { ... }`). Instead: `def foo(): Unit = { ... }`.
- Chained `map().flatMap().filter()`. Instead: a `for` comprehension.
- `null` checks scattered through call sites. Instead: `Option` combinators.

## Code Example

```scala
package com.example.shop

/** Errors that can occur while pricing an order. */
sealed trait PricingError extends Product with Serializable

/** The requested quantity was not positive. */
final case class InvalidQuantity(quantity: Int) extends PricingError

/** An order total calculation. */
final case class Order(unitPrice: BigDecimal, quantity: Int) {

  /** Computes the undiscounted total.
    *
    * @return the total price of the order
    */
  def total: BigDecimal = {
    if (quantity <= 0) {
      throw new IllegalArgumentException(s"quantity must be positive, got $quantity")
    }
    unitPrice * BigDecimal(quantity)
  }
}

/** Prices a list of orders, collecting the failures.
  *
  * @param orders the orders to price
  * @return a right value with the totals, or a left value with the first error
  */
def priceAll(orders: List[Order]): Either[InvalidQuantity, List[BigDecimal]] = {
  val results = orders.map { order =>
    Either.cond(order.quantity > 0, order.total, InvalidQuantity(order.quantity))
  }
  results.collectFirst { case Left(error) => error }.toLeft
    .flatMap(_ => Right(results.collect { case Right(total) => total }))
}
```

## Sources

- https://docs.scala-lang.org/style/
- https://twitter.github.io/effectivescala/
- https://github.com/databricks/scala-style-guide
