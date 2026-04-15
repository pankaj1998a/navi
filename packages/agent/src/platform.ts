import os from "os";

/**
 * Detection and hints for different platforms and environments.
 */
export const PLATFORM_HINTS: Record<string, string> = {
  whatsapp: "You are interacting via WhatsApp. Keep responses concise, use emojis sparingly, and avoid complex markdown that might not render well.",
  telegram: "You are on Telegram. Use markdown V2 for formatting if the client supports it.",
  discord: "You are in Discord. You can use Discord-flavored markdown and embeds.",
  slack: "You are in Slack. Use Slack-specific formatting (e.g. <https://example.com|Link>).",
  cli: "You are in a terminal / CLI environment. Use ANSI colors if supported and keep output suitable for scrolling text.",
  vscode: "You are integrated into VS Code. You can provide code snippets and use editor-specific features.",
};

/**
 * Detect if the current environment is Windows Subsystem for Linux (WSL).
 */
export function isWSL(): boolean {
  if (os.platform() !== "linux") return false;
  try {
    const release = os.release().toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

/**
 * Get a prompt hint for a specific platform.
 */
export function getPlatformHint(platform: string): string | null {
  return PLATFORM_HINTS[platform.toLowerCase()] || null;
}

/**
 * Get comprehensive environment details for the system prompt.
 */
export function getEnvironmentPrompt(): string {
  const platform = os.platform();
  const arch = os.arch();
  const wsl = isWSL();
  
  let prompt = `Environment: ${platform} (${arch})`;
  if (wsl) prompt += " [WSL]";
  
  return prompt;
}
