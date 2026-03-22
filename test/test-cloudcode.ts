import { OAuth2Client } from "google-auth-library"
import { Auth } from "./packages/navi/src/auth/index.js"

const GEMINI_CLIENT_ID = "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com"
const GEMINI_CLIENT_SECRET = "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"

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com"
const CODE_ASSIST_API_VERSION = "v1internal"

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

    // 2. Identify Project
    console.log("Loading Code Assist Project Id...")
    const resProject = await fetch(`${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:loadCodeAssist`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            cloudaicompanionProject: undefined,
            metadata: {
                ideType: "IDE_UNSPECIFIED",
                platform: "PLATFORM_UNSPECIFIED",
                pluginType: "GEMINI",
                duetProject: undefined,
            },
        }),
    })
    const projectData = await resProject.json()
    console.log("Project:", projectData.cloudaicompanionProject)
    const projectId = projectData.cloudaicompanionProject

    // Try a few variations of 'generateContent' to see why 404
    const models = [
        "gemini-3.1-pro-preview",
        "models/gemini-3.1-pro-preview",
        "gemini-2.5-pro",
        "models/gemini-2.5-pro"
    ]

    for (const model of models) {
        console.log(`\nTesting with model: ${model}`)
        const codeAssistBody = {
            model: model,
            project: projectId,
            user_prompt_id: "navi-" + Date.now(),
            request: {
                contents: [
                    { role: "user", parts: [{ text: "Hello, testing direct fetch!" }] }
                ]
            }
        }

        const endpoint = `${CODE_ASSIST_ENDPOINT}/${CODE_ASSIST_API_VERSION}:streamGenerateContent?alt=sse`
        console.log(`POST ${endpoint} ...`)

        const res = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(codeAssistBody),
        })

        console.log("Status:", res.status)
        const text = await res.text()
        console.log("Response starts with:", text.substring(0, 150))
    }
}

main().catch(console.error)
