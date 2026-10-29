import type { RGBA } from "@opentui/core"
import type { Theme } from "./index"

/** Outcome/status kinds. Use only for errors, warnings, success, and info feedback. */
export type FeedbackKind = "error" | "warning" | "success" | "info"

/**
 * Semantic view over the flat {@link Theme} fields, mirroring the token roles in
 * `packages/theme/src/tui/types.ts` (text, background levels, border, feedback).
 * Pure mapping: no color values are invented here.
 */
export type SemanticTokens = {
  readonly text: {
    readonly base: RGBA
    readonly muted: RGBA
  }
  readonly action: {
    readonly primary: RGBA
    readonly secondary: RGBA
    readonly accent: RGBA
  }
  readonly feedback: Readonly<Record<FeedbackKind, RGBA>>
  readonly background: {
    readonly base: RGBA
    readonly panel: RGBA
    readonly element: RGBA
    readonly menu: RGBA
  }
  readonly border: {
    readonly base: RGBA
    readonly active: RGBA
    readonly subtle: RGBA
  }
}

export function resolveSemantic(theme: Theme): SemanticTokens {
  return {
    text: {
      base: theme.text,
      muted: theme.textMuted,
    },
    action: {
      primary: theme.primary,
      secondary: theme.secondary,
      accent: theme.accent,
    },
    feedback: {
      error: theme.error,
      warning: theme.warning,
      success: theme.success,
      info: theme.info,
    },
    background: {
      base: theme.background,
      panel: theme.backgroundPanel,
      element: theme.backgroundElement,
      menu: theme.backgroundMenu,
    },
    border: {
      base: theme.border,
      active: theme.borderActive,
      subtle: theme.borderSubtle,
    },
  }
}

/** Feedback border/text color for a toast or status indicator. Role: feedback. */
export function feedbackColor(theme: Theme, kind: FeedbackKind): RGBA {
  return theme[kind]
}
