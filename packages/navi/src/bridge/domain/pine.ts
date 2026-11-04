import { callExtensionTool } from "./bridge.ts";
import { log } from "./log.ts";

export interface PineOptions {
  prompt: string;
  error?: string;
  isStrategy?: boolean;
  provider?: string;
}

export async function generatePineScript(opts: PineOptions): Promise<string> {
  const provider = opts.provider || "deepseek";
  const kind = opts.isStrategy ? "strategy" : "indicator";

  log(`\n======================================================`);
  log(`🌲 NAVIBRIDGE PINE SCRIPT v6 STUDIO`);
  log(`Mode: ${kind.toUpperCase()} | Engine: ${provider.toUpperCase()}`);
  log(`Goal: "${opts.prompt}"`);
  if (opts.error) log(`Compiler Error to fix: "${opts.error}"`);
  log(`======================================================\n`);

  const systemPrompt = `You are an elite TradingView Pine Script v6 expert developer.
Write clean, optimized, production-ready Pine Script v6 code for:
"${opts.prompt}"
${opts.error ? `\nFix this compiler error:\n${opts.error}\n` : ""}

CRITICAL PINE SCRIPT v6 RULES:
1. First line must be: //@version=6
2. Use ${opts.isStrategy ? 'strategy("...", overlay=true, initial_capital=10000, default_qty_type=strategy.percent_of_equity, default_qty_value=10)' : 'indicator("...", overlay=true)'}
3. Always use the 'ta.' namespace for technical indicators (ta.sma, ta.ema, ta.rsi, ta.macd, ta.crossover, ta.crossunder, ta.atr, ta.bb).
4. Use 'input.int()', 'input.float()', 'input.string()', 'input.bool()' for all customizable user inputs with minval/maxval.
5. In strategies, calculate proper risk management (ATR-based trailing stop-loss, take-profit levels with strategy.exit).
6. Ensure no undeclared variables, correct reassignments with ':=', and valid color declarations (color.new(color.green, 20)).
7. Return ONLY the complete, copy-paste ready Pine Script code inside a markdown code block (\`\`\`pinescript).`;

  log(`[1/2] Querying ${provider.toUpperCase()} with Pine Script v6 syntax constraints...`);
  const raw = await callExtensionTool("ask", {
    provider,
    prompt: systemPrompt,
    timeoutMs: 180000
  }, 185000);

  let text = "";
  if (typeof raw === "string") {
    try { text = JSON.parse(raw).text || raw; } catch { text = raw; }
  } else if (raw?.text) {
    text = raw.text;
  }
  if (!text) throw new Error(`Pine generation failed: ${(raw && typeof raw === "object" && raw.error) || "empty response from provider"}`);

  // Extract pinescript code block
  const match = text.match(/```(?:pinescript|pine)?([\s\S]*?)```/i);
  const pineCode = match && match[1] ? match[1].trim() : text.trim();

  log(`[2/2] Pine Script generated (${pineCode.split("\n").length} lines).\n`);
  return pineCode;
}
