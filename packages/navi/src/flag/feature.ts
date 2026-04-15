import { Flag } from "./flag"

/**
 * Feature flag check that allows for build-time optimization.
 * In a production build, these can be replaced with literal booleans
 * to enable dead code elimination.
 */
declare const FEATURE_VOICE: boolean | undefined
declare const FEATURE_TELEPORT: boolean | undefined
declare const FEATURE_BRIDGE: boolean | undefined
declare const FEATURE_SENTRY: boolean | undefined
declare const FEATURE_SPECULATION: boolean | undefined
declare const FEATURE_SYMBOL_GRAPH: boolean | undefined

export function feature(name: string): boolean {
    switch(name) {
        case "voice": return typeof FEATURE_VOICE !== "undefined" ? FEATURE_VOICE : true
        case "teleport": return typeof FEATURE_TELEPORT !== "undefined" ? FEATURE_TELEPORT : true
        case "bridge": return typeof FEATURE_BRIDGE !== "undefined" ? FEATURE_BRIDGE : true
        case "sentry": return typeof FEATURE_SENTRY !== "undefined" ? FEATURE_SENTRY : true
        case "speculation": return typeof FEATURE_SPECULATION !== "undefined" ? FEATURE_SPECULATION : true
        case "symbol-graph": return typeof FEATURE_SYMBOL_GRAPH !== "undefined" ? FEATURE_SYMBOL_GRAPH : true
        default: return false
    }
}



