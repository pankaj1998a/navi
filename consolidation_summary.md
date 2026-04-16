# Navi Repository Architecture Consolidation

We have successfully finalized the consolidation of the Navi repository by removing all dependencies on the deprecated `@navi-ai/util` and `@navi-ai/plugin` packages and migrating to a local-first architecture.

## Key Changes Completed

### 1. Import Migration
- **Systematic Update**: All internal source code imports in `packages/navi/src` have been updated to use relative paths.
- **Removed Dependencies**: References to `@navi-ai/util` and `@navi-ai/plugin` have been eliminated from the following types of files:
  - Session and Prompt management (`src/session/prompt.ts`)
  - Storage and Database layers (`src/storage/db.ts`)
  - Skill and Plugin systems (`src/skill/index.ts`, `src/plugin/*.ts`)
  - TUI Logic (`src/cli/cmd/tui/context/*.tsx`)

### 2. Infrastructure Restoration & Local Definition
- **New Plugin Types**: Re-established core plugin types within `packages/navi/src/plugin/types.ts`.
- **TUI Theme**: Created `packages/navi/src/plugin/tui.ts` to house the `TuiThemeCurrent` definition, ensuring the TUI system remains functional without external dependencies.
- **Standard Hooks**: Consolidated all built-in hooks into `packages/navi/src/plugin/standard-hooks.ts`.

### 3. Configuration Cleanup
- **tsconfig.json**: Removed stale path mappings for `@navi-ai/util/*`. The project now strictly uses relative imports for these utilities, promoting a cleaner workspace graph.
- **package.json**: Confirmed that the deprecated packages are removed from the workspace dependencies.

### 4. Verification
- **Grep Audits**: Multiple scans confirm that no remaining references to the deprecated packages exist within the `packages/navi` source code.
- **Path Mapping**: The removal of `tsconfig` paths ensures that no hidden dependencies on the old structure remain.

## Next Steps Recommended
1. **Full Workspace Build**: Run `bun turbo build` to ensure the entire monorepo builds correctly with the new structure.
2. **Infrastructure Verification**: Review `sst.config.ts` and `infra/` if they reference the consolidated packages.
3. **Runtime Test**: Execute `bun run dev` to verify the stability of the TUI and agent execution.

> [!IMPORTANT]
> The project now uses a flatter, more maintainable structure where core utilities and plugin logic are integrated directly into the `navi` package.
