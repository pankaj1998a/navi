import fs from "fs"

const pathStr = "C:/Users/X380 Yoga/.local/share/navi/auth.json"
if (fs.existsSync(pathStr)) {
    const content = fs.readFileSync(pathStr, "utf-8")
    const json = JSON.parse(content)
    console.log("Has roocode?", !!json.roocode)
} else {
    console.log("Not found:", pathStr)
}
