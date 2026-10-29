# Apache Style Guide

> Source: Apache Developers' C Language Style Guide (http://httpd.apache.org/dev/styleguide.html)

## Quick Rules
- Indent with four spaces; tab characters are never used.
- Opening braces for control structures go on the same line as the statement; for function definitions the brace goes on the next line.
- Closing braces sit on their own line, aligned with the start of the line containing the matching opening brace.
- Declare functions with ANSI-style arguments, and use `void` when a function takes no arguments.
- No space between the function name and the opening parenthesis of the argument list; a single space after each comma.
- `case` labels inside a `switch` are indented to the same level as the `switch` statement itself.
- Surround binary and assignment operators with a single space; unary `++`, `--`, and `!` bind tightly.
- No whitespace between a cast and the value it modifies: `(int)j`, not `(int) j`; `(char *)i`, not `(char*)i`.
- Keep lines within 80 columns and wrap long expressions at the parenthesis.
- Comments explain rationale and behaviour that the code does not make obvious; indent them to the surrounding level.

## Formatting
- Indentation: 4 spaces per level, no tabs anywhere in the source.
- The canonical formatting is reproducible with GNU `indent` using the flags `-i4 -npsl -di0 -br -nce -d0 -cli0 -npcs -nfc1 -nut`.
- Control flow: the opening brace follows the keyword, the body is indented four spaces, and the closing brace lines up with the keyword.
- `else` goes on the line after the closing brace of the `if`, aligned with the `if`.
- Function definitions: return type and name on the first line, arguments in ANSI style, opening brace on the following line.
- Function calls: `f(a, b);` -- no space before the parenthesis, one space after each comma.
- `for` statements: one space after each semicolon (`for (a; b; c)`).
- Multi-line calls and declarations: wrap arguments under the first argument, keeping each term atomic.

## Naming
- The guide leaves enum capitalization open; follow the local convention of the file you are editing.
- Use descriptive, lowercase identifiers with underscores for functions and variables in httpd-style code.
- Prefix module-level symbols with the module or subsystem name to avoid collisions in the shared binary.
- Keep macro names uppercase and function-like macros lowercase, matching the surrounding file.
- Do not rename existing symbols for style reasons alone; matching the local convention takes priority.

## Structure
- One function per logical responsibility, short enough to read in one screenful.
- Document the behaviour of exported functions with a comment block above the definition.
- Keep includes minimal and ordered: system headers first, then project headers.
- Prefer existing project helpers over reimplementing standard behaviour.
- Keep configuration in a dedicated module rather than scattering it through request handling code.

## Tooling
- Format with `indent` using the flags above, or rely on the project's existing `scripts/` formatting targets.
- Compile with warnings enabled and treat new warnings as errors.
- Keep the build free of compiler-specific extensions so the module stays portable across platforms.
- Run the project's unit test suite and the httpd regression tests before submitting a patch.
- Review diffs for accidental whitespace churn; the project prefers focused patches.

## Anti-Patterns
- Mixed tabs and spaces, or tabs used for indentation. Instead: four spaces everywhere.
- `else` on the same line as the closing brace. Instead: place `else` on the following line.
- `case` labels double-indented inside a `switch`. Instead: align them with the `switch` keyword.
- Missing space after a comma in an argument list. Instead: `f(a, b);`.
- Casting with a space: `(int) j`. Instead: `(int)j`.
- Wrapping a long line at a random column that obscures the structure. Instead: align to the opening parenthesis.
- Reformatting untouched code in the same patch. Instead: keep the diff minimal and focused.

## Code/Config Example
```c
static int handle_request(request_rec *r)
{
    const char *value;
    apr_pool_t *pool = r->pool;

    if (r->method_number != M_GET) {
        return HTTP_METHOD_NOT_ALLOWED;
    }

    value = apr_table_get(r->headers_in, "Accept-Encoding");
    if (value == NULL) {
        value = "identity";
    }

    apr_table_set(r->headers_out, "Content-Encoding", value);
    return OK;
}
```

## Sources
- http://httpd.apache.org/dev/styleguide.html
