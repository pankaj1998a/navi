---
name: github-deep-review
description: "GitHub deep review: bugs, PRs, root cause analysis, git provenance, regression detection, architectural refactor assessment."
---

# GitHub Deep Review

Conduct high-confidence, evidence-first, code-aware reviews. The goal is not a generic summary. The goal is to understand the bug class, find the real cause, verify the fix with code evidence, track provenance when possible, and evaluate whether a refactor would improve the design.

## Start

Use `gh` or git directly for reviewing PRs, diffs, and commits:

```bash
gh pr view <n> --json number,title,state,author,body,comments,reviews,files,commits
gh pr diff <n>
```

For repo-local review:
```bash
git status --short --branch
git log --oneline -20
git diff HEAD~1
```

## Review Contract

Always answer these explicitly:

- **Surface**: The affected file, module, CLI flag, or subsystem.
- **Bug**: What is the bug or behavior being addressed?
- **Root Cause**: Where in code and why. If unknown, state what evidence is missing.
- **Provenance**: For regressions, identify when and where it was introduced using `git log -S/-G` or `git blame`.
- **Fix Quality**: Is the proposed fix the best possible fix after reading adjacent code? Does it live at the correct ownership boundary?
- **Refactor**: Would a larger refactor improve correctness, clarity, or future maintainability?
- **Proof**: What proof exists (automated tests, reproduction, CI checks, live UI verification)?
- **Residual Risk**: What remains risky or unverified.

## Output Template

When reporting review findings:

```text
Surface: <runtime/CLI/provider/channel/docs>
Bug: <one or two sentences describing the issue>
Cause: <code path + confidence>
Provenance: <commit/PR/date if traceable, else N/A>
Best Fix: <what should change and why>
Refactor: <yes/no, specific architectural shape>
Proof: <tests/live proof/CI>
Risk: <remaining uncertainty>
```
