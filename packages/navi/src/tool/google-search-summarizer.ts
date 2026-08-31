import type { SearchResult } from "./search-pipeline"

export async function summarizeWithGoogleAi(
  query: string,
  results: SearchResult[],
  abort: AbortSignal,
): Promise<{ mode: "gemini" | "heuristic"; summary: string }> {
  try {
    const { getAccessToken, geminiCliFetch, resolveGeminiModelID } = await import("../provider/gemini-cli")
    const token = await getAccessToken()
    if (!token) {
      return { mode: "heuristic", summary: summarizeResults(results) }
    }

    const model = resolveGeminiModelID(process.env.NAVI_GOOGLE_AI_MODEL ?? "gemini-2.0-flash")
    const prompt = buildGoogleAiPrompt(query, results)
    const response = await geminiCliFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal: abort,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 900,
          },
        }),
      },
    )

    if (!response.ok) {
      return { mode: "heuristic", summary: summarizeResults(results) }
    }

    const data = (await response.json()) as any
    const text = extractGeminiText(data)
    if (!text) {
      return { mode: "heuristic", summary: summarizeResults(results) }
    }

    return { mode: "gemini", summary: text.trim() }
  } catch (e) {
    // Fall back to heuristic summary generation on error
    return { mode: "heuristic", summary: summarizeResults(results) }
  }
}

function buildGoogleAiPrompt(query: string, results: SearchResult[]): string {
  const sources = results
    .map((result, index) => {
      const snippet = result.snippet?.trim() ? `Snippet: ${result.snippet.trim()}` : "Snippet: none"
      return `[${index + 1}] ${result.title}\nURL: ${result.url}\n${snippet}`
    })
    .join("\n\n")

  return [
    "You are Google AI Search inside Navi.",
    "Synthesize the search results into a concise factual overview.",
    "Requirements:",
    "- Use only the supplied search results.",
    "- Keep it under 8 bullets or short paragraphs.",
    "- Cite sources inline like [1], [2].",
    "- Call out disagreement or uncertainty explicitly.",
    `Query: ${query}`,
    "",
    "Search results:",
    sources,
  ].join("\n")
}

function extractGeminiText(data: any): string {
  const candidate = data?.candidates?.[0]
  const parts = candidate?.content?.parts
  if (!Array.isArray(parts)) return ""
  return parts
    .map((part: any) => (typeof part?.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n")
}

function summarizeResults(results: SearchResult[]): string {
  const bullets = results.slice(0, 5).map((result, index) => {
    const detail = result.snippet?.trim() ? `: ${result.snippet.trim()}` : ""
    return `${index + 1}. ${result.title}${detail} [${index + 1}]`
  })

  return bullets.join("\n")
}
