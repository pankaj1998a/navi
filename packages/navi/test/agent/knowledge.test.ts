import { expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { KnowledgeManager } from "../../src/agent/knowledge"

test("knowledge renderer formats a compact project profile", () => {
  const rendered = KnowledgeManager.render({
    projectName: "Navi",
    projectType: "Terminal AI assistant monorepo",
    technologies: ["Bun", "TypeScript", "Zod"],
    architecture: {
      pattern: "Monorepo / service split",
      components: ["packages/navi: terminal CLI and runtime"],
    },
    conventions: {
      naming: "TypeScript ESM",
      formatting: "Prettier semicolons disabled",
      testing: "bun:test",
    },
    security: ["Permission-gated shell, filesystem, and external-directory access"],
    api: {
      endpoints: ["CLI command surface", "HTTP and RPC server"],
    },
    linkedRepos: [],
  })

  expect(rendered).toContain("## Project Knowledge")
  expect(rendered).toContain("Project Name: Navi")
  expect(rendered).toContain("Technologies: Bun, TypeScript, Zod")
  expect(rendered).toContain("APIs: CLI command surface, HTTP and RPC server")
})

test("knowledge detector recognizes cli projects without Navi-specific assumptions", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "navi-knowledge-"))

  try {
    await fs.writeFile(
      path.join(directory, "package.json"),
      JSON.stringify(
        {
          name: "demo-cli",
          packageManager: "bun@1.3.9",
          type: "module",
          bin: "src/index.ts",
          scripts: {
            test: "bun test",
          },
          dependencies: {
            typescript: "^5.0.0",
            yargs: "^17.0.0",
            zod: "^3.0.0",
          },
        },
        null,
        2,
      ),
    )
    await fs.writeFile(path.join(directory, "README.md"), "# Demo CLI\n")

    const knowledge = await KnowledgeManager.detectKnowledge(directory)

    expect(knowledge.projectName).toBe("demo-cli")
    expect(knowledge.projectType).toBe("CLI application")
    expect(knowledge.technologies).toContain("Bun")
    expect(knowledge.technologies).toContain("TypeScript")
    expect(knowledge.technologies).toContain("Yargs")
    expect(knowledge.security?.some((item) => item.includes("Shell commands should be gated"))).toBe(true)
    expect(knowledge.security?.some((item) => item.includes("Permission-gated shell"))).toBe(false)
  } finally {
    await fs.rm(directory, { recursive: true, force: true })
  }
})
