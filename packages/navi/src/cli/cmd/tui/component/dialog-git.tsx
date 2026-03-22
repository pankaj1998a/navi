import { useDialog, useDialog as useDialogContext } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createResource, createSignal, Show, createMemo, onMount, For } from "solid-js"
import { simpleGit } from "simple-git"
import { useTheme } from "../context/theme"
import { Keybind } from "@/util/keybind"
import { TextAttributes } from "@opentui/core"
import { useToast } from "@tui/ui/toast"
import { tmpdir } from "os"
import { join } from "path"
import { writeFileSync, unlinkSync } from "fs"

const git = simpleGit()

export function DialogGit() {
    const dialog = useDialog()
    const { theme } = useTheme()
    const toast = useToast()

    const [status, { refetch }] = createResource(async () => {
        try {
            const s = await git.status()
            return s.files
        } catch (e) {
            return []
        }
    })

    const stage = async (file: string) => {
        try {
            await git.add(file)
            toast.show({ message: `Staged ${file}`, variant: "success" })
            refetch()
        } catch (e: any) {
            toast.show({ message: `Failed to stage: ${e.message}`, variant: "error" })
        }
    }

    const unstage = async (file: string) => {
        try {
            await git.reset(['--', file])
            toast.show({ message: `Unstaged ${file}`, variant: "success" })
            refetch()
        } catch (e: any) {
            toast.show({ message: `Failed to unstage: ${e.message}`, variant: "error" })
        }
    }

    const push = async () => {
        toast.show({ message: "Pushing...", variant: "info", duration: 2000 })
        try {
            await git.push()
            toast.show({ message: "Pushed successfully", variant: "success" })
        } catch (e: any) {
            toast.show({ message: `Failed to push: ${e.message}`, variant: "error" })
        }
    }

    const pull = async () => {
        toast.show({ message: "Pulling...", variant: "info", duration: 2000 })
        try {
            await git.pull()
            toast.show({ message: "Pulled successfully", variant: "success" })
            refetch()
        } catch (e: any) {
            toast.show({ message: `Failed to pull: ${e.message}`, variant: "error" })
        }
    }

    return (
        <Show when={status()} fallback={<text>Loading...</text>}>
            {(files) => (
                <DialogSelect
                    title="Git Status"
                    options={files().map(f => ({
                        title: f.path,
                        value: f.path,
                        description: f.working_dir, // 'M', '?', etc.
                        footer: `Status: ${f.working_dir} | Index: ${f.index}`,
                        gutter: <text fg={f.index !== ' ' ? theme.success : theme.textMuted}>
                            {f.index !== ' ' ? "[S]" : "[ ]"}
                        </text>
                    }))}
                    onSelect={(option) => {
                        dialog.push(<DialogGitHunks file={option.value} onClose={() => {
                            dialog.pop()
                            refetch()
                        }} />)
                    }}
                    keybind={[
                        {
                            keybind: Keybind.parse("s")[0],
                            title: "Stage",
                            onTrigger: (opt) => stage(opt.value)
                        },
                        {
                            keybind: Keybind.parse("u")[0],
                            title: "Unstage",
                            onTrigger: (opt) => unstage(opt.value)
                        },
                        {
                            keybind: Keybind.parse("c")[0],
                            title: "Commit",
                            onTrigger: () => dialog.push(<DialogGitCommit onDone={() => {
                                dialog.pop()
                                refetch()
                            }} />)
                        },
                        {
                            keybind: Keybind.parse("r")[0],
                            title: "Refresh",
                            onTrigger: () => refetch()
                        },
                        {
                            keybind: Keybind.parse("p")[0],
                            title: "Push",
                            onTrigger: push
                        },
                        {
                            keybind: Keybind.parse("shift+p")[0],
                            title: "Pull",
                            onTrigger: pull
                        },
                        {
                            keybind: Keybind.parse("v")[0],
                            title: "View Diff",
                            onTrigger: (opt) => dialog.push(<DialogGitDiff file={opt.value} />)
                        }
                    ]}
                />
            )}
        </Show>
    )
}

