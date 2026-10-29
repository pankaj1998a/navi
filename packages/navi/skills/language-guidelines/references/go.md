# Go Style Guide

> Source: Google Go Style Guide (https://google.github.io/styleguide/go/guide), Google Go Style Decisions (https://google.github.io/styleguide/go/decisions), Google Go Best Practices (https://google.github.io/styleguide/go/best-practices), and Effective Go (https://go.dev/doc/effective_go). `gofmt` is the canonical formatter.

## Quick Rules

- Run `gofmt` (or `go fmt ./...`) on every file. Never hand-format Go code.
- Indent with tabs. `gofmt` uses tabs for indentation and spaces for alignment.
- **Initialisms**: Words that are initialisms or acronyms (e.g. "URL", "HTTP", "ID") must have a consistent case: `parseURL`, `HTTPClient`, `userID`, `APIKey` (never `parseUrl` or `HttpClient`).
- Exported identifiers start with an uppercase letter (`PascalCase`); unexported start with lowercase (`camelCase`). Never use underscores in Go names.
- Package names are short, lowercase, single words (`http`, `template`). No underscores, no hyphens, and never generic `util` or `common` packages.
- Receiver names: Short (1 or 2 letters), reflecting the type name (e.g. `c *Client`, `r *Reader`). Never use generic names like `this` or `self`.
- Getters: Do not prefix with `Get`. A field `owner` has getter `Owner()` and setter `SetOwner()`.
- Return errors as the last return value; check every error explicitly. Never ignore errors with `_`.
- Guard clauses over `else`: After a conditional block that terminates with a return or error, do not write an `else` branch.
- Document every exported package, type, constant, function, and method with a doc comment starting with the identifier name.
- Prefer the zero value: Design types such that `var x T` is immediately valid and usable without initialization.

## Formatting

- Indentation: Tabs as emitted by `gofmt`.
- Line length: No hard limit, but keep statements readable. If a line is too long, refactor the code instead of awkward manual line splitting.
- Braces: K&R style (`gofmt` standard) — opening brace on the same line, closing brace on its own line.
- Control flow structures always use curly braces, even for single-line bodies.
- Imports: Standard library first, then third-party libraries, separated by a single blank line. Use `goimports` for deterministic formatting.

## Naming

- Packages: Short, lowercase, singular noun (`client`, not `clients` or `client_utils`).
- Types: `MixedCaps` (`Reader`, `BufferManager`).
- Functions & Methods: `MixedCaps` (`NewReader`, `ProcessRequest`).
- Interfaces: Name with `-er` suffix for single-method interfaces (`Reader`, `Writer`, `Formatter`).
- Constants: `MixedCaps` (`MaxIdleConnections`), not `SCREAMING_SNAKE_CASE`. Use `iota` for enumerated constants.
- Variables: Short and proportional to scope (`i` for short loops, `requestCtx` for larger scopes). Avoid stutter (`client.ClientConfig` -> `client.Config`).

## Types and Data

- Use `:=` for short declaration when type is inferred; use `var` when declaring zero values or explicit interface types.
- Small interfaces: Define interfaces where they are consumed, not where they are implemented.
- Error types: Suffix error types with `Error` (`PathError`). Sentinel errors prefix with `Err` (`ErrNotFound`).
- Mutexes: Place mutex directly above the fields it guards.
- Slices vs arrays: Prefer slices. Pre-allocate slices with `make([]T, 0, capacity)` when length is known.

## Comments and Documentation

- Every package must have a package-level doc comment: `// Package storage provides persistent key-value storage.`
- Exported functions and types must have doc comments starting with the identifier: `// Read reads up to len(p) bytes into p.`
- `TODO` format: `// TODO(username): explain task and context.`

## Error Handling

- Errors are normal return values. Never use `panic` for expected error conditions or in public APIs.
- Wrap errors with contextual information using `%w`: `fmt.Errorf("reading config %s: %w", path, err)`.
- Inspect wrapped errors using `errors.Is()` and `errors.As()`, never direct equality `==` or type assertions.
- Error strings must be lowercase without trailing punctuation: `errors.New("connection timed out")`.

## Anti-Patterns

- Underscores in identifiers (`user_id`). Instead: `userID`.
- Catch-all packages like `util/`, `helper/`, `common/`. Instead: cohesive, domain-specific packages.
- Ignoring errors with blank identifier `_ = file.Close()`. Always log or handle errors.
- Deeply nested `if-else` cascades. Instead: return early with guard clauses.
- Using `panic` across package boundaries.

## Code Example

```go
package store

import (
	"errors"
	"fmt"
	"sync"
)

var ErrItemNotFound = errors.New("item not found")

type Item struct {
	ID    string
	Value []byte
}

type MemoryStore struct {
	mu    sync.RWMutex
	items map[string]Item
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		items: make(map[string]Item),
	}
}

func (s *MemoryStore) Get(id string) (Item, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	item, exists := s.items[id]
	if !exists {
		return Item{}, fmt.Errorf("%w: %s", ErrItemNotFound, id)
	}
	return item, nil
}

func (s *MemoryStore) Set(item Item) error {
	if item.ID == "" {
		return errors.New("item id cannot be empty")
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	s.items[item.ID] = item
	return nil
}
```

## Sources
- https://google.github.io/styleguide/go/guide
- https://google.github.io/styleguide/go/decisions
- https://google.github.io/styleguide/go/best-practices
