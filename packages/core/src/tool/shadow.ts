import z from "zod"
import { Tool } from "./tool"
import { Instance } from "../project/instance"
import { Bus } from "../bus"
import path from "path"
import fs from "fs/promises"
import os from "os"

export const ShadowWorkspaceTool = Tool.define("shadow_workspace", {
    description: "Creates a temporary 'shadow' copy of the current workspace. This allows the agent to safely experiment, build, and run tests in a sandbox without modifying the user's active directory. Returns the path to the shadow directory.",
    parameters: z.object({
        directory: z.string().optional().describe("Optional specific subdirectory to shadow, defaults to the entire project"),
    }),
    async execute(params, ctx) {
        const sourceDir = params.directory
            ? path.resolve(Instance.directory, params.directory)
            : Instance.worktree || Instance.directory

        const tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), "navi-shadow-"))

        // Simple recursive copy
        await fs.cp(sourceDir, tmpdir, {
            recursive: true,
            filter: (src) => {
                // Ignore heavy folders
                const name = path.basename(src)
                return !["node_modules", ".git", "dist", "build", ".next", ".cache", "target"].includes(name)
            }
        })

        return {
            title: "Shadow Workspace Created",
            output: `Successfully cloned ${sourceDir} into a safe shadow sandbox at:\n\n${tmpdir}\n\nYou can now safely run builds, install modules, or modify files inside this folder without breaking the live codebase.`,
            metadata: {
                shadowPath: tmpdir,
                sourcePath: sourceDir,
            }
        }
    },
})