function DialogGitDiff(props: { file: string, hunkIndex?: number }) {
    const { theme } = useTheme()
    const dialog = useDialog()
    const dimensions = useTerminalDimensions()

    const [diff] = createResource(async () => {
        try {
            return await git.diff([props.file])
        } catch (e) {
            return "Failed to load diff"
        }
    })

    const lines = createMemo(() => {
        const d = diff()
        if (!d) return []
        return d.split("\n")
    })

    onMount(() => {
        dialog.setSize("large")
    })

    return (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
            <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.text} attributes={TextAttributes.BOLD}>Diff: {props.file}</text>
                <text fg={theme.textMuted}>esc</text>
            </box>
            <scrollbox height={dimensions().height - 15} scrollbarOptions={{ visible: true }}>
                <For each={lines()}>
                    {(line: string) => {
                        let fg = theme.text
                        if (line.startsWith("+")) fg = theme.success
                        else if (line.startsWith("-")) fg = theme.error
                        else if (line.startsWith("@@")) fg = theme.accent
                        else if (line.startsWith("diff") || line.startsWith("index") || line.startsWith("---") || line.startsWith("+++")) fg = theme.textMuted

                        return <text fg={fg}>{line}</text>
                    }}
                </For>
            </scrollbox>
        </box>
    )
}



function DialogGitCommit(props: { onDone: () => void }) {
    const { theme } = useTheme()
    const toast = useToast()
    const [message, setMessage] = createSignal("")

    const commit = async () => {
        if (!message()) {
            toast.show({ message: "Commit message cannot be empty", variant: "warning" })
            return
        }
        try {
            await git.commit(message())
            toast.show({ message: "Committed successfully", variant: "success" })
            props.onDone()
        } catch (e: any) {
            toast.show({ message: `Failed to commit: ${e.message}`, variant: "error" })
        }
    }

    useKeyboard((evt: any) => {
        if (evt.name === "return") {
            commit()
        }
    })

    return (
        <box flexDirection="column" padding={4} gap={1}>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>Commit Message</text>
            <box borderStyle="single" borderColor={theme.primary} padding={1}>
                <input
                    placeholder="Enter commit message..."
                    onInput={setMessage}
                />
            </box>
            <box flexDirection="row" gap={2} paddingTop={1}>
                <text fg={theme.textMuted}>Enter: Commit</text>
                <text fg={theme.textMuted}>Esc: Cancel</text>
            </box>
        </box>
    )
}


