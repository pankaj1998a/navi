import { expect, test } from "bun:test"
import { formatNaviResponseText, parseNaviResponse } from "../../src/session/response"

test("parseNaviResponse parses asking responses with structured options", () => {
  const result = parseNaviResponse(`
\`\`\`json
{
  "status": "asking",
  "question": {
    "text": "Which provider should I use?",
    "options": [
      { "label": "OpenAI", "value": "openai" },
      { "label": "Anthropic", "value": "anthropic" }
    ],
    "required": true
  }
}
\`\`\`
`)

  expect(result.status).toBe("asking")
  expect(result.question?.options?.length).toBe(2)
  expect(result.question?.text).toBe("Which provider should I use?")
})

test("parseNaviResponse falls back to plain text for non-json answers", () => {
  const result = parseNaviResponse("Implemented the change and updated the tests.")
  expect(result.status).toBe("done")
  expect(result.answer).toBe("Implemented the change and updated the tests.")
})

test("formatNaviResponseText normalizes asking responses for chat display", () => {
  const response = parseNaviResponse(`
\`\`\`json
{
  "status": "asking",
  "question": {
    "text": "Which provider should I use?",
    "options": [
      { "label": "OpenAI", "description": "Best tool support" },
      { "label": "Anthropic", "description": "Strong reasoning" }
    ],
    "required": true
  }
}
\`\`\`
`)

  expect(formatNaviResponseText(response)).toBe("Question: Which provider should I use? (OpenAI, Anthropic)")
})
