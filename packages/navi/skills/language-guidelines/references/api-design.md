# API Style Guide

> Source: Google Cloud API Design Guide (https://cloud.google.com/apis/design), Microsoft REST API Guidelines (https://github.com/Microsoft/api-guidelines), JSON:API recommendations (http://jsonapi.org/recommendations), and API Security Checklist (https://github.com/shieldfy/API-Security-Checklist)

## Quick Rules
- Model the API as resources, not actions; use nouns in paths and standard HTTP methods for verbs.
- Use the standard method set: `Get`, `List`, `Create`, `Update`, `Delete`, plus custom methods for everything else.
- URL collections are plural (`/photos`), individual resources are the collection plus an id (`/photos/1`).
- Return the right status code for the operation: `200`, `201` with `Location`, `202` for long-running work, `204` for empty, `400`/`401`/`403`/`404`/`409`/`429` for the usual failures.
- Use a consistent error envelope with a machine-readable code, a human-readable message, and details.
- Version the API in the path or host (`/v1/photos`) and never change the meaning of an existing field.
- Paginate every collection endpoint and return a next-page token.
- Use camelCase member names, ASCII alphanumeric only, starting and ending with `a-z`.
- Secure every endpoint: standard auth, TLS 1.2+, rate limits, no secrets in URLs, and generic error messages to clients.
- Send `X-Content-Type-Options: nosniff`, `X-Frame-Options: deny`, and a restrictive `Content-Security-Policy`.

## Formatting
- JSON payloads: double quotes, two-space indentation in documentation examples, members in a stable order.
- Datetime values in ISO 8601 (RFC 3339) with an explicit timezone, e.g. `2026-10-20T09:30:00Z`.
- Enum values are uppercase strings; booleans are real JSON booleans, never `"true"` strings.
- Request and response bodies use `application/json`; state the content type in `Content-Type` and honour `Accept` with `406 Not Acceptable` when unsupported.
- Long-running operations return `202 Accepted` with a `Content-Location` header pointing at an operation resource.
- Filtering uses the reserved `filter` query family, e.g. `GET /comments?filter[post]=1,2`.

## Naming
- Paths: lowercase plural resource names with hyphens for multi-word segments (`/user-profiles`).
- Resource identifiers: opaque strings such as `publishers/1234/books/5678`, or UUIDs rather than auto-increment ids.
- JSON members: camelCase (`bookId`, `displayName`); query parameters: camelCase.
- Field names must not change meaning across versions; add new fields instead of renaming.
- Relationship URLs follow `/photos/1/relationships/comments` (relationship) and `/photos/1/comments` (related resource).
- Custom method names are verbs in lowerCamelCase appended to the resource path (`/photos:batchGet`).

## Structure
- Group the API surface by resource, with one file per service in a predictable directory layout.
- Define standard fields once (`name`, `uid`, `displayName`, `createTime`, `updateTime`, `etag`) and reuse them.
- Keep collections and individual resources addressable by a unique id, and return a `self` link for each resource.
- Use `If-Match` with `etag` for optimistic concurrency on updates.
- Separate read and write paths; do not overload `POST` for reads.
- Document the API next to the code, and keep the discovery document in sync with the implementation.

## Tooling
- Generate clients and docs from the schema (protobuf/OpenAPI) rather than maintaining them by hand.
- Validate requests against the schema in the gateway before they reach business logic.
- Add contract tests that run the same requests against the schema and the implementation.
- Lint the OpenAPI/proto file in CI and fail on breaking changes.
- Run security scanning (SAST, dependency audit, secret scanning) as part of CI.
- Instrument with structured logging, request IDs, and latency metrics per endpoint.

## Anti-Patterns
- Verbs in the URL path (`/getPhotos`). Instead: `GET /photos`.
- Returning `200 OK` with an error object in the body. Instead: use the correct 4xx/5xx status.
- Exposing internal database ids or stack traces. Instead: opaque ids and generic client messages.
- No pagination on a list endpoint. Instead: return `nextPageToken` and enforce a maximum page size.
- Accepting `POST` for a read-only operation. Instead: use `GET` with a query parameter.
- `response_type=token` in OAuth flows. Instead: exchange the authorization code for tokens.
- Passing API keys or passwords in the query string. Instead: use the `Authorization` header.
- Changing the type or meaning of an existing field in a new version. Instead: add a new field and deprecate the old one.

## Code/Config Example
```json
{
  "data": [
    {
      "type": "comments",
      "id": "1",
      "attributes": { "text": "HATEOS are the thing!" },
      "links": { "self": "/comments/1" },
      "relationships": {
        "author": {
          "links": {
            "self": "/comments/1/relationships/author",
            "related": "/comments/1/author"
          }
        }
      }
    }
  ],
  "links": { "self": "/comments" },
  "error": {
    "code": 429,
    "message": "Rate limit exceeded.",
    "status": "RESOURCE_EXHAUSTED"
  }
}
```

## Sources
- https://cloud.google.com/apis/design
- https://github.com/Microsoft/api-guidelines
- http://jsonapi.org/recommendations
- https://github.com/shieldfy/API-Security-Checklist
- http://stateless.co/hal_specification.html
