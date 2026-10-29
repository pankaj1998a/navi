# MongoDB Style Guide

> Source: Mongo Style Guide (https://github.com/jsoendermann/MongoStyleGuide)

## Quick Rules
- Model enums as uppercase string constants (`'WAITING'`, `'IN_PROGRESS'`), never as numbers or booleans.
- Never use `null` or a missing field to mean an enum state; use an explicit `'NOT_APPLICABLE'` style value.
- Do not model two-state concepts that are really multi-state as booleans; use an enum instead.
- Prefix boolean field names with `is`, `has`, or `did` (`isDoctor`, `hasDiabetes`).
- Store dates as real `Date` values, not ISO strings; use `'YYYY-MM-DD'` strings only for day-level dates.
- `null` and missing mean "unset" and nothing else; use `0`, `''`, or `[]` when a sensible default exists.
- Use one type per field, and give every object in an array the same shape.
- Store numbers as numbers, except for identifiers where leading zeroes are significant (phone numbers, IDs).
- Do not use `ObjectId` for `_id`; generate your own stable string identifiers.
- Keep documents small and shallow; merge related fields into nested objects and prune what is no longer needed.

## Formatting
- One field per line in any JSON you write, in a stable order: identifier, then state, then attributes, then relationships.
- Always quote keys and string values in JSON output; use double quotes only.
- Store timestamps in UTC and convert at the edge; keep the field name explicit (`createdAt`, `updatedAt`).
- Keep embedded documents to a depth where a query can still filter on the fields it needs.
- When a field holds a set, store it as an array of uppercase string constants rather than an object of booleans.
- When a value needs a unit, store it as `{ unit: 'KG', value: 10 }` rather than the string `'10 kg'`.

## Naming
- Keys: `camelCase` (matching JavaScript usage); avoid `snake_case` in documents.
- Collections: plural and `camelCase` (`users`, `appointments`).
- Related collections: use a dot to express the relationship (`users.appointments`).
- Enum values: uppercase string constants.
- Boolean fields: verb prefix (`isVisible`, `didAnswerPhoneCall`).
- Abbreviations are allowed only for domain vocabulary and must be capitalized properly (`hisNumber`, `ABIRight`).

## Structure
- Decide explicitly between embedding and referencing; embed one-to-many data that is read with the parent, reference data that is read independently.
- Give every document a deterministic `_id` you generate, not an `ObjectId`.
- Model mutually exclusive boolean fields as a single enum so invalid combinations cannot be stored.
- Prune and merge fields as the model evolves instead of letting a document accumulate deprecated properties.
- When a field may be absent and absence is meaningful, model the absence with a companion field or an explicit state object.
- Keep the schema of objects inside an array uniform; a `{ value, otherValue }` mix in one array is invalid.

## Tooling
- Use a JSON Schema validator on the collection so invalid documents are rejected at write time.
- Create indexes for every field used in a query predicate or sort; verify with `explain()`.
- Write migration scripts when a field changes type; never mutate documents in place across a large collection without a plan.
- Use `mongosh` or a driver for scripts; keep the driver version pinned in `package.json`.
- Run aggregation pipelines against a snapshot before applying them to production.
- Enable change streams or oplog-based auditing when downstream systems depend on the data.

## Anti-Patterns
- `gender: 1` or `gender: true` to encode a small set. Instead: `gender: 'MALE'`.
- `assessmentState: null` to mean "not assessed". Instead: `assessmentState: 'NOT_REQUIRED'`.
- Storing an ISO string in a date field. Instead: store a `Date`.
- Mixing `null` and missing across the same field. Instead: pick one and use it consistently.
- `isRed: false, isBlue: true, isGreen: false`. Instead: `color: 'BLUE'`.
- Storing `height: '178'` as a string. Instead: `height: 178`.
- Leaving `notes: null` instead of `notes: ''`. Instead: use the empty default.
- Nesting deeply to avoid extra joins. Instead: keep the document shallow and queryable.

## Code/Config Example
```js
// collections/appointments.js
db.createCollection("appointments", {
  validator: {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "patientId", "status", "startsAt"],
      properties: {
        _id: { bsonType: "string" },
        patientId: { bsonType: "string" },
        status: {
          enum: ["WAITING", "IN_PROGRESS", "COMPLETED", "NOT_APPLICABLE"]
        },
        isCancelled: { bsonType: "bool" },
        startsAt: { bsonType: "date" },
        durationMinutes: { bsonType: "int", minimum: 0 }
      }
    }
  }
});

db.appointments.insertOne({
  _id: "6xAySKn98aZ66vN",
  patientId: "eOiga4lkLaW99ER",
  status: "WAITING",
  isCancelled: false,
  startsAt: ISODate("2026-10-21T09:00:00.000Z"),
  durationMinutes: 30
});
```

## Sources
- https://github.com/jsoendermann/MongoStyleGuide
