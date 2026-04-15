/**
 * Unified Response Structure for Navi
 *
 * All LLM providers — regardless of API format — produce responses that are
 * parsed and normalized into this structure before they reach the UI or any
 * downstream consumer.
 *
 * Design goals:
 *  1. ONE canonical shape regardless of provider (Gemini, Claude, GPT, Qwen, etc.)
 *  2. First-class "question" concept — when the LLM needs clarification it
 *     uses a structured field, NOT ad-hoc prose that gets lost in text.
 *  3. Explicit status so the UI can show progress / completion / error states.
 *  4. Zero breaking changes — the existing MessagePart system is kept intact;
 *     this layer sits ON TOP as a lightweight parsed envelope.
 */

import z from "zod"

// ─── QUESTION ────────────────────────────────────────────────────────────────
// When a model needs to ask the user something before it can proceed.

export const QuestionOption = z
    .object({
        label: z.string().describe("Short human-readable label shown as a button or list item"),
        value: z.string().optional().describe("Optional machine-readable value for the choice"),
        description: z.string().optional().describe("Short explanation of the choice"),
    })
    .meta({ ref: "QuestionOption" })
export type QuestionOption = z.infer<typeof QuestionOption>

export const ResponseQuestion = z
    .object({
        /** The question text shown to the user */
        text: z.string(),
        /** Why the question is being asked */
        why: z.string().optional(),
        /** A recommended option when one choice is clearly preferred */
        recommendedOption: z.string().optional(),
        /** The user-facing tradeoff or impact of answering */
        impact: z.string().optional(),
        /** What the model expects to do after the user answers */
        expectedNextStep: z.string().optional(),
        /** Optional pre-defined options the user can pick from */
        options: z.array(QuestionOption).optional(),
        /** Whether the user MUST answer before the agent continues */
        required: z.boolean().default(true),
    })
    .meta({ ref: "ResponseQuestion" })
export type ResponseQuestion = z.infer<typeof ResponseQuestion>

export const ResponseKind = z.enum([
    "direct",
    "plan",
    "implementation",
    "blocker",
    "recommendation",
    "research",
    "review",
    "question",
    "handoff",
]).optional().meta({ ref: "ResponseKind" })
export type ResponseKind = z.infer<typeof ResponseKind>

export const ResponseHandoff = z
    .object({
        summary: z.string(),
        nextAgent: z.string().optional(),
        openQuestions: z.array(z.string()).optional(),
        files: z.array(z.string()).optional(),
        notes: z.string().optional(),
    })
    .meta({ ref: "ResponseHandoff" })
export type ResponseHandoff = z.infer<typeof ResponseHandoff>

// ─── STATUS ──────────────────────────────────────────────────────────────────

export const ResponseStatus = z.enum([
    "done",         // Task fully completed
    "partial",      // Completed some steps, more planned
    "asking",       // Paused — waiting for user input
    "error",        // Non-retryable failure
    "thinking",     // Still processing (used for streaming deltas)
]).meta({ ref: "ResponseStatus" })
export type ResponseStatus = z.infer<typeof ResponseStatus>

// ─── FILES CHANGED ───────────────────────────────────────────────────────────

export const ResponseFileChange = z
    .object({
        path: z.string(),
        action: z.enum(["created", "modified", "deleted", "read"]),
        summary: z.string().optional(),
    })
    .meta({ ref: "ResponseFileChange" })
export type ResponseFileChange = z.infer<typeof ResponseFileChange>

// ─── MAIN RESPONSE ENVELOPE ──────────────────────────────────────────────────

