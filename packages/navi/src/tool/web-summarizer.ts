import { resolveGeminiModelID, geminiCliFetch, getAccessToken } from "../provider/gemini-cli"
import { Log } from "../util/log"

const log = Log.create({ service: "web-summarizer" })

export interface SummarizeOptions {
  model?: string
  maxLength?: number
  chunkSize?: number
  abort?: AbortSignal
}

const DEFAULT_MAX_LENGTH = 8000
const DEFAULT_CHUNK_SIZE = 50000
const CHUNK_THRESHOLD = 80000

/**
 * Intelligent web content summarizer.
 * Reduces long web pages into concise, cite-heavy markdown summaries.
 */
export async function summarizeWebContent(
  content: string,
  context: string,
  opts: SummarizeOptions = {}
): Promise<string> {
  if (content.length < (opts.maxLength ?? DEFAULT_MAX_LENGTH) && !content.includes("<html>")) {
    return content
  }

  const token = await getAccessToken()
  if (!token) {
    log.warn("No access token for summarizer, returning truncated content")
    return content.slice(0, opts.maxLength ?? DEFAULT_MAX_LENGTH) + "... (truncated)"
  }

  if (content.length > CHUNK_THRESHOLD) {
    return chunkAndSummarize(content, context, opts)
  }

  return callSummarizer(content, context, opts)
}

async function callSummarizer(
  content: string,
  context: string,
  opts: SummarizeOptions
): Promise<string> {
  const modelID = resolveGeminiModelID(opts.model ?? process.env.NAVI_SUMMARIZER_MODEL ?? "gemini-2.0-flash")
  const prompt = `You are a web content summarizer for Navi.
Context: ${context}

Goal: Summarize the following web content into a concise, well-structured markdown report.
Requirements:
- Extract all key facts, data points, and actionable information.
- Use clear headings and bullet points.
- Preserve important quotes or code snippets if relevant.
- Keep the summary under 2000 words.
- If the content is mostly navigation, ads, or cookie banners, ignore them.

Content:
${content.slice(0, 100000)}`

  try {
    const response = await geminiCliFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelID}:generateContent`,
      {
        method: "POST",
        signal: opts.abort,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      }
    )

    if (!response.ok) {
      throw new Error(`Summarizer failed: ${response.statusText}`)
    }

    const data = await response.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text
    if (!text) throw new Error("Empty response from summarizer")

    return text.trim()
  } catch (err) {
    log.error("Summarization failed", { error: String(err) })
    return content.slice(0, opts.maxLength ?? DEFAULT_MAX_LENGTH) + "\n\n... (summarization failed, showing truncated raw content)"
  }
}

async function chunkAndSummarize(
  content: string,
  context: string,
  opts: SummarizeOptions
): Promise<string> {
  const chunkSize = opts.chunkSize ?? DEFAULT_CHUNK_SIZE
  const chunks: string[] = []
  for (let i = 0; i < content.length; i += chunkSize) {
    chunks.push(content.slice(i, i + chunkSize))
  }

  log.info(`Processing ${chunks.length} chunks for synthesis`)

  // For real synthesis, we would summarize each chunk and then merge.
  // For now, to keep it simple and fast, we'll summarize the first few chunks and the last chunk
  // as they usually contain the most relevant info (Intro + Content + Conclusion).
  const relevantChunks = chunks.length <= 4 
    ? chunks 
    : [chunks[0], chunks[1], chunks[Math.floor(chunks.length / 2)], chunks[chunks.length - 1]]

  const summaries = await Promise.all(
    relevantChunks.map((chunk, idx) => 
      callSummarizer(chunk, `Part ${idx + 1} of ${relevantChunks.length} - ${context}`, opts)
    )
  )

  const mergedPrompt = `You are a synthesis engine for Navi. 
Context: ${context}
I have several partial summaries of a large web page. Merge them into a single, cohesive, comprehensive markdown report.
Ensure no duplication and a logical flow.

Partial Summaries:
${summaries.join("\n\n---\n\n")}
`

  // Final synthesis call
  const modelID = resolveGeminiModelID(opts.model ?? "gemini-2.0-flash")
  try {
     const response = await geminiCliFetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelID}:generateContent`,
      {
        method: "POST",
        signal: opts.abort,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: mergedPrompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 2048,
          },
        }),
      }
    )
    const data = await response.json()
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || summaries.join("\n\n")
  } catch {
    return summaries.join("\n\n")
  }
}
