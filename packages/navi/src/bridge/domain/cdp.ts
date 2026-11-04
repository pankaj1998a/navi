import path from "path"
import fs from "fs"
import { spawn } from "child_process"

export const PROVIDER_URLS: Record<string, string> = {
  chatgpt: "https://chatgpt.com",
  claude: "https://claude.ai",
  gemini: "https://gemini.google.com/app",
  deepseek: "https://chat.deepseek.com",
  grok: "https://x.com/i/grok",
  perplexity: "https://www.perplexity.ai",
  kimi: "https://kimi.moonshot.cn",
}

export function isStable(a: string, b: string): boolean {
  return a === b && a.length > 0
}

export const STABILITY_JS = `new Promise((done)=>{let last=document.body.innerText.slice(-4000),n=0;const t=setInterval(()=>{const cur=document.body.innerText.slice(-4000);if(cur===last&&++n>=3){clearInterval(t);done(cur.slice(-2000))}else{if(cur!==last)n=0;last=cur}},800);setTimeout(()=>{clearInterval(t);done(document.body.innerText.slice(-2000))},120000)})`

export interface ChromeProfileInfo {
  userDataDir: string
  profileFolder: string
  profileName: string
  email?: string
}

export function findChromeProfileByName(targetName = "raj"): ChromeProfileInfo | null {
  const localAppData = process.env.LOCALAPPDATA || ""
  if (!localAppData) return null

  const userData = path.join(localAppData, "Google", "Chrome", "User Data")
  const localStatePath = path.join(userData, "Local State")

  if (!fs.existsSync(localStatePath)) {
    return null
  }

  try {
    const localState = JSON.parse(fs.readFileSync(localStatePath, "utf8"))
    const infoCache = localState.profile?.info_cache || {}
    const targetLower = targetName.toLowerCase().trim()

    // 1. Exact match by profile name
    for (const [folder, info] of Object.entries(infoCache) as [string, any][]) {
      if (typeof info?.name === "string" && info.name.toLowerCase().trim() === targetLower) {
        return {
          userDataDir: userData,
          profileFolder: folder,
          profileName: info.name,
          email: info.user_name || "",
        }
      }
    }

    // 2. Substring match
    for (const [folder, info] of Object.entries(infoCache) as [string, any][]) {
      if (typeof info?.name === "string" && info.name.toLowerCase().includes(targetLower)) {
        return {
          userDataDir: userData,
          profileFolder: folder,
          profileName: info.name,
          email: info.user_name || "",
        }
      }
    }

    // 3. Email match
    for (const [folder, info] of Object.entries(infoCache) as [string, any][]) {
      if (typeof info?.user_name === "string" && info.user_name.toLowerCase().includes(targetLower)) {
        return {
          userDataDir: userData,
          profileFolder: folder,
          profileName: info.name,
          email: info.user_name || "",
        }
      }
    }
  } catch {
    return null
  }

  return null
}

export function getBrowserProfileDir(): string {
  if (process.env.NAVI_BROWSER_PROFILE) {
    return path.resolve(process.env.NAVI_BROWSER_PROFILE)
  }

  // Check portable directory first if present
  const portableProfile = path.resolve(process.cwd(), "browser-profile")
  if (fs.existsSync(portableProfile)) {
    return portableProfile
  }

  const vPankajPortable = "V:\\pankaj\\navi-portable\\browser-profile"
  if (fs.existsSync(path.dirname(vPankajPortable))) {
    return vPankajPortable
  }

  const vPankajNavi = "V:\\pankaj\\navi\\browser-profile"
  if (fs.existsSync(path.dirname(vPankajNavi))) {
    return vPankajNavi
  }

  const home = process.env.USERPROFILE || process.env.HOME || ""
  return path.join(home, ".navi", "browser-profile")
}

