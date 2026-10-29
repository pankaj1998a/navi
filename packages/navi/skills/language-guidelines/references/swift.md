# Swift Style Guide

> Source: Swift API Design Guidelines (https://www.swift.org/documentation/api-design-guidelines/) plus GitHub Swift Style Guide (https://github.com/github/swift-style-guide)

## Quick Rules

- Indent with 4 spaces. No tabs. Keep lines under 100 characters.
- Types and protocols: `UpperCamelCase`. Everything else: `lowerCamelCase`. Acronyms are uniformly cased: `utf8Bytes`, `isRepresentableAsASCII`.
- Use `let` by default; use `var` only when the value genuinely changes. `let` guarantees immutability and signals intent.
- Avoid force-unwrapping (`foo!`) and implicitly unwrapped optionals (`var foo: Foo!`). Prefer `if let`, `guard let`, and `?.`.
- Return early with `guard` rather than nesting the happy path inside `if`/`else`.
- Prefer `struct` over `class` unless you need reference semantics, identity, or inheritance. Mark classes `final` by default.
- Write a documentation comment for every declaration, starting with a one-sentence summary.
- Prefer methods and properties over free functions; use `throws` rather than returning error sentinels.

## Formatting

- Indent: 4 spaces per level. No tabs. Line length: 100 characters is a reasonable target.
- Opening brace on the same line as the declaration, closing brace on its own line at the declaration's indentation.
- Type annotations bind to the identifier: `let timeToCoffee: NSTimeInterval = 2`, `func makeCoffee(type: CoffeeType) -> Coffee`. Dictionary types keep the colon attached to the key type: `[Country: City]`.
- One space on each side of binary operators and assignment; no space after a colon in a type.
- `self` is implicit unless a closure or a shadowing name requires it.
- Separate declarations with a blank line; use vertical whitespace to divide logical chunks. End files with a newline; no trailing whitespace.

## Naming

- Types, protocols, and extensions of them: `UpperCamelCase` - `OrderRepository`, `HttpClient`.
- Functions, methods, properties, variables, constants: `lowerCamelCase` - `findById`, `orderTotal`.
- Acronyms and initialisms that are all upper case in English are uniformly up- or down-cased: `utf8Bytes`, `userSMTPServer`. Other acronyms are treated as ordinary words: `radarDetector`.
- Enum cases are `lowerCamelCase` for cases of a type: `HttpMethod.get`. Protocol names describe behavior, not structure: `Collection`, `Codable`.
- Boolean properties read as assertions: `isEmpty`, `hasExpired`. Avoid `is` prefixes on non-boolean returns.
- Argument labels: the first argument usually has no label when the call reads as a phrase (`append(_:)`), otherwise a label is required (`remove(at:)`).
- Methods may share a base name when they share the same meaning (`contains(_:)`) but not when they differ (`index()` vs `index(_:inTable:)`).
- Avoid overloading on return type alone - it creates ambiguity under type inference. Type parameters: short `UpperCamelCase` - `T`, `Element`.

## Types and Data

- Use value types (`struct`, `enum`) unless you need reference identity, inheritance, or `deinit`.
- Model absent values with `Optional` and use optional chaining, `map`, `flatMap`, and `??`.
- Use `throws` and `async`/`await` rather than `Result` wrappers for error propagation in modern Swift.
- Avoid force casts (`as!`); use `as?` with a guard, or make the types concrete. Use `Codable` for anything crossing a serialization boundary.

## Comments and Documentation

- Use `///` documentation comments for declarations, `//` for implementation notes.
- Start the doc comment with a one-sentence summary, written as a fragment ("Returns the ...") and ending with a period. Add a blank `///` line, then further paragraphs in complete sentences.
- Use Markdown in doc comments and the recognized symbol commands: `Attention`, `Author`, `Bug`, `Complexity`, `Copyright`, `Date`, `Important`, `Invariant`, `Note`, `Parameter`, `Parameters`, `Precondition`, `Remark`, `Requires`, `Returns`, `SeeAlso`, `Since`, `Throws`, `ToDo`, `Version`, `Warning`.

## Error Handling

- Use `throws` for recoverable errors and `async throws` for asynchronous ones. Declare the specific error type when the set is closed.
- Handle errors with `do`/`catch`, `try?`, or `try!` (only for genuinely impossible failures). Never use a force-unwrapped `try!` in production code.
- Custom errors conform to `Error` and are `enum`s with associated values so callers can match on them.
- Prefer `defer` for cleanup that must run on every exit path.
- Avoid `fatalError` in library code; it is appropriate only in application code for unreachable states.
- Never swallow an error silently; log it or rethrow with context.

## Testing

- Layout: `Tests/` directory with one test target per module, mirroring the source layout.
- Framework: XCTest for the platform target, Swift Testing (`import Testing`) for new code.
- Test type names end in `Tests` - `OrderRepositoryTests`. Method names read as assertions: `func testFindByIdReturnsOrder() async throws`. With Swift Testing use `@Test func findByIdReturnsOrder() throws`.
- Use `XCTAssertEqual`, `XCTAssertThrowsError`, and `XCTUnwrap`; prefer `XCTUnwrap` over force-unwrapping in tests.

## Anti-Patterns

- Force-unwrapping an optional (`value!`). Instead: `guard let value else { return }` or `if let`.
- An implicitly unwrapped optional property (`var x: Int!`). Instead: `var x: Int?`.
- A class hierarchy where value types would do. Instead: use structs and protocols.
- `self.` everywhere. Instead: omit `self` unless the compiler requires it.
- Free functions where a method or property fits. Instead: attach to a type.
- A `var` used where the value never changes. Instead: `let`.
- `as!` casts. Instead: `as?` with a guard, or fix the types.
- Method families with many overloads instead of default parameters.

## Code Example

```swift
import Foundation

/// Errors raised while charging for an order.
public enum PaymentError: Error, Equatable {
    /// The order total was not a positive amount.
    case invalidTotal(amount: Decimal)
}

/// A single purchasable order.
public struct Order: Equatable {
    /// The unique identifier of the order.
    public let id: UUID
    /// The total charged for the order, in the order currency.
    public let total: Decimal
}

/// Validates and charges orders.
public struct OrderCheckout {
    private let processor: PaymentProcessor

    /// Creates a checkout service.
    public init(processor: PaymentProcessor) {
        self.processor = processor
    }

    /// Charges the given order.
    /// - Throws: `PaymentError.invalidTotal` when the total is not positive.
    public func checkout(order: Order, lastFour: String) async throws {
        guard order.total > 0 else {
            throw PaymentError.invalidTotal(amount: order.total)
        }
        try await processor.charge(amount: order.total, lastFour: lastFour)
    }
}
```

## Sources

- https://www.swift.org/documentation/api-design-guidelines/
- https://github.com/github/swift-style-guide
- https://developer.apple.com/documentation/swift
