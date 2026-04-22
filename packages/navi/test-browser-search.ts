import { webSearch } from "./src/tool/browser-engine"

async function testBrowserSearch() {
  console.log("Testing browser search provider...")
  try {
    const results = await webSearch("navi ai cli", 5)
    console.log("Results:", JSON.stringify(results, null, 2))
    console.log(`Found ${results.length} results`)
    if (results.length > 0) {
      console.log("SUCCESS: Browser search provider returns results!")
      process.exit(0)
    } else {
      console.log("ISSUE: Browser search returned no results")
      process.exit(1)
    }
  } catch (error: any) {
    console.error("ERROR:", error.message)
    process.exit(1)
  }
}

testBrowserSearch()
