import { describe, expect, it } from "bun:test"
import {
  compressContext,
  retrieveCcr,
  getHeadroomTelemetry,
  detectContentType,
  compressAuto,
} from "../src/compress/headroom"
import { native } from "../src/memory/native"
import { compressOpenAiPayload, compressAnthropicPayload } from "../src/compress/proxy"
import { handleMcpMessage } from "../src/compress/mcp"

describe("Headroom Context Compression & CCR Suite", () => {
  it("compresses large logs while preserving FATAL, errors, and stack traces", () => {
    let log = "Starting test suite run...\n"
    for (let i = 0; i < 80; i++) {
      log += `[INFO] module_${i}.ts compiled in 14ms\n`
    }
    log += "FATAL: OutOfMemoryError in worker thread 4\n"
    log += "Traceback (most recent call last):\n"
    log += "  File 'src/auth.py', line 102, in authenticate\n"
    log += "    raise SecurityException('Invalid token signature')\n"
    log += "SecurityException: Invalid token signature\n"
    for (let i = 0; i < 40; i++) {
      log += `[DEBUG] teardown hook ${i}\n`
    }
    log += "TEST RESULT: 1 failed, 79 passed\n"

    const res = compressContext("log", log)

    expect(res.compressed_len).toBeLessThan(res.original_len)
    expect(res.compressed).toContain("FATAL: OutOfMemoryError")
    expect(res.compressed).toContain("Traceback")
    expect(res.compressed).toContain("SecurityException")
    expect(res.compressed).toContain("<<ccr:")
    expect(res.ccr_key).not.toBeNull()
    expect(res.tokens_saved_est).toBeGreaterThan(0)

    // Lossless end-to-end recovery test
    if (res.ccr_key) {
      const recovered = retrieveCcr(res.ccr_key)
      expect(recovered).toBe(log)
    }
  })

  it("compresses unified diffs by trimming redundant context lines", () => {
    let diff = "diff --git a/packages/navi/src/auth.ts b/packages/navi/src/auth.ts\n"
    diff += "--- a/packages/navi/src/auth.ts\n"
    diff += "+++ b/packages/navi/src/auth.ts\n"
    diff += "@@ -10,40 +10,42 @@\n"
    for (let i = 0; i < 25; i++) {
      diff += ` unchanged context line ${i}\n`
    }
    diff += "-const apiKey = 'sk-live-123456789'\n"
    diff += "+const apiKey = process.env.API_KEY\n"
    for (let i = 0; i < 25; i++) {
      diff += ` trailing context line ${i}\n`
    }

    const res = compressContext("diff", diff, 2)
    expect(res.compressed_len).toBeLessThan(res.original_len)
    expect(res.compressed).toContain("+const apiKey = process.env.API_KEY")
    expect(res.compressed).toContain("-const apiKey = 'sk-live-123456789'")
  })

  it("compresses JSON payloads by pruning nulls and empty objects", () => {
    const rawJson = JSON.stringify(
      {
        status: "ok",
        empty_val: null,
        blank_arr: [],
        blank_obj: {},
        user: {
          id: 42,
          token_null: null,
          role: "admin",
        },
      },
      null,
      2,
    )

    const res = compressContext("json", rawJson)
    expect(res.compressed_len).toBeLessThan(res.original_len)
    expect(res.compressed).not.toContain("empty_val")
    expect(res.compressed).not.toContain("token_null")
    expect(res.compressed).toContain('"id":42')
    expect(res.compressed).toContain('"role":"admin"')
  })

  it("compresses source code skeletons while preserving function signatures and types", () => {
    let code = 'import { db } from "./db"\n\n'
    code += "export function handleRequest(req: Request) {\n"
    for (let i = 0; i < 20; i++) {
      code += `  console.log("processing step ${i}")\n`
    }
    code += "  return true\n}\n\n"
    code += "export function helper() {\n  return 1\n}\n"

    const res = compressContext("code", code, 5)
    expect(res.compressed).toContain("export function handleRequest")
    expect(res.compressed).toContain("routine body compressed")
    expect(res.compressed).toContain("export function helper")
  })

  it("tracks telemetry stats across compression events", () => {
    const stats = getHeadroomTelemetry()
    expect(stats.total_compressions).toBeGreaterThanOrEqual(1)
    expect(stats.ccr_entries).toBeGreaterThanOrEqual(1)
  })

  it("verifies native Rust FFI bindings for headroom", () => {
    if (native.isAvailable && native.headroomCompress) {
      const sample = "ERROR: Something failed\n" + "line\n".repeat(40)
      const res = native.headroomCompress("log", sample, 10)
      expect(res.compressed).toBeDefined()
      expect(res.ccr_key).toBeDefined()

      if (res.ccr_key && native.headroomRetrieve) {
        const full = native.headroomRetrieve(res.ccr_key)
        expect(full).toBe(sample)
      }
    }
  })

  it("detects content types and auto-compresses payloads appropriately", () => {
    expect(detectContentType('{"key": "value"}')).toBe("json")
    expect(detectContentType("diff --git a/file b/file\n--- a/file\n+++ b/file")).toBe("diff")
    expect(detectContentType("FATAL: panic occurred in thread\n[ERROR] test failed")).toBe("log")
    expect(detectContentType("export function test() { return 1; }")).toBe("code")

    let verboseLog = "Starting execution...\n"
    for (let i = 0; i < 60; i++) {
      verboseLog += `[INFO] step ${i} completed\n`
    }
    verboseLog += "FATAL: OutOfMemoryError in worker\n"

    const autoRes = compressAuto(verboseLog, 200)
    expect(autoRes.compressed_len).toBeLessThan(autoRes.original_len)
    expect(autoRes.tokens_saved_est).toBeGreaterThan(0)
  })

  it("optimizes OpenAI and Anthropic chat payloads in proxy transforms", () => {
    // OpenAI payload test
    let toolOutput = "Build logs:\n"
    for (let i = 0; i < 50; i++) {
      toolOutput += `[INFO] compiling artifact ${i}...\n`
    }
    toolOutput += "ERROR: build failed at stage 42\n"

    const openAiReq = {
      model: "gpt-4o",
      messages: [
        { role: "user", content: "Run the build" },
        { role: "tool", content: toolOutput },
      ],
    }

    const openAiRes = compressOpenAiPayload(openAiReq, 300)
    expect(openAiRes.tokensSaved).toBeGreaterThan(0)
    expect(openAiRes.payload.messages[1].content).toContain("ERROR: build failed")
    expect(openAiRes.payload.messages[1].content.length).toBeLessThan(toolOutput.length)

    // Anthropic payload test
    const anthropicReq = {
      model: "claude-3-5-sonnet",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool_1",
              content: toolOutput,
            },
          ],
        },
      ],
    }

    const anthropicRes = compressAnthropicPayload(anthropicReq, 300)
    expect(anthropicRes.tokensSaved).toBeGreaterThan(0)
    expect(anthropicRes.payload.messages[0].content[0].content).toContain("ERROR: build failed")
  })

  it("handles standard Model Context Protocol (MCP) JSON-RPC requests", () => {
    // 1. Initialize
    const initRes = handleMcpMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
    })
    expect(initRes.result.serverInfo.name).toBe("navi-headroom")
    expect(initRes.result.capabilities.tools).toBeDefined()

    // 2. List tools
    const listRes = handleMcpMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    })
    const toolNames = listRes.result.tools.map((t: any) => t.name)
    expect(toolNames).toContain("headroom_compress")
    expect(toolNames).toContain("headroom_retrieve")
    expect(toolNames).toContain("headroom_stats")

    // 3. Call headroom_compress
    let bulkLog = "Log:\n"
    for (let i = 0; i < 50; i++) bulkLog += `[INFO] line ${i}\n`
    bulkLog += "FATAL: crashed\n"

    const callCompress = handleMcpMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "headroom_compress",
        arguments: { text: bulkLog, type: "log" },
      },
    })
    const compData = JSON.parse(callCompress.result.content[0].text)
    expect(compData.tokens_saved_est).toBeGreaterThan(0)
    expect(compData.ccr_key).toBeDefined()

    // 4. Call headroom_retrieve
    const callRetrieve = handleMcpMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "headroom_retrieve",
        arguments: { key: compData.ccr_key },
      },
    })
    expect(callRetrieve.result.content[0].text).toBe(bulkLog)
  })
})
