import { AgentTemplate } from "../programmatic"

/**
 * CodebaseIndexer Agent
 * Phase: Analyze
 * Responsibility: Crawls the repository and produces a compressed "Phone Directory"
 * index — a token-efficient structured map that lets other agents locate logic
 * without reading source files. Runs as a background sub-agent using a cheaper model.
 *
 * Output: A markdown index grouped by directory with per-file entries containing:
 *   - Responsibility (one active-voice sentence)
 *   - Exports (names only, max 10)
 *   - Depends on (internal relative paths + external packages)
 *
 * Token budget: ≤ 40 tokens per file entry.
 */

const INDEXER_SYSTEM_PROMPT = `You are a Technical Architect and Codebase Indexer.

OBJECTIVE
Produce a "Phone Directory" map of the codebase. Output is consumed by other
AI agents that need to locate logic without reading source files.
Maximise information density, minimise tokens.

SCOPE
Index the entire repository tree from the current working directory.
Always exclude: node_modules/, dist/, .git/, build/, .next/, __pycache__/,
*.log, *.lock, lockfiles, and assets (images/fonts/icons/videos).

DEPTH
Index at file level. Do not descend into function bodies.

OUTPUT FORMAT
Group entries by directory. Each directory block:

## <relative/dir/path> — <one-phrase summary> (<N> files)

\`<file_path>\`
· Responsibility: <one active-voice sentence>
· Exports: <name1>, <name2>, ... (names only, max 10)
· Depends on: <internal rel paths> + <external packages>

STRICT CONSTRAINTS
1. No implementation. Replace all logic with (...).
2. Token budget: ≤ 40 tokens per file entry (60+ = violation).
3. Use abbreviations freely: Auth, DB, cfg, svc, req/res, etc.
4. Relative paths for internal deps; no version numbers on packages.
5. Barrel index files: write Exports: (barrel — see sub-modules).
6. No prose between entries. No preamble. No trailing summary.
7. Config/asset-only dirs: one line — \`<dir>/\` → config/assets only, skipped.
8. Add a directory-level one-liner before each ## block.

Begin indexing now.`

const INDEXER_DEEP_PROMPT = `You are a Technical Architect and Codebase Indexer.

OBJECTIVE
Produce a function-level index. Each file entry lists public functions/methods
with one-line purpose only — no signatures, no bodies.

OUTPUT FORMAT
## <dir/> — <summary> (<N> files)

\`<file_path>\`
· Responsibility: <one sentence>
· Functions:
  - <fnName>: <one-line purpose>
  - <fnName>: <one-line purpose>
· Depends on: <paths + packages>

CONSTRAINTS
1. Public/exported functions only. Skip private/internal helpers.
2. Max 8 functions per file. If more exist, list top 8 by call frequency.
3. No signatures. No return types. No parameters. Names + purpose only.
4. ≤ 60 tokens per file entry.
5. No implementation. No code. (...) for anything inline.`

const INDEXER_API_PROMPT = `You are a Technical Architect and API Surface Indexer.

OBJECTIVE
Index only the public API layer: route definitions, controllers, middleware,
and request/response schemas. Skip internal services, utilities, and config.

OUTPUT FORMAT
## <dir/> — <summary>

\`<file_path>\`
· Responsibility: <one sentence>
· Routes/Endpoints: METHOD /path, METHOD /path (names only)
· Middleware: <names>
· Schemas: <request/response type names>
· Depends on: <paths + packages>

CONSTRAINTS
1. Skip any file that does not define routes, handlers, or middleware.
2. For route files, list HTTP method + path pattern. No handler logic.
3. ≤ 50 tokens per file.`

export const CodebaseIndexer: AgentTemplate = {
    id: "codebase-indexer",
    name: "CodebaseIndexer",
    description:
        "Background sub-agent that crawls the repo and produces a compressed Phone Directory index for token-efficient codebase navigation by other agents",
    // No model hardcoded — users can override via Settings > agentModels["codebase-indexer"].
    // Recommended: use a cheap/fast model (e.g. claude-haiku, gemini-flash, gpt-4o-mini)
    // since this is a background indexing task that doesn't need frontier-level reasoning.
    tools: ["read", "grep", "ls"],
    phase: "analyze",
    skills: ["codebase-indexing", "file-analysis", "dependency-mapping"],
    systemPrompt: INDEXER_SYSTEM_PROMPT,
    handleSteps: async function* (context) {
        // Step 1: Discover project structure
        yield {
            type: "step",
            name: "Tree Discovery",
            description: "Scanning repository tree and identifying indexable files",
        }
        yield {
            type: "tool",
            name: "ls",
            input: { path: ".", recursive: true },
        }

        // Step 2: Classify and filter
        yield {
            type: "step",
            name: "File Classification",
            description: "Filtering out assets, configs, lockfiles, and non-source directories",
        }
        yield {
            type: "log",
            message: "Excluding: node_modules/, dist/, .git/, build/, .next/, __pycache__/, *.log, *.lock, assets",
        }

        // Step 3: Determine indexing depth from context
        const depth = context.input.includes("function")
            ? "function"
            : context.input.includes("api")
              ? "api"
              : "file"

        yield {
            type: "log",
            message: `Indexing depth: ${depth}-level`,
        }

        // Step 4: Read key files for export/dependency analysis
        yield {
            type: "step",
            name: "Export Analysis",
            description: "Reading source files to extract exports, responsibilities, and dependencies",
        }

        // Step 5: Generate the index
        yield {
            type: "step",
            name: "Index Generation",
            description: "Assembling Phone Directory index with ≤40 tokens per file entry",
        }
        yield {
            type: "log",
            message:
                "Applying token budget: ≤40 tokens/file (file-level), ≤60 tokens/file (function-level), ≤50 tokens/file (api-level)",
        }

        // Step 6: Write to .map/<depth>.md inside the project root.
        // .map/ sits at the repo root alongside .git/ — easy to gitignore, always co-located
        // with the codebase it describes. Multiple depth maps coexist without overwriting.
        const outputPath = `.map/codebase-index-${depth}.md`
        yield {
            type: "step",
            name: "Write Index",
            description: `Saving Phone Directory map to ${outputPath}`,
        }
        yield {
            type: "log",
            message: `Output path: ${outputPath} (add .map/ to .gitignore if not already present)`,
        }
        yield {
            type: "tool",
            name: "write",
            input: {
                path: outputPath,
                content: [
                    `<!-- Codebase Phone Directory — depth: ${depth} -->`,
                    `<!-- Generated by CodebaseIndexer. Do not edit manually. -->`,
                    `<!-- Re-run: /agent codebase-indexer -->`,
                    "",
                    "<!-- Index content will be populated by the LLM during execution -->",
                ].join("\n"),
            },
        }

        yield {
            type: "finish",
            result: `Codebase Phone Directory index saved to ${outputPath}. Other agents can now reference this file for token-efficient codebase navigation.`,
        }
    },
}

/**
 * Prompt variants exported for direct use by other agents or tools
 */
export const IndexerPrompts = {
    file: INDEXER_SYSTEM_PROMPT,
    function: INDEXER_DEEP_PROMPT,
    api: INDEXER_API_PROMPT,
} as const
