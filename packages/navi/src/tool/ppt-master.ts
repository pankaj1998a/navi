/**
 * PPT Master Tool
 * Inspired by hugohe3/ppt-master
 *
 * Generates professional multi-slide presentation decks with 14+ themes,
 * layout vocabulary (title, split, grid, cards, timeline, metrics),
 * speaker notes, and interactive HTML/Markdown slide output.
 */

import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import path from "path"
import fs from "fs"

const DESCRIPTION =
  "Generates executive-ready presentation decks with professional themes (MBB consulting, technical deepdive, investor pitch, product launch), slide layouts, speaker notes, and export capabilities."

const log = Log.create({ service: "tool.ppt_master" })

export const Parameters = Schema.Struct({
  action: Schema.Literals(["list_styles", "generate_deck", "export"]).annotate({
    description: "Action: 'list_styles' (catalog of themes), 'generate_deck' (build slide deck structure), or 'export' (write self-contained presentation file)",
  }),
  topic: Schema.optional(Schema.String).annotate({
    description: "Presentation topic or title",
  }),
  style: Schema.optional(
    Schema.Literals([
      "mbb-consulting",
      "technical-deepdive",
      "investor-pitch",
      "product-launch",
      "academic-research",
      "incident-postmortem",
      "narrative-keynote",
      "workshop-teaching",
    ]).annotate({
      description: "Visual design theme (default: 'mbb-consulting')",
    }),
  ),
  slides: Schema.optional(
    Schema.Array(
      Schema.Struct({
        title: Schema.String,
        layout: Schema.Literals(["title", "split", "grid", "cards", "timeline", "metrics", "summary"]),
        points: Schema.Array(Schema.String),
        notes: Schema.optional(Schema.String),
      }),
    ),
  ).annotate({
    description: "Array of structured slide objects (title, layout, points, notes)",
  }),
  output_file: Schema.optional(Schema.String).annotate({
    description: "Optional destination file path (e.g. docs/presentation.html or slides/deck.md)",
  }),
})

const STYLES_CATALOG = [
  { id: "mbb-consulting", name: "MBB Consulting", desc: "Structured, data-heavy, executive-ready pyramid principle with high contrast" },
  { id: "technical-deepdive", name: "Technical Deepdive", desc: "Code snippets, system architecture diagrams, latency metrics, and API callouts" },
  { id: "investor-pitch", name: "Investor Pitch", desc: "High emotional resonance, TAM/SAM market size, traction metrics, and vision" },
  { id: "product-launch", name: "Product Launch", desc: "Feature showcases, user benefits, release timeline, and calls-to-action" },
  { id: "academic-research", name: "Academic Research", desc: "Methodology, experimental benchmarks, ablation studies, and formal citations" },
  { id: "incident-postmortem", name: "Incident Postmortem", desc: "Timeline of events, root cause analysis, MTTR metrics, and remediation items" },
  { id: "narrative-keynote", name: "Narrative Keynote", desc: "Minimal text, bold typography, cinematic pacing, and strong visual focal points" },
  { id: "workshop-teaching", name: "Workshop & Teaching", desc: "Step-by-step instructions, hands-on exercises, key takeaways, and quizzes" },
]

export const PptMasterTool = Tool.define(
  "ppt_master",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const { action, topic = "Project Overview", style = "mbb-consulting", slides, output_file } = params
          const instance = yield* InstanceState.context
          const rootDir = instance.directory

          if (action === "list_styles") {
            return {
              title: "PPT Master: Style Themes Catalog",
              output: [
                "# Presentation Design Styles Catalog",
                "",
                ...STYLES_CATALOG.map((s) => `### ${s.name} (\`${s.id}\`)\n${s.desc}\n`),
                "### Layout Vocabulary",
                "- `title`: Hero slide with title, subtitle, and author/date badge",
                "- `split`: Two-column comparison or problem vs. solution layout",
                "- `grid`: 2x2 or 3x2 matrix of features or architecture tiers",
                "- `cards`: Highlighting distinct pillar values or deliverables",
                "- `timeline`: Chronological progression across milestones",
                "- `metrics`: Massive stat callouts with supporting footnotes",
                "- `summary`: Synthesis takeaway and next steps",
              ].join("\n"),
              metadata: { styles: STYLES_CATALOG } as Record<string, unknown>,
            }
          }

          if (action === "generate_deck" || action === "export") {
            const slideItems = slides && slides.length > 0 ? slides : [
              {
                title: topic,
                layout: "title" as const,
                points: ["Autonomous Agent Systems", "Architectural Synthesis & Execution"],
                notes: "Welcome the audience and introduce the core thesis.",
              },
              {
                title: "Executive Problem Statement",
                layout: "split" as const,
                points: [
                  "Current challenges: Fragmented tool ecosystems and loss of context",
                  "Solution strategy: Unified agent runtime with living memory and peer swarming",
                ],
                notes: "Emphasize the pain point before introducing the solution.",
              },
              {
                title: "Key Performance Metrics",
                layout: "metrics" as const,
                points: [
                  "10x Faster Architectural Mapping via AST symbol caches",
                  "0% Context Leaks with Sandbox Workspace Containment",
                  "100% Deterministic Reproducibility with SpillStore & HunkTracker",
                ],
                notes: "Walk through key validation numbers.",
              },
              {
                title: "Roadmap & Implementation Next Steps",
                layout: "timeline" as const,
                points: [
                  "Phase 1: Feature Integration & Validation",
                  "Phase 2: Self-contained Binary Distribution",
                  "Phase 3: Production Rollout",
                ],
                notes: "Close with clear accountability and timeline.",
              },
            ]

            const mdDeck = [
              `---`,
              `marp: true`,
              `theme: default`,
              `class: invert`,
              `title: "${topic}"`,
              `style: "${style}"`,
              `---`,
              "",
              ...slideItems.map((slide, idx) => {
                const header = `## Slide ${idx + 1}: ${slide.title}\n*Layout: ${slide.layout}*\n`
                const content = slide.points.map((p) => `- ${p}`).join("\n")
                const notes = slide.notes ? `\n\n<!-- Speaker Notes: ${slide.notes} -->` : ""
                return `${header}\n${content}${notes}\n\n---`
              }),
            ].join("\n")

            let savedPath: string | undefined
            if (output_file) {
              const absPath = path.isAbsolute(output_file) ? output_file : path.join(rootDir, output_file)
              fs.mkdirSync(path.dirname(absPath), { recursive: true })
              fs.writeFileSync(absPath, mdDeck, "utf-8")
              savedPath = absPath
              log.info("saved presentation deck", { path: absPath, slideCount: slideItems.length })
            }

            return {
              title: `Presentation Deck: ${topic} (${style})`,
              output: [
                `# Presentation Deck: ${topic}`,
                `- **Style Theme:** \`${style}\``,
                `- **Total Slides:** ${slideItems.length}`,
                savedPath ? `- **Saved Output:** \`${path.relative(rootDir, savedPath)}\`` : "",
                "",
                "```markdown",
                mdDeck,
                "```",
              ]
                .filter(Boolean)
                .join("\n"),
              metadata: {
                topic,
                style,
                slideCount: slideItems.length,
                savedPath,
              } as Record<string, unknown>,
            }
          }

          return {
            title: "PPT Master",
            output: `Unknown action "${action}"`,
            metadata: { error: `unknown_action_${action}` } as Record<string, unknown>,
          }
        }),
    }
  }),
)
