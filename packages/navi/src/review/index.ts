import { Instance } from "@/project/instance"
import { $ } from "bun"
import path from "path"
import z from "zod"
import { Log } from "@navi-ai/core/util/log"

const log = Log.create({ service: "review" })

// ============================================================
// Types
// ============================================================

export const ReviewTarget = z.union([
    z.object({ type: z.literal("uncommitted") }),
    z.object({ type: z.literal("baseBranch"), branch: z.string() }),
    z.object({ type: z.literal("commit"), sha: z.string(), title: z.string().optional() }),
    z.object({ type: z.literal("custom"), instructions: z.string() }),
])
export type ReviewTarget = z.infer<typeof ReviewTarget>

export const ReviewRequest = z.object({
    target: ReviewTarget,
    userFacingHint: z.string().optional(),
})
export type ReviewRequest = z.infer<typeof ReviewRequest>

export const ResolvedReviewRequest = z.object({
    target: ReviewTarget,
    prompt: z.string(),
    userFacingHint: z.string(),
})
export type ResolvedReviewRequest = z.infer<typeof ResolvedReviewRequest>

// ============================================================
// Prompt Templates
// ============================================================

const UNCOMMITTED_PROMPT =
    "Review the current code changes (staged, unstaged, and untracked files) and provide prioritized findings."

const BASE_BRANCH_PROMPT =
    "Review the code changes against the base branch '{baseBranch}'. The merge base commit for this comparison is {mergeBaseSha}. Run `git diff {mergeBaseSha}` to inspect the changes relative to {baseBranch}. Provide prioritized, actionable findings."

const BASE_BRANCH_PROMPT_BACKUP =
    "Review the code changes against the base branch '{branch}'. Start by finding the merge diff between the current branch and {branch}'s upstream e.g. (`git merge-base HEAD \"$(git rev-parse --abbrev-ref \"{branch}@{upstream}\")\"`), then run `git diff` against that SHA to see what changes we would merge into the {branch} branch. Provide prioritized, actionable findings."

const COMMIT_PROMPT_WITH_TITLE =
    "Review the code changes introduced by commit {sha} (\"{title}\"). Provide prioritized, actionable findings."

const COMMIT_PROMPT =
    "Review the code changes introduced by commit {sha}. Provide prioritized, actionable findings."

// ============================================================
// Git Operations
// ============================================================

async function mergeBaseWithHead(cwd: string, branch: string): Promise<string | undefined> {
    try {
        const result = await $`git merge-base HEAD ${branch}`
            .quiet()
            .nothrow()
            .cwd(cwd)
            .text()
        return result.trim() || undefined
    } catch (error) {
        log.error("Failed to find merge base", { branch, error })
        return undefined
    }
}

async function commitTitle(sha: string, cwd: string): Promise<string | undefined> {
    try {
        const result = await $`git log --format=%s -n 1 ${sha}`
            .quiet()
            .nothrow()
            .cwd(cwd)
            .text()
        return result.trim() || undefined
    } catch (error) {
        log.error("Failed to get commit title", { sha, error })
        return undefined
    }
}

// ============================================================
// Resolution Logic
// ============================================================

export function userFacingHint(target: ReviewTarget): string {
    switch (target.type) {
        case "uncommitted":
            return "current changes"
        case "baseBranch":
            return `changes against '${target.branch}'`
        case "commit":
            const shortSha = target.sha.slice(0, 7)
            if (target.title) {
                return `commit ${shortSha}: ${target.title}`
            }
            return `commit ${shortSha}`
        case "custom":
            return target.instructions.trim()
    }
}

export async function resolveReviewRequest(request: ReviewRequest): Promise<ResolvedReviewRequest> {
    const { target } = request
    const cwd = Instance.worktree

    let prompt: string

    switch (target.type) {
        case "uncommitted":
            prompt = UNCOMMITTED_PROMPT
            break

        case "baseBranch":
            const mergeBaseSha = await mergeBaseWithHead(cwd, target.branch)
            if (mergeBaseSha) {
                prompt = BASE_BRANCH_PROMPT
                    .replace("{baseBranch}", target.branch)
                    .replace("{mergeBaseSha}", mergeBaseSha)
            } else {
                prompt = BASE_BRANCH_PROMPT_BACKUP.replace("{branch}", target.branch)
            }
            break

        case "commit":
            const title = target.title || (await commitTitle(target.sha, cwd))
            if (title) {
                prompt = COMMIT_PROMPT_WITH_TITLE
                    .replace("{sha}", target.sha)
                    .replace("{title}", title)
            } else {
                prompt = COMMIT_PROMPT.replace("{sha}", target.sha)
            }
            break

        case "custom":
            const trimmedInstructions = target.instructions.trim()
            if (trimmedInstructions.length === 0) {
                throw new Error("Review prompt cannot be empty")
            }
            prompt = trimmedInstructions
            break
    }

    const hint = request.userFacingHint || userFacingHint(target)

    return {
        target,
        prompt,
        userFacingHint: hint,
    }
}

// ============================================================
// Helper Functions
// ============================================================

export async function getUncommittedChanges(): Promise<string> {
    try {
        const result = await $`git status --porcelain`
            .quiet()
            .nothrow()
            .cwd(Instance.worktree)
            .text()
        return result.trim()
    } catch (error) {
        log.error("Failed to get uncommitted changes", { error })
        return ""
    }
}

export async function getCommitDiff(sha: string): Promise<string> {
    try {
        const result = await $`git diff ${sha}^ ${sha}`
            .quiet()
            .nothrow()
            .cwd(Instance.worktree)
            .text()
        return result.trim()
    } catch (error) {
        log.error("Failed to get commit diff", { sha, error })
        return ""
    }
}

export async function getBranchDiff(baseBranch: string): Promise<string> {
    try {
        const mergeBaseSha = await mergeBaseWithHead(Instance.worktree, baseBranch)
        if (mergeBaseSha) {
            const result = await $`git diff ${mergeBaseSha}`
                .quiet()
                .nothrow()
                .cwd(Instance.worktree)
                .text()
            return result.trim()
        }
        return ""
    } catch (error) {
        log.error("Failed to get branch diff", { baseBranch, error })
        return ""
    }
}

