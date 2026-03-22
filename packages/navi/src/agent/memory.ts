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
