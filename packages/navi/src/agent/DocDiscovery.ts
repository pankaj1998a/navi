import { Log } from "../util/log"
import { iife } from "@/util/iife"

const log = Log.create({ service: "doc-discovery" })

/**
 * Common library documentation mappings. 
 * This minimizes "hallucinations" about library APIs.
 */
const DOC_MAP: Record<string, string> = {
    "@opentui/core": "https://opentui.dev/docs/core",
    "@opentui/solid": "https://opentui.dev/docs/solid-integration",
    "solid-js": "https://docs.solidjs.com/concepts/signals",
    "zod": "https://zod.dev/?id=basic-usage",
    "bun": "https://bun.sh/docs/api/shell",
    "typescript": "https://www.typescriptlang.org/docs/",
    "next": "https://nextjs.org/docs",
    "react": "https://react.dev/reference/react",
    "tailwind-css": "https://tailwindcss.com/docs/utility-first",
}

/**
 * DocDiscovery automatically identifies project libraries and 
 * provides relevant documentation links for the agent to use. 
 */
export class DocDiscovery {
    /**
     * Reads package.json (if available) and returns documentation URLs for 
     * identified dependencies.
     */
    static async discover(directory: string): Promise<string[]> {
        log.debug("Scanning for documentation", { directory })
        
        try {
            const packageJsonPath = `${directory}/package.json`
            const file = Bun.file(packageJsonPath)
            if (!(await file.exists())) return []

            const pkg = await file.json()
            const deps = { ...pkg.dependencies, ...pkg.devDependencies }
            const discovered = Object.keys(deps)
                .filter(d => !!DOC_MAP[d])
                .map(d => DOC_MAP[d])

            log.info("Documentation discovered", { count: discovered.length })
            return discovered
        } catch (e) {
            log.error("Failed to discover documentation", { error: String(e) })
            return []
        }
    }

    /**
     * Injects found docs into the system prompt context. 
     */
    static formatForAgent(urls: string[]): string {
        if (urls.length === 0) return ""
        return `\n### Relevant Documentation Found:\n- Use these URLs if you need API details:\n${urls.map(u => `  * ${u}`).join("\n")}`
    }
}