export function findChromeExecutable(): string | null {
  const candidates: string[] = []
  if (process.platform === "win32") {
    const prefixes = [
      process.env["PROGRAMFILES"] ?? "C:\\Program Files",
      process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
      process.env["LOCALAPPDATA"] ?? "",
    ].filter(Boolean)

    for (const prefix of prefixes) {
      candidates.push(
        path.join(prefix, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(prefix, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(prefix, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        path.join(prefix, "Chromium", "Application", "chrome.exe"),
      )
    }
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    )
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
    )
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

export async function isCdpOnline(cdpBase = "http://127.0.0.1:9222"): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 1200)
  try {
    const r = await fetch(`${cdpBase}/json/version`, { signal: ctrl.signal })
    if (!r.ok) return false
    const data: any = await r.json()
    return typeof data.Browser === "string"
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function launchChromeProfile(opts?: {
  port?: number
  urls?: string[]
  profileDir?: string
  profileName?: string
  forceRestart?: boolean
}): Promise<{ pid: number; profileDir: string; profileFolder?: string; port: number }> {
  const port = opts?.port ?? 9222
  const profileName = opts?.profileName ?? process.env.NAVI_CHROME_PROFILE ?? "raj"
  const resolvedProfile = findChromeProfileByName(profileName)

  const chromePath = findChromeExecutable()
  if (!chromePath) {
    throw new Error(
      "Chrome/Chromium executable not found on this system. Please install Google Chrome or Microsoft Edge.",
    )
  }

  const defaultUrls: string[] = [
    PROVIDER_URLS.chatgpt || "https://chatgpt.com",
    PROVIDER_URLS.claude || "https://claude.ai",
    PROVIDER_URLS.gemini || "https://gemini.google.com/app",
    PROVIDER_URLS.deepseek || "https://chat.deepseek.com",
  ]
  const urls: string[] = (opts?.urls && opts.urls.length > 0 ? opts.urls : defaultUrls).filter((u): u is string => typeof u === "string")

  // If forceRestart is true, gracefully close running Chrome processes so debugging port 9222 can bind
  if (opts?.forceRestart && process.platform === "win32") {
    try {
      const { execSync } = require("child_process")
      execSync("taskkill /im chrome.exe /f", { stdio: "ignore" })
      await new Promise((r) => setTimeout(r, 1500))
    } catch {}
  }

  let finalArgs: string[] = []
  let profileDirToReturn = ""
  let profileFolderToReturn = ""

  if (resolvedProfile) {
    profileDirToReturn = resolvedProfile.userDataDir
    profileFolderToReturn = resolvedProfile.profileFolder
    finalArgs = [
      `--profile-directory="${resolvedProfile.profileFolder}"`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...urls,
    ]
  } else {
    const profileDir = opts?.profileDir ?? getBrowserProfileDir()
    fs.mkdirSync(profileDir, { recursive: true })
    profileDirToReturn = profileDir
    finalArgs = [
      `--user-data-dir="${profileDir}"`,
      `--remote-debugging-port=${port}`,
      "--no-first-run",
      "--no-default-browser-check",
      ...urls,
    ]
  }

  // On Windows, use PowerShell Invoke-CimMethod Win32_Process Create to launch detached
  if (process.platform === "win32") {
    const argsString = [`"${chromePath}"`, ...finalArgs].join(" ")
    const psCommand = `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${argsString.replace(/'/g, "''")}' }`
    spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psCommand], {
      windowsHide: true,
      stdio: "ignore",
    })
  } else {
    const cp = spawn(chromePath, finalArgs, {
      detached: true,
      stdio: "ignore",
    })
    cp.unref()
  }

  // Poll until CDP port responds
  const startTime = Date.now()
  while (Date.now() - startTime < 12000) {
    await new Promise((r) => setTimeout(r, 400))
    if (await isCdpOnline(`http://127.0.0.1:${port}`)) {
      return { pid: 0, profileDir: profileDirToReturn, profileFolder: profileFolderToReturn, port }
    }
  }

  throw new Error(
    `Chrome launched with profile '${profileName}', but CDP port ${port} did not respond. If Chrome was already running before this command, please close Chrome or run 'navi bridge browser --restart' to enable remote debugging.`,
  )
}

export async function listTabs(cdpBase = "http://127.0.0.1:9222"): Promise<any[]> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 3000)
  try {
    const r = await fetch(`${cdpBase}/json/list`, { signal: ctrl.signal })
    if (!r.ok) return []
    return await r.json()
  } catch {
    return []
  } finally {
    clearTimeout(t)
  }
}

export function findTab(tabs: any[], hostOrProvider: string): any | undefined {
  const target = hostOrProvider.toLowerCase()
  return tabs.find((t) => {
    if (t.type !== "page") return false
    const url = typeof t.url === "string" ? t.url.toLowerCase() : ""
    return url.includes(target)
  })
}

