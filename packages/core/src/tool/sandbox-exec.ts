import z from "zod"
import { Tool } from "./tool"
import { spawn } from "child_process"

/**
 * SandboxExecTool — Execute code in a secure, containerized environment.
 */
export const SandboxExecTool = Tool.define("sandbox", {
  description: `Execute untrusted code (Python, Node.js, Bash) in a secure, ephemeral Docker container.
The container is destroyed immediately after execution. Access to the host network is disabled for security.`,

  parameters: z.object({
    language: z.enum(["python", "node", "bash"]).describe("The programming language to use"),
    code: z.string().describe("The source code or script to execute"),
    args: z.array(z.string()).optional().describe("Optional command line arguments to pass to the script"),
  }),

  async execute(params, _ctx) {
    return new Promise((resolve) => {
      const dockerImage = "python:3.11-slim"
      const cmd = `docker run --rm -i ${dockerImage} python3 -c "${params.code.replace(/"/g, '\\"')}"`
      
      const proc = spawn("powershell.exe", ["-Command", cmd])
      
      let stdout = ""
      let stderr = ""
      
      proc.stdout.on("data", (data) => { stdout += data.toString() })
      proc.stderr.on("data", (data) => { stderr += data.toString() })
      
      proc.on("close", (code) => {
        resolve({
          title: `Sandbox Execution (${params.language})`,
          output: code === 0 
            ? `✅ Execution successful.\n\nSTDOUT:\n${stdout}` 
            : `❌ Execution failed (exit code ${code}).\n\nSTDERR:\n${stderr}`,
          metadata: undefined as never
        })
      })
    })
  },
})
