import { createHash } from "crypto"
import { Instance } from "../project/instance"

export namespace Buddy {
    export const RARITIES = [
      'common',
      'uncommon',
      'rare',
      'epic',
      'legendary',
    ] as const
    export type Rarity = (typeof RARITIES)[number]

    export const SPECIES = [
      'panda',
      'cat',
      'duck',
      'robot',
      'tiger',
      'owl',
    ] as const
    export type Species = (typeof SPECIES)[number]

    export const EYES = ['·', '✦', '×', '◉', '@', '°'] as const
    export type Eye = (typeof EYES)[number]

    export type CompanionBones = {
      rarity: Rarity
      species: Species
      eye: Eye
      shiny: boolean
    }

    export type BuddyInfo = CompanionBones & {
        icon: string
        greeting: string
        reactions: {
            idle: string
            thinking: string
            working: string
            success: string
            error: string
        }
        tips: string[]
    }

    const MASCOTS: Record<Species, (eye: Eye) => string> = {
        panda: (e) => `ʕ${e}ᴥ${e}ʔ`,
        cat: (e) => `(=^${e}ｪ${e}^=)`,
        duck: (e) => `(•${e}•)`,
        robot: (e) => `[${e}益${e}]`,
        tiger: (e) => `ฅ^${e}ﻌ${e}^ฅ`,
        owl: (e) => `(O${e}O)`,
    }

    const TIPS = [
        "Type /mcp to see connected tools!",
        "Use /viz to see token usage.",
        "Mention files with @ to give me context.",
        "Try /rewind if you make a mistake.",
        "Use web search to find anything online!",
        "I love clean code and bamboo!",
    ]

    function mulberry32(seed: number): () => number {
      let a = seed >>> 0
      return function () {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
      }
    }

    function hashString(s: string): number {
      let h = 2166136261
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i)
        h = Math.imul(h, 16777619)
      }
      return h >>> 0
    }

    function pick<T>(rng: () => number, arr: readonly T[]): T {
      return arr[Math.floor(rng() * arr.length)]!
    }

    export function get(preferredSpecies?: Species): BuddyInfo {
        let id = "default"
        try {
            id = Instance.project?.id || "default"
        } catch (e) {
            // Ignore error if Instance is accessed outside of an active context and fall back to default ID
        }

        const rng = mulberry32(hashString(id + "buddy-salt-v1"))
        const species: Species = preferredSpecies || pick(rng, SPECIES)
        const eye = pick(rng, EYES)
        
        const mascotBase = MASCOTS[species](eye)
        
        return {
            rarity: 'common',
            species,
            eye,
            shiny: false,
            icon: mascotBase,
            greeting: `Hello! I'm your ${species} buddy. Ready to code?`,
            reactions: {
                idle: mascotBase,
                thinking: mascotBase.replaceAll(eye, '-'),
                working: mascotBase.replaceAll(eye, '◡'),
                success: mascotBase.replaceAll(eye, '◕'),
                error: mascotBase.replaceAll(eye, 'x'),
            },
            tips: TIPS,
        }
    }
}
