import type { Plugin, Hooks } from "./types"
import { 
    createCommentCheckerHook, 
    createContextWindowMonitorHook, 
    createKeywordDetectorHook, 
    createRalphLoopHook, 
    createSessionRecoveryHook, 
    createTodoContinuationEnforcerHook,
    createThinkModeHook,
    createRulesInjectorHook,
    createDirectoryAgentsInjectorHook,
    createPreemptiveCompactionHook
} from "../hooks"

/**
 * Standard Hooks Plugin
 * Integrates all built-in automation hooks into the Navi plugin system.
 */
export const StandardHooksPlugin: Plugin = async (_input, _options) => {
    // Collect all instantiated hooks
    const hooks: Hooks[] = [
        createCommentCheckerHook() as Hooks,
        createContextWindowMonitorHook() as Hooks,
        createKeywordDetectorHook(),
        createRalphLoopHook({ directory: _input.directory }) as Hooks,
        createSessionRecoveryHook() as Hooks,
        { event: createTodoContinuationEnforcerHook().event } as Hooks,
        createThinkModeHook(),
        createRulesInjectorHook({}),
        createDirectoryAgentsInjectorHook({}),
        createPreemptiveCompactionHook({})
    ]

    // Composed hooks object that proxies all events to each standard hook
    const result: Hooks = {
        "tool.execute.before": async (i, o) => {
            for (const h of hooks) await h["tool.execute.before"]?.(i, o)
        },
        "tool.execute.after": async (i, o) => {
            for (const h of hooks) {
                const fn = h["tool.execute.after"]
                if (fn) await fn(i, o as any)
            }
        },
        "tool.execute.error": async (i, o) => {
            for (const h of hooks) {
                const fn = h["tool.execute.error"]
                if (fn) await fn(i, o)
            }
        },
        "chat.message": async (i, o) => {
            for (const h of hooks) await h["chat.message"]?.(i, o as any)
        },
        "chat.params": async (i, o) => {
            for (const h of hooks) await h["chat.params"]?.(i, o)
        },
        "experimental.chat.system.transform": async (i, o) => {
            for (const h of hooks) await h["experimental.chat.system.transform"]?.(i, o)
        },
        "experimental.text.complete": async (i, o) => {
            for (const h of hooks) await h["experimental.text.complete"]?.(i, o)
        },
        event: async (i) => {
            for (const h of hooks) await h["event"]?.(i)
        }
    }

    return result
}
