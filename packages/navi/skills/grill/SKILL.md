---
name: grill
description: Run an explicitly requested decision interview and record each settled decision in durable project documentation.
source: https://github.com/mattpocock/skills
license: MIT
---

# Grill

Use this skill only when the user explicitly asks for grilling plus durable documentation or directly invokes this skill; the `agents` coordinator handing it an unclear goal, or one decision needing the user's confirmation, before its plan is a direct invocation (its question is the user's judgement — target, measure, scope — that repository facts shape but never answer), and there the durable record is the project's own `PROJECT.md` or `library/` file, never a repository doc. Complexity, ambiguity, or a possible need for docs alone never activates it. This skill carries its own interview and documentation contract. Do not load or invoke `domain-modeling` at runtime.

## Interview Contract

1. Research discoverable facts in the repository, issue, docs, and code before asking the user. Ask only for judgments or facts that cannot be discovered.
2. Ask one decision-forcing question at a time. State the recommended answer and the reason briefly, then wait for the answer.
3. Ask every interview question in plain text as an ordinary assistant response. Do not use a question tool.
   - When a bounded decision benefits from 2-3 short, mutually exclusive choices, list them in plain text with the recommended answer first.
   - Invite the user to choose, modify, or discuss the choices instead of forcing a structured selection.
4. Use comparison tables when the user requests one or shared criteria make the options easier to compare.
5. Follow dependent decisions until the skill decides the decision tree is exhausted. Never ask a final "are we done?" meta-question.
6. Summarize the settled contract: goals, non-goals, decisions, constraints, risks, validation, and unresolved items.

## Decision explanations

Use the user's language and background knowledge. Keep terminology consistent
and use natural grammar with focused sentences and paragraphs; do not impose
language-specific dictionaries, grammar restrictions, or word-count limits.
English literacy may be assumed; it does not by itself establish domain expertise.
Keep English technical terms when more precise, even in another language, and explain an
unfamiliar concept or its practical effect as needed. Use examples from the
user's context without forcing translation or repeating familiar definitions.

Give enough context to identify the decision, options, practical consequences,
recommendation, and reason. Keep assumptions and uncertainty that could change
the choice visible; put supporting detail after the explanation it supports.
The user should be able to compare the consequences without decoding internal
IDs or reading background documents first.

Use diagrams for relationships or sequences, interactive pages for exploring
changing assumptions, and animation/video when motion helps explain a process.
Choose an aid only when the understanding and verification effort it saves
justifies preparing and viewing it. Keep the question and key consequences in
the conversation; simple choices or unavailable media can use ordinary text.
Check that an aid's labels, behavior, and conclusions agree with the source
facts and explanation. Write settled decisions to the usual durable document;
an explanatory artifact does not replace that record.

## Background formal evidence

When the target project provides an applicable formal checker, follow its
local documentation to prepare the declared interview input and run the check
before choosing the outline and after relevant answers or source changes.
Read the completed invocation's results and source/input binding, then use
unresolved obligations and counterexamples to revise the next question.
Recheck changed inputs. Reuse answers only within their supported scope and
conditions, preserving independent choices. After each answer, write its source
and applicable scope into the declared input and the journal or Draft decision;
rerun and record the revised remaining obligations before the next outline.
A possible model assignment is not human acceptance; bounded coverage does
not cover unlisted questions.
Missing or stale evidence limits dependent conclusions while independent
permitted work continues. Ask one practical question in the user's language,
with ordinary choices and consequences; explain formal techniques when asked.

## Scope Contract

The interview is not finished until the settled contract fixes the scope in
writing and the user accepts that text explicitly:

1. **Artifact-level boundary.** Name what the deliverable is (the documents,
   directories, PRs, or code paths in scope) and the artifact classes that are
   out of scope, such as follow-on specs, tests, runtime code, or task plans.
2. **Done means.** A short checklist of the observable conditions that finish
   the work: landed commits, closed issues, verified evidence. Nothing outside
   the checklist is a completion dependency, except the definition-of-done
   floor below.
3. **Staged designs are approved one stage at a time.** If a decision record
   describes later stages (an ADR that stages Constitution, spec, or runtime
   changes), record them as deferred proposals; accepting the record never
   approves the later stages. Each stage returns for its own interview.
4. **Execution words never widen scope.** "Go", "do it all", or "land 1-5"
   authorize only the accepted boundary. When later work would add an artifact
   class, a new PR, or a task program outside the boundary, stop before
   producing it and take one of exactly two paths: obtain the owner's explicit
   approval of the wider boundary, recorded on the owning issue, or move the
   extra work into a follow-up issue that starts its own interview. Never build
   first and ask afterwards.

When the repository defines done for behavior changes (for example landed,
exercised, guarded), that rule is the floor under the whole contract: the
boundary (1) cannot put what it requires out of scope, the checklist (2)
cannot omit what it requires, and adding what it requires is not widening
under (4).

Post the accepted scope contract where the executing lane and its supervisors
can read it (for repository work, the owning issue), quoting the acceptance.
This comment is lane-coordination evidence, not a decision record: it quotes
the user's exact words with channel and time; the durable decision lives in the
record this skill writes, never in the comment.

Ending the interview never authorizes implementation. Implement only after a separate explicit user request.

## Documentation Contract

1. Before the first question, resolve the target document from the user's named target and the repository's existing documentation conventions. Inspect local instructions, indexes, specs, ADRs, glossaries, and nearby docs. If the target is undeterminable, ask one question. Never invent a universal `docs/grilling/<date>.md` location.
2. Create or update the target as **Draft**. Write each settled decision immediately as Draft instead of waiting for the interview to end. Keep unresolved questions visibly marked.
3. If interrupted or cancelled, preserve the Draft and all file edits, mark unresolved questions, and never auto-revert documentation changes.
4. Read detailed `CONTEXT.md`, ADR, glossary, or other format references only when that document type is actually being written.
5. Normal Write/Edit tool events are the live proof of documentation work. Do not emit duplicate `Updated <path>` status lines.
6. An explicit docs request is a hard completion condition: the session cannot finish successfully without a useful documentation creation or update. "No docs needed" with zero file changes never satisfies it.
7. Only explicit user acceptance may change a document from Draft to **Final**. Exhausting the decision tree does not imply acceptance.
8. In the final response, list every changed documentation path and whether it stayed Draft or became Final.

## Credit

This skill's name and interview approach — one recommended answer per
question, repository facts researched instead of asked, decisions written
down as they settle — come from the `grilling` skill (and the former
`grill-with-docs` skill) by Matt Pocock (@mattpocockuk),
<https://github.com/mattpocock/skills>. The skill text shipped here is our own.
See the package's `CREDITS.md`.