export async function openTab(url: string, cdpBase = "http://127.0.0.1:9222"): Promise<any> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(`${cdpBase}/json/new?${encodeURIComponent(url)}`, {
      method: "PUT",
      signal: ctrl.signal,
    })
    if (!r.ok) {
      const rGet = await fetch(`${cdpBase}/json/new?${encodeURIComponent(url)}`)
      return await rGet.json()
    }
    return await r.json()
  } finally {
    clearTimeout(t)
  }
}

export async function findOrOpenTab(hostOrProvider: string, cdpBase = "http://127.0.0.1:9222"): Promise<any> {
  const tabs = await listTabs(cdpBase)
  const existing = findTab(tabs, hostOrProvider)
  if (existing) return existing

  const provUrl = PROVIDER_URLS[hostOrProvider.toLowerCase()] || hostOrProvider
  const newTab = await openTab(provUrl, cdpBase)
  await new Promise((r) => setTimeout(r, 1500))
  return newTab
}

export async function evalInTab(wsUrl: string, js: string, timeoutMs = 15000): Promise<string> {
  const ws = new WebSocket(wsUrl)
  let opened = false
  const cleanup = () => {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  }
  try {
    await new Promise((res, rej) => {
      const tl = setTimeout(() => rej(new Error("ws-timeout")), timeoutMs)
      ws.onopen = () => {
        opened = true
        clearTimeout(tl)
        res(0)
      }
      ws.onerror = () => {
        clearTimeout(tl)
        rej(new Error("ws-error"))
      }
    })
    const id = 1
    const result: string = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("cdp-timeout")), timeoutMs)
      ws.onmessage = (m) => {
        let d: any
        try {
          d = JSON.parse(String(m.data))
        } catch (e) {
          clearTimeout(timer)
          reject(e)
          return
        }
        if (d.id !== id) return
        clearTimeout(timer)
        if (d.error) {
          reject(new Error(String(d.error.message || d.error).slice(0, 200)))
          return
        }
        const exception = d.result?.exceptionDetails
        if (exception) {
          reject(
            new Error(
              String(exception.exception?.description || exception.text || "page-exception").slice(0, 200),
            ),
          )
          return
        }
        resolve(d.result?.result?.value ?? "")
      }
      ws.send(
        JSON.stringify({
          id,
          method: "Runtime.evaluate",
          params: { expression: js, returnByValue: true, awaitPromise: true },
        }),
      )
    })
    return result
  } finally {
    if (opened || ws.readyState === WebSocket.OPEN) cleanup()
  }
}

