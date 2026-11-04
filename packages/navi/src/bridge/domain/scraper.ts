import { callExtensionTool } from "./bridge.ts";
import { log } from "./log.ts";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

export interface ScrapeOptions {
  url?: string;
  schemaOrGoal: string;
  provider?: string;
  outputFormat?: "json" | "csv";
}

export async function scrapeStructuredData(opts: ScrapeOptions): Promise<any> {
  const provider = opts.provider || "deepseek";
  log(`\n======================================================`);
  log(`🕸️ NAVIBRIDGE STRUCTURED WEB SCRAPER`);
  log(`Target: ${opts.url || "Active Browser Tab"}`);
  log(`Goal: "${opts.schemaOrGoal}"`);
  log(`Extraction Engine: ${provider.toUpperCase()}`);
  log(`======================================================\n`);

  // Step 1: Open URL if provided
  if (opts.url) {
    let parsed: URL;
    try { parsed = new URL(String(opts.url)); } catch {
      throw new Error(`invalid-url: ${opts.url}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error(`unsupported-url-scheme: ${parsed.protocol} (only http/https are allowed)`);
    }
    log(`[1/3] Navigating to ${parsed.href}...`);
    await callExtensionTool("navigate", { url: parsed.href, newTab: true }, 25000);
    await new Promise((r) => setTimeout(r, 4000));
  }

  // Step 2: Read clean page content
  log("[2/3] Extracting clean DOM and page text...");
  const rawPage = await callExtensionTool("read_page", {}, 20000);
  let pageText = "";
  let pageTitle = "Web Page";
  if (typeof rawPage === "string") {
    try {
      const p = JSON.parse(rawPage);
      pageText = p.text || rawPage;
      pageTitle = p.title || pageTitle;
    } catch {
      pageText = rawPage;
    }
  } else if (rawPage?.text) {
    pageText = rawPage.text;
    pageTitle = rawPage.title || pageTitle;
  }

  if (!pageText || pageText.length < 50) {
    throw new Error("Page content empty or unreadable");
  }
  log(`[2/3] Retrieved ${pageText.length} characters from "${pageTitle}".\n`);

  // Step 3: Run structured extraction
  log(`[3/3] Transforming unstructured content into structured data via ${provider.toUpperCase()}...`);
  const extractionPrompt = `You are an automated, high-precision structured data extraction engine.
Target Schema / Extraction Goal:
"${opts.schemaOrGoal}"

--- RAW PAGE CONTENT ---
${pageText.slice(0, 15000)}
--- END PAGE CONTENT ---

CRITICAL INSTRUCTIONS:
1. Extract ALL matching items, rows, or entities into a clean JSON structure.
2. Ensure values are strongly typed (numbers as floats/ints, booleans as true/false, arrays as lists).
3. Normalize missing fields to null.
4. Return ONLY valid, parseable JSON enclosed in a \`\`\`json ... \`\`\` code block. Do NOT include conversation or pleasantries.`;

  const rawRes = await callExtensionTool("ask", {
    provider,
    prompt: extractionPrompt,
    timeoutMs: 180000
  }, 185000);

  let text = "";
  if (typeof rawRes === "string") {
    try { text = JSON.parse(rawRes).text || rawRes; } catch { text = rawRes; }
  } else if (rawRes?.text) {
    text = rawRes.text;
  }
  if (!text) throw new Error(`Extraction failed: ${(rawRes && typeof rawRes === "object" && rawRes.error) || "empty response from provider"}`);

  // Extract JSON block
  const match = text.match(/```(?:json)?([\s\S]*?)```/i);
  const jsonStr = match && match[1] ? match[1].trim() : text.trim();
  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    parsed = { raw: text };
  }

  // Save to scraped_data/
  const outDir = resolve(process.cwd(), "scraped_data");
  mkdirSync(outDir, { recursive: true });
  const dateStr = new Date().toISOString().split("T")[0];
  const slug = pageTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 35) || "data";
  const filePath = resolve(outDir, `${dateStr}_${slug}.json`);
  writeFileSync(filePath, JSON.stringify(parsed, null, 2), "utf8");

  log(`\n✅ Data extraction complete!`);
  log(`👉 Saved to: ${filePath}\n`);
  return parsed;
}
