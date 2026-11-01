// Compatibility shim for `effect/http/HttpServer` (now `effect/unstable/http/HttpServer`).
// Re-exports the dedicated module so `HttpServer.serve`, `HttpServer.serveEffect`,
// `HttpServer.make`, and `HttpServer.HttpServer` all resolve. Mapped in tsconfig.json `paths`.
export * from "effect/unstable/http/HttpServer"
