# Elm Style Guide

> Source: Elm Style Guide (http://elm-lang.org/docs/style-guide) - the live page is a client-rendered application, so the same text was read from the style-guide source shipped with elm-format (https://github.com/rtfeldman/elm-format/tree/master/Style%20Guide) - plus the official Elm Guide (https://guide.elm-lang.org/) and the elm-format rules (https://github.com/rtfeldman/elm-format)

## Quick Rules

- Format code with `elm-format`; it is the single source of truth for whitespace, indentation, and layout.
- Imports are sorted alphabetically by the qualified module name; exposed values are sorted operators, then types, then other values.
- Use `camelCase` for values and functions, `UpperCamelCase` for types and type aliases.
- A module exposes one primary type; other exposed types are named for their role.
- Model expected failures as `Result` and absence as `Maybe`; never throw exceptions for expected errors.
- Use a port (`port module`) for all JavaScript interop; keep `init` flags to simple values.
- Document modules with `{-| ... -}` and functions with a `{-| ... -}` comment above the annotation.
- Never add `default` to a custom type constructor; model the absence explicitly.
- Keep `update`/`view`/`init` pure; put side effects in commands and subscriptions.

## Formatting

- Indentation: 4 spaces for top-level declarations and function bodies (elm-format default).
- Line length: elm-format wraps at 80 columns by default.
- Small lists stay on one line (`[1, 2, 3]`); large lists put one item per line with the comma at the start of the line:

```elm
[ 1
, 2

-- a new section
, 3
]
```

- Records follow the same leading-comma convention for large literals.
- Binary operator expressions do not use parentheses around function application: `"a" ++ f x y ++ "b"`.
- Parentheses are required around `let`, `if`, `case`, and lambda expressions used as operands.
- The left pipe `<|` is placed at the end of the preceding line, with the continuation indented.
- Comments (`--`, `{- -}`) separate sections; place two blank lines before a top-level section header comment.
- No trailing whitespace; files end with a newline; UTF-8.

## Naming

- Types and type aliases: `UpperCamelCase` (`Msg`, `User`, `Profile`).
- Functions and values: `camelCase` (`update`, `view`, `filteredUsers`).
- Constructors of a custom type: `UpperCamelCase` (`Loading`, `Loaded`, `Failed`).
- Modules are named by what they provide; a module exposing one type usually has that type's name.
- Exposed helper functions that belong to a type are named after the type: `User.name`.
- Record fields: `camelCase` (`name`, `email`).
- Ports: `port module` with `port name : Type` declarations; JS side names are camelCase.
- Avoid abbreviations and single-letter names outside of short lambdas.

## Types and Data

- Define custom types for domain state; use type aliases only for simple wrappers.
- Make the custom type the single source of truth for a module; other modules consume it.
- Use `Result` for operations that can fail and `Maybe` for values that may be absent.
- Avoid records of functions; use functions that take and return records.
- Keep `init`, `update`, and `view` pure and deterministic; side effects live in `Cmd`/`Sub`.
- Use `Msg` to describe intent (`SaveClicked`, `NameChanged`) rather than implementation details.
- Never represent "no value" with a magic sentinel; use `Maybe`/`Result`.
- Prefer pattern matching over `if`/`else` chains when discriminating custom types.

## Comments and Documentation

- Module documentation uses `{-| ... -}` at the top of the file, followed by the module's `port module`/`module` declaration or its exposed types.
- Function documentation uses `{-| ... -}` directly above the type annotation.
- Markdown inside doc comments: use fenced code blocks with an `elm` info string, and `{-` to escape code blocks in prose.
- Use `--` for line comments inside function bodies and section separators.
- Two blank lines before a top-level section comment; one blank line inside data structures to start a new section.
- Avoid comments that restate the code; explain intent and non-obvious invariants.

## Error Handling

- Model recoverable failures as `Result error value` and unwrap with `case`/`Maybe.map`/`Result.map`.
- Use `Maybe` for optional values (`Maybe String`).
- Never use `Debug.todo` or `Debug.crash` in shipped code; they exist for incomplete work.
- Validate at the boundary of the Elm application (ports) and convert failures into `Msg` values.
- Do not use `Task.attempt` for user-facing failures; model them explicitly.
- Log errors with `Debug.log` only during development; remove them before release.

## Testing

- Tests live in a `tests/` directory as `elm-explorations/tests` packages or with `elm-test`.
- Test files mirror the source: `tests/UserTest.elm` for `src/User.elm`.
- Use `elm-test`, with a `Test` alias per module: `Tests = Test.Html.Query ...`.
- Name tests as descriptive strings: `test "shows an error when the name is empty"`.
- Keep tests focused on one behaviour; use `Test.Html.Query.find`/`hasText` for view assertions.
- Avoid asserting on internal implementation; assert on rendered output and exposed functions.
- Keep a small, fast test suite so it runs in CI on every change.

## Anti-Patterns

- `default` on a custom type constructor. Instead: add an explicit `None`/`Empty` constructor.
- `Maybe` for an operation that can fail with a reason. Instead: use `Result`.
- Calling `Debug.todo` in a view. Instead: model the unfinished state.
- Side effects inside `update` or `view`. Instead: return a `Cmd` or `Sub`.
- Sorting imports by hand in a different order. Instead: let `elm-format` sort them.
- A module exposing several unrelated types. Instead: split into separate modules.
- Using a record to bundle functions. Instead: pass the record and use plain functions.

## Code Example

```elm
module Main exposing (Msg(..), Model, init, update, view)

import Browser
import Html exposing (Html, button, div, text)
import Html.Events exposing (onClick)

type Msg
    = Increment
    | Decrement

type alias Model =
    { count : Int }

init : Int -> ( Model, Cmd Msg )
init start =
    ( { count = start }, Cmd.none )

update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        Increment ->
            ( { model | count = model.count + 1 }, Cmd.none )

        Decrement ->
            ( { model | count = model.count - 1 }, Cmd.none )

{-| Renders the counter and the buttons that change it.
-}
view : Model -> Html Msg
view model =
    div []
        [ button [ onClick Decrement ] [ text "-" ]
        , div [] [ text (String.fromInt model.count) ]
        , button [ onClick Increment ] [ text "+" ]
        ]
```

## Sources

- http://elm-lang.org/docs/style-guide
- https://github.com/rtfeldman/elm-format/tree/master/Style%20Guide
- https://guide.elm-lang.org/
- https://github.com/rtfeldman/elm-format