export const NaviResponse = z
    .object({
        /**
         * The primary answer / output text from the model.
         * Always present for status="done" or "partial".
         */
        answer: z.string().optional(),

        /**
         * When the model needs clarification from the user.
         * Present when status="asking".
         */
        question: ResponseQuestion.optional(),

        /**
         * Optional high-level response kind so the UI and downstream tooling can
         * render consistent answer formats.
         */
        kind: ResponseKind,

        /**
         * The completion status of this response turn.
         */
        status: ResponseStatus,

        /**
         * Internal reasoning steps (visible only in reasoning-enabled models).
         * Not shown to the user by default; useful for debugging.
         */
        reasoning: z.string().optional(),

        /**
         * Files that were created/modified/deleted/read during this turn.
         */
        files: z.array(ResponseFileChange).optional(),

        /**
         * One-line summary of what was done in this turn.
         * Used as the session title and for compaction prompts.
         */
        summary: z.string().optional(),

        /**
         * Optional structured handoff for delegating to another agent or
         * resuming from a partial answer.
         */
        handoff: ResponseHandoff.optional(),

        /**
         * Optional confidence score for research / verification answers.
         */
        confidence: z.number().min(0).max(1).optional(),

        /**
         * Optional source list for research / evidence-backed answers.
         */
        sources: z.array(z.string()).optional(),

        /**
         * Optional next-step hint for follow-up work.
         */
        nextStep: z.string().optional(),

        /**
         * Optional blocker description when execution cannot continue.
         */
        blockedReason: z.string().optional(),

        /**
         * Raw provider metadata forwarded as-is for debugging.
         */
        providerMetadata: z.record(z.string(), z.any()).optional(),
    })
    .meta({ ref: "NaviResponse" })
    .refine(
        (v) => {
            if (v.status === "asking") return !!v.question
            return true
        },
        { message: "`question` is required when status is 'asking'", path: ["question"] },
    )
    .refine(
        (v) => {
            if (v.status === "done" || v.status === "partial") {
                if (v.kind === "handoff" && v.handoff?.summary) return true
                return !!v.answer
            }
            return true
        },
        { message: "`answer` is required when status is 'done' or 'partial'", path: ["answer"] },
    )

export type NaviResponse = z.infer<typeof NaviResponse>

// ─── PARSING ─────────────────────────────────────────────────────────────────
//
// Models may or may not emit a structured JSON block. We attempt to parse
// it; if parsing fails we fall back to treating the raw text as the answer.

const JSON_BLOCK_RE = /```(?:json)?\s*(\{[\s\S]*?\})\s*```/

/**
 * Try to extract a NaviResponse from an assistant text part.
 *
 * Strategy (in order):
 *  1. If the text contains a ```json ... ``` block, try parsing it.
 *  2. If the entire text is valid JSON, try parsing it.
 *  3. Fall back: wrap the raw text in a "done" envelope.
 */
export function parseNaviResponse(raw: string): NaviResponse {
    // 1. Fenced code block
    const fencedMatch = JSON_BLOCK_RE.exec(raw)
    if (fencedMatch) {
        const parsed = tryParseEnvelope(fencedMatch[1])
        if (parsed) return parsed
    }

    // 2. Entire text is JSON
    const trimmed = raw.trim()
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        const parsed = tryParseEnvelope(trimmed)
        if (parsed) return parsed
    }

    // 3. Plain text fallback
    return {
        status: "done",
        answer: raw,
    }
}

export function formatNaviResponseText(response: NaviResponse, fallback = ""): string {
    const answer = response.answer?.trim()
    if (response.status === "done" || response.status === "partial" || response.status === "error") {
        if (response.kind === "handoff" && response.handoff?.summary) {
            return [answer || response.handoff.summary, "", `Handoff: ${response.handoff.summary}`].join("\n").trim()
        }
        return answer || fallback.trim()
    }

    if (response.status === "asking") {
        const question = response.question?.text?.trim()
        const options = response.question?.options
            ?.map((option) => option.label)
            .filter(Boolean)
            .join(", ")

        if (answer && question) {
            return [answer, "", `Question: ${question}${options ? ` (${options})` : ""}`].join("\n")
        }

        if (question) {
            return `Question: ${question}${options ? ` (${options})` : ""}`
        }
    }

    return fallback.trim()
}

function tryParseEnvelope(json: string): NaviResponse | null {
    try {
        const data = JSON.parse(json)
        const result = NaviResponse.safeParse(data)
        if (result.success) return result.data

        // Non-strict fallback: if at minimum a question or answer is present, coerce
        if (typeof data.answer === "string" || typeof data.question?.text === "string") {
            return {
                status: data.status ?? (data.question ? "asking" : "done"),
                answer: data.answer,
                question: data.question,
                kind: data.kind,
                reasoning: data.reasoning,
                files: data.files,
                summary: data.summary,
                handoff: data.handoff,
                confidence: data.confidence,
                sources: data.sources,
                nextStep: data.nextStep,
                blockedReason: data.blockedReason,
            }
        }
    } catch {
        // JSON parse failed — not a structured response
    }
    return null
}

