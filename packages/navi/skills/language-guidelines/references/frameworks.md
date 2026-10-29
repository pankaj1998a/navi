# Frameworks

> Source: https://symfony.com/doc/current/contributing/code/standards.html, https://docs.djangoproject.com/en/dev/internals/contributing/writing-code/coding-style/, https://vuejs.org/style-guide/, https://angular.dev/style-guide

## Quick Rules
- Detect the framework from the project files first (`package.json`, `composer.json`, `pyproject.toml`, `Gemfile`, `go.mod`) and follow that framework's conventions, not generic ones.
- Keep the framework's own directory layout intact: put code in the framework's standard locations instead of inventing a parallel structure.
- Run the framework's own formatter, linter, and test runner (`npm run lint`, `vendor/bin/php-cs-fixer`, `pre-commit run`, `ng test`) rather than a generic tool.
- Respect the framework's dependency management model: `package.json`/lockfile, `composer.json`, `requirements.txt`/`pyproject.toml`; never vendor dependencies by hand.
- Prefer the framework's built-in abstractions (routing, ORM, component model, DI container) over rolling your own.
- Keep business logic out of views, templates, and components; those layers render and dispatch, they do not compute.
- Follow the framework's naming conventions for files, classes, and components so tooling and generators keep working.
- Upgrade within the framework's supported major versions only; pin the framework version in the lockfile.
- Do not edit framework internals in place; extend with the documented extension points (decorators, hooks, modules, services).
- Keep framework config in the framework's config file, and secrets in environment variables.

## PHP Frameworks

### Symfony
- Symfony PHP app framework; PSR-12 and PSR-4 based, MIT licensed.
- One class per file; the file name matches the class in `UpperCamelCase`; namespace maps to the directory path.
- camelCase for variables, functions, and methods; `snake_case` for config parameters, route names, and Twig variables; `SCREAMING_SNAKE_CASE` for constants.
- Use Yoda conditions for comparisons (`'a' === $x`) to avoid accidental assignment inside conditions.
- Declare public methods first, then protected, then private; class properties before methods.
- Use `sprintf()` for exception and error messages; messages start with a capital letter and end with a period; no backticks in messages.
- `return null;` for null returns, bare `return;` for void; add a blank line before `return` unless it is the only statement in the block.
- Build with `php php-cs-fixer.phar fix -v`; the MIT license header goes at the top of every PHP file.

### Laravel
- Laravel PHP app framework; PSR-12 with the Pint ruleset as the baseline.
- Eloquent models in `app/Models`, controllers in `app/Http/Controllers`, migrations in `database/migrations`.
- Class and file names `UpperCamelCase`; method and variable names `camelCase`; database tables plural `snake_case`; columns `snake_case`.
- Config values read via `config('services.mail.host')`, never hard-coded; `.env` holds secrets and is gitignored.
- Format with `vendor/bin/pint`; run `php artisan test` and `phpstan analyse` if configured.

### Drupal (PHP side)
- Drupal is CMS-first but its PHP layer follows PSR-12 with 2-space indentation in core.
- Service classes in `src/`, one class per file, namespace matching the path.
- Configuration lives in YAML (`config/`), not in the database, for anything versionable.
- Use dependency injection through the service container; avoid static calls and global state.
- Write hooks in `*.module` files, plugins in `src/Plugin/`, and unit tests in `tests/src/`.

## Python Frameworks

### Django
- Django Python web framework; PEP 8 with `black` as the formatter.
- Format with `black`, sort imports with `isort`, lint with `flake8`; wire all three into `pre-commit`.
- 4-space indentation for Python, 2 spaces for HTML templates; code lines up to 88 characters, docs and comments wrapped at 79.
- `snake_case` for variables, functions, and methods; `InitialCaps` for classes.
- Model field names lowercase with underscores; `class Meta` comes after the fields with one blank line between.
- Imports grouped as: future, standard library, third-party, Django, local, then try/except; sorted alphabetically within each group.
- Templates: `{% extends %}` first, exactly one space inside `{{ }}` and `{% %}`, `{% load %}` libraries in alphabetical order.
- Views: the first parameter is always named `request`; use `assertRaisesMessage()` rather than `assertRaises()`.

## JavaScript Frameworks

### Vue
- Vue 3 progressive JavaScript framework; the official style guide has four priority levels.
- Priority A (non-negotiable): multi-word component names, detailed prop definitions with types, `key` on every `v-for`, never `v-if` on the same element as `v-for`, and component-scoped styles.
- Priority B: component files under `src/components/`, `PascalCase` for component file names, `camelCase` for props.
- Priority C: consistent formatting enforced by ESLint + Prettier rather than by hand.
- Use Composition API with `<script setup>` for new components; keep components small and single-purpose.
- Scope styles with the `scoped` attribute or CSS modules; prefer a class-based strategy (BEM) for component libraries.

### Angular
- Angular TypeScript framework; the style guide covers naming, project structure, and component design.
- File names use hyphens (`user-profile.ts`); unit tests use `user-profile.spec.ts` next to the source.
- All UI code lives under `src/`; the entry point is `src/main.ts`; configuration and scripts live outside `src/`.
- Organize by feature area (`src/movie-reel/show-times/film-details/`), never by code type (`components/`, `services/`).
- One concept per file; prefer `inject()` over constructor parameter injection.
- Mark Angular-initialized properties `readonly`; use `protected` for members only the template reads.
- Prefer `class` and `style` bindings over `ngClass`/`ngStyle`; name event handlers for the action, not the event.

## Cross-Framework Rules
- Keep the framework's build and dependency manifests at the repository root and commit the lockfile.
- Put third-party integrations behind the framework's own extension point so upgrades stay cheap.
- Write tests in the framework's expected location and naming so the default test runner finds them.
- Do not mix two frameworks' idioms in one module; pick the one the project already uses.

## Anti-Patterns
- Bypassing the framework's routing, ORM, or DI container to call the database or the service locator directly. Instead: use the documented abstraction.
- Mixing framework conventions with generic ones (for example, `snake_case` Vue props or `camelCase` Django model fields). Instead: follow the framework's rules.
- Editing files inside `vendor/`, `node_modules/`, or `site-packages/`. Instead: extend via the framework's extension mechanism.
- Putting secrets, API keys, or `.env` files in version control. Instead: read them from the environment.
- Hand-editing an auto-generated file (routes cache, compiled DI container, migrations that already ran). Instead: change the source and regenerate.
- Leaving business logic in a template or a component. Instead: move it into a service, model, or composable and test it there.
- Upgrading a major framework version as part of an unrelated feature. Instead: do it in a dedicated change with its own test pass.

## Sources
- https://symfony.com/doc/current/contributing/code/standards.html
- https://docs.djangoproject.com/en/dev/internals/contributing/writing-code/coding-style/
- https://vuejs.org/style-guide/
- https://angular.dev/style-guide
- https://www.php-fig.org/psr/psr-12/
- https://laravel.com/docs/11.x/pint
