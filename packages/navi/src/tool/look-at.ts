import z from "zod"
import { Tool } from "./tool"
import { pathToFileURL } from "url"
import path from "path"
import { Session } from "../session"
import { SessionPrompt } from "../session/prompt"
import { Instance } from "../project/instance"
import { extname } from "path"

const LOOK_AT_DESCRIPTION = `Analyze media files (PDFs, images, diagrams) that require interpretation beyond raw text. 
Extracts specific information or summaries from documents, describes visual content. 
Use when you need analyzed/extracted data rather than literal file contents.`

function inferMimeType(filePath: string): string {
    const ext = extname(filePath).toLowerCase()
    const mimeTypes: Record<string, string> = {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".heic": "image/heic",
        ".heif": "image/heif",
        ".mp4": "video/mp4",
        ".mpeg": "video/mpeg",
        ".mpg": "video/mpeg",
        ".mov": "video/mov",
        ".avi": "video/avi",
        ".flv": "video/x-flv",
        ".webm": "video/webm",
        ".wmv": "video/wmv",
        ".3gpp": "video/3gpp",
        ".3gp": "video/3gpp",
        ".wav": "audio/wav",
        ".mp3": "audio/mp3",
        ".aiff": "audio/aiff",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".flac": "audio/flac",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".md": "text/md",
        ".html": "text/html",
        ".json": "application/json",
        ".xml": "application/xml",
        ".js": "text/javascript",
        ".py": "text/x-python",
    }
    return mimeTypes[ext] || "application/octet-stream"
}

export const LookAtTool = Tool.define("look_at", {
    description: LOOK_AT_DESCRIPTION,
    parameters: z.object({
        file_path: z.string().describe("Absolute or relative path to the file to analyze"),
        goal: z.string().describe("What specific information to extract from the file"),
    }),
    execute: async (args, ctx) => {
        const filePath = path.isAbsolute(args.file_path) ? args.file_path : path.resolve(Instance.directory ?? process.cwd(), args.file_path)
        const mimeType = inferMimeType(filePath)
        const filename = path.basename(filePath)

        const prompt = `Analyze this file and extract the requested information.

Goal: ${args.goal}

Provide ONLY the extracted information that matches the goal.
Be thorough on what was requested, concise on everything else.
If the requested information is not found, clearly state what is missing.`

        // Create a sub-session for analysis
        const subSession = await Session.create({
            parentID: ctx.sessionID,
            title: `look_at: ${args.goal.substring(0, 50)}`,
        })

        // Send the prompt with the file to the multimodal agent
        const result = await SessionPrompt.prompt({
            sessionID: subSession.id,
            agent: "multimodal",
            parts: [
                { type: "text", text: prompt },
                {
                    type: "file",
                    mime: mimeType,
                    url: pathToFileURL(filePath).href,
                    filename,
                },
            ],
        })

        // Extract the text response from the assistant message
        const responseText = result.parts
            .filter((p) => p.type === "text")
            .map((p) => (p as any).text)
            .join("\n")

        return {
            title: `Analyzed ${filename}`,
            output: responseText || "No response from multimodal agent",
            metadata: { subSessionID: subSession.id },
        }
    },
})


