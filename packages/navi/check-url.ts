import { GEMINI_SCOPES } from "./src/provider/gemini-cli.ts"
import * as crypto from "crypto"

function generatePKCE() {
    const verifier = crypto.randomBytes(32).toString("base64url")
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url")
    return { verifier, challenge }
}

function encodeState(state: any): string {
    return Buffer.from(JSON.stringify(state)).toString("base64url")
}

const url = new URL("https://accounts.google.com/o/oauth2/v2/auth")
url.searchParams.set("client_id", "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com")
url.searchParams.set("response_type", "code")
url.searchParams.set("redirect_uri", "http://127.0.0.1:51122/oauth2callback")
url.searchParams.set("scope", GEMINI_SCOPES.join(" "))
const pkce = generatePKCE()
url.searchParams.set("code_challenge", pkce.challenge)
url.searchParams.set("code_challenge_method", "S256")
url.searchParams.set("state", encodeState({ verifier: pkce.verifier, projectId: "" }))
url.searchParams.set("access_type", "offline")
url.searchParams.set("prompt", "consent")
console.log(url.toString())
