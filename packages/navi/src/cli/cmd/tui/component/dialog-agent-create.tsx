import { createSignal, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useToast } from "@tui/ui/toast"
import { Agent } from "@/agent/agent"
import { Global } from "@/global"
import { Instance } from "@/project/instance"
import * as path from "path"
import * as matter from "gray-matter"
import * as fs from "fs/promises"
import { useTheme } from "@tui/context/theme"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { reconcile } from "solid-js/store"

const TEMPLATES = [
    {
        title: "Architect",
        value: "architect",
        description: "Specialized in high-level design and system patterns (KiloCode Mode)",
    },
    {
        title: "Tester",
        value: "tester",
        description: "Focused on writing tests and QA (KiloCode Mode)",
    },
    {
        title: "Debugger",
        value: "debug",
        description: "Specialized in finding and fixing bugs (KiloCode Mode)",
    },
    {
        title: "Ask",
        value: "ask",
        description: "Expert at explaining code and answering questions (KiloCode Mode)",
    },
    {
        title: "User Story Creator",
        value: "user_story",
        description: "Synthesizes requirements into clear user stories and tasks (KiloCode Mode)",
    },
    {
        title: "Refactor",
        value: "refactor",
        description: "Specialized in improving code structure and readability (KiloCode Mode)",
    },
    {
        title: "Reviewer",
        value: "review",
        description: "Expert at code review and identifying potential issues (KiloCode Mode)",
    },
    {
        title: "Blank Agent",
        value: "blank",
        description: "Start from scratch with a custom description",
    },
]

