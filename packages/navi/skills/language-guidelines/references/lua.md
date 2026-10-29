# Lua Style Guide

> Source: Lua Style Guide (http://lua-users.org/wiki/LuaStyleGuide), a community guide hosted by the Lua Users Group. It in turn draws on *Programming in Lua* and the *Lua 5.1 Reference Manual*. The guide's own authors note that Lua has no single consensus style, so the rules below are the widely accepted core.

## Quick Rules
- Indent with 2 spaces. This is the convention used in *Programming in Lua*, the Lua Reference Manual, and the Lua users wiki.
- Declare everything `local` unless it is genuinely a global. Globals are the biggest source of coupling and bugs in Lua.
- Never use the `module()` function. Return a table from the file and `require` it.
- Use `local M = {}` ... `return M` as the module pattern, and require it: `local config = require("config")`.
- Use `--` for comments and put a space after it: `-- not found`.
- Use `nil` checks written as `if not value then` (Lua treats `nil` and `false` as false), and `and`/`or` for short defaulting: `x = x or "default"`.
- Use `#t` and `next(t)` for length and emptiness; do not trust `table.getn`.
- Name booleans and predicates with an `is_` prefix: `is_directory`.
- Use `ALL_CAPS` for constants, and `_` for a deliberately ignored variable.
- Do not use the `debug` library in production code, and avoid deprecated 5.1 features (`table.getn`, `table.setn`, `table.foreach`, `gcinfo`).

## Formatting
- Indentation: 2 spaces. Tabs or 3-4 spaces also appear in the wild; pick one and stay consistent.
- No formal line-length limit; keep lines under 100 characters, and well under 80 for readability.
- Opening brace style: `function name(args)` with no space before the parenthesis, and a space after the comma in the argument list.
- End every block with the matching `end`; add a trailing comment when nesting is deep: `end -- for each t`.
- Blank line between top-level function definitions.
- Use `;` as the statement separator only when two statements must share one line; normally one statement per line.
- Prefer `..` for concatenation with spaces around it: `"a" .. b`.
- No trailing whitespace; file ends with a newline.
- Group locals in a single `local` statement per scope when it reads better: `local x, y = 1, 2`.
- Avoid Hungarian-style type prefixes; they are redundant in a dynamically typed language and add noise.

## Naming
- Locals and fields: `lower_snake_case` (e.g. `color`, `ntimes`). `camelCase` is also seen; choose one per project. Functions: `lower_snake_case` too, since functions are values: `print_table`, `get_config`.
- Predicates and booleans: prefix with `is_` or `has_`: `is_directory`, `has_errors`. Constants: `ALL_CAPS` with optional underscores: `MAX_LINES`, `DEFAULT_TIMEOUT`.
- Module names: short, lowercase, no separators: `luasql`, `luasql.postgres`, `lualdap`.
- Class-like metatables: `UpperCamelCase` (`BankAccount`); instances of them stay lower camel case (`account`).
- Internal Lua names starting with an underscore followed by uppercase (`_VERSION`, `_G`) are reserved by the language - never define your own.
- `_` is the conventional placeholder for an ignored value: `for _, value in ipairs(t) do`.
- Conventional loop variables: `i` for the index, `k` for the key, `v` for the value, `t` for a table. `self` is the receiver in a method defined with `:`. `M` is a common name for the module table.

## Types and Data
- Lua has one value type; "types" are conventions. Use a consistent metatable to implement classes:

```lua
local Account = {}
Account.__index = Account
```

- Prefer tables with explicit fields over parallel arrays. Use `nil` for absence; do not use sentinel values.
- `nil` cannot be stored in a table without removing the key, so a table that must hold "no value" needs a sentinel such as `false` or a wrapper table. Beware the length operator `#`: it is only defined for sequences and may be unreliable on tables with holes. Use `next(t) == nil` to test emptiness.
- `pairs` iterates a table in an unspecified order; `ipairs` iterates an array in order. Do not modify a table while iterating over it.
- Use `table.insert`/`table.remove` for clarity, or `t[#t+1] = v` for a known-array append. Be careful with numeric for-loop variable scope; copy it if you need the value after the loop.

## Comments and Documentation
- Use `--` for a line comment; use `--[[ ... ]]` for a block comment. Always put a space after `--`: `-- not found`. A trailing comment is separated from the code by two spaces.
- There is no standard doc-comment convention. Two common choices: a LuaDoc block above the function, or a short comment header such as `--- Deletes a session.` followed by `-- @param id Session identification.`
- Comments should explain intent, not restate the code. TODO format: `-- TODO(owner): description`. Delete commented-out code; rely on version control.

## Error Handling
- `error("message")` raises a runtime error; `error("message", level)` controls where the position prefix is added (use level 2 to point at the caller). `assert(condition, "message")` raises when the condition is false and is the idiomatic guard.
- `pcall(fn, ...)` returns `ok, result` and never raises; `xpcall(fn, handler, ...)` lets you supply a traceback handler. Use `pcall` only around calls into code you do not control, or when you genuinely intend to recover. Inspect the `ok` flag; do not swallow every error and continue with garbage.
- Lua has no exception for "not found" - return `nil` and let the caller decide.
- Wrap error messages with context: `error("cannot open config: " .. path, 2)`.
- `error` with a non-string value (a table) is allowed and lets callers inspect structured details.

## Testing
- Frameworks: `busted` is the most common; `luassert` plus a small custom runner, and the built-in `lua` binary with plain asserts, are also used.
- Layout: a `spec/` directory with one spec file per module, named `<module>_spec.lua`. Layout with plain asserts: a `test/` directory mirroring `src/`.
- Test descriptions read as sentences: `describe("Config", function() it("returns nil for a missing key", ...) end)`.
- Use `assert.is_nil`, `assert.are.same`, and `assert.has_error` under busted; under plain Lua use `assert(result == nil, "message")`.
- Test through the module's public API, requiring it the same way a consumer would: `local config = require("config")`. Isolate global state between tests: save and restore `_G` entries, or design modules to be stateless.
- Keep fixtures in `spec/fixtures/` and load them with paths relative to the spec file.

## Anti-Patterns
- Assigning to an undeclared global - instead declare `local` at the top of the block.
- `module("mymodule", package.seeall)` - instead return a table and `require` it.
- Comparing with `== nil` where truthiness suffices - instead `if not value then`.
- `if x == false or x == nil` to mean "missing" - instead `if not x then`, unless `false` is a meaningful value.
- `table.getn(t)` (deprecated 5.1) - instead use `#t` for sequences.
- `print` for real output - instead `io.write` or a logger.
- Using the `debug` library to poke at internals - instead expose a documented API.
- A `for` loop that mutates the table being iterated - instead collect into a new table and return it.

## Code Example
```lua
-- Configuration loader.
-- Reads a `key=value` document and exposes the parsed values.

local M = {}

--- Returns the parsed key/value pairs of a configuration document.
-- @param contents string configuration text
-- @return table<string, string> parsed values
function M.parse(contents)
  local values = {}

  for line in contents:gmatch("[^\r\n]+") do
    local key, value = line:match("^%s*([^=]-)%s*=%s*(.-)%s*$")
    if key and key ~= "" then
      values[key] = value
    end
  end

  return values
end

--- Returns a required value or raises an error.
-- @param values table<string, string> parsed values
-- @param key string key to look up
-- @return string the value
function M.require_value(values, key)
  local value = values[key]
  assert(value ~= nil, string.format("missing required key: %s", key))
  return value
end

return M
```

## Sources
- http://lua-users.org/wiki/LuaStyleGuide
- https://www.lua.org/manual/5.4/manual.html
- https://www.lua.org/pil/
- https://lunarmodules.github.io/busted/
