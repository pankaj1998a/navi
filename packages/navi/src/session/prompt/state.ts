import { Instance } from "../../project/instance"
import { MessageV2 } from "../message-v2"

export interface PromptState {
    abort: AbortController
    callbacks: {
        resolve(input: MessageV2.WithParts): void
        reject(): void
    }[]
}

export const state = Instance.state(
    () => {
        const data: Record<string, PromptState> = {}
        return data
    },
    async (current) => {
        for (const item of Object.values(current)) {
            item.abort.abort()
            for (const callback of item.callbacks) {
                callback.reject()
            }
        }
    },
)
