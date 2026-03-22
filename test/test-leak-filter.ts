
// Mock of the filtering logic I implemented in index.tsx

function filterTextPart(text: string) {
    const t = text.trim()
    if (t.includes("contextMaxCharacters") ||
        (t.includes('"type": "object"') && t.includes('"properties":'))) {
        return ""
    }
    return t
}

function filterWebSearch(query: any) {
    if (typeof query !== "string") return "Invalid query"
    if (query.includes("contextMaxCharacters") || query.includes('"type": "string"')) {
        return "Web Search"
    }
    return query
}

function filterWebFetch(url: any) {
    if (typeof url !== "string") return ""
    if (url.includes("contextMaxCharacters") || url.includes('"type": "object"')) return "Invalid URL"
    return url
}

function filterCodeSearch(query: any) {
    if (typeof query !== "string") return ""
    if (query.includes("contextMaxCharacters") || query.includes('"type": "object"')) return "Code Search"
    return query
}

// Test Data (Simulated Leak)
const LEAK_SCHEMA = `
{
  "contextMaxCharacters": {
    "type": "number",
    "description": "Maximum characters..."
  },
  "livecrawl": {
    "type": "string",
    "enum": ["fallback", "forced"]
  }
}
`

const LEAK_SCHEMA_ONE_LINE = `{"contextMaxCharacters": 10000, "type": "object"}`

const NORMAL_TEXT = "Here is some code for you."
const NORMAL_URL = "https://google.com"
const NORMAL_QUERY = "how to fix memory leak"

console.log("--- Testing TextPart Filter ---")
console.log("Leak (Multilne):", filterTextPart(LEAK_SCHEMA) === "" ? "PASS" : "FAIL")
console.log("Leak (OneLine):", filterTextPart(LEAK_SCHEMA_ONE_LINE) === "" ? "PASS" : "FAIL")
console.log("Normal:", filterTextPart(NORMAL_TEXT) === NORMAL_TEXT ? "PASS" : "FAIL")

console.log("\n--- Testing WebSearch Filter ---")
console.log("Leak:", filterWebSearch(LEAK_SCHEMA) === "Web Search" ? "PASS" : "FAIL")
console.log("Normal:", filterWebSearch(NORMAL_QUERY) === NORMAL_QUERY ? "PASS" : "FAIL")

console.log("\n--- Testing WebFetch Filter ---")
console.log("Leak:", filterWebFetch(LEAK_SCHEMA) === "Invalid URL" ? "PASS" : "FAIL")
console.log("Normal:", filterWebFetch(NORMAL_URL) === NORMAL_URL ? "PASS" : "FAIL")

console.log("\n--- Testing CodeSearch Filter ---")
console.log("Leak:", filterCodeSearch(LEAK_SCHEMA) === "Code Search" ? "PASS" : "FAIL")
console.log("Normal:", filterCodeSearch(NORMAL_QUERY) === NORMAL_QUERY ? "PASS" : "FAIL")
