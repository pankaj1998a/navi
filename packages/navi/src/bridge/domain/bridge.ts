import { ensureBridgeDaemonRunning } from "../../native/bridge-runner"

export async function callExtensionTool(
  tool: string,
  args: Record<string, unknown> = {},
  timeoutMs = 30000,
): Promise<any> {
  const online = await ensureBridgeDaemonRunning()
  if (!online) {
    throw new Error("NaviBridge daemon is not running on 127.0.0.1:10086.")
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch("http://127.0.0.1:10086/tool", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, args }),
      signal: controller.signal,
    })
    clearTimeout(timer)
    if (!res.ok) {
      throw new Error(`Bridge tool error ${res.status}: ${await res.text()}`)
    }
    return await res.json()
  } catch (err: any) {
    clearTimeout(timer)
    throw err
  }
}

