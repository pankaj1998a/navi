import { callExtensionTool } from "./bridge.ts";
import { log } from "./log.ts";

export interface ChartAnalysisResult {
  ok: boolean;
  provider: string;
  analysis?: string;
  error?: string;
  timestamp: string;
}

export async function analyzeActiveChart(provider = "chatgpt", customPrompt?: string): Promise<ChartAnalysisResult> {
  log(`\n======================================================`);
  log(`📈 NAVIBRIDGE CHART VISION ANALYST`);
  log(`Target Multimodal Engine: ${provider.toUpperCase()}`);
  log(`======================================================\n`);

  log("[1/3] Capturing high-resolution viewport screenshot via CDP...");
  const snapRes = await callExtensionTool("screenshot", {}, 20000);
  let dataUrl = "";
  if (snapRes?.dataUrl) {
    dataUrl = snapRes.dataUrl;
  } else if (typeof snapRes === "string") {
    try { dataUrl = JSON.parse(snapRes).dataUrl; } catch {}
  }

  if (!dataUrl || !dataUrl.startsWith("data:image")) {
    return {
      ok: false,
      provider,
      error: "Failed to capture chart screenshot. Make sure your chart tab is open and focused.",
      timestamp: new Date().toISOString()
    };
  }
  log(`[1/3] Screenshot captured (${Math.round(dataUrl.length / 1024)} KB image payload).\n`);

  const prompt = customPrompt || `You are an elite quantitative technical analyst and Smart Money Concepts (SMC) trader.
Analyze this trading chart in detail:
1. Market Structure: (Bullish / Bearish / Consolidating / Range-bound)
2. Critical Price Zones:
   - Key Resistance Levels
   - Key Support Levels
   - Liquidity Sweeps & Invalidation Highs/Lows
3. Smart Money Concepts (SMC):
   - Order Blocks (OB) & Fair Value Gaps (FVG)
   - Break of Structure (BOS) or Change of Character (CHoCH)
4. Momentum & Volume:
   - Volume confirmation / divergence
   - Indicator readings if visible (RSI, Moving Averages, MACD)
5. Actionable Trade Setup:
   - Directional Bias: [LONG / SHORT / NEUTRAL]
   - Optimal Entry Range
   - Strict Stop-Loss (and invalidation level)
   - Take-Profit Targets: TP1 (conservative), TP2 (extended)
   - Estimated Risk-to-Reward Ratio (R:R)
   - Confidence Score: [1 to 10]`;

  log(`[2/3] Sending chart visual to ${provider.toUpperCase()} for multi-timeframe analysis...`);
  const askRes = await callExtensionTool("ask", {
    provider,
    prompt,
    images: [dataUrl],
    timeoutMs: 180000
  }, 185000);

  let text = "";
  if (typeof askRes === "string") {
    try { text = JSON.parse(askRes).text || askRes; } catch { text = askRes; }
  } else if (askRes?.text) {
    text = askRes.text;
  }

  if (!text) {
    return {
      ok: false,
      provider,
      error: askRes?.error || "No response received from vision provider",
      timestamp: new Date().toISOString()
    };
  }

  log(`[3/3] Chart analysis completed (${text.length} characters).\n`);
  return {
    ok: true,
    provider,
    analysis: text,
    timestamp: new Date().toISOString()
  };
}
