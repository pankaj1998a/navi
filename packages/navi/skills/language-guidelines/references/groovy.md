# Groovy Style Guide

> Source: Apache Groovy Style Guide (https://groovy-lang.org/style-guide.html), which is also published at https://groovy.apache.org/style-guide.html. The `groovy-lang.org` URL redirects to the Apache Groovy site; the content is identical. Rules below that go beyond the guide (Gradle project layout, Spock naming) are community consensus and are labelled as such.

## Quick Rules
- Omit semicolons at line ends. They are optional and their presence signals pasted Java.
- Do not mix `def` and explicit types. Pick one per declaration; never write `def String name = "Guillaume"`.
- Omit the `public` modifier - it is the default. Only add a modifier when the member is not public.
- Use a concrete return type on every public method, especially a `def` method, so a stray last expression cannot silently become the return value.
- Use `==` for value comparison (it maps to `equals()` and is null-safe). Use `is()` only for reference identity.
- Use single-quoted strings for constants; use double quotes / GStrings only when interpolation is needed.
- Use `?.` for safe navigation instead of nested null checks, and `?:` (Elvis) for defaults.
- Use `assert` for validation; Groovy asserts are always active and do not need `-ea`.
- Prefer native syntax: lists, maps, ranges, `~/regex/`, and GDK methods (`each`, `find`, `collect`) over hand-rolled loops.

## Formatting
- Indentation: 4 spaces, no tabs.
- Line length: 120 characters is a practical ceiling; break long expressions rather than letting them run off.
- Braces: same-line opening brace, closing brace on its own line.
- One statement per line; semicolons only when two statements must share a line.
- Blank line between methods and between logical sections of a class; no blank line at the start or end of a method body.
- Import ordering: standard library and third-party imports in one group, sorted alphabetically. Use import aliasing (`import java.util.List as UtilList`) instead of fully-qualified names in code.
- File header: optional license block, then package, then imports, then the class. One blank line between sections.
- No trailing whitespace; file ends with a newline.

## Naming
- Classes and interfaces: `UpperCamelCase` nouns: `class ServerConfig`.
- Methods and functions: `lowerCamelCase` verbs: `def processRecords()`.
- Variables and properties: `lowerCamelCase`; constants: `UPPER_SNAKE_CASE`.
- Packages: all lowercase, no underscores: `org.example.project`.
- Fields in a POGO: `lowerCamelCase` (`String name`); the compiler generates the private field plus getter/setter.
- Booleans read as predicates - `isEnabled`, `hasErrors` rather than `enabled` alone.
- Test specifications (Spock): full sentences describing behaviour, e.g. `"returns an empty list when no records exist"`.
- Do not prefix getters with `get` when Groovy property access already covers it.

## Types and Data
- Prefer explicit types on public API surfaces (methods, properties, return types) so contracts are documented and IDE completion works.
- `def` is fine for local variables whose type is obvious from the initialiser.
- Use `@CompileStatic` or `@TypeChecked` on performance-sensitive or public-API code so type errors are caught at compile time.
- Prefer immutable collections (`List`, `Set`, `Map` from `asImmutable()`) over mutable ones for values passed around.
- Use GStrings (`"..."`) for interpolation; use `"${expr}"` when the expression is not a simple variable, and `$var` for simple ones.
- Use triple-double-quotes for multi-line strings and call `.stripIndent()` when the indentation should be removed.
- Use slashy strings `/pattern/` for regular expressions so backslashes need not be doubled.
- Use native collection literals (`[1, 4, 6]`, `[CA: 'California']`) rather than `new ArrayList()` / `new HashMap()`.
- Use ranges (`10..20` inclusive, `10..<20` exclusive) instead of manual bounds checks.

## Comments and Documentation
- Use `/** ... */` GroovyDoc for classes, methods, and properties that are part of the public API.
- GroovyDoc tags: `@param`, `@return`, `@throws`, in that order. Put a summary sentence first.
- Implementation comments use `//`; prefer a comment above the code over trailing comments.
- Comments should explain intent. Do not narrate the next line.
- TODO format: `// TODO(owner): description`.
- Avoid commented-out code.

## Error Handling
- Groovy uses the standard JVM exception model. Throw a specific type with a useful message: `throw new IllegalStateException("Cannot resolve ${name}")`.
- Do not use exceptions for ordinary control flow. Prefer returning `null` or an `Optional` for "not found".
- Groovy's `assert` is the idiomatic validation tool: `assert name` (non-null and non-empty by Groovy Truth) and `assert name?.size() > 3`.
- Use `catch (any)` only when the exception type truly does not matter; catch `Exception` explicitly otherwise.
- Always include the cause when wrapping: `throw new RuntimeException("Failed to load $path", e)`.

## Testing
- Frameworks: JUnit 4/5 for unit tests, Spock for specification-style tests, TestNG where the project already uses it.
- Layout: `src/test/groovy/<package>/...` mirrors `src/main/groovy/<package>/...`.
- Groovy test classes extend `groovy.util.GroovyTestCase` (or `Specification` under Spock).
- Spock feature files live in `src/test/resources/<package>/<FeatureName>.feature` with `Feature:` / `Scenario:` / `then:` blocks.
- Test method names in plain JUnit: `testXxx` in the JUnit 3 style, or `shouldXxx` under Spock.
- Test data with data tables (`where:` blocks in Spock) instead of copy-pasted scenarios.
- Assert on observable behaviour; avoid asserting on private fields.

## Anti-Patterns
- `def String name = "x"` - instead write `String name = "x"`; never mix `def` and a type.
- `public class Foo { public void bar() {} }` - instead omit `public` entirely.
- `if (name != null && name.length() > 0)` - instead use `if (name)` and Groovy Truth.
- `if (status != null && status.equals(CONST))` - instead use `status == CONST`; `==` is null-safe.
- `throw new Exception("Unable to convert " + resource)` - instead use a GString: `throw new IllegalArgumentException("Unable to convert ${resource}")`.
- Nested `if (obj != null) { if (obj.getChild() != null) { ... } }` - instead use `obj?.child?.value`.
- `def result = name != null ? name : "Unknown"` - instead use the Elvis operator: `def result = name ?: "Unknown"`.
- A `def` method whose body ends in an `if`/`else` - instead give the method an explicit return type so the last-expression rule cannot surprise you.

## Code Example
```groovy
package org.example.service

import groovy.transform.CompileStatic
import org.slf4j.Logger
import org.slf4j.LoggerFactory

/**
 * Resolves a service endpoint for a given region.
 */
@CompileStatic
class EndpointResolver {

    private static final Logger log = LoggerFactory.getLogger(EndpointResolver)

    private static final String DEFAULT_REGION = 'us-central1'

    private final Map<String, String> endpoints

    EndpointResolver(Map<String, String> endpoints) {
        this.endpoints = endpoints
    }

    /**
     * Returns the endpoint URL for a region, or the default when unknown.
     */
    String resolve(String region) {
        String key = region ?: DEFAULT_REGION
        String endpoint = endpoints[key]

        if (endpoint == null) {
            log.warn('No endpoint configured for region {}; using default', key)
            endpoint = endpoints[DEFAULT_REGION]
        }

        return endpoint
    }
}
```

## Sources
- https://groovy-lang.org/style-guide.html
- https://groovy.apache.org/style-guide.html
- https://groovy.apache.org/documentation.html
- https://spockframework.org/spock/documentation/
