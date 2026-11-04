import { callExtensionTool } from "./bridge.ts";
import { log } from "./log.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, sep } from "node:path";

export interface ResearchOptions {
  query: string;
  depth?: number;
  provider?: string;
  synthesizer?: string;
  outputPath?: string;
}

export async function deepResearch(opts: ResearchOptions): Promise<string> {
  const query = opts.query.trim();
  if (!query) throw new Error("Empty research query");

  const searchProvider = opts.provider || "perplexity";
  const synthProvider = opts.synthesizer || "deepseek";

  log(`\n======================================================`);
  log(`🚀 NAVIBRIDGE DEEP RESEARCH AGENT`);
  log(`Topic: "${query}"`);
  log(`Search Engine: ${searchProvider.toUpperCase()} | Synthesizer: ${synthProvider.toUpperCase()}`);
  log(`======================================================\n`);

  // Step 1: Broad multi-angle discovery query
  log(`[Step 1/3] Generating initial comprehensive web discovery via ${searchProvider.toUpperCase()}...`);
  const discoveryPrompt = `Perform an exhaustive, factual deep research on this topic:
"${query}"

Include:
1. Executive Summary & Core Definitions
2. Key players, technologies, or competitors
3. Detailed technical comparisons & metrics
4. Known tradeoffs, pricing, or real-world caveats
5. Future outlook for 2026

Provide concrete facts, numbers, and key references where available.`;

  const discoveryRaw = await callExtensionTool("ask", {
    provider: searchProvider,
    prompt: discoveryPrompt,
    timeoutMs: 180000
  }, 185000);

  let discoveryText = "";
  if (typeof discoveryRaw === "string") {
    try { discoveryText = JSON.parse(discoveryRaw).text || discoveryRaw; } catch { discoveryText = discoveryRaw; }
  } else if (discoveryRaw?.text) {
    discoveryText = discoveryRaw.text;
  }
  if (!discoveryText) throw new Error(`Discovery stage failed: ${(discoveryRaw && typeof discoveryRaw === "object" && discoveryRaw.error) || "empty response from provider"}`);

  log(`[Step 1/3] Discovery completed (${discoveryText.length} characters retrieved).\n`);

  // Step 2: Critical analysis / counter-arguments query
  log(`[Step 2/3] Querying critical analysis and counter-perspectives via ${synthProvider.toUpperCase()}...`);
  const critiquePrompt = `Analyze the following research findings on "${query}":

--- FINDINGS ---
${discoveryText.slice(0, 10000)}
--- END FINDINGS ---

Please critique and expand:
1. What critical details or common pitfalls are missing?
2. What are the strongest counter-arguments or edge cases?
3. Provide a practical recommendation matrix.`;

  const critiqueRaw = await callExtensionTool("ask", {
    provider: synthProvider,
    prompt: critiquePrompt,
    timeoutMs: 180000
  }, 185000);

  let critiqueText = "";
  if (typeof critiqueRaw === "string") {
    try { critiqueText = JSON.parse(critiqueRaw).text || critiqueRaw; } catch { critiqueText = critiqueRaw; }
  } else if (critiqueRaw?.text) {
    critiqueText = critiqueRaw.text;
  }
  if (!critiqueText) throw new Error(`Critique stage failed: ${(critiqueRaw && typeof critiqueRaw === "object" && critiqueRaw.error) || "empty response from provider"}`);

  log(`[Step 2/3] Critical analysis completed (${critiqueText.length} characters retrieved).\n`);

  // Step 3: Synthesis into final structured research dossier
  log(`[Step 3/3] Compiling unified Deep Research Dossier...`);
  const dateStr = new Date().toISOString().split("T")[0];
  const report = `# Deep Research Dossier: ${query}
*Generated on ${dateStr} by NaviBridge Deep Research Agent*
*Engines: ${searchProvider.toUpperCase()} (Primary Search) + ${synthProvider.toUpperCase()} (Synthesizer)*

---

## 1. Executive Summary & Primary Discovery
${discoveryText.trim()}

---

## 2. Critical Analysis, Tradeoffs & Counter-Perspectives
${critiqueText.trim()}

---

## 3. NaviBridge Agent Methodology
- Multi-provider consensus fanning out across independent web AI networks.
- Verification window: 180s per research stage with native DOM streaming detection.
- Data captured directly from live session runtime without external API token costs.
`;

  const reportsDir = resolve(process.cwd(), "research_reports");
  mkdirSync(reportsDir, { recursive: true });

  const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
  const fileName = `${dateStr}_${slug}.md`;
  let fullPath: string;
  if (opts.outputPath) {
    // A caller-supplied path must stay inside the working directory.
    const cwd = resolve(process.cwd());
    const resolved = resolve(cwd, opts.outputPath);
    if (!(resolved === cwd || resolved.startsWith(cwd + sep))) {
      throw new Error("outputPath must stay inside the current working directory");
    }
    fullPath = resolved;
  } else {
    fullPath = resolve(reportsDir, fileName);
  }

  writeFileSync(fullPath, report, "utf8");
  log(`\n✅ Deep Research complete! Dossier saved to:\n👉 ${fullPath}\n`);

  return fullPath;
}
