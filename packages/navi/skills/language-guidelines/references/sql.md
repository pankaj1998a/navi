# SQL Style Guide

> Source: SQL Style Guide by Simon Holywell (https://www.sqlstyle.guide/) plus Joe Celko's SQL Programming Style conventions

## Quick Rules

- Use uppercase for reserved keywords: `SELECT`, `FROM`, `WHERE`, `JOIN`, `GROUP BY`.
- Use lowercase `snake_case` for table and column names. Avoid `camelCase` and Hungarian prefixes such as `sp_` or `tbl`.
- Tables use a collective or plural name (`staff`, `employees`); columns are always singular.
- Never give a table the same name as one of its columns, and vice versa.
- Align the root keywords so `SELECT`, `FROM`, `WHERE` form a vertical "river" of whitespace.
- Always use the `AS` keyword when aliasing a table or a computed column.
- Prefer `BETWEEN` over chained `AND` comparisons and `IN()` over chained `OR`.
- Store timestamps as ISO 8601: `2026-03-14T09:30:00.00000`.
- Prefer `NUMERIC`/`DECIMAL` over `FLOAT`/`REAL` for exact values.
- Prefer standard SQL functions over vendor-specific ones for portability.

## Formatting

- Reserved keywords uppercase; identifiers lowercase.
- One space after commas, around `=`, comparison operators, and around apostrophes.
- Newline before `AND`/`OR` in a `WHERE` clause.
- Newline after each keyword definition and after a comma that separates logical groups of columns.
- Root keywords right-aligned, expressions left-aligned:
  `SELECT a.title,` newline `       a.release_date` newline `  FROM albums AS a` newline ` WHERE a.title = 'Charcoal Lane'`.
- Joins indent to the right of the river, with the `ON` condition on its own line.
- Subqueries align to the right of the river and use the same layout rules.
- In `CREATE TABLE`, indent column definitions by 4 spaces and declare the primary key first, right after `CREATE TABLE`.
- Constraints sit directly beneath the column they apply to, aligned to the right of the column name.

## Naming

- Names are unique and not reserved keywords. Maximum 30 characters (30 bytes).
- Names start with a letter, contain only letters, numbers, and underscores, and never end with an underscore.
- No multiple consecutive underscores. Use an underscore where a space would go: `first_name`.
- Avoid abbreviations unless widely understood.
- Tables: collective name preferred - `staff`, `employees`. No `tbl_` prefix.
- Columns: singular - `first_name`. Avoid a bare `id` as the primary identifier when a descriptive name is possible.
- Correlation names relate to what they alias; as a rule of thumb use the first letter of each word: `staff AS s`, `students AS s1`.
- Append a number when a correlation name would collide: `s1`, `s2`.
- Use standard column suffixes: `_id`, `_status`, `_total`, `_num`, `_name`, `_seq`, `_date`, `_tally`, `_size`, `_addr`.
- Stored procedures must contain a verb, with no `sp_` prefix: `archive_old_orders()`.

## Types and Data

- Prefer `NUMERIC` or `DECIMAL` for money and exact quantities; use `FLOAT`/`REAL` only when floating point is genuinely required.
- Avoid vendor-specific types; use the portable ANSI equivalent.
- The default value must match the column type, and defaults come before `NOT NULL`:
  `total NUMERIC(10,2) DEFAULT 0.00 NOT NULL`.
- Every table has at least one key. Prefer a single, simple, stable key; use compound keys when they are the right model.
- Keep key data types consistent across the schema and easy to validate against a published standard.
- Name custom constraints explicitly; vendor-generated names are fine for `UNIQUE`, `PRIMARY KEY`, and `FOREIGN KEY`.
- Use `LIKE`/`SIMILAR TO` to validate string formats and `CHECK()` to enforce numeric ranges.
- Order `ON DELETE` before `ON UPDATE` in a foreign key.

## Comments and Documentation

- Use the C-style `/* ... */` for block comments where possible; otherwise start with `--` and finish with a new line.
- Comment the *why*, not the mechanics. Explain derived values and business rules.
- Group related dates together in a `SELECT` list and comment the grouping.
- Document every table with a comment describing its purpose and grain, and every non-obvious column.
- Do not rely on comments for correctness - enforce rules with constraints.
- Keep comments synchronized with the schema.

## Error Handling

- Enforce integrity with `NOT NULL`, `CHECK`, `UNIQUE`, and `FOREIGN KEY` rather than with application code alone.
- Use transactions (`BEGIN` / `COMMIT` / `ROLLBACK`) for multi-statement writes.
- Always order `ON DELETE`/`ON UPDATE` clauses deterministically.
- Handle constraint violations at the application boundary and translate them into domain errors.
- Avoid `UNION` and temporary tables when the schema can be optimised to avoid them.
- Do not swallow errors with `WHEN OTHERS THEN NULL` without logging them.

## Testing

- Schema migrations are versioned and applied in order; each migration is reversible or explicitly documented as not reversible.
- Test fixtures are created in a dedicated test schema or database, never in production data.
- Write data-quality checks as queries: orphan checks, uniqueness checks, and `NOT NULL` coverage reports.
- Test every constraint by attempting a violating insert and asserting it fails.
- Regression queries for known reports belong in the test suite so a schema change cannot silently alter results.
- Use a linter such as `sqlfluff` with the `sql_style` ruleset in CI.

## Anti-Patterns

- `camelCase` identifiers. Instead: use `snake_case`.
- Hungarian prefixes such as `tbl_` or `sp_`. Instead: no prefix, or a meaningful one.
- Plural column names. Instead: singular column names.
- Omitting `AS` on aliases. Instead: always write `AS`.
- A quoted identifier for a normal name. Instead: use unquoted lowercase names; if quoting is unavoidable, use SQL-92 double quotes.
- Missing `WHERE` on an `UPDATE` or `DELETE`. Instead: always scope the statement and test it against a transaction.
- `FLOAT` for currency. Instead: use `NUMERIC(p, s)`.
- Re-implementing constraints in application code. Instead: declare them in the schema.
- A `UNION` used to paper over a modelling problem. Instead: fix the schema.

## Code Example

```sql
-- Retrieves published albums released in a given year.
--
-- The join to tracks is filtered to track_number <= 3 so the result
-- returns only the first three tracks of each album.
SELECT a.title,
       a.release_date,
       COUNT(t.track_id) AS track_total,
       MAX(t.duration_seconds) AS longest_track_seconds
  FROM albums AS a
  JOIN tracks AS t
    ON t.album_id = a.album_id
   AND t.track_number <= 3
 WHERE a.release_date BETWEEN '2020-01-01' AND '2020-12-31'
   AND a.publication_status = 'published'
 GROUP BY a.title, a.release_date
 ORDER BY a.release_date DESC;

CREATE TABLE albums (
    album_id             NUMERIC(10,0) NOT NULL,
    title                VARCHAR(200) NOT NULL,
    release_date         TIMESTAMP NOT NULL,
    publication_status   VARCHAR(20) DEFAULT 'draft' NOT NULL,
    CONSTRAINT pk_albums PRIMARY KEY (album_id),
    CONSTRAINT ck_albums_status CHECK (publication_status IN ('draft', 'published'))
);
```

## Sources

- https://www.sqlstyle.guide/
- https://www.sqlstyle.guide/en/select.html
- https://www.sqlstyle.guide/en/create.html
