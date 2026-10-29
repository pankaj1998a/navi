# Julia Style Guide

> Source: Blue: a Style Guide for Julia (https://github.com/JuliaDiff/BlueStyle), which draws on PEP 8, the Julia Contribution Guidelines, and the official Julia Style Guide (https://docs.julialang.org/en/v1/manual/style-guide/). BlueStyle takes precedence where the sources conflict.

## Quick Rules
- Indent with 4 spaces. Never use tabs.
- Keep lines to 92 characters or fewer.
- Types and modules use `UpperCamelCase`; functions and variables use `lower_case_with_underscores`.
- `using` one module per line, at the top of the file, sorted alphabetically. Prefer `using` over `import`.
- Use `let` for immutable bindings; use `const` for global constants named in `UPPER_SNAKE_CASE`.
- In long-form function definitions always use an explicit `return`, and always return a value (even `return nothing`).
- Use trailing commas in expanded array, tuple, and function-call notation.
- No trailing whitespace. Every file ends with a newline.
- No extra spaces inside brackets, before commas, or around `:` in ranges.
- Document exported functions and types with a Markdown docstring. Never use global mutable state; put logic in functions and globals in `const`.

## Formatting
- Indentation: 4 spaces, no tabs. Line length: 92 characters.
- Wrap long signatures by putting one parameter per line, indented one level, with the closing paren on its own line.
- Blank line between a function definition and the next one. No blank line after `function ...` and none before the matching `end`.
- Separate multi-line blocks with a blank line (between an `if` block and a following `for` block).
- No spaces inside `()`, `[]`, `{}`: `spam(ham[1], [eggs])`. No space before a comma or semicolon; one space after.
- Ranges are written without inner spaces: `ham[1:9]`, `ham[9:-3:0]`.
- Binary operators are surrounded by a single space; unary operators are not: `-1`, `i = j + 1`. Do not align assignments with extra spaces.
- Expanded collections use one element per line with a trailing comma; the closing bracket matches the indentation of the opening statement.
- Multi-line triple-quoted strings and triple-backtick blocks are indented, and the closing delimiter is indented one level.

## Naming
- Modules and types: `UpperCamelCase` - `module Solver`, `struct Result`.
- Functions and methods: `lower_case_with_underscores` - `solve_system`, `parse_config`. Base itself uses `lowercase` without underscores, so either is acceptable; be consistent within a package.
- Function names describe an action or property, not the argument type: `submit(bid::Bid)`, not `submit_bid`.
- Keep function names to one or two words. If you cannot shorten a name, split the function.
- Internal-only functions and types get a leading underscore: `_internal_helper`, `_MyInternalType`.
- Variables and keyword arguments: `lower_case_with_underscores`. Global constants: `UPPER_SNAKE_CASE` - `MAX_ITERATIONS`.
- Type parameters: `UpperCamelCase` with a leading `T` when there is a single one: `struct Container{T}`.
- Keyword arguments are named without a trailing underscore; use a trailing `_` only to avoid a clash with a positional name.
- Enum values and struct fields: `lower_case_with_underscores`.

## Types and Data
- Use `struct` (immutable) by default; use `mutable struct` only when the object genuinely changes after construction.
- Annotate function arguments as generally as possible: `arr::AbstractArray` rather than `arr::Array{Int}`.
- Field types may be concrete when memory layout matters; prefer `Int` over `Integer` for stored fields.
- Use parametric types for performance-sensitive containers, but keep the public API general.
- Use `Union{Nothing, T}` (or `T?`) for a value that may be absent; avoid `Any` unless the value really is heterogeneous.
- Return `nothing` explicitly rather than relying on an implicit `nothing`.
- Use `NamedTuple` for small ad-hoc records; use `struct` for anything with many fields or a stable contract.
- Avoid global variables; declare them `const` at the top of the file. Use keyword arguments rather than positional booleans.

## Comments and Documentation
- Docstrings use triple double quotes and Markdown. Start the first line with the function signature in the conventional form: `    bar(x[, y])`, then a blank line, then the description.
- Document every exported function and every public type. Internal helpers may be undocumented. Docstring lines wrap at 92 characters.
- Structure longer docstrings with `# Arguments`, `# Returns`, `# Throws`, `# Examples` sections, each on its own line with a blank line before the body.
- Implementation comments use `#` with a single space after it and two spaces before an inline trailing comment.
- Comments state the intended behaviour, not the mechanics. `# Compensate for border` is good; `# Increment x` is not.
- Comments should be complete sentences; capitalise the first word unless it starts with an identifier.
- TODO format: `# TODO(owner): description`. Never leave commented-out code in a file.

## Error Handling
- Use exceptions for exceptional conditions: `throw(ArgumentError("n must be positive"))`.
- Use `error("message")` only when no more specific exception type fits. Do not `error` inside a hot loop.
- `@assert` is for programmer errors and can be removed by the optimiser; do not rely on it for user input validation.
- Custom exception types should subtype `Exception` and carry structured data, e.g. `struct ConfigError <: Exception` with `path` and `reason` fields.
- Document the exceptions a function throws in the docstring's `# Throws` section.
- Use `nothing` for a normal "not found" result, not an exception, when absence is expected.

## Testing
- Framework: the built-in `Test` standard library. `TestFixtures` and `JET` are common additions.
- Layout: `test/runtests.jl` holds the root `@testset` and includes per-module test files from `test/`.
- A package should have exactly one root test set: `@testset "MyPackage" begin include("arithmetic.jl") end`.
- Test files are named after the module they test: `test/arithmetic.jl` for `src/arithmetic.jl`.
- Use `@testset` groupings with a descriptive name for each behaviour.
- Assertions are written `@test value == expected`. Do not add type noise: `@test value == 0`, not `@test value == 0.0`.
- Use `@test_throws` for error paths: `@test_throws ArgumentError parse_config("")`.
- Test the public API only; keep helpers in the test file private. Use `Aqua.jl` to check package hygiene.

## Anti-Patterns
- `function f(x) x + 1 end` with no `return` in long form - instead always write `return x + 1` in a multi-line `function` block.
- `using A, B` on one line - instead write `using A` and `using B` on separate lines, sorted.
- `import Base: isreal` then extending it silently - instead `using Base` and write `Base.isreal(x::Ghost) = false`.
- `x = 1; y = 2` with extra alignment spaces - instead `x = 1` / `y = 2` with a single space.
- `ham[1 : 9]` with spaces in the range - instead `ham[1:9]`.
- `.1` and `2.` - instead write `0.1` and `2.0`.
- `for i = 1:10` - instead `for i in 1:10`.
- A global `mutable` variable used as a counter - instead use a `Ref` inside a function or a closure.

## Code Example
```julia
"""
    solve_linear(matrix::AbstractMatrix, rhs::AbstractVector) -> Vector{Float64}

Solve the linear system `matrix * x = rhs` using Gaussian elimination with
partial pivoting.

# Arguments
- `matrix::AbstractMatrix`: the square coefficient matrix.
- `rhs::AbstractVector`: the right-hand side vector.

# Throws
- `ArgumentError`: if the matrix is not square or its size does not match `rhs`.
"""
function solve_linear(matrix::AbstractMatrix, rhs::AbstractVector)
    n = size(matrix, 1)
    if size(matrix, 2) != n || length(rhs) != n
        throw(ArgumentError("matrix must be square and match the right-hand side"))
    end

    a = Matrix{Float64}(matrix)
    b = Vector{Float64}(rhs)

    for column in 1:n
        pivot = argmax(abs.(a[column:n, column]))
        pivot == 1 && continue
        a[[column, column + pivot - 1], :] = a[[column + pivot - 1, column], :]
        b[column], b[column + pivot - 1] = b[column + pivot - 1], b[column]
    end

    for row in n:-1:1
        b[row] = (b[row] - dot(a[row, row+1:end], b[row+1:end])) / a[row, row]
    end

    return b
end
```

## Sources
- https://github.com/JuliaDiff/BlueStyle
- https://docs.julialang.org/en/v1/manual/style-guide/
- https://docs.julialang.org/en/v1/manual/documentation/
