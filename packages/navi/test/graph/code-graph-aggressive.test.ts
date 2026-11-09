import { describe, expect, test, afterAll } from "bun:test"
import path from "node:path"
import fs from "node:fs"
import { extractGraph } from "../../src/graph/extract"
import { extractCodeGraphNative } from "../../src/native/native-runner"

describe("Phase 2: Native Rust Parallel Code Graph Engine", () => {
  const testDir = path.join(import.meta.dir, "..", "fixtures", "graph-aggressive-test")

  // Setup test environment
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true })
  }

  afterAll(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {}
  })

  test("native runner extracts code graph via Rayon parallel engine", () => {
    const res = extractCodeGraphNative(testDir)
    expect(res).not.toBeNull()
    expect(Array.isArray(res?.nodes)).toBe(true)
    expect(Array.isArray(res?.edges)).toBe(true)
  })

  describe("False-Positive Defense (Comments & String Masking)", () => {
    const decoyTs = path.join(testDir, "decoy.ts")
    fs.writeFileSync(
      decoyTs,
      `
      /*
      export function decoyInBlockComment() {
        return "fake";
      }
      export class DecoyClassInBlockComment {}
      */

      // export function decoyInLineComment() {}
      // export class DecoyClassInLineComment {}

      const template = \`
        export function decoyInTemplateString() {}
        export class DecoyClassInTemplateString {}
      \`

      const jsonStr = "class DecoyClassInDoubleQuote {}"
      const singleQuoteStr = 'function decoyInSingleQuote() {}'

      export class RealService {
        execute() {
          return true
        }
      }

      export function realOperation() {
        return 42
      }
      `,
      "utf8",
    )

    test("completely ignores decoy symbols inside comments and string literals", () => {
      const graph = extractGraph({ rootDir: testDir })
      const labels = graph.nodes.map((n) => n.label)

      // Verified real symbols
      expect(labels).toContain("RealService")
      expect(labels).toContain("realOperation()")

      // Defended against false positives
      expect(labels).not.toContain("decoyInBlockComment()")
      expect(labels).not.toContain("DecoyClassInBlockComment")
      expect(labels).not.toContain("decoyInLineComment()")
      expect(labels).not.toContain("DecoyClassInLineComment")
      expect(labels).not.toContain("decoyInTemplateString()")
      expect(labels).not.toContain("DecoyClassInTemplateString")
      expect(labels).not.toContain("DecoyClassInDoubleQuote")
      expect(labels).not.toContain("decoyInSingleQuote()")
    })
  })

  describe("Multi-Language AST Extraction", () => {
    const rustFile = path.join(testDir, "engine.rs")
    fs.writeFileSync(
      rustFile,
      `
      use crate::telemetry::Tracker;

      pub struct EngineCore {
          pub id: u64,
      }

      pub enum EngineMode {
          Fast,
          Accurate,
      }

      pub trait Executable {
          fn execute(&self);
      }

      impl Executable for EngineCore {
          fn execute(&self) {}
      }

      pub async fn start_engine() {}
      `,
      "utf8",
    )

    const pyFile = path.join(testDir, "analyzer.py")
    fs.writeFileSync(
      pyFile,
      `
      import os
      from typing import Optional

      class BaseAnalyzer:
          pass

      class SecurityAnalyzer(BaseAnalyzer):
          def scan_vulnerabilities(self):
              pass
      `,
      "utf8",
    )

    const goFile = path.join(testDir, "worker.go")
    fs.writeFileSync(
      goFile,
      `
      package worker
      import "sync"

      type WorkerPool struct {}
      type TaskRunner interface {}

      func DispatchTask() {}
      `,
      "utf8",
    )

    test("extracts Rust, Python, and Go entities and inheritance edges", () => {
      const graph = extractGraph({ rootDir: testDir })
      const labels = graph.nodes.map((n) => n.label)

      // Rust
      expect(labels).toContain("EngineCore")
      expect(labels).toContain("EngineMode")
      expect(labels).toContain("Executable")
      expect(labels).toContain("start_engine()")

      const rustImplEdge = graph.edges.find((e) => e.relation === "implements")
      expect(rustImplEdge).toBeDefined()
      expect(rustImplEdge?.target).toBe("Executable")

      // Python
      expect(labels).toContain("BaseAnalyzer")
      expect(labels).toContain("SecurityAnalyzer")
      expect(labels).toContain("scan_vulnerabilities()")

      const pyExtendsEdge = graph.edges.find(
        (e) => e.relation === "extends" && e.target === "BaseAnalyzer",
      )
      expect(pyExtendsEdge).toBeDefined()

      // Go
      expect(labels).toContain("WorkerPool")
      expect(labels).toContain("TaskRunner")
      expect(labels).toContain("DispatchTask()")
      expect(graph.edges.some((e) => e.target === "sync")).toBe(true)
    })
  })

  describe("Syntax Error Resilience", () => {
    test("survives malformed/incomplete syntax without throwing or crashing", () => {
      const brokenTs = path.join(testDir, "broken.ts")
      fs.writeFileSync(
        brokenTs,
        `
        export class ValidBeforeError {
          foo() {
        // Incomplete code with unmatched braces, missing quotes, syntax errors
        function incomplete(
        `,
        "utf8",
      )

      try {
        expect(() => {
          const graph = extractGraph({ rootDir: testDir })
          expect(graph.nodes.length).toBeGreaterThan(0)
        }).not.toThrow()
      } finally {
        try {
          fs.unlinkSync(brokenTs)
        } catch {}
      }
    })
  })

  describe("Scale & Parallel Performance", () => {
    const scaleDir = path.join(testDir, "scale")
    if (!fs.existsSync(scaleDir)) {
      fs.mkdirSync(scaleDir, { recursive: true })
    }

    // Generate 120 source files
    for (let i = 0; i < 120; i++) {
      fs.writeFileSync(
        path.join(scaleDir, `file_${i}.ts`),
        `import { helper } from "./file_${(i + 1) % 120}"\nexport class Service_${i} {}\nexport function action_${i}() {}\n`,
        "utf8",
      )
    }

    test("indexes 120 multi-file repository in parallel in under 200ms", () => {
      const start = performance.now()
      const graph = extractGraph({ rootDir: scaleDir, maxFiles: 500 })
      const elapsed = performance.now() - start

      expect(graph.nodes.length).toBeGreaterThanOrEqual(240) // 120 files + 120 classes + 120 functions
      expect(graph.edges.length).toBeGreaterThanOrEqual(120)
      expect(elapsed).toBeLessThan(200) // Rayon parallel execution in <200ms
    })
  })
})
