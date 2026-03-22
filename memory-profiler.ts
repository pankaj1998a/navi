import { exec } from "child_process"
import fs from "fs"
import path from "path"

async function main() {
    const profileDir = path.join(process.cwd(), "memory-profiles")
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir)
    }

    // Run the TUI for a short duration and generate a heap snapshot
    console.log("Generating initial heap snapshot...")

    // Create a temporary script to run the TUI briefly
    const tempScript = path.join(process.cwd(), "temp-tui-runner.js")
    fs.writeFileSync(
        tempScript,
        `
import { tui } from "./packages/navi/src/cli/cmd/tui/app"

async function runTui() {
  try {
    console.log("Starting TUI...")
    const tuiPromise = tui({
      url: "http://localhost:3000",
      args: {
        themeMode: "dark"
      },
      directory: process.cwd(),
      onExit: () => {
        console.log("TUI exiting...")
      }
    })

    // Let the TUI run for 5 seconds
    await new Promise(resolve => setTimeout(resolve, 5000))

    // Take heap snapshot
    const heapSnapshot = await Bun.write("${path.join(profileDir, "tui-heap-snapshot.heapsnapshot")}", Bun.gc(true))

    console.log("Heap snapshot generated:", heapSnapshot)

    // Wait for TUI to exit properly
    await tuiPromise
  } catch (error) {
    console.error("Error running TUI:", error)
  }
}

runTui().catch(console.error)
`,
        "utf8"
    )

    // Run the temporary script with Bun's debug options
    try {
        const result = await new Promise((resolve, reject) => {
            exec(`cd "${process.cwd()}" && bun run --inspect-wait "${tempScript}"`, (error, stdout, stderr) => {
                if (error) {
                    reject(error)
                } else {
                    resolve({ stdout, stderr })
                }
            })
        })
        console.log("TUI execution result:", result)
    } catch (error) {
        console.error("Error executing TUI:", error)
    } finally {
        // Clean up the temporary script
        fs.unlinkSync(tempScript)
        console.log("Temporary script removed")
    }

    // Check if snapshot was generated
    const snapshotPath = path.join(profileDir, "tui-heap-snapshot.heapsnapshot")
    if (fs.existsSync(snapshotPath)) {
        const stats = fs.statSync(snapshotPath)
        console.log(`Heap snapshot generated successfully: ${stats.size} bytes`)
        console.log("View the snapshot in Chrome DevTools > Memory > Load")
    } else {
        console.error("Heap snapshot not generated")
    }
}

main().catch(console.error)
