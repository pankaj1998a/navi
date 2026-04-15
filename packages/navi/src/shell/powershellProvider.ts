import { spawn, type ChildProcess } from "child_process"
import { Log } from "../util/log"

const log = Log.create({ service: "powershell-provider" })

/**
 * PowerShellProvider implements native PowerShell execution for Windows.
 * It handles the specific escaping and error formatting needed for PS.
 */
export class PowerShellProvider {
    /**
     * Executes a command in a fresh PowerShell process.
     */
    static spawn(command: string, options: { cwd: string }): ChildProcess {
        log.info("Spawning PowerShell process", { command })
        
        // Use -NoProfile for faster startup and -Command for execution
        // We use pwsh if available, otherwise fallback to powershell.exe
        const shell = Bun.which("pwsh") || "powershell.exe"
        
        return spawn(shell, ["-NoProfile", "-NonInteractive", "-Command", command], {
            cwd: options.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            shell: false // We are spawning the shell directly
        })
    }

    /**
     * Formats error output to be more readable for the agent.
     * PS error records can be very verbose; this strips them to the essentials.
     */
    static formatError(rawError: string): string {
        if (!rawError) return ""
        
        // Strip the common 'CategoryInfo', 'FullyQualifiedErrorId' etc. if present
        // to save context tokens while keeping the actual message.
        return rawError
            .split('\n')
            .filter(line => !line.trim().startsWith('+')) // Remove PS position markers
            .filter(line => !line.includes('CategoryInfo'))
            .filter(line => !line.includes('FullyQualifiedErrorId'))
            .join('\n')
            .trim()
    }
}


