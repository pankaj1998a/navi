/**
 * Navi Hooks - Automation hooks ported from oh-my-navi-dev
 *
 * Available hooks:
 * - keywordDetector: Detects ultrawork/search/analyze keywords
 * - todoContinuationEnforcer: Ensures agents complete all TODOs
 * - contextWindowMonitor: Monitors token usage and warns at high usage
 * - ralphLoop: Continuous execution until task completion
 * - thinkMode: Auto-detects thinking keywords and upgrades models
 * - sessionRecovery: Auto-recovers from session errors
 * - commentChecker: Detects excessive/low-quality AI comments
 * - rulesInjector: Loads rules from .claude/rules, .cursor/rules, etc.
 * - directoryAgentsInjector: Auto-injects AGENTS.md context
 * - preemptiveCompaction: Auto-compacts before context overflow
 */

export { createKeywordDetectorHook, detectKeywords } from "./keyword-detector"
export type { KeywordType, DetectedKeyword } from "./keyword-detector"

export { createTodoContinuationEnforcerHook } from "./todo-continuation-enforcer"

export { createContextWindowMonitorHook } from "./context-window-monitor"

export { createRalphLoopHook } from "./ralph-loop"
export type { RalphLoopState, RalphLoopHook, RalphLoopOptions } from "./ralph-loop"

export { createThinkModeHook, detectThinkKeyword, getHighVariant, getThinkingConfig } from "./think-mode"
export type { ThinkModeState } from "./think-mode"

export { createSessionRecoveryHook, detectErrorType, isRecoverableError, isRecovering } from "./session-recovery"
export type { SessionRecoveryState, SessionRecoveryHook, SessionRecoveryOptions } from "./session-recovery"

export { createCommentCheckerHook, checkComments } from "./comment-checker"
export type { CommentIssue, CommentCheckResult, CommentCheckerOptions } from "./comment-checker"

export { createRulesInjectorHook } from "./rules-injector"
export type { RulesInjectorOptions } from "./rules-injector"

export { createDirectoryAgentsInjectorHook } from "./directory-agents-injector"
export type { DirectoryAgentsInjectorOptions } from "./directory-agents-injector"

export { createPreemptiveCompactionHook } from "./preemptive-compaction"
export type { PreemptiveCompactionOptions } from "./preemptive-compaction"

