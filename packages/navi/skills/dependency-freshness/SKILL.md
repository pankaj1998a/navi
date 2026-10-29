---
name: dependency-freshness
description: "Verify dependencies are up to date against live package registries whenever adding or updating any dependency or writing new code that pins versions. Use package_versions tool first; fall back to registry HTTP APIs or CLI checks. Covers npm, pnpm, yarn, bun, pip, poetry, uv, cargo, go mod, gem, bundler, composer, nuget, hex, pub, maven, gradle."
---

# Dependency Freshness

## When this applies

You MUST run a freshness check before ANY of the following actions:

- (a) Adding a package to a manifest (package.json, Cargo.toml, pyproject.toml, go.mod, Gemfile, composer.json, *.csproj, mix.exs, pubspec.yaml, pom.xml, build.gradle, and friends).
- (b) Bumping or pinning a version anywhere, including "just touching" the version string.
- (c) Writing a new import/require/use statement for a package that is not already in the manifest.
- (d) Copying a dependency block between projects, or from docs/blog posts/README snippets.
- (e) Creating a new manifest from scratch (scaffolding, bootstrapping a new module).
- (f) Advising a user to install something (`bun add x`, `cargo add x`, `pip install x`, ...).

No exceptions -- including throwaway scripts, examples, patches, and "quick fixes".
Scripts regress into products; a stale pin written today becomes a CVE tomorrow.

## Primary path: package_versions tool

Navi has the built-in `package_versions` tool. Use it FIRST, every time. Try it
before any fallback command. Invocation forms:

1. Explicit list (mixed ecosystems supported):

   invoke package_versions { "packages": ["npm:react", "npm:typescript", "pypi:requests", "crates:tokio"] }

2. Full JS/TS manifest:

   invoke package_versions { "manifestPath": "packages/app/package.json" }

3. Rust manifest:

   invoke package_versions { "manifestPath": "crates/mylib/Cargo.toml" }

Rules:

- Treat any result with `outdated: true` as a blocker. NEVER write a version
  older than the returned `latest` unless the user explicitly demanded that
  older pin. If the user demands it, honor the user and note the gap.
- When `outdated: true`, write the `latest` version returned by the tool into
  the manifest, and tell the user in one line that you bumped the pin to latest.
- If an entry comes back as an error (unknown package, ecosystem Routing
  failure, network error for that package), fall back to the live registry
  checks below for that package only. Packages that resolved fine need no
  fallback.

## Fallback: live registry checks

Only when the tool is unavailable or an entry errors. These sources update live:

| Ecosystem | Live check | Notes |
| --- | --- | --- |
| npm / bun / pnpm / yarn | `npm view <pkg>@latest version` | bun/pnpm/yarn share the same npm registry; `bun pm view` also works; any of them answers for all four |
| PyPI (pip / poetry / uv) | `curl -s https://pypi.org/pypi/<pkg>/json` -> `info.version` | or `pip index versions <pkg>` |
| Cargo (crates.io) | `curl -s https://crates.io/api/v1/crates/<crate>` -> `.crate.max_stable_version` | crates.io REQUIRES an identifying User-Agent header (e.g. `curl -s -H "User-Agent: navi-agent (dev@localhost)" ...`) |
| Go (go mod) | `go list -m -versions <module>` | plain module path, no ecosystem prefix |
| RubyGems (gem / bundler) | `gem search <gem> --remote --exact` or `curl -s https://rubygems.org/api/v1/gems/<gem>.json` | JSON `.version` field |
| Composer (PHP) | `curl -s https://repo.packagist.org/p2/<vendor>/<pkg>.json` | first key of `versions` is newest |
| NuGet (dotnet) | `curl -s https://api.nuget.org/v3-flatcontainer/<id>/index.json` | last entry of `versions` array |
| Hex (Elixir) | `curl -s https://hex.pm/api/packages/<name>` | `.version` |
| Dart / pub | `curl -s https://pub.dev/api/packages/<name>` | `.latest.version` |
| Maven / Gradle | `curl -s "https://search.maven.org/solrsearch/select?q=g:<group>+AND+a:<artifact>&rows=1&wt=json"` | `latestVersion` |

Hard rules:

- NEVER treat a lockfile (bun.lock, package-lock.json, pnpm-lock.yaml,
  yarn.lock, Cargo.lock, uv.lock, poetry.lock, composer.lock, Gemfile.lock),
  a workspace `~/*` catalog, docs you remember, or your training memory as
  evidence of the latest version. Lockfiles and catalogs record what existed
  when they were last written, not what is current.
- Treat your training data as stale. Every check is an "as of today's date"
  question; assume any version you remember is outdated until a live source
  says otherwise.

## Manifest writing rules

- Default to caret ranges: `^1.2.3` for npm/npm-compatible ecosystems (bun,
  pnpm, yarn, deno). For Cargo the equivalent default is `1.2` (implicit
  caret). For poetry-style constraints prefer `>=1.2.3,<2.0.0`. The shared
  idea: allow patch/minor updates, do not hard-pin unless the user asks, and
  never jump a major without the user's decision.
- Never use `*` as a version. It silently floats across breaking majors.
- After editing a manifest, keep its lockfile in sync. Known lockfile names:
  npm: package-lock.json; bun: bun.lock; pnpm: pnpm-lock.yaml; yarn: yarn.lock;
  Cargo: Cargo.lock; uv: uv.lock; pip-tools: requirements.txt lock;
  poetry: poetry.lock; composer: composer.lock; bundler: Gemfile.lock;
  Hex: mix.lock; Dart: pubspec.lock; Gradle/Maven: pom.xml/gradle.lockfile as
  applicable.
- After writing the version, re-run the check ONCE to confirm that the string
  you wrote equals the `latest` you fetched. Transcription errors are real.

## Anti-patterns

1. Copying a dependency block from a blog post, README, or AI-generated
   snippet into a manifest without a freshness check. Blog pins are stale by
   definition.
2. Pinning a version from memory ("react is 18.2.0, right?") instead of
   querying the registry.
3. Writing the literal string `latest` as a version requirement. It is not a
   valid version specifier in most ecosystems and npm resolves it only in
   install commands, not manifests.
4. Ignoring deprecation warnings, yanked flags, or EOL notices returned by
   the registry. If the registry says the package is deprecated or yanked,
   report it to the user and suggest an alternative instead of installing.
5. Bumping a transitive/indirect dependency (or running a blanket `cargo
   update -p`, `bun update` on one package) without checking compatibility of
   packages that depend on it.
6. Skipping the check because the package "is surely current" or because you
   checked it "earlier in this session". Earlier in the session is not live.
7. Querying a mirror or custom registry without verifying it is the one the
   project is actually configured to use (.npmrc, .cargo/config.toml,
   pip.ini, repositories settings). A version on a stale mirror is not a
   version you can depend on.
8. Writing a prerelease tag (alpha/beta/rc/canary/snapshot) unless the user
   explicitly asked for a prerelease.

## Multi-project changes

- Run the check per manifest. Monorepos commonly hold several package.json
  files plus a Cargo workspace or a Python project per folder; a single folder
  scan does not discharge the obligation for sibling manifests.
- Batch your calls to limit latency: pass all packages of one ecosystem in one
  `package_versions` invocation (e.g. every npm dependency of the manifest in
  one list), and run independent fallback commands in parallel where the
  harness allows it.
