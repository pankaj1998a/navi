# XML Style Guide

> Source: Google XML Document Format Style Guide (https://google.github.io/styleguide/xmlstyle.html) plus W3C XML Recommendation (https://www.w3.org/TR/xml/)

## Quick Rules

- Design XML formats to be consumed by machines, not humans. Never mix content and structure.
- Every element must contain either nothing, character content, or child elements. Mixed content is forbidden.
- Use `lowerCamelCase` for element names, attribute names, and enumerated values.
- Names contain only ASCII letters and digits, and should not exceed 25 characters.
- Put every element in a namespace; use a default namespace where possible. Never change a namespace URI.
- Namespace prefixes must be short, lower-case ASCII, and never a single letter.
- Prefer child elements over attributes. Use attributes for identifiers, codes, and metadata - at most about 10 per element.
- Use ISO 8601 (RFC 3339) UTC timestamps for dates: `2026-03-14T09:30:00Z`.
- Avoid booleans; use enumerations. Never use `1`/`0` for booleans.
- Use `RELAX NG` compact syntax for schemas, with optional `Schematron` rules.

## Formatting

- Encode documents in UTF-8.
- Declare namespaces on the root element wherever possible.
- Keep the namespace URI to prefix mapping constant throughout the document.
- One space before each attribute in a start tag; no redundant whitespace.
- Pretty-print with 2-space indentation for child elements.
- Elements containing character content must not be wrapped - whitespace is significant there.
- An empty element may be written as `<foo/>` or `<foo></foo>`; the two forms are equivalent and applications must not distinguish them.
- Attribute values may use double quotes or single quotes; never require one over the other.
- Comments must not carry data. They may hold TODOs in hand-written XML, and should not appear in elements with character content.
- A comment must have whitespace after `<!--` and before `-->`.
- Use `<![CDATA[ ... ]]>` only where `&amp;` and `&lt;` would be unreadable; do not require or forbid it.
- Do not use entity references other than `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`; use character references or literal characters.

## Naming

- Element, attribute, and enumerated value names: `lowerCamelCase` - `orderId`, `createdAt`, `statusType`.
- Names contain only ASCII letters and digits - no underscores, hyphens, or dots.
- Prefer a short, descriptive name of 25 characters or fewer; if the limit forces obscurity, exceed it.
- Acronyms are treated as words: `informationUri`, not `informationURI`.
- Namespace URIs take the form `https://example.com/service-or-format/year` - `https://example.com/orders/2026`.
- Namespace prefixes are short and lower-case: `dc`, `xs`, `od` - never `O` or `D`.
- Use `xml:id` for the identifier attribute and `xml:lang` for language.
- Use `href` for hypertext references.
- Attribute names are not namespaced unless drawn from a foreign document type.
- Enumerated values are lowerCamelCase too: `statusType="pendingApproval"`.

## Types and Data

- Use `xsd:int`, `xsd:long`, or `xsd:double` for numbers; express them in base 10.
- Prefer `xsd:decimal`/`xsd:double` over vendor-specific numeric types.
- Booleans are discouraged - use an enumeration instead. If one is unavoidable, it is `true` or `false`.
- Represent a key-value pair as an empty element whose name is the key, with a `value` attribute, optionally with a `unit` attribute using SI units.
- Represent binary data as Base64, optionally with `xsi:type="xs:base64Binary"`.
- Use an element rather than an attribute when the data may have substructure, is large, spans multiple lines, is order-sensitive, or may repeat.
- Use an attribute when the data is an enumeration code, metadata about another element, an ID reference, or a hyperlink target.
- Give schema and documentation a rule for whitespace stripping; parsers do not strip element whitespace but do convert newlines in attribute values to spaces.
- Do not embed syntax in character content or attribute values (other than dates, URIs, and XPath).

## Comments and Documentation

- The XML declaration `<?xml version="1.0" encoding="UTF-8"?>` heads the document.
- Document the format itself: publish the schema and an explanatory prose description of each element.
- Use XML comments sparingly - they are often discarded by parsers.
- If a comment is used, it belongs in the prolog or in an element that has child elements.
- Record the intended semantics of the format in the schema documentation rather than in comments inside instances.
- Keep the element order in the schema and in the documentation identical.

## Error Handling

- XML processing errors are reported by the parser, not by the document. Validate documents against the schema before use.
- A schema should make invalid states unrepresentable: use `enumeration` facets instead of free-text status values.
- Use `Schematron` for constraints a schema cannot express, such as cross-element dependencies.
- Never rely on comment content or on attribute ordering to carry meaning.
- A consumer that must accept third-party XML should tolerate both empty-element spellings and both quote styles.
- Reject documents that violate the schema rather than silently repairing them.

## Testing

- Test fixtures live alongside the schema - `testdata/valid/*.xml` and `testdata/invalid/*.xml`.
- Each invalid fixture should correspond to a specific rule the schema or Schematron enforces.
- Round-trip tests: parse a document, generate it again, and compare the canonical form.
- Run the fixtures through the validator in CI so schema changes cannot break consumers.
- Use namespace-aware parsers only; a namespace-unaware parser is a bug.
- Test against a strict parser to confirm there is no reliance on undefined behavior.

## Anti-Patterns

- Mixed content (`<p>text <b>bold</b></p>`). Instead: separate text and structure into distinct elements.
- An element overloaded with more than about ten attributes. Instead: use child elements for related attributes.
- Changing a namespace URI to reorganize a format. Instead: add a new versioned namespace.
- A single-letter namespace prefix. Instead: use `od`, `dc`, `xs`.
- Boolean attributes carrying meaning. Instead: use an enumeration value.
- Quoted identifiers everywhere. Instead: use valid names; if a name must be quoted, prefer SQL-92 double quotes.
- Binary data embedded directly. Instead: Base64-encode it, or link to it.
- Comments used to carry real data. Instead: put the data in elements.
- A document that depends on attribute order. Instead: never depend on it.

## Code Example

```xml
<?xml version="1.0" encoding="UTF-8"?>
<order xmlns="https://example.com/orders/2026"
       xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>March supply order</dc:title>
  <orderId>ORD-2026-0314</orderId>
  <createdAt>2026-03-14T09:30:00Z</createdAt>
  <statusType>pendingApproval</statusType>
  <lineItems>
    <lineItem>
      <sku>WIDGET-001</sku>
      <quantity unit="unit">12</quantity>
      <unitPrice currency="EUR">4.95</unitPrice>
    </lineItem>
    <lineItem>
      <sku>WIDGET-002</sku>
      <quantity unit="unit">3</quantity>
      <unitPrice currency="EUR">19.50</unitPrice>
    </lineItem>
  </lineItems>
</order>
```

## Sources

- https://google.github.io/styleguide/xmlstyle.html
- https://github.com/google/styleguide/blob/gh-pages/xmlguide.md
- https://www.w3.org/TR/xml/
- https://relaxng.org/compact-tutorial-20030326.html
