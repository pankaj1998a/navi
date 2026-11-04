import { readFileSync, writeFileSync, copyFileSync, renameSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { log } from "./log.ts";

export interface VaultEntry {
  id: string;
  category: "chat" | "council" | "research" | "chart" | "trade_alert";
  title: string;
  content: string;
  metadata?: Record<string, any>;
  timestamp: string;
}

const MAX_ENTRIES = 1000;

/**
 * Where NaviBridge keeps user state. Overridable so tests (and side-by-side
 * installs) never touch the real profile.
 */
export function naviHome(): string {
  return process.env.NAVIBRIDGE_HOME || join(homedir(), ".navibridge");
}

function getVaultPath(): string {
  const dir = naviHome();
  mkdirSync(dir, { recursive: true });
  return join(dir, "vault.json");
}

/**
 * A vault entry is only usable if its string fields really are strings.
 * A hand-edited or partially written vault.json must not be able to crash
 * every downstream consumer.
 */
function isVaultEntry(e: any): e is VaultEntry {
  return !!e
    && typeof e === "object"
    && !Array.isArray(e)
    && typeof e.title === "string"
    && typeof e.content === "string"
    && typeof e.timestamp === "string"
    && typeof e.id === "string";
}

export function loadVault(): VaultEntry[] {
  const file = getVaultPath();
  if (!existsSync(file)) return [];
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("vault.json root is not an array");
    const valid = parsed.filter(isVaultEntry);
    const dropped = parsed.length - valid.length;
    if (dropped > 0) log(`[vault] Dropped ${dropped} malformed entr${dropped === 1 ? "y" : "ies"} from vault.json`);
    return valid;
  } catch (err) {
    const bak = `${file}.${Date.now()}.bak`;
    try {
      if (existsSync(file)) {
        copyFileSync(file, bak);
        console.error(`[vault] Corrupted vault.json backed up to ${bak}: ${String(err)}`);
      }
    } catch {}
    return [];
  }
}

/**
 * Serialises writes. The vault is a single JSON file, so two concurrent
 * read-modify-write cycles would otherwise silently drop one of the entries.
 */
let writeChain: Promise<unknown> = Promise.resolve();

export function saveVaultEntry(entry: Omit<VaultEntry, "id" | "timestamp">): Promise<VaultEntry> {
  const fullEntry: VaultEntry = {
    id: `v_${Date.now()}_${randomUUID().slice(0, 5)}`,
    timestamp: new Date().toISOString(),
    ...entry
  };
  const write = writeChain.then(() => {
    const vault = loadVault();
    vault.unshift(fullEntry);
    const trimmed = vault.slice(0, MAX_ENTRIES);
    const target = getVaultPath();
    const tmp = `${target}.${randomUUID()}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(trimmed, null, 2), "utf8");
      renameSync(tmp, target);
    } catch (err) {
      try { if (existsSync(tmp)) unlinkSync(tmp); } catch {}
      throw err;
    }
    return fullEntry;
  });
  // Keep the chain alive even when this write fails.
  writeChain = write.catch(() => {});
  return write;
}

export function searchVault(query: string, limit = 20): VaultEntry[] {
  const q = query.trim().toLowerCase();
  const vault = loadVault();
  if (!q) return vault.slice(0, limit);
  const words = q.split(/\s+/).filter(Boolean);

  const scored = vault.map((entry) => {
    let score = 0;
    const titleLower = entry.title.toLowerCase();
    const contentLower = entry.content.toLowerCase();

    for (const w of words) {
      if (titleLower.includes(w)) score += 10;
      let count = 0;
      let pos = 0;
      while ((pos = contentLower.indexOf(w, pos)) !== -1) {
        count++;
        pos += w.length;
      }
      score += Math.min(count * 2, 20);
    }
    return { entry, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
