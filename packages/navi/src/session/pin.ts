import { Storage } from "../storage/storage"

export namespace SessionPin {
    export async function list(sessionID: string): Promise<string[]> {
        return await Storage.read<string[]>(["session_pin", sessionID]).catch(() => []) ?? []
    }

    export async function add(sessionID: string, files: string[]) {
        const current = await list(sessionID)
        const next = [...new Set([...current, ...files])]
        await Storage.write(["session_pin", sessionID], next)
        return next
    }

    export async function remove(sessionID: string, files: string[]) {
        const current = await list(sessionID)
        const next = current.filter(f => !files.includes(f))
        await Storage.write(["session_pin", sessionID], next)
        return next
    }
}
