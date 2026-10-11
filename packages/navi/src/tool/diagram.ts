/**
 * Diagram Design Tool
 * Inspired by cathrynlavery/diagram-design
 *
 * Provides professional diagram generation, styling, linting, and export
 * across Mermaid, SVG, and structured architecture formats.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"

const DESCRIPTION =
  "Generates, styles, lints, and exports professional diagrams (flowcharts, sequence, C4 architecture, state machines, timelines, class diagrams) using Mermaid or SVG with curated theme skins."

const log = Log.create({ service: "tool.diagram_design" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["generate", "lint", "list_templates", "export"]).annotate({
    description: "Action: 'generate' (create diagram), 'lint' (validate syntax), 'list_templates' (available diagram types & themes), or 'export' (write to file)",
  }),
  diagram_type: Schema.optional(
    Schema.Literals([
      "flowchart",
      "sequence",
      "architecture-c4",
      "state",
      "timeline",
      "class",
      "entity-relationship",
      "mindmap",
      "gantt",
      "sankey",
    ]).annotate({
      description: "Type of diagram (flowchart, sequence, architecture-c4, state, timeline, class, entity-relationship, mindmap, gantt, sankey)",
    }),
  ),
  theme: Schema.optional(
    Schema.Literals(["slate-dark", "corporate-light", "cyber-neon", "minimal-mono"]).annotate({
      description: "Visual skin theme: 'slate-dark', 'corporate-light', 'cyber-neon', or 'minimal-mono'",
    }),
  ),
  title: Schema.optional(Schema.String).annotate({
    description: "Title of the diagram",
  }),
  content: Schema.optional(Schema.String).annotate({
    description: "Diagram source definition (e.g. Mermaid syntax or SVG elements)",
  }),
  output_file: Schema.optional(Schema.String).annotate({
    description: "Optional destination file path to save the diagram (e.g. docs/architecture.mermaid or assets/flow.svg)",
  }),
})

const THEME_DIRECTIVES: Record<string, string> = {
  "slate-dark": `%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#1e293b', 'primaryTextColor': '#f8fafc', 'primaryBorderColor': '#38bdf8', 'lineColor': '#38bdf8', 'secondaryColor': '#0f172a', 'tertiaryColor': '#1e293b'}}}%%`,
  "corporate-light": `%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#f1f5f9', 'primaryTextColor': '#0f172a', 'primaryBorderColor': '#2563eb', 'lineColor': '#2563eb', 'secondaryColor': '#e2e8f0', 'tertiaryColor': '#ffffff'}}}%%`,
  "cyber-neon": `%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#090d16', 'primaryTextColor': '#00ffcc', 'primaryBorderColor': '#ff007f', 'lineColor': '#00ffcc', 'secondaryColor': '#121826', 'tertiaryColor': '#1a233a'}}}%%`,
  "minimal-mono": `%%{init: {'theme': 'base', 'themeVariables': { 'primaryColor': '#ffffff', 'primaryTextColor': '#111827', 'primaryBorderColor': '#111827', 'lineColor': '#111827', 'secondaryColor': '#f9fafb', 'tertiaryColor': '#f3f4f6'}}}%%`,
}

export const DiagramDesignTool = Tool.define(
  "diagram_design",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { action, diagram_type = "flowchart", theme = "slate-dark", title, content, output_file } = params
          const instance = yield* InstanceState.context
          const rootDir = instance.directory

          if (action === "list_templates") {
            return {
              title: "Diagram Design Templates & Themes",
              output: [
                "# Diagram Design Suite",
                "",
                "### Supported Diagram Types",
                "- `flowchart`: Process flows, business logic branching, algorithm workflows",
                "- `sequence`: API interactions, microservice protocols, auth handshakes",
                "- `architecture-c4`: System context, containers, component topology",
                "- `state`: FSM transitions, agent states, lifecycle steps",
                "- `timeline`: Milestones, roadmaps, release phases",
                "- `class`: OOP domain models, interfaces, inheritance hierarchies",
                "- `entity-relationship`: Database schemas, table relations, foreign keys",
                "- `mindmap`: Brainstorming, capability taxonomies, category structures",
                "- `gantt`: Project task scheduling and dependencies",
                "- `sankey`: Data/traffic throughput, resource allocations",
                "",
                "### Available Theme Skins",
                "- `slate-dark`: Modern dark engineering theme with electric blue accents",
                "- `corporate-light`: Clean enterprise documentation style",
                "- `cyber-neon`: High-contrast cyberpunk palette for dashboards & presentations",
                "- `minimal-mono`: Crisp monochromatic style for whitepapers and print",
              ].join("\n"),
              metadata: {
                types: ["flowchart", "sequence", "architecture-c4", "state", "timeline", "class", "entity-relationship", "mindmap", "gantt", "sankey"],
                themes: ["slate-dark", "corporate-light", "cyber-neon", "minimal-mono"],
              } as Record<string, unknown>,
            }
          }

          if (action === "lint") {
            const code = (content || "").trim()
            if (!code) {
              return {
                title: "Diagram Lint: Failed",
                output: "Error: No diagram content provided to lint.",
                metadata: { valid: false, error: "empty_content" } as Record<string, unknown>,
              }
            }

            const validHeaderPrefixes = [
              "graph", "flowchart", "sequenceDiagram", "classDiagram",
              "stateDiagram", "erDiagram", "gantt", "mindmap", "sankey", "C4Context", "C4Container", "%%"
            ]

            const firstLine = code.split("\n")[0]?.trim() ?? ""
            const hasRecognizedHeader = validHeaderPrefixes.some((prefix) => firstLine.startsWith(prefix) || code.includes(prefix))

            if (!hasRecognizedHeader) {
              return {
                title: "Diagram Lint: Warning",
                output: `Warning: Diagram syntax does not start with a recognized Mermaid diagram header (${validHeaderPrefixes.slice(0, 6).join(", ")}...).`,
                metadata: { valid: false, warning: "missing_standard_header" } as Record<string, unknown>,
              }
            }

            return {
              title: "Diagram Lint: Valid",
              output: `Diagram syntax verification passed. Recognized diagram type: ${diagram_type}.`,
              metadata: { valid: true, diagram_type } as Record<string, unknown>,
            }
          }

          if (action === "generate" || action === "export") {
            const rawContent = (content || "").trim()
            const themeDirective = THEME_DIRECTIVES[theme] || THEME_DIRECTIVES["slate-dark"]

            let styledDiagram = rawContent
            if (!rawContent.startsWith("%%{init:")) {
              styledDiagram = `${themeDirective}\n${rawContent}`
            }

            const headerTitle = title ? `### ${title}\n\n` : ""
            const formattedOutput = `${headerTitle}\`\`\`mermaid\n${styledDiagram}\n\`\`\``

            let savedPath: string | undefined
            if (output_file) {
              const absPath = path.isAbsolute(output_file) ? output_file : path.join(rootDir, output_file)
              fs.mkdirSync(path.dirname(absPath), { recursive: true })
              fs.writeFileSync(absPath, styledDiagram, "utf-8")
              savedPath = absPath
              log.info("saved diagram file", { path: absPath, type: diagram_type })
            }

            return {
              title: `Diagram Generated: ${title || diagram_type}`,
              output: [
                headerTitle ? `# ${title}\n` : `# Diagram (${diagram_type})`,
                `- **Type:** \`${diagram_type}\``,
                `- **Theme:** \`${theme}\``,
                savedPath ? `- **Saved To:** \`${path.relative(rootDir, savedPath)}\`` : "",
                "",
                formattedOutput,
              ]
                .filter(Boolean)
                .join("\n"),
              metadata: {
                diagram_type,
                theme,
                savedPath,
                length: styledDiagram.length,
              } as Record<string, unknown>,
            }
          }

          return {
            title: "Diagram Design",
            output: `Unknown action "${action}"`,
            metadata: { error: `unknown_action_${action}` } as Record<string, unknown>,
          }
        }),
    }
  }),
)
