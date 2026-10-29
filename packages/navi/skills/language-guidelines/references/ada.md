# Ada Style Guide

> Source: Ada 95 Quality and Style Guide (http://www.adaic.org/docs/95style/html/contents.html) plus GNAT Coding Style (http://gcc.gnu.org/onlinedocs/gnat-style/) and Ada Programming/Coding standards (https://en.wikibooks.org/wiki/Ada_Programming/Coding_standards)

## Quick Rules

- Use spaces, never tab characters. Indent 3 spaces per nesting level, 2 spaces for continuation lines.
- Reserved words are lowercase; every other identifier is `Mixed_Case_With_Underscores`; acronyms are all uppercase.
- Keep source lines to 72 characters (79 is an accepted alternative), and keep one statement per line.
- Declare one object per declaration, and initialize objects at the point of declaration.
- Put every subprogram in a package specification and a matching package body; the spec is the public contract.
- Boolean objects use predicate clauses or adjectives: `List_Is_Empty`, `User_Is_Available`, not `Flag`.
- Never hide a global entity behind a local declaration of the same name.
- Catch `when others =>` only when you re-raise or you can document precisely what you handle.
- Every unit starts with a comment giving the unit name, purpose, and version.

## Formatting

- Indentation: 3 spaces per nesting level (nesting = `if`/`loop`/`case`/`begin` blocks); continuation lines use 2 spaces so they read differently from nesting.
- Line length: maximum 72 characters; 79 characters is the documented alternative.
- Use spaces only. Tab characters render differently across editors and printers.
- One statement per line. Do not pack multiple statements onto one line even when legal.
- Align colons in related declarations, and align `when` choices in a `case` statement.
- Continuation lines are indented from the start of the continued expression, not from the statement start.
- Blank line before a new logical group of declarations; a header comment may introduce the group.
- Local subprogram bodies come after all local subprogram declarations in the enclosing body.
- End every file with a newline; no trailing whitespace on any line.

## Naming

- Words in an identifier are separated by underscores and each word starts with a capital: `Current_Time`, `Max_Line_Length`.
- Acronyms and abbreviations stay fully uppercase: `HTTP_Timeout`, `Parse_ID`.
- Ada is case-insensitive; the project must pick one capitalization convention and apply it everywhere.
- Objects: singular, specific nouns describing the value: `Retirement_Date`, `Element_Count`.
- Boolean objects: a predicate clause or adjective, e.g. `List_Is_Empty`, `Ready`.
- Types: descriptive nouns, e.g. `Second_Of_Day`; subtypes are adjectives of the base type, e.g. `Morning` for a range of `Second_Of_Day`.
- Enumeration literals are capitalized like other identifiers: `Before_Noon`, `After_Noon`.
- Package names describe what the package provides and are plural or collective when they hold many declarations.
- Exception names describe the condition, not the action: `Invalid_Index`, `File_Not_Found`.
- Do not prefix names with the package name; the package already provides the namespace.

## Types and Data

- Prefer strongly typed solutions: use `Ada.Containers` vectors and maps rather than raw access-to-access types.
- Use `constant` for values fixed at elaboration and `immutable` for objects that should not change after initialization.
- Declare objects at the narrowest scope possible; keep them as close to first use as the language allows.
- Use `subtype` to document ranges and units of an existing type instead of inventing a new type.
- Keep discriminants, tagged types, and representation clauses minimal and documented.
- Avoid access-to-access types; use access-to-object and controlled types with a clear lifetime story.
- `Ada.Strings.Unbounded` is fine for text of unknown length; prefer fixed-size `String` when the bound is known.
- Do not rely on unchecked conversions; use `Ada.Exceptions` and explicit range checks at trust boundaries.

## Comments and Documentation

- Use `--` for comments; put a single space after the dashes and start the text with a capital.
- End-of-line comments explain the current line; put a blank line before a comment that introduces a block.
- Every unit begins with a header comment: unit name, one-line purpose, version, and optionally author/date.
- Document the intent of a package in the package spec, not in the body; the body should only hold implementation.
- Use GNATdoc-style comment blocks (`--  |` or `--/**`) for public API documentation when GNATdoc is used.
- Do not restate the code in comments; explain why a decision was made.
- Marker comments use `-- TODO:`, `-- FIXME:`, `-- XXX:` followed by a short note.
- Keep comments up to date; a stale comment is worse than no comment.

## Error Handling

- Use exceptions for exceptional conditions; do not use them for ordinary control flow.
- Declare a specific exception type per error condition; avoid relying on `Constraint_Error` text.
- `raise` with a message: `raise Invalid_Index with "index out of range";`.
- When catching, name the specific exception; `when others =>` must re-raise or log and document the behaviour.
- Validate parameters at the boundary of a package, once, rather than in every internal caller.
- Use `Ada.Exceptions.Exception_Occurrence` to attach information to a raised exception.
- Do not catch an exception and silently continue; an unrecoverable error should propagate.
- For expected failures, return a status value or a discriminated record instead of raising.

## Testing

- Put tests in a separate package (for example `Tests_For_Stack`) so production code has no test dependencies.
- Use `Ada.Text_IO` or a framework such as GNATCOLL.Python for test harnesses; keep each test case small.
- Name tests after the behaviour under test, e.g. `Test_Push_And_Pop`.
- Assert one behaviour per test case so failures point at a single cause.
- Use `pragma Assert` for internal invariants in debug builds; do not use assertions for input validation.
- Cover boundary cases: empty containers, first and last element, overflow of the subtype range.
- Keep test fixtures local to the test; reset state explicitly between cases.

## Anti-Patterns

- Using `goto` or `exit` to escape deeply nested loops. Instead: extract a helper function with a Boolean result.
- Catching `when others` and doing nothing. Instead: re-raise, or handle a documented, specific set.
- Mixing case conventions in one project (`max_line`, `Max_Line`, `MAX_LINE`). Instead: pick one convention and apply it.
- Using a `String (1 .. 255)` for everything. Instead: use a subtype with a meaningful name and a real bound.
- Putting implementation code in the package specification. Instead: keep the spec declarative; the body holds the code.
- Declaring several variables in one statement. Instead: one declaration per object, each initialized.
- Using `Integer` for sizes, counts, or indices. Instead: use `Natural`, `Positive`, or a range subtype.
- Shadowing a package name with a local variable. Instead: rename the local so readers are not misled.

## Code Example

```ada
package Lists_Simple is

   --  A bounded stack of integers.
   --  Capacity is fixed at declaration so that Push cannot overflow.

   Max_Length : constant := 64;

   type Stack is array (1 .. Max_Length) of Integer;
   subtype Usable_Stack is Stack range 1 .. Max_Length;

   type Stack_Access is access all Stack;

   Empty_Stack_Error : exception;
   Full_Stack_Error  : exception;

   function Is_Empty (Item : Stack_Access) return Boolean;
   --  Returns True when Item holds no elements.

   procedure Push
     (Item : in out Stack_Access;
      Value : in Integer)
      with Pre  => Item'Length < Max_Length,
           Post => Item'Length = Item'Length'Old + 1;
   --  Adds Value to the top of Item.

private

   function Is_Empty (Item : Stack_Access) return Boolean is
   begin
      return Item = null or else Item'Length = 0;
   end Is_Empty;

end Lists_Simple;
```

## Sources

- http://www.adaic.org/docs/95style/html/contents.html
- http://www.adaic.org/docs/95style/html/sec_2/2-1-2.html
- http://www.adaic.org/docs/95style/html/sec_2/2-1-9.html
- http://www.adaic.org/docs/95style/html/sec_3/3-1-3.html
- http://www.adaic.org/docs/95style/html/sec_3/3-2-3.html
- http://gcc.gnu.org/onlinedocs/gnat-style/
- https://en.wikibooks.org/wiki/Ada_Programming/Coding_standards