function DialogGitHunks(props: { file: string, onClose: () => void }) {
    const dialog = useDialog()
    const { theme } = useTheme()
    const toast = useToast()
    const [selected, setSelected] = createSignal<Set<number>>(new Set())

    const [diff] = createResource(async () => {
        try {
            // Get unstaged diff
            return await git.diff(['--u', props.file])
        } catch (e) {
            return null
        }
    })

    const parsed = createMemo(() => {
        const d = diff()
        if (!d) return null
        return parseDiff(d)
    })

    const options = createMemo(() => {
        const p = parsed()
        if (!p) return []
        return p.hunks.map((hunk, i) => {
            const lines = hunk.lines
            const added = lines.filter(l => l.startsWith('+')).length
            const removed = lines.filter(l => l.startsWith('-')).length
            return {
                title: hunk.header,
                value: i,
                description: lines.find(l => l.startsWith('+') || l.startsWith('-')) || lines[0] || "",
                footer: `+${added} -${removed}`,
                gutter: <text fg={selected().has(i) ? theme.success : theme.textMuted}>
                    {selected().has(i) ? "[x]" : "[ ]"}
                </text>
            }
        })
    })

    const stage = async () => {
        const p = parsed()
        if (!p) return
        const toStage = Array.from(selected()).sort((a, b) => a - b)
        if (toStage.length === 0) {
            toast.show({ message: "No hunks selected", variant: "warning" })
            return
        }

        const patchContent = p.header + "\n" + toStage.map(i => p.hunks[i].content).join("\n") + "\n"

        try {
            // Write patch to temp file
            const patchFile = join(tmpdir(), `navi-patch-${Date.now()}.diff`)
            writeFileSync(patchFile, patchContent)

            // Apply patch
            await git.raw(['apply', '--cached', patchFile])

            // Cleanup
            unlinkSync(patchFile)

            toast.show({ message: "Staged selected hunks", variant: "success" })
            props.onClose()
        } catch (e: any) {
            toast.show({ message: `Failed to stage: ${e.message}`, variant: "error" })
        }
    }

    return (
        <DialogSelect
            title={`Stage Hunks: ${props.file}`}
            options={options()}
            onSelect={(option) => {
                const s = new Set(selected())
                if (s.has(option.value)) s.delete(option.value)
                else s.add(option.value)
                setSelected(s)
            }}
            keybind={[
                {
                    keybind: Keybind.parse("s")[0],
                    title: "Stage Selected",
                    onTrigger: stage
                },
                {
                    keybind: Keybind.parse("a")[0],
                    title: "Select All",
                    onTrigger: () => {
                        const p = parsed()
                        if (!p) return
                        setSelected(new Set(p.hunks.map((_, i) => i)))
                    }
                },
                {
                    keybind: Keybind.parse("v")[0],
                    title: "View Hunk",
                    onTrigger: (opt) => {
                        const p = parsed()
                        if (!p) return
                        const hunk = p.hunks[opt.value]
                        if (!hunk) return
                        dialog.push(<DialogGitHunkView file={props.file} hunk={hunk} />)
                    }
                }
            ]}
        />
    )
}

function DialogGitHunkView(props: { file: string, hunk: any }) {
    const { theme } = useTheme()
    const dialog = useDialog()
    const dimensions = useTerminalDimensions()

    onMount(() => {
        dialog.setSize("large")
    })

    return (
        <box flexDirection="column" paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
            <box flexDirection="row" justifyContent="space-between">
                <text fg={theme.text} attributes={TextAttributes.BOLD}>Hunk: {props.file}</text>
                <text fg={theme.textMuted}>esc</text>
            </box>
            <scrollbox height={dimensions().height - 15} scrollbarOptions={{ visible: true }}>
                <text fg={theme.accent}>{props.hunk.header}</text>
                <For each={props.hunk.lines}>
                    {(line: string) => {
                        let fg = theme.text
                        if (line.startsWith("+")) fg = theme.success
                        else if (line.startsWith("-")) fg = theme.error
                        return <text fg={fg}>{line}</text>
                    }}
                </For>
            </scrollbox>
        </box>
    )
}


function parseDiff(diff: string) {
    const lines = diff.split('\n')
    const headerLines = []
    let i = 0
    // Header includes everything before the first @@
    while (i < lines.length && !lines[i].startsWith('@@')) {
        headerLines.push(lines[i])
        i++
    }
    const header = headerLines.join('\n')

    const hunks = []
    let currentHunk = { header: "", lines: [] as string[], content: "" }

    for (; i < lines.length; i++) {
        const line = lines[i]
        if (line.startsWith('@@')) {
            if (currentHunk.header) {
                currentHunk.content = currentHunk.header + "\n" + currentHunk.lines.join("\n")
                hunks.push(currentHunk)
            }
            currentHunk = { header: line, lines: [], content: "" }
        } else {
            currentHunk.lines.push(line)
        }
    }
    if (currentHunk.header) {
        currentHunk.content = currentHunk.header + "\n" + currentHunk.lines.join("\n")
        hunks.push(currentHunk)
    }

    return { header, hunks }
}
