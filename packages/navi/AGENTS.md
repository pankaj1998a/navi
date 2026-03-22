# navi agent guidelines

## Build/Test Commands

- **Install**: `bun install`
- **Run**: `bun run --conditions=browser ./src/index.ts`
- **Typecheck**: `bun run typecheck` (npm run typecheck)
- **Test**: `bun test` (runs all tests)
- **Single test**: `bun test test/tool/tool.test.ts` (specific test file)

## Code Style

- **Runtime**: Bun with TypeScript ESM modules
- **Imports**: Use relative imports for local modules, named imports preferred
- **Types**: Zod schemas for validation, TypeScript interfaces for structure
- **Naming**: camelCase for variables/functions, PascalCase for classes/namespaces
- **Error handling**: Use Result patterns, avoid throwing exceptions in tools
- **File structure**: Namespace-based organization (e.g., `Tool.define()`, `Session.create()`)

## Architecture

- **Tools**: Implement `Tool.Info` interface with `execute()` method
- **Context**: Pass `sessionID` in tool context, use `App.provide()` for DI
- **Validation**: All inputs validated with Zod schemas
- **Logging**: Use `Log.create({ service: "name" })` pattern
- **Storage**: Use `Storage` namespace for persistence
- **API Client**: The TypeScript TUI (built with SolidJS + OpenTUI) communicates with the Navi server using `@navi-ai/sdk`. When adding/modifying server endpoints in `packages/navi/src/server/server.ts`, run `./script/generate.ts` to regenerate the SDK and related files.

## Ralph Efficiency (The Loop)

Navigate complex tasks using the **Ralph Loop** methodology:
1. **Delegation**: Use the `swarm` tool to run sub-agents in parallel (e.g., `frontend`, `backend`, `tester`).
2. **Verification**: Always verify code changes with `bash` (tests/build) before reporting success.
3. **Persistence**: Save project-level state (PRDs, Tasks) to `.specs/` or `prd.json`.
4. **Learning**: Discover patterns and record them in this `AGENTS.md` file or its project-local equivalent.
5. **Iteration**: Loop until the task is demonstrably complete and verified. Never assume; always prove.
