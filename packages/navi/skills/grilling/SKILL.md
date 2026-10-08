---
name: grilling
description: Relentless requirements and design interrogation to eliminate assumptions before implementing. Use when stress-testing a plan, scoping a complex feature, or asking clarifying questions.
---

# Grilling: Design Tree Interrogation

Interview the user systematically until reaching a complete, shared understanding.

## Design Tree & The Frontier
- Map the problem as a **Design Tree**: every major decision branches into dependent decisions.
- The **Frontier** is the set of questions whose prerequisites are already settled.
- Work the tree in **rounds**: Ask the whole frontier in one batch with clear numbers and recommended options:

```markdown
❓ **Q1 - <Question Title>**: <Context and choices>
➡️ **Recommended**: <Your recommended answer and rationale>

---

❓ **Q2 - <Question Title>**: <Context and choices>
➡️ **Recommended**: <Your recommended answer and rationale>
```

## Rules of Grilling
- **Finding facts is the agent's job**: Never ask the user for information you can discover using search, read, bash, or subagents.
- **Making decisions is the user's job**: Put explicit choices to the user with recommendations.
- **The frontier is empty when done**: Conclude only when all branches are settled and no assumptions remain silent.
