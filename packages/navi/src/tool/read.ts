import z from "zod"
import * as fs from "fs"
import * as path from "path"
import { Tool } from "./tool"
import { readFileCore } from "@navi-ai/native"
import { LSP } from "../lsp"
import { FileTime } from "../file/time"
import DESCRIPTION from "./read.txt"
import { Instance } from "../project/instance"
import { Identifier } from "../id/id"
import { assertExternalDirectory } from "./external-directory"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_BYTES = 50 * 1024

// Token estimation constants for media files (from Gemini CLI)
const IMAGE_TOKEN_ESTIMATE = 3000 // Covers up to 4K resolution
const PDF_TOKEN_ESTIMATE = 25800 // ~100 pages at 258 tokens/page
const AUDIO_TOKEN_ESTIMATE = 128 // Per second of audio
const VIDEO_TOKEN_ESTIMATE = 263 // Per second of video

// MIME type mapping for common extensions
const MIME_TYPES: Record<string, string> = {
  // Images
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".heif": "image/heif",
  // Audio
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".aiff": "audio/aiff",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  // Video
  ".mp4": "video/mp4",
  ".mpeg": "video/mpeg",
  ".mpg": "video/mpeg",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".flv": "video/x-flv",
  ".webm": "video/webm",
  ".wmv": "video/x-ms-wmv",
  ".3gpp": "video/3gpp",
  ".3gp": "video/3gpp",
  // Documents
  ".pdf": "application/pdf",
}

// Known binary extensions that should not be processed as media
const BINARY_EXTENSIONS = new Set([
  ".zip", ".tar", ".gz", ".exe", ".dll", ".so", ".class", ".jar", ".war", ".7z",
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".odt", ".ods", ".odp",
  ".bin", ".dat", ".obj", ".o", ".a", ".lib", ".wasm", ".pyc", ".pyo",
])

type FileType = "text" | "image" | "pdf" | "audio" | "video" | "binary" | "svg"

/**
 * Detects the type of file based on extension and MIME type.
 * Inspired by Gemini CLI's detectFileType function.
 */
function detectFileType(filepath: string, mimeType: string | null): FileType {
  const ext = path.extname(filepath).toLowerCase()

  // TypeScript files can be misidentified as MPEG video
  if ([".ts", ".mts", ".cts"].includes(ext)) {
    return "text"
  }

  // SVG is text-based, treat separately
  if (ext === ".svg" || mimeType === "image/svg+xml") {
    return "svg"
  }

  // Check MIME type first
  if (mimeType) {
    if (mimeType.startsWith("image/")) return "image"
    if (mimeType.startsWith("audio/")) return "audio"
    if (mimeType.startsWith("video/")) return "video"
    if (mimeType === "application/pdf") return "pdf"
  }

  // Check known binary extensions
  if (BINARY_EXTENSIONS.has(ext)) {
    return "binary"
  }

  // Check known media extensions
  if (ext in MIME_TYPES) {
    const mime = MIME_TYPES[ext]
    if (mime.startsWith("image/")) return "image"
    if (mime.startsWith("audio/")) return "audio"
    if (mime.startsWith("video/")) return "video"
    if (mime === "application/pdf") return "pdf"
  }

  return "text"
}

function getMimeType(filepath: string): string {
  const ext = path.extname(filepath).toLowerCase()
  return MIME_TYPES[ext] || "application/octet-stream"
}

/**
 * Estimate tokens for media files based on type and size.
 * Uses heuristics from Gemini CLI.
 */
function estimateMediaTokens(fileType: FileType, fileSize: number): number {
  switch (fileType) {
    case "image":
      return IMAGE_TOKEN_ESTIMATE
    case "pdf":
      return PDF_TOKEN_ESTIMATE
    case "audio":
      // Estimate based on file size (rough approximation)
      // ~16KB per second for MP3, ~500KB per minute
      const audioDurationSeconds = Math.ceil(fileSize / 16000)
      return audioDurationSeconds * AUDIO_TOKEN_ESTIMATE
    case "video":
      // Estimate based on file size (rough approximation)
      // ~500KB per second for typical video
      const videoDurationSeconds = Math.ceil(fileSize / 500000)
      return videoDurationSeconds * VIDEO_TOKEN_ESTIMATE
    default:
      return 0
  }
}

