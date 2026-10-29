- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Do not extract single-use helpers preemptively. Inline the logic at the call site unless the helper is reused, hides a genuinely complex boundary, or has a clear independent name that improves the caller.
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream
- In `src/config`, follow the existing self-export pattern at the top of the file (for example `export * as ConfigAgent from "./agent"`) when adding a new config module.

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/navi`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/navi`), never `tsc` directly.

## Architecture Layering

- Keep runtime dependencies directed from Schema to Core and Protocol, then from Core and Protocol to Server. Client runtime code may depend on Schema and Protocol but never Core or Server; `sdk` composes Client, Core, and Server.
- After changing the public Protocol or Server `HttpApi`, regenerate the client/SDK artifacts instead of editing generated files directly (see the SDK build note at the top of this file).
- This repository does not use Changesets. Do not add `.changeset` files; follow the existing release workflow instead.

## Session Core Invariants

- Keep durable events minimal: record irreducible new facts, never state derivable by folding the ordered history.
- Keep prompt admission (`session.inbox.enqueued` → `session.inbox.delivered`) separate from model execution; `session_inbox` stores only unconsumed work.
- Keep `SessionExecution` process-global and Session-ID based; keep `SessionRunner`, model resolution, tools, permissions, and filesystem Location-scoped.
- Each step is one explicit `llm.stream` call continuing from reloaded history. Do not add an in-memory tool loop.
- See CONTEXT.md for the full session-runtime vocabulary; keep new naming consistent with it.

## Branch Names, Commits and PR Titles

- Use short branch names of at most three words, hyphen-separated, no slashes or type prefixes (e.g. `session-recovery`).
- Use conventional commit-style messages and PR titles: `type(scope): summary` with types `feat`, `fix`, `docs`, `chore`, `refactor`, `test` (e.g. `fix(tui): simplify thinking toggle styling`).

## Google Style Guides Adherence

Navi coding agents (`build`, `tdd`, `reviewer`, `architect`, `debugger`, `optimizer`, etc.) must strictly adhere to Google's official coding style guides (https://google.github.io/styleguide/) across all supported programming languages:
- **C++**: Google C++ Style Guide (`cppguide.html`)
- **Python**: Google Python Style Guide (`pyguide.html`)
- **Go**: Google Go Style Guide, Decisions & Best Practices (`go/`)
- **TypeScript**: Google TypeScript Style Guide (`tsguide.html`)
- **JavaScript**: Google JavaScript Style Guide (`jsguide.html`)
- **Java**: Google Java Style Guide (`javaguide.html`)
- **Rust**: Google Rust Style Guide (`rustguide.html`)
- **Shell**: Google Shell Style Guide (`shellguide.html`)
- **HTML/CSS**: Google HTML/CSS Style Guide (`htmlcssguide.html`)
- **C#**: Google C# Style Guide (`csharpguide.html`)
- **Swift**: Google Swift Style Guide (`https://google.github.io/swift/`)
- **Kotlin**: Google Android Kotlin Style Guide (`kotlin/style-guide`)
- **Dart**: Effective Dart / Google (`effective-dart`)
- **Angular**: Google Angular Style Guide (`angular.dev/style-guide`)
- **Common Lisp**: Google Common Lisp Style Guide (`lispguide.html`)
- **Haskell**: Google Haskell Style Guide (`haskellguide.html`)
- **Objective-C**: Google Objective-C Style Guide (`objcguide.html`)
- **R**: Google R Style Guide (`Rguide.html`)
- **JSON**: Google JSON Style Guide (`jsoncguide.html`)
- **XML**: Google XML Document Format Style Guide (`xmlguide.html`)
- **Markdown**: Google Documentation Style Guide (`docguide/style.html`)
- **Verilog**: Google Verilog Style Guide (`verilogguide.html`)
- **Vim script**: Google Vimscript Style Guide (`vimscriptguide.html`)

Agents should consult `packages/navi/skills/language-guidelines` references before generating or reviewing code in any of these languages.

## Cloud Providers & Deployment Documentation

When agents are architecting, building, deploying, or troubleshooting apps targeting cloud environments, consult the official documentation hubs and repositories:
- **Amazon Web Services (AWS)**:
  - Official Docs: https://docs.aws.amazon.com/
  - GitHub: https://github.com/awsdocs
- **Oracle Cloud Infrastructure (OCI)**:
  - Official Docs: https://docs.oracle.com/ (Cloud Directory: https://docs.oracle.com/en/cloud/, IaaS/OCI: https://docs.oracle.com/en-us/iaas/Content/home.htm)
  - GitHub: https://github.com/oracle & https://github.com/oracle-devrel
- **Google Cloud Platform (GCP)**:
  - Official Docs: https://docs.cloud.google.com/docs & https://cloud.google.com/docs
  - GitHub: https://github.com/googlecloudplatform
- **Cloudflare**:
  - Official Docs: https://developers.cloudflare.com/
  - GitHub: https://github.com/cloudflare
- **Microsoft Azure**:
  - Official Docs: https://learn.microsoft.com/en-us/azure/?product=popular
  - GitHub: https://github.com/MicrosoftDocs (azure-docs: https://github.com/MicrosoftDocs/azure-docs)

For specialized cloud workflows, agents should load the `cloud-providers` skill (`packages/navi/skills/cloud-providers`).


