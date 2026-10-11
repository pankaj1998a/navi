import fs from "fs"
import path from "path"
import crypto from "crypto"
import { execFileSync } from "child_process"
import { Global } from "@navi-ai/core/global"
import * as Log from "@navi-ai/core/util/log"

const log = Log.create({ service: "file-security" })

const ENC_PREFIX = "enc:v1:"
let cachedKey: Buffer | undefined

/**
 * Enforces strict filesystem ACLs restricting access exclusively to the current owner.
 * On Windows, sets NTFS ACL inheritance removal and grants Full Control only to the active user.
 * On POSIX systems, applies 0o600 (owner read/write only).
 */
export function protectFilePermissions(filePath: string): void {
  try {
    if (!fs.existsSync(filePath)) return

    if (process.platform === "win32") {
      const username = process.env.USERNAME || process.env.USER || "Administrators"
      execFileSync(
        "icacls",
        [filePath, "/inheritance:r", "/grant:r", `${username}:(F)`],
        { stdio: "ignore", windowsHide: true },
      )
    } else {
      fs.chmodSync(filePath, 0o600)
    }
  } catch (err) {
    log.warn("failed to enforce file access controls", { path: filePath, error: String(err) })
  }
}

/**
 * Retrieves or initializes the 256-bit AES master key used for at-rest secret encryption.
 * The key is stored in a dedicated, ACL-hardened file in the user data directory.
 */
function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey

  if (process.env.NAVI_MASTER_KEY) {
    const raw = process.env.NAVI_MASTER_KEY.trim()
    cachedKey = raw.length === 64 ? Buffer.from(raw, "hex") : crypto.createHash("sha256").update(raw).digest()
    return cachedKey
  }

  const keyPath = path.join(Global.Path.data, ".navi.key")
  try {
    if (fs.existsSync(keyPath)) {
      const content = fs.readFileSync(keyPath)
      if (content.length === 32) {
        cachedKey = content
        return cachedKey
      }
    }

    // Generate fresh 256-bit key
    const fresh = crypto.randomBytes(32)
    fs.mkdirSync(path.dirname(keyPath), { recursive: true })
    fs.writeFileSync(keyPath, fresh, { mode: 0o600 })
    protectFilePermissions(keyPath)
    cachedKey = fresh
    return cachedKey
  } catch (err) {
    log.error("failed to persist or load master key, falling back to ephemeral key", { error: String(err) })
    cachedKey = crypto.randomBytes(32)
    return cachedKey
  }
}

/**
 * Encrypts a plaintext secret using AES-256-GCM.
 * Formats output as: enc:v1:<iv_hex>:<tag_hex>:<cipher_hex>
 */
export function encryptSecret(plaintext: string): string {
  if (!plaintext || plaintext.startsWith(ENC_PREFIX)) {
    return plaintext
  }

  const key = getMasterKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${ENC_PREFIX}${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`
}

/**
 * Decrypts a ciphertext encrypted with AES-256-GCM.
 * Non-encrypted values (not matching enc:v1:) are returned as-is for backwards compatibility.
 */
export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(ENC_PREFIX)) {
    return value
  }

  const parts = value.slice(ENC_PREFIX.length).split(":")
  if (parts.length !== 3) {
    log.error("malformed encrypted secret format")
    return value
  }

  const [ivHex, tagHex, cipherHex] = parts
  if (!ivHex || !tagHex || !cipherHex) {
    log.error("malformed encrypted secret format")
    return value
  }
  try {
    const key = getMasterKey()
    const iv = Buffer.from(ivHex, "hex")
    const tag = Buffer.from(tagHex, "hex")
    const ciphertext = Buffer.from(cipherHex, "hex")

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)
    decipher.setAuthTag(tag)
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return decrypted.toString("utf8")
  } catch (err) {
    log.error("failed to decrypt secret", { error: String(err) })
    return value
  }
}
