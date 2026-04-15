import { OAuth2Client } from "google-auth-library"
import { Auth } from "./packages/navi/src/auth/index.js"

// OAuth credentials should be set via environment variables:
//   GEMINI_CLIENT_ID
//   GEMINI_CLIENT_SECRET
// Never commit real credentials to source control.

async function main() {
    const clientId = process.env.GEMINI_CLIENT_ID
    const clientSecret = process.env.GEMINI_CLIENT_SECRET

    if (!clientId || !clientSecret) {
        throw new Error(
            "GEMINI_CLIENT_ID and GEMINI_CLIENT_SECRET environment variables are required. " +
            "Set them before running this script."
        )
    }

    const auth = await Auth.get("gemini-cli")
    if (!auth || auth.type !== "oauth") throw new Error("not authenticated")

    // 1. Get token
    const client = new OAuth2Client({
        clientId,
        clientSecret,
    })
    client.setCredentials({ refresh_token: auth.refresh })
    const { token } = await client.getAccessToken()

    if (!token) throw new Error("No token")

    console.log(token)
}

main().catch(console.error)