// ─── BUILDERS ────────────────────────────────────────────────────────────────
// Convenient factory functions for creating responses programmatically.

export const NaviResponseBuilder = {
    done(answer: string, extras?: Partial<NaviResponse>): NaviResponse {
        return { ...extras, status: "done", answer }
    },

    partial(answer: string, extras?: Partial<NaviResponse>): NaviResponse {
        return { ...extras, status: "partial", answer }
    },

    asking(question: ResponseQuestion, extras?: Partial<NaviResponse>): NaviResponse {
        return { ...extras, status: "asking", question }
    },

    error(answer: string, extras?: Partial<NaviResponse>): NaviResponse {
        return { ...extras, status: "error", answer }
    },

    handoff(summary: string, extras?: Partial<NaviResponse>): NaviResponse {
        return { ...extras, status: "partial", answer: extras?.answer ?? summary, kind: "handoff", handoff: { summary, ...(extras?.handoff ?? {}) } }
    },
}

// ─── SYSTEM PROMPT FRAGMENT ──────────────────────────────────────────────────
// This is injected into the system prompt so all models know the expected format.

export const RESPONSE_FORMAT_PROMPT = `\
## Response Format

When you complete a task or need to ask the user a question, output your response
in the following JSON format inside a fenced json block:

\`\`\`json
{
  "status": "done" | "partial" | "asking" | "error",
  "kind": "direct" | "plan" | "implementation" | "blocker" | "recommendation" | "research" | "review" | "question" | "handoff",
  "answer": "Your full response text here (required for status: done or partial)",
  "question": {                         // Only when status is 'asking'
    "text": "Your question to the user",
    "why": "Why this question is necessary",
    "recommendedOption": "Preferred choice if one stands out",
    "impact": "What happens if the user picks this option",
    "expectedNextStep": "What the model will do after the answer",
    "options": [                        // Optional — predefined choices
      { "label": "Option A", "value": "a" },
      { "label": "Option B", "value": "b", "description": "Tradeoff for B" }
    ],
    "required": true
  },
  "summary": "One-line summary of what was accomplished",
  "handoff": {
    "summary": "Short transfer summary for another agent or later turn",
    "nextAgent": "Optional next agent to run",
    "openQuestions": ["Optional follow-up questions"],
    "files": ["Optional files to inspect next"],
    "notes": "Optional extra context"
  },
  "confidence": 0.0,
  "sources": ["Optional source URLs, file paths, or evidence identifiers"],
  "nextStep": "Optional next action",
  "blockedReason": "Optional reason execution cannot continue",
  "files": [                            // Optional — list files you touched
    { "path": "src/foo.ts", "action": "modified", "summary": "Added X" }
  ]
}
\`\`\`

**Status values:**
- \`done\` — task fully completed, include \`answer\`
- \`partial\` — completed some steps, more planned, include \`answer\`
- \`asking\` — you need user input before proceeding, include \`question\`
- \`error\` — non-retryable failure, include \`answer\` explaining what went wrong

**Question rules:**
1. Ask at most one blocking question at a time unless the user explicitly asked for a questionnaire or multi-step intake.
2. Use \`options\` whenever the decision can be reduced to 2-4 concrete choices.
3. Include \`why\`, \`impact\`, and \`expectedNextStep\` when the question affects scope, risk, or cost.
4. Make the question action-oriented and specific enough that the next step is obvious after the user answers.

**Answer rules:**
1. Start with the direct answer or outcome.
2. Choose the most accurate \`kind\` for the response so downstream tooling can render it consistently.
3. Then include only the most relevant evidence, actions taken, risks, and next step.
4. Clearly label assumptions or uncertainty instead of implying certainty.
5. Use \`handoff\` when you are transferring work, delegating, or leaving a partial result for another agent.
6. When \`kind\` is \`handoff\`, \`handoff.summary\` is the primary transfer payload and \`answer\` may mirror it or be omitted if the summary is present.

**Rules:**
1. ALWAYS output this JSON block as the LAST thing in your response.
2. Free-form explanation goes BEFORE the JSON block.
3. If you need to ask the user something, use \`status: "asking"\` — never ask inline in prose.
4. The \`answer\` field should contain the complete, final, user-facing response.
5. Do not leave the user guessing what happens next.
6. Prefer a single clear output format per turn: direct answer, plan, implementation, blocker, recommendation, research report, review findings, question, or handoff.
`



