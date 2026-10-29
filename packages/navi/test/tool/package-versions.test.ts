import { describe, expect, it } from "bun:test"
import { Effect, Schema } from "effect"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { compareVersions, extractLatest, isPrereleaseVersion, parseManifest, parsePackageRef, Parameters } from "@/tool/package-versions"

const FIXTURE_PACKAGE_JSON = `{
  "name": "fixture-app",
  "version": "1.0.0",
  "dependencies": { "react": "^16.8.0" },
  "devDependencies": { "typescript": "~5.2.2" }
}`

const FIXTURE_REQUIREMENTS = `# pinned and unpinned deps
requests[security]==2.28.0
flask>=2.0
celery
-r other-requirements.txt
`

const FIXTURE_CARGO_TOML = `[package]
name = "fixture-app"
version = "0.1.0"

[dependencies]
serde = "1.0"
tokio = { version = "1.35", features = ["full"] }
inherited = { workspace = true }

[dev-dependencies]
criterion = "0.5"
`

const decode = (input: unknown) => Effect.runPromiseExit(Schema.decodeUnknownEffect(Parameters)(input))

describe("package_versions tool", () => {
  describe("parameter decoding", () => {
    it("rejects an unknown ecosystem literal", async () => {
      const result = await decode({ ecosystem: "gophers" })
      expect(result._tag).toBe("Failure")
    })

    it("accepts an empty input and defaults ecosystem to npm", async () => {
      const result = await decode({})
      expect(result._tag).toBe("Success")
      if (result._tag === "Success") {
        expect(result.value.ecosystem).toBe("npm")
        expect(result.value.includePrerelease).toBe(false)
      }
    })

    it("accepts explicit packages and includePrerelease", async () => {
      const result = await decode({ packages: ["npm:react", "pypi:requests"], includePrerelease: true })
      expect(result._tag).toBe("Success")
    })
  })

  describe("package reference parsing", () => {
    it("splits registry:name refs", () => {
      expect(parsePackageRef("npm:react", "npm")).toEqual({ registry: "npm", name: "react" })
      expect(parsePackageRef("maven:org.apache.commons:commons-lang3", "npm")).toEqual({
        registry: "maven",
        name: "org.apache.commons:commons-lang3",
      })
    })

    it("defaults bare names to the ecosystem param", () => {
      expect(parsePackageRef("requests", "pypi")).toEqual({ registry: "pypi", name: "requests" })
      expect(parsePackageRef("serde", "npm")).toEqual({ registry: "npm", name: "serde" })
    })

    it("falls back when the prefix is not a registry", () => {
      expect(parsePackageRef("unknown:thing", "crates")).toEqual({ registry: "crates", name: "unknown:thing" })
    })
  })

  describe("version comparison", () => {
    it("compares equal versions", () => {
      expect(compareVersions("1.2.3", "1.2.3")).toBe(0)
      expect(compareVersions("v2.1.0", "2.1.0")).toBe(0)
    })

    it("compares numerically, not lexically", () => {
      expect(compareVersions("2.0.0", "10.0.0")).toBeLessThan(0)
      expect(compareVersions("1.0.10", "1.0.2")).toBeGreaterThan(0)
    })

    it("sorts pre-releases below their stable version", () => {
      expect(compareVersions("1.0.0-beta.1", "1.0.0")).toBeLessThan(0)
      expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0)
      expect(compareVersions("1.0.0", "1.0.0-rc.1")).toBeGreaterThan(0)
    })

    it("flags dev channel versions as pre-release", () => {
      expect(isPrereleaseVersion("1.0.0")).toBe(false)
      expect(isPrereleaseVersion("1.0.0-rc.1")).toBe(true)
      expect(isPrereleaseVersion("1.2.3-dev")).toBe(true)
    })
  })

  describe("registry response extraction", () => {
    const npmBody = JSON.stringify({
      "dist-tags": { latest: "2.0.0" },
      versions: { "2.0.0": {}, "3.0.0-beta.1": {} },
    })

    it("reads dist-tags.latest from npm and prereleases when asked", () => {
      expect(extractLatest("npm", npmBody, false)).toBe("2.0.0")
      expect(extractLatest("npm", npmBody, true)).toBe("3.0.0-beta.1")
    })

    it("reads crates max_stable_version", () => {
      const body = JSON.stringify({ crate: { max_stable_version: "1.2.0", newest_version: "2.0.0-rc.1" } })
      expect(extractLatest("crates", body, false)).toBe("1.2.0")
      expect(extractLatest("crates", body, true)).toBe("2.0.0-rc.1")
    })

    it("reads pypi info.version", () => {
      expect(extractLatest("pypi", JSON.stringify({ info: { version: "3.11.0" } }), false)).toBe("3.11.0")
    })

    it("throws a per-entry error for empty responses", () => {
      expect(() => extractLatest("npm", "{}", false)).toThrow()
    })
  })

  describe("manifest parsing from temp files", () => {
    it("parses package.json, requirements.txt, and Cargo.toml fixtures", async () => {
      await using tmp = await tmpdir({
        init: async (dir) => {
          await Bun.write(path.join(dir, "package.json"), FIXTURE_PACKAGE_JSON)
          await Bun.write(path.join(dir, "requirements.txt"), FIXTURE_REQUIREMENTS)
          await Bun.write(path.join(dir, "Cargo.toml"), FIXTURE_CARGO_TOML)
          return dir
        },
      })
      const extra = tmp.extra as string

      const pkg = parseManifest("package.json", await Bun.file(path.join(extra, "package.json")).text())
      expect(pkg.ecosystem).toBe("npm")
      expect(pkg.deps).toEqual([
        { name: "react", wanted: "^16.8.0", registry: "npm" },
        { name: "typescript", wanted: "~5.2.2", registry: "npm" },
      ])

      const requirements = parseManifest("requirements.txt", await Bun.file(path.join(extra, "requirements.txt")).text())
      expect(requirements.ecosystem).toBe("pypi")
      expect(requirements.deps).toEqual([
        { name: "requests", wanted: "2.28.0", registry: "pypi" },
        { name: "flask", wanted: undefined, registry: "pypi" },
        { name: "celery", wanted: undefined, registry: "pypi" },
      ])

      const cargo = parseManifest("Cargo.toml", await Bun.file(path.join(extra, "Cargo.toml")).text())
      expect(cargo.ecosystem).toBe("crates")
      expect(cargo.deps).toEqual([
        { name: "serde", wanted: "1.0", registry: "crates" },
        { name: "tokio", wanted: "1.35", registry: "crates" },
        { name: "inherited", wanted: undefined, registry: "crates" },
        { name: "criterion", wanted: "0.5", registry: "crates" },
      ])
    })

    it("rejects unsupported manifest types", () => {
      expect(() => parseManifest("unknown.deps", "")).toThrow("Unsupported manifest type")
    })
  })
})
