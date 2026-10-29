# Angular Style Guide

> Source: Official Angular Style Guide (https://angular.dev/style-guide)

## Quick Rules

- Single responsibility principle: Define one component, service, directive, or pipe per file.
- Keep files small, focused, and under 400 lines of code.
- Naming convention: Follow feature-based naming with consistent type suffixes: `[feature].[type].ts` (e.g. `hero-list.component.ts`, `auth.service.ts`, `highlight.directive.ts`, `truncate.pipe.ts`).
- Component selectors: Use `kebab-case` with a custom project prefix (e.g. `app-user-profile`, `nav-header`). Never use `ng-` as a prefix.
- Directive selectors: Use `lowerCamelCase` with a custom project prefix (e.g. `[appHighlight]`).
- Prefer standalone components (`standalone: true` or default in Angular v17+) and inject-based dependency injection (`inject(AuthService)`) over constructor parameter injection.
- Prefer Signals (`signal()`, `computed()`, `input()`, `output()`) for reactive state over raw RxJS subjects where appropriate.
- Delegate complex business logic to services; keep components lean and focused on UI presentation and user events.
- Put shared utilities, pipes, and models into dedicated `shared/` or `core/` directories.

## Formatting & Structure

- 2 spaces indentation, no tabs.
- Place member declarations in consistent order:
  1. Input / Output properties (`input()`, `output()`, `@Input()`, `@Output()`)
  2. Public properties & signals
  3. Private properties
  4. Constructor / dependency injections
  5. Lifecycle hooks (`ngOnInit`, `ngOnDestroy`)
  6. Public methods
  7. Private methods
- Separate HTML templates and styles into external files (`.html`, `.css`/`.scss`) when they exceed 3 lines.

## Naming

- Components: Class `HeroListComponent`, file `hero-list.component.ts`, selector `app-hero-list`.
- Services: Class `HeroService`, file `hero.service.ts`.
- Directives: Class `HighlightDirective`, file `highlight.directive.ts`, selector `[appHighlight]`.
- Pipes: Class `TruncatePipe`, file `truncate.pipe.ts`, name `truncate`.
- Interfaces / Types: `User`, `HeroState` in `user.model.ts` (no `I` prefix like `IUser`).

## Anti-Patterns

- Logic inside templates: calling methods in template interpolation `{{ getFilteredList() }}`. Instead: use `computed()` signals or pipes.
- Subscribing inside services without unsubscription management. Instead: use `takeUntilDestroyed()` or `async` pipe.
- Mutating input properties directly. Inputs are read-only.
- Using `any` type for API payloads or component state.

## Code Example

```typescript
import { Component, ChangeDetectionStrategy, input, output, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { User } from './user.model';

@Component({
  selector: 'app-user-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './user-card.component.html',
  styleUrls: ['./user-card.component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserCardComponent {
  readonly user = input.required<User>();
  readonly selectUser = output<User>();

  readonly displayName = computed(() => {
    const u = this.user();
    return `${u.firstName} ${u.lastName}`;
  });

  handleClick(): void {
    this.selectUser.emit(this.user());
  }
}
```

## Sources
- https://angular.dev/style-guide
