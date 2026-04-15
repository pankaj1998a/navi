import type { Argv } from "yargs"
import path from "path"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { Instance } from "../../project/instance"
import { KnowledgeManager } from "../../agent/knowledge"
import { MemoryFacts } from "../../agent/memory-facts"

export const KnowledgeCommand = cmd({
  command: "knowledge [directory]",
  describe: "inspect and refresh project knowledge",
  builder: (yargs: Argv) => {
    return yargs
      .positional("directory", {
        describe: "project directory to inspect (default: current working directory)",
        type: "string",
      })
      .option("json", {
        describe: "output machine-readable knowledge data",
        type: "boolean",
      })
      .option("refresh", {
        describe: "refresh the stored long-term project knowledge snapshot",
        type: "boolean",
      })
      .option("limit", {
        describe: "limit the number of project facts to include",
        type: "number",
        default: 6,
      })
  },
  handler: async (args) => {
    const directory = path.resolve(args.directory ?? process.cwd())

    await bootstrap(directory, async () => {
      const project = Instance.project
      const knowledge = await KnowledgeManager.detectKnowledge(Instance.worktree)
      const refreshResult = args.refresh
        ? await KnowledgeManager.syncProjectKnowledge({
            projectID: project.id,
            worktree: Instance.worktree,
            knowledge,
          })
        : undefined
      const storedKnowledge = await KnowledgeManager.recallProjectKnowledge(project.id, 3)
      const projectFacts = await MemoryFacts.recallProjectFacts(project.id, args.limit ?? 6)

      if (args.json) {
        console.log(
          JSON.stringify(
            {
              directory,
              project: {
                id: project.id,
                worktree: Instance.worktree,
                name: project.name,
                vcs: project.vcs,
              },
              knowledge,
              renderedKnowledge: KnowledgeManager.render(knowledge),
              storedKnowledge: storedKnowledge.map((entry) => ({
                id: entry.id,
                content: entry.content,
                createdAt: entry.createdAt,
                lastAccessed: entry.lastAccessed,
                importance: entry.importance,
                tags: entry.tags,
              })),
              projectFacts: projectFacts.map((entry) => ({
                id: entry.id,
                content: entry.content,
                confidence: entry.metadata?.confidence ?? entry.importance,
                source: entry.metadata?.source,
              })),
              refresh: refreshResult
                ? {
                    stored: refreshResult.stored,
                    removed: refreshResult.removed,
                  }
                : undefined,
            },
            null,
            2,
          ),
        )
        return
      }

      console.log(`Project: ${project.name ?? knowledge.projectName}`)
      console.log(`Directory: ${directory}`)
      console.log("")
      console.log(KnowledgeManager.render(knowledge))

      if (storedKnowledge.length > 0) {
        console.log("")
        console.log("## Stored Project Knowledge")
        console.log(storedKnowledge[0].content)
      }

      const renderedFacts = MemoryFacts.renderProjectFacts(projectFacts)
      if (renderedFacts) {
        console.log("")
        console.log(renderedFacts)
      }

      if (refreshResult) {
        console.log("")
        console.log(
          refreshResult.stored
            ? `Refreshed project knowledge (${refreshResult.removed} old entries removed)`
            : "Project knowledge already up to date",
        )
      }
    })
  },
})