export const ReadTool = Tool.define("read", {
  description: DESCRIPTION,
  parameters: z.object({
    filePath: z.string().describe("The path to the file to read"),
    offset: z.coerce.number().describe("The line number to start reading from (0-based)").optional(),
    limit: z.coerce.number().describe("The number of lines to read (defaults to 2000)").optional(),
  }),
  async execute(params, ctx) {
    let filepath = params.filePath
    if (!path.isAbsolute(filepath)) {
      filepath = path.join(process.cwd(), filepath)
    }
    const title = path.relative(Instance.worktree, filepath)

    await assertExternalDirectory(ctx, filepath, {
      bypass: Boolean(ctx.extra?.["bypassCwdCheck"]),
    })

    // Feature 1: Engineering & Security Rigor (Credential Protection)
    // Strictly guard sensitive files to prevent credential leakage
    const isSensitive = filepath.includes('.env') || filepath.includes('credentials') || filepath.includes('secret')
    if (isSensitive) {
      await ctx.ask({
        permission: "read_sensitive",
        patterns: [filepath],
        always: [], // Force explicit approval every time for sensitive files
        metadata: { warning: "Attempting to read a sensitive credential file." },
      })
    } else {
      await ctx.ask({
        permission: "read",
        patterns: [filepath],
        always: ["*"],
        metadata: {},
      })
    }

    const file = Bun.file(filepath)
    if (!(await file.exists())) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)

      let suggestions: string[] = []
      try {
        const dirEntries = fs.readdirSync(dir)
        suggestions = dirEntries
          .filter(
            (entry) =>
              entry.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(entry.toLowerCase()),
          )
          .map((entry) => path.join(dir, entry))
          .slice(0, 3)
      } catch (e) {
        // Ignore error if directory doesn't exist
      }

      if (suggestions.length > 0) {
        throw new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${suggestions.join("\n")}`)
      }

      throw new Error(`File not found: ${filepath}`)
    }

    // Detect file type using improved detection
    const fileType = detectFileType(filepath, file.type)
    const mimeType = file.type || getMimeType(filepath)

    // Handle media files (images, PDFs, audio, video)
    if (fileType === "image" || fileType === "pdf" || fileType === "audio" || fileType === "video") {
      const base64Data = Buffer.from(await file.bytes()).toString("base64")
      const typeLabel = fileType.charAt(0).toUpperCase() + fileType.slice(1)
      const stat = await file.stat()
      const estimatedTokens = estimateMediaTokens(fileType, stat.size)
      const msg = `${typeLabel} file read successfully (${mimeType}, ~${estimatedTokens} tokens)`

      return {
        title,
        output: msg,
        metadata: {
          preview: msg,
          truncated: false,
          fileType: fileType as "image" | "pdf" | "audio" | "video",
          mimeType,
          estimatedTokens,
        },
        attachments: [
          {
            id: Identifier.ascending("part"),
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            type: "file",
            mime: mimeType,
            url: `data:${mimeType};base64,${base64Data}`,
          },
        ],
      }
    }

    // Handle SVG as text
    if (fileType === "svg") {
      const content = await file.text()
      return {
        title,
        output: `<file>\n${content}\n</file>`,
        metadata: {
          preview: content.slice(0, 500),
          truncated: content.length > 500,
        } as any,
      }
    }

    const isBinary = await isBinaryFile(filepath, file)
    if (isBinary) throw new Error(`Cannot read binary file: ${filepath}`)

    const limit = params.limit ?? DEFAULT_READ_LIMIT
    const offset = params.offset || 0

    try {
      // Use native read_file_core for memory efficiency
      // Note: offset in native is 1-based line number, but params.offset is 0-based index
      // So we pass offset + 1
      const content = await readFileCore(filepath, offset + 1, limit)

      let output = "<file>\n"
      output += content
      output += "\n</file>"

      // Extract preview (first 20 lines)
      const lines = content.split("\n")
      const preview = lines.slice(0, 20).join("\n")
      const truncated = lines.length >= limit

      // just warms the lsp client
      LSP.touchFile(filepath, false)
      FileTime.read(ctx.sessionID, filepath)

      return {
        title,
        output,
        metadata: {
          preview,
          truncated,
        } as any,
      }
    } catch (e) {
      throw new Error(`read failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  },
})

async function isBinaryFile(filepath: string, file: Bun.BunFile): Promise<boolean> {
  const ext = path.extname(filepath).toLowerCase()
  // binary check for common non-text extensions
  if (BINARY_EXTENSIONS.has(ext)) {
    return true
  }

  const stat = await file.stat()
  const fileSize = stat.size
  if (fileSize === 0) return false

  const bufferSize = Math.min(4096, fileSize)
  const buffer = await file.arrayBuffer()
  if (buffer.byteLength === 0) return false
  const bytes = new Uint8Array(buffer.slice(0, bufferSize))

  let nonPrintableCount = 0
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) return true
    if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
      nonPrintableCount++
    }
  }
  // If >30% non-printable characters, consider it binary
  return nonPrintableCount / bytes.length > 0.3
}
