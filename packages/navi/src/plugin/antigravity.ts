/**
 * Antigravity Auth Plugin for Navi
 *
 * Provides Google OAuth authentication for accessing Google's Antigravity IDE
 * with access to Gemini 3 Pro/Flash and Claude models via Antigravity.
 *
 * Features:
 * - OAuth with Google for Antigravity access
 * - Multi-account support
 * - Automatic token refresh
 *
 * Based on navi-antigravity-auth by NoeFabris
 */

import type { Plugin } from "@/plugin"
import { AntigravityAuthHook, getAntigravityProviderConfig, ANTIGRAVITY_MODELS } from "../provider/antigravity"

export const AntigravityAuthPlugin: Plugin = async (_ctx) => {
    return {
        auth: AntigravityAuthHook,
    }
}

export { AntigravityAuthHook, getAntigravityProviderConfig, ANTIGRAVITY_MODELS }

export default AntigravityAuthPlugin


