# Shell (Bash) Style Guide

> Source: Google Shell Style Guide (https://google.github.io/styleguide/shellguide.html) plus ShellCheck (https://www.shellcheck.net/)

## Quick Rules

- Bash is the only shell permitted for executables. Start with `#!/bin/bash` and minimal flags.
- Indent 2 spaces. Never use tabs (the only exception is a `<<-` here-document body).
- Limit lines to 80 characters. Use `$(command)` for command substitution, never backticks.
- Prefer `[[ ... ]]` over `[ ... ]` and `test`.
- Quote every variable expansion: `"${var}"`. Use `"$@"` when forwarding arguments.
- Use `(( ... ))` and `$(( ... ))` for arithmetic, never `let`, `expr`, or `$[ ... ]`.
- All error messages go to STDERR; normal output goes to STDOUT.
- Always check return values and exit with a non-zero status on failure. Run ShellCheck on every script.

## Formatting

- Indent: 2 spaces, no tabs. Line length: 80 characters.
- Use a here-document or a variable for strings longer than 80 characters.
- Pipelines that do not fit on one line are split one command per line, with the pipe at the start of the continuation line and 2-space indentation:
  `cmd1 \` newline `  | cmd2 \` newline `  | cmd3`.
- `; then` and `; do` stay on the same line as `if`, `for`, or `while`. `else`, `fi`, and `done` go on their own line.
- `case` alternatives are indented 2 spaces; `;;` on its own line for multi-line actions.
- Always include `in "$@"` in `for` loops over arguments.

## Naming

- Functions: lower case with underscores - `my_func`, `cleanup_backup`. A library may namespace with `::` - `mypackage::my_func`.
- Variables: lower case with underscores - `zone`, `file_list`.
- Constants and exported environment variables: `UPPER_SNAKE_CASE`, declared at the top of the file - `readonly PATH_TO_FILES`.
- Source filenames: lower case with underscores - `make_template.sh`. Executables on the `PATH` may have no extension; libraries must end in `.sh` and must not be executable.
- Loop variables match what they iterate: `for zone in "${zones[@]}"`.
- Functions take parentheses immediately after the name with no space: `my_func() {`. Use `local` for every function-local variable.

## Types and Data

- There are no types; treat every value as a string and quote it.
- Use arrays (`declare -a flags`) for lists of arguments; never build a command line by concatenating a string.
- Expand arrays as `"${array[@]}"` and use `"${array[*]}"` only when you need one joined string.
- Use `readonly` for values that must not change; apply it immediately after assignment.
- Prefer builtins over external processes: `"$(( X + Y ))"` over `expr`, and `${string/#foo/bar}` over `sed`.
- Use `local` for function-scoped variables so the global namespace stays clean.
- Declare and assign separately when the value comes from a command substitution, because `local` swallows the exit code: `local out; out="$(cmd)"`.

## Comments and Documentation

- Every file starts with a shebang and a top-level comment describing the file's contents.
- Every function that is not both obvious and short gets a header comment. Functions in a library always get one.
- The header comment lists: description, globals used or modified, arguments, outputs, and return values.
- Use the `####` banner style for function headers:
  `#######################################` newline `# Cleanup files from the backup directory.` newline `# Arguments:` newline `#   None`.
- Implementation comments explain the tricky, non-obvious, or important parts. Do not comment everything.
- TODOs are `TODO(owner): description` in all caps with an identifier after the colon.

## Error Handling

- Check every return value: `if ! cmd; then ... fi` or `if (( $? != 0 )); then ... fi`.
- Write error messages to STDERR with `>&2` and exit non-zero.
- Provide a helper for error output, e.g. `err() { echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')]: $*" >&2; }`.
- `set -euo pipefail` is recommended for new scripts, but do not rely on it alone - still check explicitly.
- Do not use `eval`; it munges input and makes the assigned variables impossible to reason about.
- Avoid `set -e` pitfalls: a failing command in a condition, `(( i++ ))` returning 0, or a command in a pipeline.
- Never swallow an error silently; if a failure is expected, handle it explicitly and document why.

## Testing

- There is no standard framework; use `bats` (Bash Automated Testing System) for structured tests, or a plain script that exits non-zero on failure.
- Put tests in a `test/` or `tests/` directory with one file per script under test, named `*_test.sh`.
- Name test functions descriptively: `test_cleanup_removes_old_files()`.
- Each test asserts one behavior and exits non-zero with a message on failure.
- Always run ShellCheck as part of the test suite.
- Test the failure paths: missing arguments, non-existent paths, and unwritable destinations.
- Keep the fixtures in a `testdata/` directory so the test script is readable.

## Anti-Patterns

- Unquoted variables: `rm $file`. Instead: `rm "${file}"`.
- `for f in $(ls)`. Instead: `for f in ./*;` or use a `while read` loop.
- `let` or `expr` for arithmetic. Instead: `(( ))` and `$(( ))`.
- Piping into `while` and expecting variables to survive. Instead: use process substitution `while read ...; do ...; done < <(cmd)`.
- Backticks for command substitution. Instead: `$(cmd)`.
- `eval` to set variables. Instead: read into an array or use a nameref.
- Aliases in scripts. Instead: define a function.
- Echoing normal status to STDERR or errors to STDOUT. Instead: route them to the right stream.

## Code Example

```bash
#!/bin/bash
#
# Archive and prune old backups in the backup directory.

readonly BACKUP_DIR='/var/backups'
readonly KEEP_DAYS=14

# Reports an error to STDERR and exits. Arguments: $1 message.
err() {
  echo "[$(date +'%Y-%m-%dT%H:%M:%S%z')]: $*" >&2
  exit 1
}

# Deletes backups older than KEEP_DAYS. Globals: BACKUP_DIR, KEEP_DAYS.
prune_old_backups() {
  local dir
  for dir in "${BACKUP_DIR}"/*; do
    if [[ ! -d "${dir}" ]]; then
      continue
    fi
    if ! find "${dir}" -mtime "+${KEEP_DAYS}" -exec rm -rf {} +; then
      err "Unable to prune backups in ${dir}"
    fi
  done
}

main() {
  if [[ ! -d "${BACKUP_DIR}" ]]; then
    err "Backup directory ${BACKUP_DIR} does not exist"
  fi
  prune_old_backups
}

main "$@"
```

## Sources

- https://google.github.io/styleguide/shellguide.html
- https://github.com/google/styleguide/blob/gh-pages/shellguide.md
- https://www.shellcheck.net/
- https://bats-core.readthedocs.io/