export async function queryDirectCdp(
  prompt: string,
  provider = "chatgpt",
  timeoutSecs = 60,
  cdpBase = "http://127.0.0.1:9222",
): Promise<string> {
  let online = await isCdpOnline(cdpBase)
  if (!online) {
    await launchChromeProfile()
    online = await isCdpOnline(cdpBase)
    if (!online) {
      throw new Error(`Dedicated Chrome AI Browser is not running on ${cdpBase}. Run 'navi bridge browser' to start it.`)
    }
  }

  const tab = await findOrOpenTab(provider, cdpBase)
  if (!tab || !tab.webSocketDebuggerUrl) {
    throw new Error(`Failed to find or open browser tab for provider '${provider}' on ${cdpBase}.`)
  }

  const sanitizedPrompt = JSON.stringify(prompt)
  const timeoutMs = timeoutSecs * 1000

  const runnerScript = `
    (async () => {
      const promptText = ${sanitizedPrompt};
      const timeoutMs = ${timeoutMs};

      const INPUTS = [
        "#prompt-textarea",
        "textarea#chat-input",
        "div.ProseMirror[contenteditable=true]",
        "div.ql-editor[contenteditable=true]",
        "rich-textarea div[contenteditable=true]",
        ".chat-input-editor",
        "div[data-lexical-editor=true]",
        "textarea[placeholder*='Ask' i]",
        "textarea[placeholder*='Message' i]",
        "textarea[placeholder*='DeepSeek' i]",
        "textarea",
        "div[contenteditable=true]",
        "div[role=textbox]"
      ];

      const SEND_BTNS = [
        "button[data-testid='send-button']",
        "button[data-testid='fruitjuice-send-button']",
        "button[aria-label*='Send' i]",
        "button[aria-label*='Submit' i]",
        "button[aria-label*='Grok' i]",
        "button.send-button",
        ".send-button-container",
        ".send-icon",
        "svg[name='Send']",
        "div[role='button'][class*='send' i]",
        "div[role='button']:has(svg)",
        "div.ds-icon-button",
        "button[type='submit']",
        "button:has(svg path[d*='M'])"
      ];

      function findInput() {
        for (const s of INPUTS) {
          const els = [...document.querySelectorAll(s)];
          for (const el of els) {
            if ((el.offsetParent || el.getClientRects().length > 0 || (el.offsetWidth || 0) > 0) && !el.disabled && !el.readOnly) return el;
          }
        }
        return null;
      }

      function findSend() {
        for (const s of SEND_BTNS) {
          try {
            const el = document.querySelector(s);
            if (el && (el.offsetParent || el.getClientRects().length > 0 || (el.offsetWidth || 0) > 0) && !el.disabled && el.getAttribute("aria-disabled") !== "true") return el;
          } catch {}
        }
        return null;
      }

      function lastAssistantTurn() {
        const sels = [
          'div[data-message-author-role="assistant"]',
          '[data-message-author-role="assistant"]',
          '.font-claude-message',
          'message-content',
          'model-response',
          'div.ds-markdown',
          '.markdown',
          'div.prose',
          'article'
        ];
        for (const s of sels) {
          try {
            const els = [...document.querySelectorAll(s)].filter((e) => (e.innerText || "").trim().length > 5);
            if (els.length) return (els[els.length - 1].innerText || "").trim();
          } catch {}
        }
        return (document.body.innerText || "").slice(-4000);
      }

      function isGenerating() {
        return !!document.querySelector([
          "button[aria-label*='Stop' i]",
          "button[data-testid*='stop' i]",
          ".stop-generating-button",
          "[aria-label*='Stop streaming' i]",
          ".ds-loading",
          ".result-streaming"
        ].join(","));
      }

      let el = null;
      for (let w = 0; w < 40 && !el; w++) {
        el = findInput();
        if (!el) await new Promise((r) => setTimeout(r, 250));
      }

      if (!el) {
        return JSON.stringify({ ok: false, error: "Could not find chat input field. Please check if you need to log in to " + location.hostname });
      }

      const beforeTurn = lastAssistantTurn();
      el.focus();

      if (el.isContentEditable) {
        try {
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
          document.execCommand("insertText", false, promptText);
        } catch {
          el.textContent = promptText;
        }
      } else {
        try {
          const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          if (desc && desc.set) desc.set.call(el, promptText);
          else el.value = promptText;
        } catch {
          el.value = promptText;
        }
      }
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

      await new Promise((r) => setTimeout(r, 300));

      const btn = findSend();
      if (btn) {
        try { btn.click(); } catch {}
      }
      try {
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      } catch {}

      const startTime = Date.now();
      let genStarted = false;
      let lastText = beforeTurn;
      let stableCount = 0;

      while (Date.now() - startTime < timeoutMs) {
        await new Promise((r) => setTimeout(r, 500));
        const curText = lastAssistantTurn();
        const generating = isGenerating();

        if (generating || curText !== beforeTurn) {
          genStarted = true;
        }

        if (genStarted) {
          if (curText === lastText && curText.length > 10 && !generating) {
            stableCount++;
            if (stableCount >= 3) {
              return JSON.stringify({ ok: true, text: curText });
            }
          } else {
            stableCount = 0;
            lastText = curText;
          }
        }
      }

      const finalText = lastAssistantTurn();
      if (finalText && finalText !== beforeTurn) {
        return JSON.stringify({ ok: true, text: finalText });
      }

      return JSON.stringify({ ok: false, error: "Response timeout reached (" + Math.round(timeoutMs / 1000) + "s)" });
    })()
  `

  const raw = await evalInTab(tab.webSocketDebuggerUrl, runnerScript, timeoutMs + 10000)
  try {
    const parsed = JSON.parse(raw)
    if (parsed.ok) return parsed.text
    throw new Error(parsed.error || "Unknown error during CDP query")
  } catch (err: any) {
    if (err.message && err.message.includes("Could not find chat input")) {
      throw new Error(`${err.message} (Open the Chrome window and sign in once to your ${provider} account)`)
    }
    throw err
  }
}
