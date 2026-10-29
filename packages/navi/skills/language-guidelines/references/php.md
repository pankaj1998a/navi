# PHP Style Guide

> Source: PHP-FIG PSR-12 Extended Coding Style Guide (https://www.php-fig.org/psr/psr-12/) and PSR-1 Basic Coding Standard (https://www.php-fig.org/psr/psr-1/), plus PHPUnit conventions (https://phpunit.de/)

## Quick Rules

- Use `<?php` to open a file; never close it with `?>` in a pure-PHP file. Encode UTF-8 without BOM.
- Indent with 4 spaces, never tabs. Soft line limit 120 characters; keep most lines under 80.
- Declare `declare(strict_types=1);` right after the opening tag.
- One class per file, PSR-4 autoloading: `namespace Vendor\Package;` and `StudlyCaps` class names.
- Constants are `UPPER_SNAKE_CASE`; methods and functions are `camelCase`; properties are `$camelCase`.
- Braces for classes and methods go on their own line; control structures put `{` on the same line as the condition.
- Visibility (`public`/`protected`/`private`) is mandatory on every property, constant (PHP 7.1+), and method. `var` is forbidden.
- Throw exceptions; do not return error codes. Never swallow an exception without logging or rethrowing.
- Prefer `===` over `==`, and `=== null` to test for null.

## Formatting

- Indent: 4 spaces per level, no tabs. Line length: soft limit 120, prefer 80 or fewer.
- Class opening brace on its own line, closing brace on its own line, nothing after the closing brace.
- Method/function opening brace on its own line. Control structures (`if`, `foreach`, `try`) keep the brace on the same line, one space after `)`.
- `elseif` (not `else if`). `case` bodies are indented one level from `switch`; `break` aligns with the `case` body.
- Binary operators get one space on each side. Casts: `(int) $value`. Increment/decrement attach to the variable.
- No trailing whitespace, one statement per line, LF line endings, file ends with a single newline.
- File header order: `<?php`, docblock, `declare`, `namespace`, class `use` imports, function `use` imports, const `use` imports, code. Each import group is separated by one blank line.

## Naming

- Namespace: `Vendor\Package`. Class/interface/trait: `StudlyCaps` - `OrderRepository`.
- Method and function: `camelCase` - `findById`. Property: `$camelCase` - `$orderDate`.
- Constant: `UPPER_SNAKE_CASE` - `MAX_RETRIES`. Booleans read as predicates: `$isActive`.
- File: one class per file, named after the class in StudlyCaps - `src/Repository/OrderRepository.php`.
- Test: `tests/OrderRepositoryTest.php`, class `OrderRepositoryTest extends TestCase`.

## Types and Data

- Always type-hint parameters and return types: `public function find(int $id): ?Order`.
- Use nullable types `?Order`; avoid implicit null returns. `strict_types=1` in every file.
- Prefer value objects and `final` classes over anemic bags with public setters.
- Use `array` with a docblock shape when a dedicated class is not warranted; use `iterable` for read-only traversals.
- Prefer immutable construction: pass everything to the constructor, expose getters, avoid public mutable state.

## Comments and Documentation

- Use PHPDoc (`/** ... */`) on every public class, method, and function.
- Include `@param` with types and descriptions, `@return` with the type, and `@throws` for documented exceptions.
- Use `/** @var Type */` on array properties that need a shape. Line comments use `//`.
- Keep docblocks in sync with the code; a stale docblock is worse than none.
- Annotate unfinished work as `// TODO(owner): what remains` above the code.

## Error Handling

- Throw `Exception`/`RuntimeException`/`InvalidArgumentException` subclasses; do not return `-1` or `false` as an error channel.
- Catch the narrowest exception you can handle; a bare `catch (Exception $e)` that swallows is forbidden.
- Log with context before rethrowing: `throw new RuntimeException('...', 0, $e);`.
- Validate arguments at the boundary of the public API and throw `InvalidArgumentException`.
- Do not use `error_reporting`/`ini_set` inside library files; that is a side effect.

## Testing

- Layout: `tests/` at project root, mirroring `src/`. One test class per production class.
- Framework: PHPUnit. `extends PHPUnit\Framework\TestCase`. Test method names describe the scenario: `testFindByIdReturnsOrder()`.
- Use the Arrange / Act / Assert structure with a blank line between the phases.
- Use data providers for table-driven cases instead of copy-pasted test bodies.
- Mock only at boundaries (HTTP, database, clock). Prefer real objects and in-memory fakes.
- Assert on behaviour and state, not on the number of calls to a collaborator.

## Anti-Patterns

- Mixing PHP with stray HTML and inline `echo` in class files. Instead: keep views in templates.
- Using `var` or omitting visibility. Instead: `private ?Order $order = null;`.
- Catching `Exception` and doing nothing. Instead: log, rethrow, or narrow the catch.
- Using `==` for comparisons. Instead: use `===`.
- Global mutable state such as `$GLOBALS['db']`. Instead: inject dependencies explicitly.
- Long `if`/`else` chains. Instead: use `switch`, polymorphism, or early returns.

## Code Example

```php
<?php

declare(strict_types=1);

namespace Vendor\Shop;

/**
 * Stores and retrieves orders.
 */
final class OrderRepository
{
    public const DEFAULT_CURRENCY = 'EUR';

    /** @param array<int, Order> $orders */
    public function __construct(private array $orders = [])
    {
    }

    /**
     * Returns the order with the given id.
     *
     * @throws \InvalidArgumentException if no order matches the id.
     */
    public function find(int $id): Order
    {
        if (!isset($this->orders[$id])) {
            throw new \InvalidArgumentException(sprintf('Order %d not found.', $id));
        }

        return $this->orders[$id];
    }
}
```

## Sources

- https://www.php-fig.org/psr/psr-12/
- https://www.php-fig.org/psr/psr-1/
- https://github.com/php-fig/fig-standards/blob/master/accepted/PSR-12-extended-coding-style-guide.md
- https://github.com/php-fig/fig-standards/blob/master/accepted/PSR-1-basic-coding-standard.md
- https://phpunit.de/documentation/
