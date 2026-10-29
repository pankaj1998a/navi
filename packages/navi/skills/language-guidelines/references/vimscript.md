# Vim script Style Guide

> Source: Google Vimscript Style Guide (https://google.github.io/styleguide/vimscriptguide.html)

## Quick Rules

- Prefer 2-space indentation, spaces only.
- Limit lines to 80 characters.
- Use `autoload` functions (`plugin_name#Function()`) rather than cluttering global script namespace.
- Scope all variables explicitly: `s:` for script-local, `l:` or no prefix for function-local, `g:` for global, `b:` for buffer, `w:` for window, `t:` for tab.
- In strings, prefer single quotes for literal strings (`'regular\expression'`) and double quotes only when escape sequences (`"\n"`) are required.
- For string matching, always specify explicit case sensitivity: use `=#` (case-sensitive match) or `=?` (case-insensitive match). Never use bare `==` for strings, as it respects the user's `ignorecase` setting.
- Use `\v` (very magic) in regular expressions for predictable escaping.
- Avoid dangerous commands: never use `:normal` without `!`. Always use `:normal!`.
- Catch exceptions specifically; avoid bare `:catch` without a pattern unless rethrowing.
- Never use abbreviation commands (`:ab`) in plugins.

## Formatting

- Indentation: 2 spaces per level.
- Maximum line width: 80 characters.
- Break long expressions before binary operators. Use line continuation backslash (`\`) indented properly.
- Put spaces around binary operators: `let s:counter = 1`.
- Put a space after commas in lists and dictionaries: `[1, 2, 3]`, `{'a': 1, 'b': 2}`.
- Put closing brackets on their own line for multi-line dictionaries or lists.

## Naming

- Global plugin functions: `PascalCase` with autoload prefix: `myplugin#DoAction()`.
- Script-local functions: `s:PascalCase()`: `s:InitializeState()`.
- Variables: `snake_case` with explicit scope: `s:cache_dir`, `g:myplugin_enable_feature`.
- Constants: `UPPER_SNAKE_CASE` with scope: `s:DEFAULT_TIMEOUT`.

## Anti-Patterns

- Bare `==` for strings (`if str == "foo"`). Instead: `if str ==# "foo"`.
- `:normal` without bang. Instead: `:normal!`.
- Polluting the global namespace without `g:plugin_name_` prefix or `autoload`.
- Using `execute` with unescaped user input. Instead: use `fnameescape()` or `shellescape()`.
- Failing to clean up temporary buffers or windows.

## Code Example

```vim
" Script-local state
let s:DEFAULT_MAX_ITEMS = 50

function! myplugin#search#Execute(query, options) abort
  if empty(a:query)
    echoerr 'myplugin: query cannot be empty'
    return []
  endif

  let l:case_sensitive = get(a:options, 'case_sensitive', 0)
  let l:results = []

  for l:item in s:GetItems()
    if l:case_sensitive && l:item ==# a:query
      call add(l:results, l:item)
    elseif !l:case_sensitive && l:item ==? a:query
      call add(l:results, l:item)
    endif
  endfor

  return l:results
endfunction
```

## Sources
- https://google.github.io/styleguide/vimscriptguide.html
