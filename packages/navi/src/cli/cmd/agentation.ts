import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"

interface Annotation {
  id?: string
  element?: string
  comment?: string
  nearbyText?: string
  reactComponents?: string
  sourceLocation?: string
  page?: string
  url?: string
  resolved?: boolean
}

interface PendingResponse {
  count?: number
  annotations?: Annotation[]
}

export const AgentationCommand = effectCmd({
  command: "agentation <action> [id]",
  describe: "Inspect and manage live Agentation visual annotations (status, pending, resolve)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("action", {
        describe: "Action to perform: status | pending | resolve",
        type: "string",
      })
      .positional("id", {
        describe: "Annotation ID to resolve (for resolve action)",
        type: "string",
      })
      .option("port", {
        alias: "p",
        describe: "Agentation server port (default: 4747)",
        type: "number",
        default: 4747,
      })
      .option("url", {
        describe: "Agentation server URL (default: http://localhost:4747)",
        type: "string",
        default: "http://localhost:4747",
      }),
  handler: Effect.fn("Cli.agentation")(function* (args) {
    const action = args.action?.toLowerCase()
    const baseUrl = (args.url || `http://localhost:${args.port || 4747}`).replace(/\/$/, "")

    if (action === "status" || action === "health") {
      UI.println(UI.Style.TEXT_INFO_BOLD + `Checking Agentation server at ${baseUrl}...` + UI.Style.TEXT_NORMAL)
      yield* Effect.promise(async () => {
        try {
          const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) })
          if (res.ok) {
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Agentation server is ONLINE at ${baseUrl}` + UI.Style.TEXT_NORMAL)
          } else {
            UI.println(UI.Style.TEXT_WARNING_BOLD + `⚠ Agentation server responded with status: ${res.status}` + UI.Style.TEXT_NORMAL)
          }
        } catch {
          UI.println(
            UI.Style.TEXT_DANGER_BOLD +
              `❌ Agentation server is not reachable at ${baseUrl}` +
              UI.Style.TEXT_NORMAL,
          )
          UI.println(UI.Style.TEXT_DIM + `Tip: Start it with 'npx -y agentation-mcp server'` + UI.Style.TEXT_NORMAL)
        }
      })
      return
    }

    if (action === "pending" || action === "list") {
      yield* Effect.promise(async () => {
        try {
          const res = await fetch(`${baseUrl}/pending`, { signal: AbortSignal.timeout(3000) })
          if (!res.ok) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `❌ Failed to fetch pending annotations: HTTP ${res.status}` + UI.Style.TEXT_NORMAL)
            return
          }
          const data = (await res.json()) as PendingResponse
          const count = data.count ?? data.annotations?.length ?? 0

          if (count === 0) {
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ No pending UI annotations found.` + UI.Style.TEXT_NORMAL)
            return
          }

          UI.println(
            UI.Style.TEXT_INFO_BOLD +
              `\n=== AGENTATION FEEDBACK (${count} pending annotation${count === 1 ? "" : "s"}) ===\n` +
              UI.Style.TEXT_NORMAL,
          )

          const list = data.annotations || []
          list.forEach((item, index) => {
            UI.println(
              UI.Style.TEXT_SUCCESS_BOLD +
                `[${index + 1}] Element: ` +
                UI.Style.TEXT_NORMAL +
                `${item.element || "unknown"}` +
                (item.id ? UI.Style.TEXT_DIM + ` (id: ${item.id})` : ""),
            )
            if (item.comment) {
              UI.println(`    Comment:  ${item.comment}`)
            }
            if (item.reactComponents) {
              UI.println(`    React:    ${item.reactComponents}`)
            }
            if (item.sourceLocation) {
              UI.println(`    Source:   ${item.sourceLocation}`)
            }
            if (item.nearbyText) {
              const preview = item.nearbyText.length > 80 ? item.nearbyText.slice(0, 80) + "…" : item.nearbyText
              UI.println(`    Context:  ${preview}`)
            }
            if (item.url || item.page) {
              UI.println(`    Page:     ${item.url || item.page}`)
            }
            UI.println("")
          })
        } catch {
          UI.println(
            UI.Style.TEXT_DANGER_BOLD +
              `❌ Could not connect to Agentation server at ${baseUrl}` +
              UI.Style.TEXT_NORMAL,
          )
          UI.println(UI.Style.TEXT_DIM + `Start the server with 'npx -y agentation-mcp server'` + UI.Style.TEXT_NORMAL)
        }
      })
      return
    }

    if (action === "resolve") {
      const id = args.id
      if (!id) return yield* fail("Annotation ID is required: 'navi agentation resolve <id>'")

      yield* Effect.promise(async () => {
        try {
          const res = await fetch(`${baseUrl}/annotations/${id}/resolve`, {
            method: "POST",
            signal: AbortSignal.timeout(3000),
          })
          if (res.ok) {
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Marked annotation ${id} as resolved.` + UI.Style.TEXT_NORMAL)
            return
          }
          // Fallback to PATCH
          const patchRes = await fetch(`${baseUrl}/annotations/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolved: true }),
            signal: AbortSignal.timeout(3000),
          })
          if (patchRes.ok) {
            UI.println(UI.Style.TEXT_SUCCESS_BOLD + `✓ Marked annotation ${id} as resolved.` + UI.Style.TEXT_NORMAL)
          } else {
            UI.println(UI.Style.TEXT_DANGER_BOLD + `❌ Failed to resolve annotation: HTTP ${patchRes.status}` + UI.Style.TEXT_NORMAL)
          }
        } catch (err: any) {
          UI.println(UI.Style.TEXT_DANGER_BOLD + `❌ Error contacting Agentation server: ${err?.message || err}` + UI.Style.TEXT_NORMAL)
        }
      })
      return
    }

    if (action === "watch") {
      UI.println(UI.Style.TEXT_INFO_BOLD + `👀 Watching for Agentation feedback on ${baseUrl}... (Ctrl+C to stop)` + UI.Style.TEXT_NORMAL)
      yield* Effect.promise(async () => {
        const seen = new Set<string>()
        while (true) {
          try {
            const res = await fetch(`${baseUrl}/pending`, { signal: AbortSignal.timeout(2000) })
            if (res.ok) {
              const data = (await res.json()) as PendingResponse
              const items = data.annotations || []
              for (const item of items) {
                if (item.id && !seen.has(item.id)) {
                  seen.add(item.id)
                  UI.println(UI.Style.TEXT_SUCCESS_BOLD + `\n[NEW ANNOTATION] #${item.id}` + UI.Style.TEXT_NORMAL)
                  if (item.comment) UI.println(`  Feedback: ${item.comment}`)
                  if (item.element) UI.println(`  Element: ${item.element}`)
                  if (item.reactComponents) UI.println(`  Component: <${item.reactComponents}>`)
                  if (item.sourceLocation) UI.println(`  Source: ${item.sourceLocation}`)
                  if (item.url) UI.println(`  URL: ${item.url}`)
                }
              }
            }
          } catch {
            // Ignore connection errors during watch loop
          }
          await new Promise((r) => setTimeout(r, 2000))
        }
      })
      return
    }

    return yield* fail(`Unknown action '${action}'. Available actions: status, pending, resolve, watch`)
  }),
})