async function fileExists(path: string): Promise<boolean> {
    try {
        await fs.access(path, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

export function DialogAgentCreate() {
    const dialog = useDialog()
    const toast = useToast()
    const { theme } = useTheme()
    const sdk = useSDK()
    const sync = useSync()
    const [step, setStep] = createSignal<"template" | "description" | "location">("template")
    const [description, setDescription] = createSignal("")
    const [selectedTemplate, setSelectedTemplate] = createSignal("blank")

    return (
        <>
            <Show when={step() === "template"}>
                <DialogSelect
                    title="Choose a Template"
                    options={TEMPLATES}
                    onSelect={(option) => {
                        setSelectedTemplate(option.value)
                        if (option.value === "blank") {
                            setStep("description")
                        } else {
                            setStep("location")
                        }
                    }}
                />
            </Show>
            <Show when={step() === "description"}>
                <DialogPrompt
                    title="Create Agent"
                    description={() => <text fg={theme.textMuted}>What should this agent do?</text>}
                    placeholder="e.g. A Python expert that focuses on data science"
                    onConfirm={(value) => {
                        if (!value) return
                        setDescription(value)
                        setStep("location")
                    }}
                />
            </Show>
            <Show when={step() === "location"}>
                <DialogSelect
                    title="Where to save?"
                    options={[
                        {
                            title: "Current Project",
                            value: "project",
                            description: path.join(Instance.worktree, ".navi/agent"),
                        },
                        {
                            title: "Global",
                            value: "global",
                            description: path.join(Global.Path.config, "agent"),
                        }
                    ]}
                    onSelect={async (option) => {
                        const toastId = toast.show({
                            variant: "info",
                            message: "Generating agent...",
                            duration: 10000
                        })
                        dialog.clear()

                        try {
                            let content = ""
                            let identifier = ""

                            if (selectedTemplate() === "blank") {
                                const generated = await Agent.generate({ description: description() })
                                identifier = generated.identifier
                                const frontmatter = {
                                    description: generated.whenToUse,
                                    mode: "all"
                                }
                                content = matter.stringify(generated.systemPrompt, frontmatter)
                            } else {
                                if (selectedTemplate() === "architect") {
                                    identifier = "architect"
                                    content = `---
description: A software architect specialized in high-level design, system patterns, and structural decisions.
mode: primary
tools:
  read: true
  websearch: true
  webfetch: true
  list: true
  glob: true
  grep: true
  edit: false
---

You are **Navi Architect**, a senior software architect. Your role is to:
1.  Analyze high-level requirements and translate them into system designs.
2.  Make decisions about project structure, technology stack, and design patterns.
3.  Review existing code for architectural consistency and scalability.
4.  Create detailed implementation plans for other agents to execute.

**Guidelines:**
- Focus on the "what" and "why", not just the "how".
- Consider trade-offs (performance vs. maintainability, speed vs. quality).
- Use \`read\`, \`list\`, and \`grep\` to understand the current codebase structure.
- Use \`websearch\` to research best practices and new technologies.
- Do NOT write code implementation details unless necessary for the design.
- Output your plans in clear, structured Markdown.`
                                } else if (selectedTemplate() === "tester") {
                                    identifier = "tester"
                                    content = `---
description: A quality assurance specialist focused on writing tests, analyzing coverage, and ensuring code reliability.
mode: subagent
tools:
  read: true
  edit: true
  bash: true
  list: true
  glob: true
---

You are **Navi Tester**, a QA specialist. Your role is to:
1.  Write comprehensive unit, integration, and end-to-end tests.
2.  Analyze code for edge cases and potential bugs.
3.  Ensure high test coverage and reliability.
4.  Refactor code to be more testable.

**Guidelines:**
- Always prefer writing tests *before* or *alongside* code changes (TDD).
- Use \`bash\` to run tests and verify results.
- Ensure tests are isolated and deterministic.
- When fixing bugs, create a reproduction test case first.
- Focus on \`__tests__\`, \`*.test.ts\`, \`*.spec.ts\` and similar files.`
                                } else if (selectedTemplate() === "debug") {
                                    identifier = "debug"
                                    content = `---
description: A specialist in identifying and fixing software bugs.
mode: subagent
tools:
  read: true
  edit: true
  bash: true
  list: true
  glob: true
  grep: true
---

You are **Navi Debugger**, a specialist in identifying and fixing software bugs. Your role is to:
1.  Analyze error logs and stack traces to find the root cause of issues.
2.  Use debugging tools and techniques to isolate problems.
3.  Propose and implement robust fixes for identified bugs.
4.  Verify fixes with tests.

**Guidelines:**
- Start by reproducing the bug if possible.
- Use \`read\` and \`grep\` to trace the execution flow.
- Use \`bash\` to run the application or tests and observe behavior.
- When fixing, consider side effects and edge cases.
- Always explain the root cause before providing the fix.`
                                } else if (selectedTemplate() === "ask") {
                                    identifier = "ask"
                                    content = `---
description: Expert at explaining code and answering questions.
mode: primary
tools:
  read: true
  list: true
  glob: true
  grep: true
  websearch: true
---

You are **Navi Ask**, an expert at understanding and explaining complex codebases. Your role is to:
1.  Answer questions about how the code works.
2.  Explain complex algorithms or system flows.
3.  Help users find where specific functionality is implemented.
4.  Provide high-level overviews of the project structure.

**Guidelines:**
- You are in READ-ONLY mode for the codebase. You can read files but not edit them.
- Use \`read\`, \`grep\`, and \`list\` to gather information.
- Provide clear, concise explanations with code snippets where helpful.
- If you don't know something, be honest and suggest how to find out.`
                                } else if (selectedTemplate() === "user_story") {
                                    identifier = "user_story"
                                    content = `---
description: Synthesizes requirements into clear user stories and tasks.
mode: primary
tools:
  read: true
  list: true
  glob: true
---

You are **Navi User Story Creator**, a product-focused agent. Your role is to:
1.  Analyze high-level requirements and break them down into user stories.
2.  Define clear acceptance criteria for each story.
3.  Create a structured task list for developers to follow.
4.  Ensure that the user's intent is correctly captured and translated into technical requirements.

**Guidelines:**
- Use the INVEST principle (Independent, Negotiable, Valuable, Estimable, Small, Testable) for user stories.
- Focus on the user's perspective: "As a [role], I want [feature], so that [benefit]".
- Provide clear, actionable tasks.
- Use \`read\` and \`list\` to understand the current state of the project if needed.`
                                } else if (selectedTemplate() === "refactor") {
                                    identifier = "refactor"
                                    content = `---
description: Specialized in improving code structure without changing its behavior.
mode: subagent
tools:
  read: true
  edit: true
  list: true
  glob: true
  grep: true
---

You are **Navi Refactor**, a specialist in improving code structure without changing its behavior. Your role is to:
1. Identify code smells and opportunities for refactoring.
2. Apply design patterns to improve maintainability and readability.
3. Simplify complex logic and remove duplication.
4. Ensure that refactored code remains functional and well-tested.

**Guidelines:**
- Focus on clean code principles (SOLID, DRY, KISS).
- Use \`read\` and \`grep\` to analyze the current implementation.
- Propose changes that improve the long-term health of the codebase.
- Always verify refactors with existing tests.`
                                } else if (selectedTemplate() === "review") {
                                    identifier = "review"
                                    content = `---
description: Expert at code review, quality assurance, and identifying potential issues.
mode: subagent
tools:
  read: true
  list: true
  glob: true
  grep: true
---

You are **Navi Reviewer**, an expert at code review and quality assurance. Your role is to:
1. Review code changes for correctness, security, and performance.
2. Ensure adherence to project coding standards and best practices.
3. Identify potential bugs, edge cases, and vulnerabilities.
4. Provide constructive feedback and suggestions for improvement.

**Guidelines:**
- Be thorough and objective in your reviews.
- Use \`read\` to examine the changes in context.
- Look for common pitfalls (e.g., memory leaks, race conditions, security flaws).
- Explain the reasoning behind your suggestions.`
                                }
                            }

                            const targetPath = option.value === "global"
                                ? path.join(Global.Path.config, "agent")
                                : path.join(Instance.worktree, ".navi/agent")

                            // Ensure unique filename
                            let finalPath = path.join(targetPath, `${identifier}.md`)
                            let counter = 1
                            while (await fileExists(finalPath)) {
                                finalPath = path.join(targetPath, `${identifier}-${counter}.md`)
                                counter++
                            }

                            await fs.mkdir(targetPath, { recursive: true })
                            await Bun.write(finalPath, content)

                            // Force server to reload config by disposing instance state
                            await sdk.client.instance.dispose({})

                            // Refresh agent list
                            const agents = await sdk.client.app.agents({})
                            sync.set("agent", reconcile(agents.data ?? []))

                            toast.show({
                                variant: "success",
                                message: `Agent created: ${path.basename(finalPath, ".md")}`,
                                duration: 3000
                            })
                        } catch (e) {
                            toast.show({
                                variant: "error",
                                message: `Failed to create agent: ${e}`,
                                duration: 5000
                            })
                        }
                    }}
                />
            </Show>
        </>
    )
}
