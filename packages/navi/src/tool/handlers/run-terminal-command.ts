import { exec } from 'child_process'
import { promisify } from 'util'
import { Instance } from '../../project/instance'

const execAsync = promisify(exec)

export interface RunTerminalCommandParams {
    command: string
    cwd?: string
}

export interface RunTerminalCommandResult {
    output: string
    exitCode: number
}

export async function handleRunTerminalCommand(params: RunTerminalCommandParams): Promise<RunTerminalCommandResult> {
    const cwd = params.cwd || Instance.directory

    try {
        const { stdout, stderr } = await execAsync(params.command, { cwd })
        const output = stdout + (stderr ? `\nError output:\n${stderr}` : '')
        return {
            output: output.trim(),
            exitCode: 0
        }
    } catch (error: any) {
        return {
            output: error.stdout + (error.stderr ? `\nError output:\n${error.stderr}` : '') + `\nExecution failed: ${error.message}`,
            exitCode: error.code || 1
        }
    }
}
