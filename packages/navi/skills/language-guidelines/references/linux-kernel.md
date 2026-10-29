# Linux Kernel Style Guide

> Source: Linux kernel coding style (https://www.kernel.org/doc/html/latest/process/coding-style.html)

## Quick Rules
- Indent with tabs, where a tab is 8 columns wide; spaces are never used for indentation outside comments and Kconfig.
- Keep lines within 80 columns; break long statements into sensible chunks with descendants aligned to the opening parenthesis.
- Use K&R braces: the opening brace goes on the same line for statements, on the next line for function definitions.
- Always use braces for multiple statements, even when a single statement would fit on one line.
- Use a space after keywords (`if`, `switch`, `for`, `while`) but not after `sizeof`, `typeof`, `alignof`, `__attribute__`.
- Write one declaration per line and one statement per line; never chain statements with commas.
- Use `snake_case` for globals and functions, short lowercase names for locals, and `UPPER_CASE` for macros.
- Use `bool` rather than `int` for booleans; never write `!!`.
- Prefer `static inline` functions over function-like macros; wrap multi-statement macros in `do { ... } while (0)`.
- Comment what the code does, not how; keep the explanation at the top of the function.

## Formatting
- Indentation: tabs of 8 columns; a `switch` and its `case` labels share the same column.
- Braces: `if (x) {` on one line, but a function body starts on the line after the signature.
- Spaces: one space around binary operators, none around unary operators, none inside parentheses, none around `.` or `->`.
- Pointer declarations bind the `*` to the name: `char *buffer;`, not `char* buffer`.
- No trailing whitespace at the end of a line, ever.
- Multi-line comments use the kernel style with a column of asterisks and a blank first and last line.
- Kernel-doc comments (`/** ... */`) for exported API functions; do not restate the signature.

## Naming
- Global functions and variables: descriptive `snake_case` (`count_active_users()`, not `cntusr()`).
- Local variables: short and to the point (`i`, `tmp`); do not encode the type in the name.
- Macros and constants: `UPPER_CASE`; function-like macros may be lower case.
- Enum constants: `UPPER_CASE` and prefixed with the type name where ambiguity is possible.
- Flags are defined as `enum foo_flags` with members starting with the function name in upper case.
- Avoid introducing new uses of "master/slave" and "blacklist/whitelist"; prefer primary/secondary, leader/follower, denylist/allowlist.

## Structure
- Functions should do one thing and fit in one or two 80x24 screenfuls; split anything longer.
- Keep the number of local variables around 5-10; more than that means the function needs splitting.
- Separate functions with a single blank line; put `EXPORT_SYMBOL()` immediately after the closing brace.
- Declare prototype parameters with names, and keep the storage class, return type, and parameter attributes in a fixed order.
- Shared data structures that can be found by another thread need reference counting; locking does not replace it.
- Prefer to compile out whole functions with `#if` in a header rather than scattering conditionals through a `.c` file.
- Put the conditional expression in a comment after the `#endif` for non-trivial blocks.

## Tooling
- Check patches with `scripts/checkpatch.pl` before submitting; treat warnings as errors.
- Format C with `scripts/Lindent` or `clang-format` using the kernel style config.
- Build with `make W=1` to surface extra compiler warnings.
- Run `make C=1` with sparse to catch type and endianness issues.
- Use EditorConfig for shared indentation and newline settings.
- Keep editor-specific modelines (`-*- mode: c -*-`, vim settings) out of source files.

## Anti-Patterns
- `if (cond) do_this(), do_that();` to avoid braces. Instead: always use braces for multiple statements.
- Multiple assignments on one line. Instead: one statement per line.
- Casting the result of `kmalloc()`. Instead: assign directly; the conversion is guaranteed.
- `typedef struct foo foo_t;` for structures and pointers. Instead: spell out the struct type; use typedefs only for opaque objects, clear fixed-width integers, or sparse-generated types.
- `BUG()`, `BUG_ON()`, or `VM_BUG_ON()` in new code. Instead: use `WARN_ON_ONCE()` and provide recovery code.
- `!!flag` to normalize a boolean. Instead: use `bool` and let the conversion happen.
- Marking every small function `inline`. Instead: leave inlining to the compiler; `inline` is for macro replacements.
- `int` used for a boolean. Instead: use `bool`.
- Leaving trailing whitespace or a `.editorconfig` conflict in a patch. Instead: strip it before submitting.

## Code/Config Example
```c
/* Convert a timeval into a jiffies value. */
static unsigned long timeval_to_jiffies(struct timeval *tv)
{
	unsigned long msec = tv->tv_sec * 1000UL;

	msec += tv->tv_usec / 1000;

	return msec / (1000 / HZ);
}

int system_is_up(void)
{
	return system_state == SYSTEM_RUNNING;
}
EXPORT_SYMBOL(system_is_up);
```

## Sources
- https://www.kernel.org/doc/html/latest/process/coding-style.html
