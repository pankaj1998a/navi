import { cmd } from "./cmd"
import path from "path"
import { spawn } from "child_process"
import { UI } from "../ui"

export const RustCommand = cmd({
    command: "rust",
    describe: "run the experimental rust tui",
    builder: (yargs) => yargs,
    handler: async () => {
        const platform = process.platform === "win32" ? "windows" : process.platform
        const arch = process.arch
        const binaryName = process.platform === "win32" ? "navi-cli.exe" : "navi-cli"

        // In development, we might want to look in the target directory directly
        const devPath = path.resolve(__dirname, "../../../../../../navi-rs/target/release", binaryName)

        // In production/dist, it should be in the bin directory alongside the JS binary
        // The JS binary is at dist/navi-ai-agent-{os}-{arch}/bin/navi.exe
        // So we look in the same directory
        const distPath = path.resolve(path.dirname(process.execPath), binaryName)

        let binaryPath = distPath

        // Check if we are running from source (bun run src/index.ts) or installed binary
        if (process.argv[1].endsWith(".ts")) {
            // We are likely running from source
            binaryPath = devPath
        }

        if (!await Bun.file(binaryPath).exists()) {
            // Fallback to check if we are in the dist structure but maybe not same dir
            // Or just try the dev path if dist path failed
            if (await Bun.file(devPath).exists()) {
                binaryPath = devPath
            } else {
                UI.error(`Rust binary not found at ${binaryPath} or ${devPath}`)
                UI.error("Please run 'cargo build --release' in navi-rs directory")
                process.exit(1)
            }
        }

        // Pass arguments after "rust" to the binary
        const rustIndex = process.argv.indexOf("rust")
        const args = rustIndex !== -1 ? process.argv.slice(rustIndex + 1) : []

        UI.println(UI.Style.TEXT_INFO_BOLD + `Launching Rust TUI from: ${binaryPath}`)

        const child = spawn(binaryPath, args, {
            stdio: "inherit",
            env: process.env
        })

        child.on("exit", (code) => {
            process.exit(code ?? 0)
        })
    },
})



