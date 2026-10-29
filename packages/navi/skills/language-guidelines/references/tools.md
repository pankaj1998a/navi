# Tools

> Source: https://agents.md, https://eslint.org/, https://standardjs.com/rules.html, https://rubocop.org/, https://cs.symfony.com, https://github.com/squizlabs/PHP_CodeSniffer, https://github.com/checkstyle/checkstyle, https://github.com/koalaman/shellcheck, https://github.com/conventional-changelog/conventional-changelog, https://github.com/semantic-release/semantic-release, https://laravel.com/docs/11.x/pint, https://github.com/easy-coding-standard/easy-coding-standard

## Quick Rules
- Never add a linting, formatting, or release tool to a project that already has one; use the tool the project uses.
- Commit the tool's configuration file (`eslint.config.js`, `.rubocop.yml`, `.php-cs-fixer.php`, `checkstyle.xml`, `ecs.php`) and the lockfile that pins it.
- Wire every linter into pre-commit hooks and CI so violations are caught before merge, not after.
- Pin tool versions; a formatter upgrade that changes every file is a project-wide diff, so it needs its own commit.
- Run the tool in check mode in CI (`--fix` only locally) so CI never mutates the tree.
- Fix the whole file, not just the lines you touched, so the diff stays consistent.
- Use `--report-unused-disable-directives` style flags to keep suppression comments from piling up.
- Keep the agent-facing `AGENTS.md` at the repository root (plus nested copies per package) with setup, test, and style commands.

## Agent Guidance

### AGENTS.md
- The open, tool-agnostic format for guiding coding agents; used by Codex, Cursor, Copilot, opencode, Aider, and others.
- Place `AGENTS.md` at the repository root; add nested files in packages for monorepos; the nearest file wins.
- Keep it as plain Markdown with any headings you like; no required fields.
- Cover: project overview, install/build/test commands, code style rules, testing instructions, security notes, PR and commit conventions.
- Keep it living: update it when the commands or conventions change, and symlink `AGENT.md` if legacy tooling expects it.
- Do not duplicate the human README; link to it and add only what an agent needs.

## JavaScript and TypeScript

### ESLint
- The pluggable linter for JavaScript, JSX, and TypeScript; config lives in `eslint.config.js` (flat config) and is resolved from the nearest directory upward.
- Run `npx eslint .` for the whole project, `npx eslint --fix .` to auto-fix, `--cache` to speed up repeat runs, `--max-warnings 0` to fail on warnings in CI.
- Quote glob patterns (`npx eslint "lib/**"`) so the shell does not expand them.
- Use `--report-unused-disable-directives` to fail on stale `eslint-disable` comments.
- Scope configs per directory with `files` patterns; keep shared rules in a `configs/` folder imported by the flat config.

### JavaScript Standard Style
- The zero-config style: 2-space indent, single quotes, no semicolons, camelCase names, space before function parens, `===` comparisons.
- No unused variables, no `var`, no `eval`, no `debugger`, no trailing commas, files end with a newline.
- Install as `standard` and run `standard --fix`; the rules map one-to-one onto ESLint rule IDs.
- Use it when the project has no formatter yet; do not combine it with Prettier without an explicit decision.

### Conventional Changelog
- Generates a changelog from git commit metadata, using a preset such as `conventionalcommits` or `angular`.
- Commit types drive the changelog sections and the version bump: `fix` for patch, `feat` for minor, `BREAKING CHANGE:` in the footer for major.
- Pair it with `commitlint` to reject malformed messages and with `standard-version` or `semantic-release` to version and publish.
- Keep the changelog in `CHANGELOG.md` at the repository root, grouped by release.

### semantic-release
- Fully automates versioning, changelog generation, tagging, and publishing from commit messages.
- Runs in CI on the release branch after a successful build; it verifies conditions, analyses commits, generates notes, tags, and publishes.
- Default preset is the Angular commit convention; switch with the `preset` option for `conventionalcommits`.
- Requires a Git repository, a CI system with secure credentials, and a recent Git and Node version.
- Never bump `package.json` version by hand in a semantic-release project.

## PHP

### PHP_CodeSniffer
- Detects and fixes violations of a defined standard (PSR-12, Symfony, Magento, WordPress) with `phpcs` and `phpcbf`.
- Configure with a `phpcs.xml` (or `phpcs.xml.dist`) naming the installed standard and the paths to scan.
- Run `vendor/bin/phpcs` in CI and `vendor/bin/phpcbf` locally to auto-fix.
- Rulesets are composable: `phpcs --standard=PSR12,SlevomatCodingStandard` covers more than a single standard.

