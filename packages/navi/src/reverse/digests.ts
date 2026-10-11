import { createHash } from "node:crypto"

export const sha256Hex = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex").slice(0, 16)

export * as ReverseDigests from "./digests"
