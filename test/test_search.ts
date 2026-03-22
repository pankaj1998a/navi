import { httpSearch } from "./packages/navi/src/tool/http-search.ts"

const query = "latest Python 3.13 features"
console.log(`\nSearching: "${query}"\n`)

const results = await httpSearch(query, 6)
console.log(`Got ${results.length} results:\n`)
results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.title}`)
    console.log(`   ${r.url}`)
    if (r.snippet) console.log(`   ${r.snippet.slice(0, 100)}`)
    console.log()
})
