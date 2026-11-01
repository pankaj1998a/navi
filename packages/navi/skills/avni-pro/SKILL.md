---
name: avni-pro
description: Advanced coding and research bridge using browser automation to delegate complex reasoning, code generation, and deep research to Frontier AI web models (Kimi, DeepSeek, Claude, ChatGPT) at zero token bill, with strict subagent delegation and verified page closure.
---

# Avni-Pro: Frontier AI Web Bridge & Subagent Orchestration

Avni-Pro enables local or lightweight models in Navi to consult frontier reasoning models via automated browser interaction **without exhausting the main agent's 1-million token context window**.

---

## 🛡️ Context Protection & Subagent Architecture

> [!IMPORTANT]
> **MAIN AGENT CONTEXT PROTECTION RULE**:
> The **Main Agent MUST NOT** run direct browser navigation or raw DOM reading loops in its primary conversation.
> Raw HTML and multi-turn web scraping can consume hundreds of thousands of tokens.
> 
> Instead, the Main Agent **MUST delegate** each AI consultation to a dedicated **`@bridge` subagent** (or via the `task` tool).
> The subagent executes in an isolated sandbox and returns **ONLY** the distilled final code or concise markdown synthesis to the main agent.

```
+-------------------------------------------------------------------------+
| MAIN AGENT (Clean 1M Context Window - No HTML/DOM Bloat)                |
|                                                                         |
|  1. Dispatches Task: "Consult Kimi for algorithm design"                |
|  2. Dispatches Task: "Consult DeepSeek-R1 for mathematical proof"       |
+-------------------------------------------------------------------------+
       |                                                    |
       v (Isolated Sandbox)                                 v (Isolated Sandbox)
+------------------------------------+    +------------------------------------+
| SUBAGENT 1: @bridge (Kimi)         |    | SUBAGENT 2: @bridge (DeepSeek-R1)  |
|                                    |    |                                    |
| 1. navigate("https://kimi.ai")     |    | 1. navigate("https://deepseek...") |
| 2. type(prompt) -> click(send)     |    | 2. type(prompt) -> click(send)     |
| 3. wait(reasoning)                 |    | 3. wait(reasoning)                 |
| 4. content(extract markdown)       |    | 4. content(extract markdown)       |
| 5. close() -> VERIFY CLOSED ✅     |    | 5. close() -> VERIFY CLOSED ✅     |
+------------------------------------+    +------------------------------------+
       |                                                    |
       +-----------------> Returns Clean Code Only <--------+
```

---

## 🔒 Strict Subagent Operational Rules

### Rule 1: One AI Website at a Time
- Each `@bridge` subagent is strictly dedicated to **ONE** AI website at a time.
- Never navigate between multiple different AI websites within a single browser session.

### Rule 2: Mandatory Page Closure & Verification
Every subagent consultation MUST complete the full 5-step lifecycle:
1. **`navigate`**: Open the specific AI portal (`https://kimi.moonshot.cn`, `https://chat.deepseek.com`, etc.).
2. **`type` & `click`**: Submit the self-contained prompt.
3. **`wait`**: Allow the frontier model to complete its thinking stream (10-30s).
4. **`content`**: Extract the markdown response.
5. **`close` & VERIFY**:
   ```json
   {
     "action": "close"
   }
   ```
   - **Verification Check**: The subagent must check that the tool response confirms `closed: true` before completing the subagent task.

### Rule 3: Zero-Leak Synthesis
- The subagent must filter out all UI elements, sidebar text, headers, and buttons.
- Return **only** clean code blocks, types, or concise bulleted reasoning back to the Main Agent.

---

## 🌐 Supported AI Web Portals & Profiles

| Portal | URL | Strengths |
| :--- | :--- | :--- |
| **Kimi (Moonshot AI)** | `https://kimi.moonshot.cn` / `https://www.kimi.ai` | Massive 200k+ context, deep web search, long-document coding. |
| **DeepSeek Chat / R1** | `https://chat.deepseek.com` | DeepSeek-R1 reasoning, complex algorithms, competitive programming. |
| **Perplexity AI** | `https://www.perplexity.ai` | Real-time technical documentation, cited web research. |
| **Claude Web / ChatGPT** | `https://claude.ai` / `https://chatgpt.com` | Architectural design, refactoring, and code review. |

---

## 📋 Example: Main Agent Delegation Workflow

```typescript
// 1. Main Agent spawns isolated subagent for Kimi
yield* task.spawn({
  agent: "bridge",
  prompt: `Navigate to https://kimi.moonshot.cn. Ask:
"Provide a high-performance LRU Cache implementation in TypeScript with O(1) get/put operations and zero memory leaks."
Extract the clean code, close the page, verify page is closed, and return only the TypeScript code.`
})

// 2. Main Agent receives clean TypeScript code directly into its context!
// 3. Main Agent saves code and runs local verification:
yield* edit.execute(...)
yield* test_runner.execute({ path: "test/cache.test.ts" })
```
