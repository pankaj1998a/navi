# Git Style Guide

> Source: Git Style Guide (https://github.com/agis/git-style-guide) plus Git project CodingGuidelines (https://github.com/git/git/blob/master/Documentation/CodingGuidelines)

## Quick Rules
- One commit equals one logical change. A bug fix plus a refactor is two commits; a feature plus its tests is one commit.
- Never rewrite published history. Rebase only branches you alone own and that are not under review; never rebase `main` or any release branch.
- Use lowercase, hyphen-separated branch names (`oauth-migration`), optionally prefixed with a ticket id (`issue-15`, `T321-new-feature`).
- Write commit messages in an editor, not with `-m`. The summary line is at most 50 characters, imperative mood, capitalized, with no trailing period.
- Put a blank line after the summary, wrap the body at 72 characters, and explain why the change was needed plus any side effects.
- Before merging, rebase the branch onto the target branch and merge with `--no-ff` so the merge is recorded in history.
- Test before you push. Never push half-finished work; use `git add -p` to stage logical chunks.
- Use annotated tags for releases and important checkpoints; use lightweight tags only for personal bookmarks.
- Be consistent with the rest of the repository. If the surrounding code uses a different convention, match the local convention.

## Formatting
- Branch creation: `git checkout -b new-feature` (hyphens, lowercase) or `git checkout -b feature-a/maria` for personal work on a shared feature.
- Commit message structure: subject line, blank line, body paragraphs, then a footer of issue references (`Resolves: #56`).
- Use `git commit --squash <sha>` and `git commit --fixup <sha>` to mark intent, and `git rebase --autosquash` to apply them.
- Interactive staging with `git add -p` keeps one logical change per commit.
- Diff cleanup: `git diff --check` for whitespace errors, `git diff --staged` before committing.
- Merge shape: `git fetch && git rebase origin/main`, then `git merge --no-ff my-branch`.

## Naming
- Branches: `feature-a/main` for the team-wide branch, `feature-a/maria` for a personal branch, merged upward into the team branch.
- Branches may embed external ticket ids: `issue-15`, `T321-new-feature`.
- Tags: annotated, named after the released version (`v1.4.0`).
- Commit subjects read as an instruction ("Mark huge records as obsolete"), not as a report ("Fixed the bug").
- Never put credentials, tokens, or personal data in branch names, commit messages, or tags.

## Structure
- A clean linear history: rebase feature branches onto `main` before merging, so the result applies directly to the tip of `main`.
- Keep the branch short-lived; delete merged branches from the remote (`git branch --merged | grep -v "\*"` lists candidates).
- Group unrelated work into separate branches; one branch equals one unit of work.
- Every user-visible change should be reflected in the documentation, in the same commit as the code.
- Keep commit order logical: if commit X depends on change Y, Y comes first in history.

## Tooling
- Maintenance: `git gc`, `git prune`, `git fsck` to keep the repository healthy.
- Message linting: commitlint with Conventional Commits rules, wired into CI to reject malformed subjects.
- Hooks: a `pre-commit` hook that runs the project linter and the test suite before the commit is created.
- CI: run the same checks CI runs, plus `git diff --check`, before pushing.
- Diff review: `git log --oneline --decorate --graph` to read the history, `git show <sha>` to review a single change.
- Tagging releases: `git tag -a v1.4.0 -m "Release 1.4.0"` and push the tag explicitly.

## Anti-Patterns
- "Quick fix" or "WIP" commit messages. Instead: a descriptive imperative subject plus a body explaining why.
- Mixing a refactor and a behavior change in one commit. Instead: split with `git add -p` into two logical commits.
- `git commit -m "long message"` for a multi-line explanation. Instead: use the editor so the body can be wrapped at 72 columns.
- Force-pushing or rebasing a shared or `main` branch. Instead: rebase only your own unpublished branch.
- Merging with fast-forward into a busy `main`. Instead: `git merge --no-ff` so the branch is visible in history.
- Pushing work-in-progress commits to a protected branch. Instead: keep them on a topic branch and squash before merging.
- Committing generated files, `node_modules`, or secrets. Instead: add them to `.gitignore` and keep secrets in a secret manager.

## Code/Config Example
```text
Mark huge records as obsolete when clearing hinting faults

Records that exceed the size limit made the reclaimer loop
unbounded. Skip them explicitly and log the count so operators can
see how many records were affected.

This changes the reclaimer throughput slightly, but avoids the
out-of-memory failures reported in issue #412.

Resolves: #412, #418
See also: #399
```

## Sources
- https://github.com/agis/git-style-guide
- https://github.com/git/git/blob/master/Documentation/CodingGuidelines
