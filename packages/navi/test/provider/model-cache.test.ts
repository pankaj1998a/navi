import { expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Global } from "../../src/global"
import { tmpdir } from "../fixture/fixture"
import { loadCachedModels, readCache, stampCatalog, writeCache } from "../../src/provider/model-cache"

const SAMPLE_MODEL = {
  id: "gpt-4.1",
  providerID: "openai",
  name: "GPT-4.1",
  api: {
    id: "gpt-4.1",
    url: "https://api.openai.com/v1",
    npm: "@ai-sdk/openai",
  },
  capabilities: {
    temperature: true,
    reasoning: false,
    attachment: true,
    toolcall: true,
    input: { text: true, audio: false, image: true, video: false, pdf: false },
    output: { text: true, audio: false, image: false, video: false, pdf: false },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  },
  limit: {
    context: 128000,
    output: 16384,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: new Date().toISOString(),
  isFree: true,
  variants: {},
} as any

test("reads stale cache as fallback after expiry", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providerID = "openai"
      const cachePath = path.join(Global.Path.cache, "provider-models", `${providerID}.json`)

      await writeCache(providerID, {
        "gpt-4.1": stampCatalog(
          {
            "gpt-4.1": SAMPLE_MODEL,
          },
          {
            providerID,
            source: "fetch",
            fetchedAt: new Date().toISOString(),
          },
        )["gpt-4.1"],
      })

      const file = Bun.file(cachePath)
      const entry = (await file.json()) as any
      entry.fetchedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      await Bun.write(cachePath, JSON.stringify(entry, null, 2))

      expect(await readCache(providerID)).toBeUndefined()

      const stale = await readCache(providerID, { allowExpired: true })
      expect(stale?.["gpt-4.1"]).toBeDefined()
      expect(stale?.["gpt-4.1"].catalog?.source).toBe("fetch")

      const loaded = await loadCachedModels(providerID)
      expect(loaded.stale).toBe(true)
      expect(loaded.models["gpt-4.1"]).toBeDefined()
      expect(loaded.models["gpt-4.1"].catalog?.source).toBe("stale-cache")
    },
  })
})
