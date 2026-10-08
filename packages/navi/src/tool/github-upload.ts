import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { InstanceState } from "@/effect/instance-state"
import * as Log from "@navi-ai/core/util/log"
import { parseGitHubRemote } from "@/util/repository"
import fs from "fs"
import path from "path"
import DESCRIPTION from "./github-upload.txt"

const log = Log.create({ service: "tool.github-upload" })

export const Parameters = Schema.Struct({
  path: Schema.String.annotate({
    description: "Relative or absolute path to the local image or video file to upload",
  }),
  repository: Schema.optional(Schema.String).annotate({
    description: "Target repository formatted as 'owner/repo' (defaults to origin remote or GITHUB_REPOSITORY)",
  }),
  altText: Schema.optional(Schema.String).annotate({
    description: "Optional alt text for markdown embed (defaults to filename)",
  }),
})

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
}

function parseOwnerAndRepo(input?: string): { owner: string; repo: string } | null {
  if (!input) return null
  const parsed = parseGitHubRemote(input)
  if (parsed) return parsed

  const cleaned = input.trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "")
  const parts = cleaned.split("/").filter(Boolean)
  if (parts.length === 2 && parts[0] && parts[1]) {
    return { owner: parts[0], repo: parts[1] }
  }
  return null
}

export const GithubUploadTool = Tool.define(
  "github_upload",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context

          const filePath = path.isAbsolute(params.path) ? params.path : path.resolve(instance.directory, params.path)

          yield* ctx.ask({
            permission: "github_upload",
            patterns: [params.path],
            always: ["*"],
            metadata: { path: filePath },
          })

          if (!fs.existsSync(filePath)) {
            return {
              title: "GitHub Asset Upload Failed",
              output: `❌ File not found: ${filePath}`,
              metadata: { error: "file_not_found" } as Record<string, unknown>,
            }
          }

          const ext = path.extname(filePath).toLowerCase()
          const contentType = MIME_MAP[ext] || "application/octet-stream"
          const fileName = path.basename(filePath)
          const alt = params.altText || fileName

          // Get token
          const token =
            process.env["GITHUB_TOKEN"] ||
            process.env["GH_TOKEN"] ||
            process.env["GITHUB_PAT"] ||
            ""

          if (!token) {
            return {
              title: "GitHub Asset Upload Failed",
              output: "❌ No GitHub token found in GITHUB_TOKEN or GH_TOKEN environment variables.",
              metadata: { error: "missing_token" } as Record<string, unknown>,
            }
          }

          // Resolve owner & repo
          let owner = ""
          let repo = ""

          const fromParam = parseOwnerAndRepo(params.repository)
          if (fromParam) {
            owner = fromParam.owner
            repo = fromParam.repo
          } else {
            try {
              const proc = Bun.spawnSync(["git", "remote", "get-url", "origin"], {
                cwd: instance.worktree,
              })
              if (proc.exitCode === 0 && proc.stdout) {
                const remoteUrl = proc.stdout.toString().trim()
                const fromRemote = parseOwnerAndRepo(remoteUrl)
                if (fromRemote) {
                  owner = fromRemote.owner
                  repo = fromRemote.repo
                }
              }
            } catch {
              // fallback to env
            }

            if (!owner || !repo) {
              const fromEnv = parseOwnerAndRepo(process.env["GITHUB_REPOSITORY"])
              if (fromEnv) {
                owner = fromEnv.owner
                repo = fromEnv.repo
              }
            }
          }

          if (!owner || !repo) {
            return {
              title: "GitHub Asset Upload Failed",
              output: "❌ Could not determine GitHub repository. Specify 'repository' parameter or ensure git remote 'origin' exists.",
              metadata: { error: "missing_repository" } as Record<string, unknown>,
            }
          }

          // 1. Get repository ID via GitHub API
          const repoRes = yield* Effect.promise(() =>
            fetch(`https://api.github.com/repos/${owner}/${repo}`, {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "User-Agent": "Navi-Agent",
              },
            }),
          )

          if (!repoRes.ok) {
            return {
              title: "GitHub Asset Upload Failed",
              output: `❌ Failed to fetch repository ${owner}/${repo} info (${repoRes.status}): ${repoRes.statusText}`,
              metadata: { error: "repo_fetch_failed" } as Record<string, unknown>,
            }
          }

          const repoInfo = (yield* Effect.promise(() => repoRes.json())) as { id: number }
          const repoId = repoInfo.id

          // 2. Upload binary payload to uploads.github.com/user-attachments/assets
          const fileBuffer = fs.readFileSync(filePath)
          const uploadUrl = `https://uploads.github.com/user-attachments/assets?name=${encodeURIComponent(fileName)}&content_type=${encodeURIComponent(contentType)}&repository_id=${repoId}`

          const uploadRes = yield* Effect.promise(() =>
            fetch(uploadUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
                "Content-Type": contentType,
                "User-Agent": "Navi-Agent",
              },
              body: fileBuffer,
            }),
          )

          if (!uploadRes.ok) {
            const errText = yield* Effect.promise(() => uploadRes.text())
            return {
              title: "GitHub Asset Upload Failed",
              output: `❌ GitHub user-attachments upload failed (${uploadRes.status}): ${errText}`,
              metadata: { error: "upload_failed", status: uploadRes.status } as Record<string, unknown>,
            }
          }

          const uploadData = (yield* Effect.promise(() => uploadRes.json())) as { url: string }
          const assetUrl = uploadData.url

          const isVideo = contentType.startsWith("video/")
          const markdown = isVideo ? assetUrl : `![${alt}](${assetUrl})`

          return {
            title: `Uploaded Asset: ${fileName}`,
            output: [
              `✓ Successfully uploaded asset to GitHub CDN:`,
              `- **URL**: ${assetUrl}`,
              `- **Markdown**: \`${markdown}\``,
              "",
              "Embedded preview:",
              markdown,
            ].join("\n"),
            metadata: {
              url: assetUrl,
              markdown,
              contentType,
              fileName,
              repo: `${owner}/${repo}`,
            } as Record<string, unknown>,
          }
        }),
    }
  }),
)
