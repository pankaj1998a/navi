# C Style Guide

> Source: C Coding Standard (https://users.ece.cmu.edu/~eno/coding/CCodingStandard.html) plus C Programming/Structure and style (https://en.wikibooks.org/wiki/C_Programming/Structure_and_style) and Making The Best Use of C (https://www.gnu.org/prep/standards/html_node/Writing-C.html)

## Quick Rules

- Indent with spaces, never tabs; keep lines under 78 characters.
- Use braces on every `if`, `while`, and `for`, even when the body is a single statement.
- Put the opening brace on the same line as the control statement.
- Name locals and functions `lower_case_with_underscores`; name `struct` tags and macros `UPPER_CASE`.
- Compare constants on the left: `if (NULL == ptr)`, never `if (ptr == NULL)`.
- Initialize every variable at declaration; never leave a pointer uninitialized.
- Check the return value of every system call and every `malloc`/`realloc`.
- Use `const` on every parameter that is not modified, and on pointers to data you do not modify.
- No data definitions in headers; headers contain declarations only.
- Never use `goto` for forward jumps; use it only to leave deeply nested loops, with a labeled cleanup block.

## Formatting

- Indentation: 3 spaces per level (this guide's convention); spaces only, never tabs.
- Line length: maximum 78 characters.
- Braces: opening brace on the same line as `if`/`for`/`while`/`do`, closing brace on its own line at the statement's indent level.
- One statement per line; one variable per declaration (`char **a = 0;` then `char *x = 0;`).
- Put a space after a comma and around binary operators; no space before a semicolon or after `(`.
- `if (condition) {` with a space between `if` and `(`; function calls are `func (arg)` or `func(arg)` - pick one and be consistent (prefer `func(arg)`).
- Add a short comment to closing braces in deeply nested blocks (`} /* end while */`).
- Blank line between functions; group related declarations together.
- Never leave trailing whitespace; end the file with a newline.

## Naming

- Functions: `lower_case_with_underscores`, verb-first: `check_for_errors`, not `error_check`.
- Locals: `lower_case_with_underscores`. Include the unit in the name when relevant: `timeout_msecs`, `weight_lbs`.
- Struct/union tags: `lower_case`; typedef names: `Capitalized` (`Time`, `ErrorProcessor`).
- Struct members: a per-type prefix is acceptable, e.g. `sc_` for `struct softc`.
- Globals: prefix with `g_` (`g_log`, `g_plog`) and avoid globals where possible.
- Global constants and `#define` macros: `UPPER_CASE_WITH_UNDERSCORES`.
- Enum labels: `UPPER_CASE_WITH_UNDERSCORES`; always provide a leading error/unknown label.
- Boolean-style functions: prefix `is_` (`is_hit_retry_limit`) or suffix `_p` per project convention.
- Suffix counters and limits: `_cnt`, `_max`, `_key`.

## Types and Data

- Use the fixed-width types from `<stdint.h>` (`uint32_t`, `int64_t`) for anything that crosses an interface.
- Use `size_t` for sizes and counts, never `int`, when dealing with `malloc`/`strlen` results.
- Prefer `enum` over `#define` for named integer constants - debuggers understand enum labels.
- Never cast an integer to an enum implicitly; conversions between enums and integers are error prone.
- Do not use `float` as a loop counter, and never compare floats with `==`.
- Use `const` aggressively: `const char *name` for read-only strings, `char *buf` only when the buffer is modified.
- Declare variables in the narrowest scope; C99 allows declarations inside blocks.
- One variable per declaration, each initialized.

## Comments and Documentation

- Use `/* ... */` for block comments and `//` for line comments; be consistent within a file.
- Start each file with a block comment describing the file's purpose, author, and version.
- Use Doxygen-style headers for functions: `@param`, `@return`, `@todo`, `@bug`, `@deprecated`, `@see`.
- Put the gotcha keyword first in the comment and make the first line a self-contained summary.
- Document the decision, not the mechanics: explain why an unusual approach was chosen.
- Document why each `#include` is present; group includes with a comment per group.
- Use `/* */` rather than `//` for comments that must sit inside macro definitions.
- Avoid commenting out large blocks; use `#if 0` with a descriptive macro such as `#if NOT_YET_IMPLEMENTED` and a note.

## Error Handling

- Check every system call that can fail; include the system error text in the message.
- Check every `malloc`/`realloc`; consider a wrapper that aborts on failure.
- Return a status code (`int`, 0 = success, negative = error) rather than calling `exit` deep inside a library.
- Use `errno` with `strerror` to build messages: `fprintf(stderr, "open: %s\n", strerror(errno));`.
- Do not ignore errors silently; if you must, cast the result to `(void)` so it is explicit.
- Validate arguments at the public boundary of a module, once.
- Never use `if (f())` as a truth test unless the function is documented to return only 0 for false; write `if (FAIL != f())`.

## Testing

- Test files alongside sources, named `foo_test.c` for `foo.c`.
- Build with strict warnings: `gcc -Wall -Wextra -Werror -std=c11`.
- Enable sanitizers in test builds: `-fsanitize=address,undefined`.
- One test function per behaviour, named `test_<unit>_<behaviour>`, returning 0 on success.
- Cover boundary conditions: empty buffers, zero length, maximum length, allocation failure.
- Test error paths explicitly by making the failing syscall return an error.
- Keep test helpers in a separate header so production code stays clean.

## Anti-Patterns

- `if (ptr == NULL)`. Instead: `if (NULL == ptr)` so a dropped `=` is caught by the compiler.
- `char **a, *x;` on one line. Instead: one declaration per variable, each initialized.
- Leaving a variable uninitialized. Instead: initialize at declaration; the compiler cannot check this for you.
- Defining a global variable in a header. Instead: declare `extern` in the header, define once in a `.c` file.
- Using `#ifdef DEBUG`. Instead: use `#if DEBUG` or `#if !defined(USER_NAME)`.
- Macro that evaluates its argument twice. Instead: parenthesize the whole expression, or use a `static inline` function.
- Comparing structures with `memcmp` or assigning them. Instead: compare fields, or use a dedicated equality function.
- Casting away `const`. Instead: change the API to take a `const` pointer.

## Code Example

```c
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "ring_buffer.h"

#define RING_BUFFER_CAPACITY 256

struct ring_buffer {
    uint8_t data[RING_BUFFER_CAPACITY];
    size_t tail;
    bool full;
};

/*
 * Appends @data to @buffer.
 *
 * @param buffer The destination ring buffer.
 * @param data   Bytes to append.
 * @return 0 on success, -1 when the buffer is full.
 */
int ring_buffer_append(struct ring_buffer *buffer,
                       const uint8_t *data,
                       size_t length)
{
    if (NULL == buffer || NULL == data || buffer->full) {
        return -1;
    }

    for (size_t i = 0; i < length; i++) {
        buffer->data[buffer->tail] = data[i];
        buffer->tail = (buffer->tail + 1) % RING_BUFFER_CAPACITY;
    }
    return 0;
}
```

## Sources

- https://users.ece.cmu.edu/~eno/coding/CCodingStandard.html
- https://en.wikibooks.org/wiki/C_Programming/Structure_and_style
- https://www.gnu.org/prep/standards/html_node/Writing-C.html
