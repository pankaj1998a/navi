# R Style Guide

> Source: Google's R Style Guide (https://google.github.io/styleguide/Rguide.html) plus The tidyverse style guide (https://style.tidyverse.org/)

## Quick Rules

- Indent with 2 spaces. Never use tabs.
- Use `snake_case` for everything: variables, functions, arguments. Do not use `.` in names.
- Function names are verbs in `snake_case`; do not prefix function names with `do_`, `is_`, or `has_` unless the boolean result requires it.
- Assign with `<-`, never `=`, and never use right-hand assignment (`->`).
- Use the base pipe `|>` with one operation per line, indented 2 spaces.
- Qualify external functions with `pkg::fun()` instead of `library()` or `@import`.
- Use explicit `return()` in Google style; rely on the last expression in tidyverse style, but never mix in one file.
- Use `stop()`/`cli::cli_abort()` with a full sentence that starts with "must" or "can't".
- Document every exported function with roxygen2 (`#'`).

## Formatting

- Indent: 2 spaces per level.
- Line length: keep under 80 characters where practical; no hard limit in the guides.
- One assignment per line; spaces around all infix operators (`x <- a + b`).
- No space before a comma, one space after.
- `if (cond) { ... }` - a space after the `if` keyword, and braces around every block.
- `function(x) {` - space between the keyword and the parenthesis, and before `{`.
- Keep a space after `,` in function calls: `mean(x, na.rm = TRUE)`.
- Operators `::`, `:::`, `$`, `@`, `[`, `[[`, `^`, unary `-`/`+`, and `:` take no surrounding space.
- `{{ var }}` (embracing) always has inner spaces.
- Use a single blank line between functions; two blank lines are not the norm. Avoid blank lines at the start or end of a function body.
- Use comment banners of `# ---- section ----` to break a long script into readable chunks.
- End every file with a single newline; no trailing whitespace.

## Naming

- Variables and functions: `snake_case`, lowercase, with underscores between words - `day_one`, `add_row()`.
- Never reuse a common function name for a variable (`c`, `T`, `mean`).
- Reserve `.` for the S3 object system (`function.class`); do not use it elsewhere in names.
- Variables are nouns, functions are verbs - `permute()`, not `permutation()`.
- Do not cram data into names (`model_2018`, `model_2019`) - use a list or data frame instead.
- Function arguments: `snake_case`; use `x`, `y`, `.x`, `.y` inside `purrr`-style lambdas.
- Files: lower case, machine readable, `-` or `_` between words, `.R` extension - `fit_models.R`, `01-load-data.R`.
- Avoid `final`, `final2`, `new`, `temp` in file names; use dates (`report-2022-03-20.qmd`).
- Datasets and column names: `snake_case` (`Sepal.Length` style with a capital letter is a data-idiom exception).
- Do not use `my_`, `new_`, or `final_` prefixes on names - they describe history, not meaning.

## Types and Data

- R is dynamically typed; rely on idiomatic types (`numeric`, `character`, `logical`, `factor`, `Date`).
- Be explicit about missingness: use `NA`, never `""` or `"NULL"`, and check with `is.na()`.
- Use `factor` only for genuinely categorical data; set `stringsAsFactors = FALSE` when reading character data.
- Use tibbles/dplyr rather than data frames when available; they are safer and print better.
- Prefer `vapply()` over `sapply()` when the result shape matters.
- Avoid modifying data frames in place with `attach()` - it is forbidden; pass data explicitly.
- Use the base `|>` pipe rather than `%>%`; the tidyverse guide prefers `|>` and treats `%>%` as legacy.

## Comments and Documentation

- Use roxygen2 comments (`#'`) for all exported functions, with a title line, then `@param`, `@return`, `@examples`.
- Indent one space after `#'`; wrap long tag text with two extra spaces.
- Titles are sentence case, no trailing full stop. Tag descriptions are sentences ending with a full stop.
- Regular comments use `# ` and explain the *why*, not the *what*.
- Comments are sentence case; use a full stop only for two or more sentences.
- Document packages in a `packagename-package.R` file.
- Cross-link with `[pkg::function()]` and group related functions with `@family`.

## Error Handling

- Signal errors with `stop()` (or `cli::cli_abort()`); never return a sentinel string.
- Start the message with a general problem statement, then details.
- Use "must" when the expected value is known, "can't" when it is not:
  `stop("`n` must be a numeric vector, not a character vector.")`
- Add bulleted detail lines for multiple problems, and mention the failing location.
- Use `tryCatch()` and `rlang::try_fetch()` for recoverable errors; re-raise with the original as the parent.
- Validate arguments at the top of a function and fail fast.
- Never use `suppressWarnings()` or `try()` to hide a real problem without a comment explaining why.

## Testing

- Layout: `tests/testthat/test-<file>.R` mirroring `R/<file>.R`; use `usethis::use_test()`.
- Framework: `testthat` with `testthat::test_that()` blocks.
- Name expectations in prose: `test_that("order total is discounted", { ... })`.
- Use `expect_equal()`, `expect_true()`, `expect_error()` rather than raw `stopifnot()`.
- Test edge cases explicitly: empty input, zero and negative values, NA handling.
- Keep the Arrange / Act / Assert shape with blank lines between phases.
- Prefer fixtures and helper functions over copy-paste; use `withr` to restore global state.

## Anti-Patterns

- `attach()` or `library()` scattered through a script. Instead: qualify with `pkg::fun()` and call `library()` once at the top of a script.
- Using `=` for assignment. Instead: use `<-`.
- Right-hand assignment `x -> y`. Instead: `y <- x`.
- A long pipe on one line. Instead: one operation per line, indented 2 spaces.
- CamelCase or dot.case names. Instead: `snake_case`.
- `sapply()` where the result shape matters. Instead: `vapply()`.
- Catching an error and returning `NULL` silently. Instead: handle it or let it propagate.
- `my_variable` / `new_function` names. Instead: name for meaning.

## Code Example

```r
#' Calculate the discounted total of an order
#'
#' @param unit_price Price of a single item.
#' @param quantity Number of items ordered.
#' @param percent Whole percentage points to discount.
#' @return The discounted total as a numeric value.
#' @examples
#' order_total(10, 3, 25)
order_total <- function(unit_price, quantity, percent) {
  if (unit_price < 0 || quantity < 0) {
    stop("`unit_price` and `quantity` must not be negative.")
  }
  if (!percent %in% seq(0, 100)) {
    stop("`percent` must be between 0 and 100.")
  }

  subtotal <- unit_price * quantity
  subtotal - (subtotal * percent / 100)
}

order_total(10, 3, 25)
```

## Sources

- https://google.github.io/styleguide/Rguide.html
- https://style.tidyverse.org/
- https://github.com/tidyverse/style
- https://styler.r-lib.org/
