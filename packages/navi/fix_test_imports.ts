import { glob } from "glob"
import fs from "fs/promises"

async function main() {
  const files = await glob("test/*.ts")
  for (const file of files) {
    const content = await fs.readFile(file, "utf8")
    const replaced = content.replace(/"\.\/src\//g, '"../src/')
    if (content !== replaced) {
      console.log(`Fixing imports in ${file}`)
      await fs.writeFile(file, replaced)
    }
  }
}

main().catch(console.error)
