import { OAuth2Client } from "google-auth-library"
import { Auth } from "./packages/navi/src/auth/index.js"

const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const GEMINI_CLIENT_SECRET = "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"

async function main() {
    const auth = await Auth.get("gemini-cli")
    if (!auth || auth.type !== "oauth") throw new Error("not authenticated")

    // 1. Get token
    const client = new OAuth2Client({
        clientId: GEMINI_CLIENT_ID,
        clientSecret: GEMINI_CLIENT_SECRET,
    })
    client.setCredentials({ refresh_token: auth.refresh })
    const { token } = await client.getAccessToken()

    if (!token) throw new Error("No token")

    console.log(token)
}

main().catch(console.error)
