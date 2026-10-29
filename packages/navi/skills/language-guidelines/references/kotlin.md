# Kotlin Style Guide

> Source: Kotlin Coding Conventions (https://kotlinlang.org/docs/coding-conventions.html), the official JetBrains/Kotlin documentation. The guide is backed by the IntelliJ IDEA "Kotlin style guide" code style, which should be enabled in the project so formatting is automatic.

## Quick Rules
- Indent with 4 spaces. Never use tabs.
- Omit semicolons. Kotlin line breaks are significant, so semicolons are rarely needed.
- Use `val` by default; use `var` only when the value is genuinely reassigned. Do not add a redundant explicit type when the initialiser already provides it.
- Declare classes, objects, and functions with `UpperCamelCase`; properties, parameters, and local variables with `lowerCamelCase`; `const val` and immutable top-level `val` with `UPPER_SNAKE_CASE`.
- Prefer expression bodies for single-expression functions: `fun foo() = 1`.
- Prefer default parameter values over overloads.
- Prefer immutable collection interfaces (`List`, `Set`, `Map`) and `listOf`/`setOf`/`mapOf` over mutable ones.
- Prefer `if`/`else` expressions and `when` expressions over statement forms with `return` inside.
- Use string templates instead of concatenation.
- Document public library API with KDoc; avoid `@param`/`@return` unless the description does not fit in the prose.

## Formatting
- Indentation: 4 spaces. Continuation lines for a long parameter list are indented 4 spaces, with the closing parenthesis on its own line.
- No line-length limit in the guide; keep lines under 120 characters for readability.
- Braces: opening brace on the same line as the declaration, closing brace on its own line at the same indentation.
- Put a space before the colon when it separates a type from a supertype or a delegation target, but not when it separates a declaration from its type. Always a space after the colon.
- Modifier order is fixed: `public / protected / private / internal`, `expect / actual`, `final / open / abstract / sealed / const`, `external / override / lateinit / tailrec / vararg / suspend / inner / enum / annotation / fun`, `companion / inline / value / infix / operator / data`.
- Annotations go on their own line before the declaration, except that a single annotation without arguments may share the line.
- Omit the redundant `public` modifier unless you are writing a library and want an explicit API surface. Omit the `: Unit` return type on a function that returns nothing.
- Trailing commas are encouraged at declaration sites (class parameters, function parameters, enum entries, collection literals) and optional at call sites.
- Omit horizontal alignment of any kind; renaming an identifier must not change surrounding formatting. No trailing whitespace; files end with a newline.

## Naming
- Package: all lowercase, no underscores - `org.example.project`. Multi-word names are discouraged; if needed, concatenate or use camel case.
- Class, object, and interface: `UpperCamelCase` - `open class DeclarationProcessor`, `interface Source`.
- Function, property, and local variable: `lowerCamelCase` - `fun processDeclarations()`, `var declarationCount = 1`.
- Constant: `const val MAX_COUNT = 8`, or a top-level/object `val` with no custom getter holding deeply immutable data - `val USER_NAME_FIELD = "UserName"`.
- Property holding mutable or behavioural data: `lowerCamelCase` - `val mutableCollection: MutableSet<String>`.
- Backing property for a public property: prefix with an underscore - `private val _elementList`, exposed as `val elementList: List<Element> get() = _elementList`.
- Acronyms: two-letter acronyms are fully uppercase (`IOStream`); longer acronyms capitalise only the first letter (`XmlFormatter`, `HttpInputStream`).
- Test functions: underscores and even backticked names with spaces are allowed in test code only - `fun ensureEverythingWorks_onAndroid()`.
- Enum entries: `UPPER_SNAKE_CASE` (`RED`, `GREEN`) or `UpperCamelCase`; pick one per enum.

## Types and Data
- Use `val` over `var` for every local and property that is not reassigned.
- Use immutable collection types in signatures (`Collection`, `List`, `Set`, `Map`) and build them with `listOf`, `setOf`, `mapOf`.
- Use data classes for value carriers: `data class Customer(val name: String, val id: Long)`.
- Use sealed classes or sealed interfaces for closed hierarchies and exhaustively matched `when` expressions.
- Use `when` over a long `if`/`else if` chain; `when` on three or more options is the idiomatic choice. Use `is` for type checks, `as` for casts; prefer safe calls (`?.`) and the elvis operator (`?:`).
- Model absence as nullable (`String?`) rather than as an empty string or a sentinel value. Declare platform types explicitly: a public function returning a Java platform type must state `String`, not leave it inferred.
- Use `typealias` for a functional or generic type that appears in several places, and extension functions liberally for operations that belong to a receiver type.

## Comments and Documentation
- KDoc is `/** ... */`, with each continuation line starting with `*`. A short comment may be on one line. Put the summary first as a sentence: `/** Returns the absolute value of [number]. */`. Link to parameters with square brackets in the prose rather than repeating them in `@param`.
- Use `@param` and `@return` only when a parameter or the return value needs a longer explanation.
- Implementation comments use `//`; a `/* ... */` block is acceptable for a multi-line note. Comments explain intent; do not restate the code.
- TODO format: `// TODO(owner): description`. KDoc on every public member of a library, including overrides only when behaviour differs.

## Error Handling
- Kotlin has no checked exceptions. Use `try`/`catch` for expected failures and `Result<T>` when the failure is part of the function's contract. `runCatching { }` is fine for quick wrapping.
- Throw `IllegalArgumentException` for bad arguments, `IllegalStateException` for invalid state, `IOException` for I/O problems. Use domain-specific exception types when the caller must distinguish them.
- Include a useful message: `throw IllegalArgumentException("id must not be blank")`.
- `?.` and `?:` handle the ordinary nullable path; do not wrap them in try/catch.
- `finally` runs cleanup; use `use { }` for resources that implement `Closeable` so closing is automatic.
- Do not use exceptions for ordinary control flow; return a nullable value or a sealed result type.

## Testing
- Frameworks: JUnit 5 (Jupiter) is the standard; `kotlin.test` provides multiplatform assertions; MockK and Turbine are common Kotlin-native additions.
- Layout: `src/test/kotlin/<package>/...` mirrors `src/main/kotlin/<package>/...`.
- Test class name: `<ClassUnderTest>Test`. Test function names may use backticked sentences: ``fun `returns empty list when no records exist`()``.
- Use `@BeforeEach`/`@AfterEach` for setup and teardown; `@Nested` for grouping related cases.
- Arrange / Act / Assert structure, with a blank line between phases.
- Prefer coroutine test utilities (`runTest`) for suspending functions; never use `Thread.sleep` in tests.
- Assert on observable behaviour and on specific error types: `assertThrows<IllegalArgumentException> { ... }`.
- Use fakes over mocks for value objects and collaborators you own.

## Anti-Patterns
- `var x = 1` for a value never reassigned - instead `val x = 1`.
- `MutableList<String>` as a parameter type for a read-only collection - instead `List<String>`.
- `if (x == null) { return null } else { return y }` - instead use `x ?: y` or an expression body.
- A `when` with two branches - instead use `if`/`else`; `when` is for three or more options.
- String concatenation with `+` - instead use a template: `"$name has ${children.size} children"`.
- `fun foo(): Unit` - instead omit the return type.
- `public` on every member - instead omit it unless writing a library with an explicit API surface.
- `!!` to force a non-null value - instead use `?.`, `?:`, or an `if` guard.

## Code Example
```kotlin
package org.example.config

/**
 * Reads a service configuration from a `key=value` document.
 *
 * @param source the raw configuration text
 * @throws IllegalArgumentException if a required key is missing
 */
class ConfigLoader(private val source: String) {

    private val values: Map<String, String> =
        source.lines()
            .mapNotNull { line ->
                val separator = line.indexOf('=')
                if (separator <= 0) null
                else line.substring(0, separator).trim() to line.substring(separator + 1).trim()
            }
            .toMap()

    /**
     * Returns the configured service name, or the default when absent.
     */
    fun serviceName(default: String = "unnamed-service"): String = values["name"] ?: default

    /**
     * Returns the configured retry count.
     *
     * @throws IllegalArgumentException if the value is not a positive integer
     */
    fun retryCount(): Int {
        val raw = values["retries"] ?: return 3
        val count = raw.toIntOrNull()
            ?: throw IllegalArgumentException("retries must be an integer, got '$raw'")
        require(count > 0) { "retries must be positive, got $count" }
        return count
    }
}
```

## Sources
- https://kotlinlang.org/docs/coding-conventions.html
- https://kotlinlang.org/docs/kotlin-doc.html
- https://kotlinlang.org/docs/idioms.html
