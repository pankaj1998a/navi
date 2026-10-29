# Erlang Style Guide

> Source: Erlang Coding Standards & Guidelines (https://github.com/inaka/erlang_guidelines) plus the Erlang Secure Coding Guidelines (https://www.erlang.org/doc/system/secure_coding.html)

## Quick Rules

- Indent with 2 spaces, spaces only; keep lines to 100 characters.
- Module names are `lower_snake_case`; function names are `lower_snake_case`; variables are `CamelCase`.
- Write `-spec` for every exported function and define types with `-type`.
- Do not use `if`; use function clauses and `case` instead.
- Avoid `throw` and `catch`; use `try ... of ... catch` for error handling.
- Never use `-import` or `-compile(export_all)`.
- Keep functions small (about 12 expressions) and avoid nesting more than 3 levels deep.
- Group types at the top of the module and records before the functions that use them.
- Prefer pattern matching to equality tests; prefer iolists to string concatenation.
- Use tagged tuples or atoms for messages: `{set_foo, Pid}`.

## Formatting

- Indentation: 2 spaces per level; spaces only, never tabs.
- Line length: 100 characters maximum.
- No trailing whitespace.
- Surround operators and commas with spaces.
- Put a space after a comma; write `{ok, Value}`.
- End every function clause with `.` and separate clauses with a blank line.
- Put one blank line between top-level functions.
- Group exported functions first, then unexported ones, when that aids discovery.
- Place all `-type` and `-opaque` declarations at the beginning of the module.
- Place records used by the module before the function bodies.

## Naming

- Modules: `lower_snake_case` (`my_app_http_server`), consistent across the project.
- Functions: `lower_snake_case`, atoms only (`parse_header`).
- Variables and parameters: `CamelCase` (`RequestBody`, `MaxRetries`).
- Atoms: `lower_snake_case`; quote only when unavoidable (`'GET'`).
- Records: `lower_snake_case` with `lower_snake_case` field names (`#http_request{status = 200}`).
- OTP state records are named `#<module>_state` and typed as `-type state() :: #<module>_state{}`.
- Macros: `ALL_UPPER_CASE`.
- Type names: `lower_snake_case` (`http_error()`), opaque types where the representation is private.
- Boolean parameters are avoided; use separate functions or a behaviour instead.

## Types and Data

- Write `-spec` for exported functions; use `-callback` instead of `behaviour_info/1`.
- Define types with `-type` and export them with `-export_type` when they are part of the API.
- Use `-opaque` for types whose representation should stay private.
- Always type the fields of a record.
- Keep records module-private; share data through opaque types and accessor functions.
- Avoid records in specs; use types instead.
- Prefer binaries and iolists over lists of integers and string concatenation.
- Do not use the `process_flag`/global state tricks; pass state explicitly.

## Comments and Documentation

- Comment levels: `%%%` for module comments, `%%` for function comments, `%` for inline comments.
- Document every exported function with an edoc `%% @doc` comment describing arguments and the return value.
- Write module-level `%%%` documentation explaining what the module is for.
- Comments explain why, not what.
- Use `%% @spec` and `%% @doc` tags so `edoc` can generate documentation.
- Avoid comments that will go stale; update them with the code.

## Error Handling

- Do not use `if`; let function clauses and `case` handle the branching.
- Use `try ... of ... catch` for error handling; never `case catch`.
- Do not use `throw`/`catch` for non-local returns; use tail recursion.
- Pattern match on `{ok, Value}` and `{error, Reason}` tuples rather than raising for expected failures.
- Let a process crash rather than partially updating state; supervision handles restarts.
- Log errors with the stack trace; do not let errors pass unlogged.
- Validate arguments in the API function of the module, at the outermost layer.

## Testing

- Use Common Test (`*_SUITE.erl` files) or EUnit (`*_tests.erl` modules).
- Name Common Test suites `<module>_SUITE` with a `all/0` listing the test cases.
- Name test cases descriptively: `returns_error_for_invalid_input`.
- Keep unit tests short with one or two assertions each so failures are easy to localize.
- Use `?_assert` macros for EUnit; `?_assertEqual` for value comparisons.
- Set up and tear down per test case with `{setup, ...}` / `{cleanup, ...}`.
- Prefer pattern matching in test setup to build fixtures; use `?assertMatch` for shape checks.
- Run the full test suite in CI before releasing.

## Anti-Patterns

- `if` expressions. Instead: use function clauses; each clause is a named case.
- `throw` to escape a loop. Instead: restructure with tail recursion.
- `-import` to shorten calls. Instead: call `module:function(...)` so the origin is obvious.
- `-compile(export_all)`. Instead: export an explicit list of functions.
- `-include` a header with record or type definitions shared across modules. Instead: keep records in one module and share opaque types.
- Comparing with `=:=` and then branching. Instead: pattern match in the function head.
- `length(List) > 0`. Instead: match on `[]` / `[ _ | _ ]`.
- A 6000-line module with 500 functions. Instead: split into focused modules with one responsibility.

## Code Example

```erlang
-module(http_header).
-export([parse/1, format/1]).

%% @doc A single header field.
-type header() :: {binary(), binary()}.

%% @doc Parses a raw header line into a `header()' tuple.
-spec parse(binary()) -> {ok, header()} | {error, malformed}.
parse(Line) when is_binary(Line) ->
    case binary:split(Line, <<":">>) of
        [Name, Value] ->
            {ok, {trim(Name), trim(Value)}};
        _ ->
            {error, malformed}
    end.

%% @doc Formats a header tuple back into its wire representation.
-spec format(header()) -> binary().
format({Name, Value}) ->
    <<Name/binary, ": ", Value/binary>>.

%% @private
-spec trim(binary()) -> binary().
trim(Bin) ->
    string:trim(Bin, both, " \t").

-ifdef(TEST).
-include_lib("eunit/include/eunit.hrl").

parse_test_() ->
    [?_assertEqual({ok, {<<"Host">>, <<"example.com">>}},
                   parse(<<"Host: example.com">>)),
     ?_assertEqual({error, malformed}, parse(<<"broken">>))].

-endif.
```

## Sources

- https://github.com/inaka/erlang_guidelines
- https://www.erlang.org/doc/system/secure_coding.html
- https://www.erlang.org/doc/man/erlang.html
