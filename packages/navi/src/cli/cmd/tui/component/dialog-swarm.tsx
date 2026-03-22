import { For, createMemo, createSignal, onMount, onCleanup, Match, Switch } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { SplitBorder } from "./border"
import { useKeybind } from "@tui/context/keybind"
import { P2PDiscovery } from "@/p2p/discovery"
import type { PeerInfo } from "@/p2p/types"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "../ui/toast"

export function DialogSwarm() {
    const dialog = useDialog()
    const { theme } = useTheme()
    const keybind = useKeybind()
    const dimensions = useTerminalDimensions()
    const sdk = useSDK()
    const toast = useToast()

    const [peers, setPeers] = createSignal<PeerInfo[]>([])
    const [selected, setSelected] = createSignal(0)

    const refreshPeers = () => {
        // In a real environment, this might call the local RPC worker to get the P2P stats. 
        // Since we are running in the TUI, the backend P2P runs in the worker/server.
        // We should ideally fetch this via SDK or RPC. Let's add an SDK method or just use fetch.
    }

    onMount(() => {
        const fetchPeers = async () => {
            try {
                const controller = new AbortController()
                const id = setTimeout(() => controller.abort(), 1000)
                const response = await fetch("http://127.0.0.1:4096/global/peers", { signal: controller.signal }).catch(() => null)
                clearTimeout(id)
                if (response && response.ok) {
                    const data = await response.json()
                    setPeers(data.peers || [])
                }
            } catch (e) {
                // ignore
            }
        }
        fetchPeers()
        const timer = setInterval(fetchPeers, 5000)
        onCleanup(() => clearInterval(timer))
    })

    useKeyboard((evt) => {
        const peerList = peers()
        if (evt.name === "escape" || keybind.match("app_exit", evt)) {
            dialog.clear()
            return
        }

        if (evt.name === "up" || evt.name === "k") {
            setSelected((prev) => (prev > 0 ? prev - 1 : peerList.length - 1))
        }

        if (evt.name === "down" || evt.name === "j") {
            setSelected((prev) => (prev < peerList.length - 1 ? prev + 1 : 0))
        }

        if (evt.name === "return") {
            const selectedPeer = peerList[selected()]
            if (selectedPeer) {
                toast.show({
                    message: `Delegation to ${selectedPeer.name} is not fully implemented yet!`,
                    variant: "info"
                })
                dialog.clear()
            }
        }
    })

    return (
        <box
            width={Math.min(dimensions().width - 4, 80)}
            height={Math.min(dimensions().height - 4, 20)}
            border={["left", "top", "bottom", "right"]}
            borderColor={theme.border}
            customBorderChars={SplitBorder.customBorderChars}
            flexDirection="column"
            backgroundColor={theme.backgroundPanel}
        >
            <box
                border={["bottom"]}
                borderColor={theme.border}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={0}
                paddingBottom={0}
                customBorderChars={SplitBorder.customBorderChars}
                justifyContent="space-between"
            >
                <box flexDirection="row" gap={1}>
                    <text fg={theme.primary}>{"◈"}</text>
                    <text fg={theme.text}>Swarm Collaboration</text>
                </box>
                <text fg={theme.textMuted}>{peers().length} Peers Found</text>
            </box>
            <box flexDirection="column" paddingLeft={1} paddingRight={1} paddingTop={1} flexGrow={1} overflow="hidden">
                <Switch>
                    <Match when={peers().length === 0}>
                        <text fg={theme.textMuted}>Scanning local network for active Navi swarms...</text>
                    </Match>
                    <Match when={true}>
                        <For each={peers()}>
                            {(peer, index) => {
                                const isSelected = () => index() === selected()
                                return (
                                    <box
                                        flexDirection="row"
                                        backgroundColor={isSelected() ? theme.backgroundElement : undefined}
                                        paddingLeft={1}
                                        paddingRight={1}
                                        justifyContent="space-between"
                                    >
                                        <box flexDirection="row" gap={2}>
                                            <text fg={isSelected() ? theme.primary : theme.text}>
                                                {isSelected() ? "▶" : " "} {peer.name}
                                            </text>
                                            <text fg={theme.textMuted}>{peer.id.slice(0, 8)}</text>
                                            <text fg={theme.success}>{peer.status}</text>
                                        </box>
                                        <box gap={2} flexDirection="row">
                                            <text fg={theme.textMuted}>{peer.hostname}:{peer.port}</text>
                                        </box>
                                    </box>
                                )
                            }}
                        </For>
                    </Match>
                </Switch>
            </box>
            <box
                border={["top"]}
                borderColor={theme.border}
                paddingLeft={1}
                paddingRight={1}
                paddingTop={0}
                paddingBottom={0}
                flexDirection="row"
                justifyContent="space-between"
                customBorderChars={SplitBorder.customBorderChars}
            >
                <box flexDirection="row" gap={2}>
                    <box flexDirection="row" gap={1}>
                        <text fg={theme.text}>{"↑↓"}</text>
                        <text fg={theme.textMuted}>navigate</text>
                    </box>
                    <box flexDirection="row" gap={1}>
                        <text fg={theme.text}>enter</text>
                        <text fg={theme.textMuted}>delegate task</text>
                    </box>
                </box>
                <box flexDirection="row" gap={1}>
                    <text fg={theme.text}>esc</text>
                    <text fg={theme.textMuted}>cancel</text>
                </box>
            </box>
        </box>
    )
}
