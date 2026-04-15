import { Storage } from "../storage/storage"

export namespace SharedMemory {
    export async function get(key: string, namespace: string = "global"): Promise<any> {
        return await Storage.read<any>(["memory", namespace, key]).catch(() => undefined)
    }

    export async function set(key: string, value: any, namespace: string = "global") {
        await Storage.write(["memory", namespace, key], value)
    }

    export async function list(namespace: string = "global") {
        const keys = await Storage.list(["memory", namespace])
        return keys.map(k => k[k.length - 1])
    }

    export async function remove(key: string, namespace: string = "global") {
        await Storage.remove(["memory", namespace, key])
    }

    export async function clear(namespace: string = "global") {
        const keys = await Storage.list(["memory", namespace])
        for (const key of keys) {
            await Storage.remove(key)
        }
    }
}

export namespace RoleMemory {
    /**
     * Get memory scoped to a specific agent role (e.g. "architect", "reviewer")
     */
    export async function get(role: string, key: string): Promise<any> {
        return SharedMemory.get(key, `role_memory_${role}`)
    }

    /**
     * Set memory scoped to an agent role
     */
    export async function set(role: string, key: string, value: any): Promise<void> {
        return SharedMemory.set(key, value, `role_memory_${role}`)
    }

    /**
     * Format the agent's role-specific context to inject into their system prompt
     */
    export async function formatPromptContext(role: string): Promise<string> {
        const data = await SharedMemory.list(`role_memory_${role}`)
        if (data.length === 0) return ""
        
        let output = "\\n\\n# Role-Specific Context:\\n"
        for (const key of data) {
            const val = await get(role, key)
            output += `- **${key}**: ${JSON.stringify(val)}\\n`
        }
        return output
    }
}