### PHP CS Fixer
- The fixer for PHP style and modernisation; configured in `.php-cs-fixer.php` returning a `Finder` and a rules list.
- Run `vendor/bin/php-cs-fixer fix --dry-run --diff` in CI and `vendor/bin/php-cs-fixer fix` locally.
- Keep risky rules in a separate `@PHP*Migration` set, enabled one migration at a time.
- Target a specific PHP version with `PhpCsFixer\PhpVersion` so the fixer does not suggest unsupported syntax.

### Laravel Pint
- The opinionated PHP style fixer built on PHP-CS-Fixer, for Laravel projects.
- Configure with `pint.json`; the `laravel` preset is the default. Run `vendor/bin/pint` to fix, `--test` to check only.
- Keep it consistent with the Laravel conventions; do not add extra rules without a reason.

### EasyCodingStandard
- Runs PHP_CodeSniffer and PHP-CS-Fixer rules together from one `ecs.php` config.
- Enable curated prepared sets (`arrays`, `spaces`, `namespaces`, `docblocks`, `controlStructures`, `comments`, `casing`, `cleanup`) or a single preset (`psr12`, `perCs`, `laravel`).
- Use `withSkip()` for files or rules that are deliberately excluded, and `with*Level()` to adopt the standard gradually.
- Run `vendor/bin/ecs` to check and `vendor/bin/ecs --fix` to repair.

## Other Languages

### RuboCop
- The Ruby static analyser and formatter, driven by the community Ruby style guide.
- Configure in `.rubocop.yml` with `AllCops: NewCops: enable` so new cops are adopted deliberately.
- Run `bundle exec rubocop` in CI, `bundle exec rubocop -a` to apply safe corrections, `-A` for unsafe ones.
- Use `rubocop --auto-gen-config` to generate a `.rubocop_todo.yml` for legacy code, and shrink the todo list over time.
- Keep `Layout`, `Lint`, and `Security` departments at their default severity.

### Checkstyle
- The Java code-quality tool that enforces a code standard through a ruleset.
- Configure with `checkstyle.xml` referencing the `Checker` module and a `TreeWalker` with the checks you enforce.
- Run `java -jar checkstyle-10.18.1-all.jar -c config.xml <sources>`; integrate via the Maven/Gradle plugin in CI.
- Keep the ruleset small and enforceable; a standard nobody can satisfy is not a standard.

### ShellCheck
- The static analyser for bash and sh scripts; catches quoting bugs, portability problems, and misuse of common commands.
- Run `shellcheck myscripts/*.sh` and fail CI on any warning; add a `shellcheck` hook to `.pre-commit-config.yaml`.
- Pin a ShellCheck version explicitly to avoid surprise build breaks when new warnings ship.
- It does not enforce formatting; pair it with `shfmt` if you need a consistent shell style.

## Anti-Patterns
- Adding ESLint to a project that already uses Standard, or Prettier to a project that already uses Pint. Instead: use the project's existing tool.
- Running the formatter in CI with `--fix`, so CI commits changes instead of reporting them. Instead: check mode in CI, fix mode locally.
- Enabling every rule in a new linter config, creating hundreds of errors on day one. Instead: start with the recommended set and adopt stricter rules incrementally.
- Editing generated or vendored files to satisfy the linter. Instead: exclude vendor, build, and generated paths in the config.
- Manually bumping the version in `package.json` while `semantic-release` is also enabled. Instead: let the tool version the release.
- Leaving `eslint-disable` and `phpcs:ignore` comments behind after the underlying issue is fixed. Instead: enable the unused-disable reporting flag and clean them up.
- Storing linting configuration in a global or per-developer file. Instead: commit the config so every machine and CI run the same rules.

## Sources
- https://agents.md
- https://eslint.org/
- https://standardjs.com/rules.html
- https://rubocop.org/
- https://cs.symfony.com
- https://github.com/squizlabs/PHP_CodeSniffer
- https://github.com/easy-coding-standard/easy-coding-standard
- https://laravel.com/docs/11.x/pint
- https://github.com/checkstyle/checkstyle
- https://github.com/koalaman/shellcheck
- https://github.com/conventional-changelog/conventional-changelog
- https://github.com/semantic-release/semantic-release
