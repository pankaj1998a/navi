---
name: diagnosing-bugs
description: Disciplined 6-phase diagnosis loop for hard bugs, crashes, and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken, throwing, failing, or slow.
---

# Diagnosing Bugs

A disciplined 6-phase protocol for isolating and fixing bugs without speculative guessing.

## Redact
Redact every secret, token, or credential before displaying output or logs. Use `<REDACTED>`.

## Phase 1: Build a Feedback Loop (MANDATORY GATE)
**This is the foundation.** If you have a tight, deterministic pass/fail signal that goes RED on *this specific bug*, finding the root cause is mechanical. If you don't, no amount of reading code will save you.

### Acceptable Feedback Loops (in preference order):
1. **Failing test**: Unit, integration, or e2e test asserting the exact failure.
2. **Curl / HTTP script**: Reproducing against a running dev server or endpoint.
3. **CLI invocation**: Run with fixture input, diffing output against expected state.
4. **Headless browser script**: Driving UI and asserting on DOM/console/network errors.
5. **Replay captured trace**: Replay network payload or event log in isolation.
6. **Throwaway test harness**: Minimal harness exercising the code path directly.

### Phase 1 Completion Criterion
You must name **one fast, deterministic, agent-runnable command** that you have already run and witnessed go RED on this specific symptom.
*Hard Gate*: If you catch yourself reading code to form a hypothesis before this command exists, **STOP**. Jumping to a hypothesis without a loop is strictly prohibited. If a loop cannot be built, stop and request fixtures or logs from the user.

## Phase 2: Reproduce & Minimise
1. Confirm the loop reproduces the user's exact failure mode (not an adjacent unrelated error).
2. **Minimise**: Cut inputs, callers, and configuration one at a time, re-running the loop after each cut.
3. Done when every remaining element is strictly load-bearing (removing any one makes it pass).

## Phase 3: Ranked Falsifiable Hypotheses
Generate **3–5 ranked hypotheses** before testing any of them.
Each hypothesis must be falsifiable and state a clear prediction:
> Format: *"If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."*

Show the ranked list to the user before probing.

## Phase 4: Targeted Instrumentation
- Test hypotheses one by one, changing one variable at a time.
- Prefer targeted logs at branch boundaries.
- **Prefix every debug log**: Use a unique tag like `[DEBUG-a4f2]` so that cleanup is a single grep.
- For performance regressions: establish baseline timing/profiling measurements first. Measure first, fix second.

## Phase 5: Fix + Regression Test
1. Turn the minimised reproduction into a regression test at the **public seam**.
2. Verify the test fails cleanly.
3. Apply the minimal fix to make it pass.
4. Re-run the Phase 1 feedback loop against the original un-minimised repro.

## Phase 6: Cleanup & Learning
- [ ] Original reproduction no longer reproduces.
- [ ] Regression test passes.
- [ ] All `[DEBUG-...]` logs removed.
- [ ] Throwaway scripts cleaned up.
- [ ] Verified root cause and mechanism recorded in commit or PR message.
