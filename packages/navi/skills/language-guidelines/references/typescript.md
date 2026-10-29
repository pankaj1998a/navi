# TypeScript Style Guide

> Source: Google TypeScript Style Guide (https://google.github.io/styleguide/tsguide.html) plus TypeScript Handbook Do's and Don'ts (https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)

## Quick Rules

- Indent with 2 spaces. Use double quotes for strings. Terminate every statement with a semicolon.
- Use `const` by default, `let` when reassignment is needed, and never `var`. Declare one variable per statement.
- Use named exports only. `export default` is disallowed.
- Names must be descriptive. No ambiguous abbreviations, no Hungarian notation, no `opt_` prefix.
- `UpperCamelCase` for types, `lowerCamelCase` for values, `CONSTANT_CASE` for immutable module-level constants.
- Prefer `interface` over a `type` alias for object shapes; prefer `unknown` over `any`.
- Document public API with JSDoc (`/** ... */`); use `//` for implementation comments.

## Formatting

- Indent: 2 spaces per level. No tabs.
- Line length: 80 characters is the Google target; longer lines are permitted when breaking them hurts readability.
- One space after commas, around `=`, and around binary operators.
- No space after `(` or before `)`, and no space before `:` in a type annotation.
- Braces on the same line for control statements: `if (x) { ... }`.
- Exactly one blank line between top-level declarations; separate imports from other code with a blank line.
- File order: copyright (if any), `@fileoverview` JSDoc, imports, implementation - each separated by one blank line.

## Naming

- Classes, interfaces, types, enums, decorators, type parameters: `UpperCamelCase` - `OrderRepository`, `T`.
- Variables, parameters, functions, methods, properties, module aliases: `lowerCamelCase` - `findById`, `orderTotal`.
- Module-level immutable constants and enum values: `CONSTANT_CASE` - `MAX_RETRIES`.
- Files: `snake_case` - `order_repository.ts`. Namespace imports are `lowerCamelCase` - `import * as fooBar from './foo_bar';`.
- Treat acronyms as words: `loadHttpUrl`, not `loadHTTPURL`. Test method names may use `testX_whenY_doesZ()` in xUnit-style frameworks.
- Do not decorate names with type information already in the type: no `customerIdString`, no `MyFooInterface`.
- Interfaces introduced for a class should express *why* they exist: `TodoItemStorage`, not `ITodoItem`.

## Types and Data

- Rely on type inference for trivially inferred types; omit redundant annotations like `const x: boolean = true`.
- Annotate complex expressions and generic containers that would otherwise infer as `unknown`.
- Use `interface` for object types; use `type` for unions, tuples, and aliases of primitives.
- Prefer optional properties and parameters (`?`) over `| undefined` in unions.
- Type aliases must not include `| null` or `| undefined`; add nullability at the point of use.
- Avoid `any`. Use a specific type, `unknown`, or, if unavoidable, suppress the lint with a documented reason.
- Never use the `{}` type; use `unknown`, `Record<string, T>`, or `object`. Prefer `T[]` for simple element types.
- Do not use the wrapper types `String`, `Number`, `Boolean`; always use the lowercase primitives.
- `as` casts are a last resort; prefer type guards, `satisfies`, or a better-typed API.

## Comments and Documentation

- Use `/** ... */` JSDoc for documentation a user of the code should read; use `//` for implementation notes.
- Multi-line comments must use multiple `//` lines, not `/* */` block style.
- JSDoc is Markdown. Use `-` for lists, since plain text is flattened by tooling.
- Most JSDoc tags occupy their own line: `@param`, `@return`, `@deprecated`. Do not combine `@param` tags on one line.
- Wrap long tag descriptions with four spaces of continuation indent.
- Document all exported symbols of a module. Do not restate the parameter name in the description.
- Do not declare types in `@param`/`@return` - the compiler already knows them.
- Place the JSDoc block *before* any decorator. Use `@deprecated` with clear migration instructions.

## Error Handling

- Reject with `Error` subclasses (or `unknown` caught and narrowed), not with strings.
- Use `throw new TypeError("...")` for a caller mistake and `new Error("...")` for an internal failure.
- Always include the offending value or the expectation in the message: `throw new RangeError(\`count must be <= limit, got ${count}\`);`
- Catch with `catch (error: unknown)` and narrow before use, or type the catch variable.
- Never swallow an error silently; rethrow with context or log it.
- Use `try`/`catch` only where the error can be handled; do not use it for control flow.
- In async code, `await` the promise and handle rejection at the call site; avoid floating promises.

## Testing

- Layout: `*_test.ts` next to the source or in a `test/` directory; `*.test.ts` for integration specs.
- Framework: Jasmine or Jest. Test names read as sentences: `it('returns an error for a negative count', ...)`.
- Use `beforeEach`/`afterEach` for fixture lifecycle; avoid shared mutable state between tests.
- Mock only external boundaries; prefer fakes and dependency injection over heavy mocking.
- Keep the type checker enabled in tests; use `as` only with a written justification.

## Anti-Patterns

- `var` anywhere. Instead: `const` or `let`.
- `export default`. Instead: named exports.
- `any` to silence the compiler. Instead: `unknown` and narrow it.
- `namespace Foo { }` or `import x = require(...)`. Instead: ES modules in separate files.
- `for (const key in obj)`. Instead: `for (const [key, value] of Object.entries(obj))`.
- A container class used only to namespace static members. Instead: export the constants and functions directly.
- `new Array()` / `new Object()`. Instead: use array and object literals.
- A type alias for an object shape. Instead: use an `interface`.

## Code Example

```typescript
/** Options accepted by {@link createOrder}. */
export interface CreateOrderOptions {
  /** The customer placing the order. */
  readonly customerId: string;
  /** The unit price of each item, in cents. */
  readonly unitPriceCents: number;
  /** How many items to order. */
  readonly quantity: number;
}

/** An order that has been validated and priced. */
export interface Order {
  readonly customerId: string;
  readonly totalCents: number;
}

/**
 * Creates a priced order.
 *
 * @throws {RangeError} if the quantity or unit price is not positive.
 */
export function createOrder(options: CreateOrderOptions): Order {
  if (options.quantity <= 0) {
    throw new RangeError(`quantity must be positive, got ${options.quantity}`);
  }
  if (options.unitPriceCents <= 0) {
    throw new RangeError(`unitPriceCents must be positive`);
  }

  return {
    customerId: options.customerId,
    totalCents: options.unitPriceCents * options.quantity,
  };
}
```

## Sources

- https://google.github.io/styleguide/tsguide.html
- https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html
- https://basarat.gitbook.io/typescript/styleguide
