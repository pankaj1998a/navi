# D Style Guide

> Source: The D Style (https://dlang.org/dstyle.html) plus the D Language Foundation documentation at https://dlang.org/ and Phobos source conventions

## Quick Rules

- Use 4 spaces per indentation level; spaces only, never tabs; one statement per line.
- Put the opening brace of a function, class, struct, or namespace on its own line.
- Name modules and packages in all lowercase with underscores; name types in `PascalCase`, functions and variables in `camelCase`.
- State the return type explicitly wherever possible.
- Keep lines to a soft limit of 80 characters and a hard limit of 120.
- Prefer property functions over getter/setter pairs; properties are nouns, functions are verbs.
- Document every public symbol in Ddoc format with `Params:` and `Returns:` sections.
- Put `unittest` blocks immediately after the function they test; annotate every unittest with attributes.
- Prefer selective imports (`import std.range : zip`) over global ones; sort imports lexicographically.
- Use `alias new = old;` syntax rather than the inverted `alias old new;` form.

## Formatting

- Indentation: 4 spaces per level.
- Braces on their own line for blocks and type definitions:

```d
void func(int param)
{
    if (param < 0)
    {
        ...
    }
}
```

- Line length: soft limit 80, hard limit 120.
- Space after `for`, `foreach`, `if`, `while`, `version`, and after keywords with parentheses.
- Space around binary operators and assignments (`a + b`, `b += 1`); no space after unary operators (`!a`, `~a`, `&c`, `e++`).
- `else if` chains keep the keywords on the same line as the closing brace.
- Avoid unnecessary parentheses in conditionals: `a == b ? "x" : "y"`, not `(a == b) ? ...`.
- Class and struct fields have exactly one space between the type and the field name.
- Imports are sorted lexicographically; selective imports have a space before and after the colon.
- One statement per line; no trailing whitespace; files end with a newline.

## Naming

- Modules and packages: all lowercase, only `[a-z0-9_]` (`std.algorithm`).
- Classes, interfaces, structs, unions, enums, non-eponymous templates: `PascalCase`.
- Functions, properties, member functions, variables: `camelCase`.
- Constants (including `enum` members and `immutable`): `camelCase`, like normal variables.
- Acronyms keep one case throughout: `UTFException`, `asciiChar`.
- A name conflicting with a keyword gets a single trailing underscore (`nothrow_`).
- Eponymous templates are capitalized like the symbol they shadow.
- User-defined attributes are `camelCase` (`@selector`).
- Declarations are left-justified so the shared type is obvious: `int[] x, y;`, not `int []x, y;`.

## Types and Data

- Prefer `immutable` and `const` for data that should not change; use `@safe`, `pure`, and `nothrow` attributes.
- Annotate non-templated functions with matching attributes; list them alphabetically (`const @nogc nothrow pure @safe`).
- Use `auto` for local variables whose type is inferred from the initializer.
- Avoid `in`/`out` parameter contracts unless the function benefits; prefer expression-based `in`/`out` syntax.
- Prefer discriminated unions (`variant`) or structs over inheritance hierarchies.
- Avoid operator overloading that changes the conventional meaning of an operator.
- Do not use Hungarian notation; do encode purpose in names when the type cannot.
- Prefer `immutable`/`const` slices and arrays over raw pointers.

## Comments and Documentation

- Public symbols get Ddoc comments (`///` for one line, `/** ... */` for blocks).
- Doc comments use at most two stars (`/**`) or two pluses (`/++`) at the start.
- Include `Params:` and `Returns:` sections in every public function's doc comment.
- Do not prefix each line of a doc comment with `*`.
- Use `///` ditto comments to repeat a previous doc comment.
- Text example blocks inside docs use three dashes (`---`).
- Use `//` for implementation comments that explain why, not what.

## Error Handling

- Use `assert` for internal invariants that must never be violated; it is disabled in release builds.
- Throw `Exception` (or a subclass) for recoverable error conditions.
- Use `enforce` (from `std.exception`) to check a precondition and throw `Exception`.
- Do not use exceptions for ordinary control flow; return `bool` or an optional value instead.
- Use `Throwable`/`Exception` hierarchies sparingly; catch the specific type you can handle.
- Document every `throws` condition in the Ddoc comment.

## Testing

- Place a `unittest` block immediately after the function under test.
- Annotate unittests with the same attributes as the function: `pure nothrow @nogc @safe unittest { ... }`.
- Avoid `unittest` blocks inside templates: they are instantiated per type; move tests outside.
- Exercise every code path at least once and verify with a coverage analyzer.
- Use `assert` inside unittests to check expected values.
- Keep tests focused: one behaviour per `unittest` block, with a descriptive `assert` message.

## Anti-Patterns

- `import std.range;` when only `zip` is needed. Instead: `import std.range : zip;`.
- `alias VOID = void;`. Instead: use the built-in type directly; drop meaningless aliases.
- `int []x, y;`. Instead: left-justify declarations: `int[] x, y;`.
- Overloading `+` to mean something other than addition. Instead: use a named method.
- `unittest` inside a template. Instead: place the test outside the template.
- A getter/setter pair for every field. Instead: use a property function.
- Relying on `in`/`out` contracts everywhere. Instead: document preconditions and check them at the boundary.
- `catch (Exception) { }`. Instead: catch the specific type and do something meaningful.

## Code Example

```d
/**
Checks whether a number is positive.

Params:
    number = number to be checked

Returns: `true` if the number is positive, `false` otherwise.
*/
bool isPositive(int number) @safe pure nothrow
{
    return number > 0;
}

/**
Splits a whitespace-separated string into its tokens.

Params:
    text = the string to split

Returns: the tokens found in `text`, in order.
*/
string[] splitTokens(string text) @safe
{
    import std.array : split;
    import std.algorithm : filter, map;

    return text.split(" ").filter!(a => a.length > 0).map!(a => a.idup).array;
}

unittest
{
    assert(isPositive(1));
    assert(!isPositive(0));
    assert(splitTokens("a b  c") == ["a", "b", "c"]);
}
```

## Sources

- https://dlang.org/dstyle.html
- https://dlang.org/
