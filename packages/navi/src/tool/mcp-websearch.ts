import { Duration, Effect, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as NetworkPolicy from "@/permission/network"

export const EXA_URL = process.env.EXA_API_KEY
  ? `https://mcp.exa.ai/mcp?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
  : "https://mcp.exa.ai/mcp"
export const PARALLEL_URL = "https://search.parallel.ai/mcp"

const McpResult = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({
        type: Schema.String,
        text: Schema.String,
      }),
    ),
  }),
})

const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(McpResult))

const parsePayload = (payload: string) =>
  Effect.gen(function* () {
    const trimmed = payload.trim()
    if (!trimmed.startsWith("{")) return undefined
    const data = yield* decode(trimmed)
    return data.result.content.find((item) => item.text)?.text
  })

export const parseResponse = Effect.fn("McpWebSearch.parseResponse")(function* (body: string) {
  const trimmed = body.trim()
  const direct = trimmed ? yield* parsePayload(trimmed) : undefined
  if (direct) return direct

  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue
    const data = yield* parsePayload(line.substring(6))
    if (data) return data
  }
  return undefined
})

export const SearchArgs = Schema.Struct({
  query: Schema.String,
  type: Schema.String,
  numResults: Schema.Number,
  livecrawl: Schema.String,
  contextMaxCharacters: Schema.optional(Schema.Number),
})

export const CodeArgs = Schema.Struct({
  query: Schema.String,
  tokensNum: Schema.Number,
})

export const ParallelSearchArgs = Schema.Struct({
  objective: Schema.String,
  search_queries: Schema.Array(Schema.String),
  session_id: Schema.optional(Schema.String),
  model_name: Schema.optional(Schema.String),
})

const McpRequest = <F extends Schema.Struct.Fields>(args: Schema.Struct<F>) =>
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Literal(1),
    method: Schema.Literal("tools/call"),
    params: Schema.Struct({
      name: Schema.String,
      arguments: args,
    }),
  })

export interface CallOptions {
  /**
   * Egress policy resolved by the calling tool. Omitted falls back to the
   * environment-only policy so direct callers still fail closed.
   */
  policy?: NetworkPolicy.NetworkPolicy
}

export const call = <F extends Schema.Struct.Fields>(
  http: HttpClient.HttpClient,
  url: string,
  tool: string,
  args: Schema.Struct<F>,
  value: Schema.Struct.Type<F>,
  timeout: Duration.Input,
  headers?: Record<string, string>,
  options?: CallOptions,
) =>
  Effect.gen(function* () {
    // Fixed MCP endpoints: validate once per call, before the request, so a
    // policy can block the backend.
    NetworkPolicy.assertUrlAllowed(url, options?.policy ?? NetworkPolicy.resolve(undefined))

    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.accept("application/json, text/event-stream"),
      HttpClientRequest.setHeaders(headers ?? {}),
      HttpClientRequest.schemaBodyJson(McpRequest(args))({
        jsonrpc: "2.0" as const,
        id: 1 as const,
        method: "tools/call" as const,
        params: { name: tool, arguments: value },
      }),
    )
    const response = yield* HttpClient.filterStatusOk(http)
      .execute(request)
      .pipe(
        // Refuse redirects: the URL validated above must be the URL called.
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.die(new Error(`${tool} request timed out`)) }),
      )
    const body = yield* response.text
    return yield* parseResponse(body)
  })
