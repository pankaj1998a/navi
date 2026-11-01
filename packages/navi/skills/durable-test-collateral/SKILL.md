---
name: durable-test-collateral
description: Load the body before the first implementation edit for a bug fix or behavior change, or when the user or governing specification makes reusable tests a deliverable. It keeps the smallest focused test with the delivered project and updates coverage when behavior changes. Adding features to a project created earlier in this session is greenfield work, not a behavior change; a report that something already built behaves wrongly is still a bug fix. Do not load for greenfield work unless reusable tests are explicitly required, behavior-preserving refactors, verification-only work, plan/review/explanation/documentation/formatting/generated-output-only work, explicit no-change or no-tool work, or when the user declines tests.
user-invocable: false
---

# Durable Test Collateral

Verification is part of the delivered project when it can prevent the same
behavior from breaking again. Use the project's existing framework and
conventions.

Loading this skill does not mean the current turn asked for the change. While you
are still investigating — explaining existing behavior, or answering a design
question the user raised — use commands that only read and leave the repository
unmodified, tests included.

## Scale to the task

Skip the failing-test-first workflow below when the change is tiny and leaves
program logic alone (a typo, a text or style tweak, a config value, or a version
pin), when the work is a throwaway prototype or a standalone one-file script or
page, when the request adds features to a project you created earlier in this
session, or when the user asks for speed or a quick result. A quick direct check
of the changed behavior is enough there; if you add no maintained test, say so in
the report. A user request for tests anywhere in the session, or a
specification that makes tests a deliverable, still applies.

Any other bug fix or behavior change keeps the workflow at its smallest: one
focused failing test, the fix, that test passing, and, when a broad run is
required, one broad run after the final edit. A report that something already
built behaves wrongly is a bug fix, even when it comes with feature requests.

Before a test run that may take more than a minute or two, tell the user in one
line what runs and why. If you poll it, post a short status line between polls;
never poll a long run silently.

## Keep the check with the project

For a bug fix or behavior change, add or update the smallest maintained test in
the repository's normal test layout that exercises the changed behavior. If a
specification makes a reusable suite or test category a deliverable, implement
that suite instead of treating it as private verification.

An inline interpreter command, heredoc, scratch script, temporary-directory
test, demo, or manual probe may help diagnose the problem, but it does not
replace the maintained test. Keep a useful self-authored test unless the user
explicitly asks for a disposable probe.

Do not add a new test framework solely to satisfy this skill. If the repository
has no maintained harness and the request does not require one, disclose when
durable coverage would be disproportionate or infeasible and use the narrowest
honest verification instead.

On a later turn, update the maintained test even when the old suite remains
green and the user does not repeat the test request. Cover the new behavior,
not merely an unrelated cleanup in the test file.

## Prove the maintained check

Observe the authentic failure before the implementation change when it is safe
and runnable. Then make the smallest implementation change and run the focused
maintained test after the final relevant source or test edit.

Do not weaken or delete a real failing test to obtain green. Fix the product,
or explain why the test's expectation is wrong before changing that
expectation. Do not repeat an unchanged check solely to collect evidence.

Run a broad or full suite only when the user, a repository gate, or
proportionate risk requires it, and then once, after the final edit, rather
than after each intermediate edit. A focused regression test comes first; broad
proof does not substitute for missing focused coverage.

Before deciding what a repository gate requires, read what the repository
declares it runs: its CI workflow, its test entry points, and its root-level
scripts listed with hidden entries included. A suite the project itself runs
over this change is a gate, not an optional extra, and a suite that skips
itself when its data is absent is not a green result.

A runner is unavailable only after you tried to make it available. When the
repository ships the command that fetches or builds the missing fixture,
corpus, or toolchain, run that command once and then run the gate. Report the
gate unavailable only when that attempt itself failed, and say what failed.

If the real runner is unavailable but the focused test can still be authored
honestly, leave the focused test in the repository and say it was not run. Do
not fabricate a passing result.
