import { webSearch } from "./src/tool/browser-engine"

async function testBrowserSearch() {
  console.log("Testing browser search provider...")

  const queries = ["navi ai cli", "javascript tutorial", "weather today"]

  for (const query of queries) {
    console.log(`\n--- Query: "${query}" ---`)
    try {
      const start = Date.now()
      const results = await webSearch(query, 5)
      const elapsed = Date.now() - start
      console.log(`Time: ${elapsed}ms, Results: ${results.length}`)

      for (const r of results) {
        console.log(`  - ${r.title.substring(0, 60)}`)
        console.log(`    URL: ${r.url.substring(0, 80)}`)
        console.log(`    Snippet: ${r.snippet.substring(0, 80)}`)
      }
    } catch (error: any) {
      console.error(`ERROR for "${query}":`, error.message)
    }
  }
}

testBrowserSearch()
