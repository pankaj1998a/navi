# Haskell Style Guide

> Source: Haskell Programming Guidelines (https://wiki.haskell.org/Programming_guidelines), with the GHC team's WorkingConventions (https://hackage.haskell.org/trac/ghc/wiki/WorkingConventions) and the Haddock markup reference (https://haskell-haddock.readthedocs.io/en/latest/markup.html) as supporting references.

## Quick Rules
- Put a Haddock module header (`{- | ... -}`) at the top of every source file, with the hierarchical module name matching the file path.
- Keep lines at 80 characters or fewer (75 preferred). Never leave trailing whitespace. Always end the file with a newline.
- Expand tabs to spaces; use 4 spaces per indentation level and stay consistent.
- Types and type classes start with an uppercase letter; functions and variables start with lowercase. Use `lowerCamelCase` for multi-word names.
- Write a type signature for every top-level function. Avoid shadowing and unused bindings; respect compiler warnings.
- Prefer total functions. Avoid `head`, `tail`, `fromJust`, and `!!`; use pattern matching or `Maybe`/`Either` instead.
- Use `let` rather than `where`; do not mix and nest them.
- Separate pure code from IO. Keep IO in thin wrapper functions and put the logic in pure helpers.
- Import `Set` and `Map` qualified (`import qualified Data.Set as Set`).
- No `unsafePerformIO`, no `Debug.Trace` in shipped code, no commented-out code.

## Formatting
- Indentation: 4 spaces (the guide allows 4 or 8 but asks for consistency); tabs are forbidden.
- Line length: 80 characters maximum, 75 preferred. Break long expressions by restructuring rather than by wrapping arbitrarily.
- Layout is significant. Break after `do`, `let`, `where`, and `case ... of ...`, and indent the alternatives by one level.
- Put each `case` alternative on its own line; do not use the `{ a; b }` brace-and-semicolon style.
- One blank line between top-level definitions. No trailing whitespace on any line; exactly one trailing newline at end of file.
- `where`/`let` bindings align under the keyword. Multi-line records use the leading-comma style, one field per line (`{ field1 :: a` / `, field2 :: a`).
- Imports: one module per line, standard library by hierarchical name (`import Data.List`), sorted, with a blank line between groups.

## Naming
- Types, type classes, and data constructors: `UpperCamelCase` (`ParseResult`, `Either`).
- Functions, arguments, and local bindings: `lowerCamelCase` (`parseInput`, `currentToken`).
- Module names: hierarchical and matching the directory, e.g. `Data.Company.Project` in `src/Data/Company/Project.hs`.
- Avoid symbolic infix identifiers except in libraries that define them; a trailing `\\` breaks CPP.
- Use `snake_case` only where a library's documented spelling demands it, and transliterate it in caller code. Long names are fine when they carry information; be laconic when a short name is unambiguous: `splineInterp` beats `spline_interpolation`.
- Bool-ish predicates read as predicates: `isEmpty`, `hasError`. Internal-only helpers get a leading underscore: `_internalHelper`.

## Types and Data
- Give every top-level function an explicit type signature; it is documentation and it catches errors.
- Use real data types over type synonyms and tuples. Prefer a dedicated sum type to a boolean flag.
- Give records explicit field names; do not depend on constructor field order. Use `newtype` for a distinct type with the same representation.
- Put class constraints on functions, not on the data type, and avoid type synonyms that hide the underlying representation (`type FilePath = String`).

## Comments and Documentation
- Every exported function and data type gets a Haddock comment (`-- |` before the definition, or `{- | ... -}`).
- The Haddock comment starts with the identifier name and states what the thing does.
- Module header Haddock is mandatory and must include module name, description, copyright, licence, maintainer, stability, and portability.
- Implementation comments use `--` (or `{- -}` for blocks). They should say *what* the code does, not *how*.
- Do not put comments inside a function body that merely restate the code. Decompose the function instead.
- TODO format: `-- TODO(owner): description`. Delete commented-out code; rely on version control.

## Error Handling
- Model failure in the type system: `Either Text a` or a dedicated `data ParseError = ...`.
- `error` is for genuinely impossible states only, and the message should name the position: `error "ParseConfig.unquote"`.
- Do not use `error` to signal user input problems or missing data.
- Partial functions must document their preconditions, and callers must ensure them.
- Prefer `maybe defaultValue id (Map.lookup key m)` or a `case` over `fromJust (Map.lookup key m)`.
- Do not use `unsafePerformIO` in library code. `Debug.Trace` is for debugging only and must not remain in production code.

## Testing
- Frameworks: HUnit (`hunit`) for unit tests, `hspec` for specifications, `tasty` with `tasty-hunit` for larger suites.
- Layout: a `test/` directory at the project root, mirroring the `src/` structure, exposed through the `test-suite` stanza.
- Test module names: `Spec` or `Test` suffix, e.g. `ParserSpec`.
- Function names: `prop_` for QuickCheck properties, `case_` for HUnit cases, or `describe`/`it` blocks under hspec.
- Keep the test module separate from the implementation module; use the package's public API and test the exported behaviour, including error cases.
- Use `QuickCheck` for pure functions with algebraic properties; use explicit example tables for the tricky corners.

## Anti-Patterns
- `head xs` / `xs !! 0` - instead pattern match and return `Nothing` or a `Maybe`.
- `fromJust (Map.lookup k m)` - instead use a `case` or `maybe`.
- `let x = 1 in ...` nested inside `where` - instead use one style (`let` preferred) and keep bindings flat.
- `f (g (h x))` - instead use `f $ g $ h x`, or `f . g . h` for a definition.
- A `case` written on one line with brace syntax - instead break after `of` and indent the alternatives.
- Missing type signatures on exported functions - instead write the signature; it is the cheapest documentation there is.
- Importing only part of a module and hiding the rest - instead import the whole module and qualify if needed.
- `unsafePerformIO` to sneak IO into a pure function - instead separate the pure core from the IO shell.

## Code Example
```haskell
{- |
Module      : Company.Project.Parser
Description : Parse a configuration file into a typed record.
-}
module Company.Project.Parser
  ( Config (..), ParseError (..), parseConfig ) where

import Data.Char (isSpace)
import Data.List (foldl')

data Config = Config
  { configName :: String
  , configRetries :: Int
  }
  deriving (Eq, Show)

data ParseError
  = MissingKey String
  | NotAnInteger String
  deriving (Eq, Show)

-- | Parse a "key=value" document into a 'Config'.
parseConfig :: String -> Either ParseError Config
parseConfig contents = do
  name <- required contents "name"
  retries <- optionalInt contents "retries" 3
  pure (Config name retries)
  where
    required text key = case lookup key (pairs text) of
      Just value -> Right value
      Nothing -> Left (MissingKey key)
    optionalInt text key fallback = case lookup key (pairs text) of
      Nothing -> Right fallback
      Just raw -> case reads raw of
        [(n, rest)] | all isSpace rest -> Right n
        _ -> Left (NotAnInteger raw)
    pairs = foldl' step [] . lines
    step acc line = case break (== '=') line of
      (key, '=' : value) -> (trim key, trim value) : acc
      _ -> acc
    trim = reverse . dropWhile isSpace . reverse . dropWhile isSpace
```

## Sources
- https://wiki.haskell.org/Programming_guidelines
- https://hackage.haskell.org/trac/ghc/wiki/WorkingConventions
- https://haskell-haddock.readthedocs.io/en/latest/markup.html
- https://www.haskell.org/onlinereport/haskell2010/
