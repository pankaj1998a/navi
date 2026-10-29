# Brainfuck Style Guide

> Source: BF Style Guide (https://codepen.io/renmans/full/JjdJPpW) plus the source repository at https://github.com/renmans/bf-style-guide and the Brainfuck language reference at https://en.wikipedia.org/wiki/Brainfuck

## Quick Rules

- Put `[` and `]` each on their own line, alone on that line.
- Put a line break after every `[` and after every `]`.
- Split long instruction runs into several short ones; never combine more than 5 increments/decrements in one expression.
- Start every program with an "initial comment loop": a `[ ... ]` block whose cell is still 0, holding a prose description.
- Put a description of the program's input and output before the code.
- Add an inline comment on each line explaining the progress of the program.
- State the iteration count of every loop in a comment (`cell #0 = 5`).
- Remember the tape is 8-bit: only ASCII values are safe, and cells wrap modulo 256.
- Comment text inside a comment loop must not contain unbalanced `[` or `]`.

## Formatting

- Indentation: 4 spaces per level inside a `[ ... ]` block.
- Brackets: `[` and `]` are always alone on their line, never written as `[>++>]`.
- Line breaks after every `[` and every `]`.
- Expression width: at most 5 characters of `+`/`-` combined per run; use `++++ +++` style grouping rather than a single long run.
- Data pointer moves (`>` and `<`) are written separately from arithmetic: `> ++`, not `>++`.
- Blank line separates the header comment loop from the program body.
- No trailing whitespace; every file ends with a newline.

## Naming

Brainfuck has no identifiers, so naming applies to the surrounding artifacts:

- File names: `hello_world.bf`, `fizzbuzz.bf` - lowercase with underscores, describing the program's output.
- Use one program per file; keep helper variants as `name_v2.bf` rather than editing in place.
- Comment labels should name the concept, e.g. `cell #0 = counter`, not `stuff`.
- Name variables in comments after their role: `cell #1 = output`, `cell #2 = input buffer`.

## Types and Data

- The tape is a flat array of 8-bit cells starting at cell 0; there is no type system.
- Values wrap: 255 + 1 becomes 0. Use explicit "add then subtract" loops to avoid overflow bugs.
- Only ASCII (0-127) is meaningful for output; printing a byte above 127 produces garbage.
- Keep a mental map of which cell holds what and state it in comments near the setup code.
- The pointer is unbounded left and right (implementation permitting), but values beyond the tape are zero.

## Comments and Documentation

- Brainfuck has no comment syntax, so comments are written inside a skipped `[ ... ]` loop.
- The initial comment loop must come first, before any instruction that changes cell 0.
- Inside the comment loop, `.` `,` `+` `-` `<` `>` are inert; only balanced brackets matter.
- The comment loop body must not contain `[` or `]` characters, or the loop structure breaks.
- Required comment content: what the program does, what input it reads, what output it produces.
- Provide an example of the expected output so a reader can verify the program quickly.
- Inline comments go at the end of a line, separated by spaces, and must avoid characters that look like instructions.

## Error Handling

Brainfuck has no error handling; the program either terminates or loops forever.

- Avoid infinite loops: every `[` loop must have a guaranteed exit condition, stated in a comment.
- If the program reads input, document the expected number of characters in a comment.
- If the input runs out, most interpreters leave the cell unchanged or zero; say what your program assumes.
- Do not rely on undefined behaviour of a particular interpreter; state the interpreter assumptions in the header comment.

## Testing

- Test by running the program against the documented example input and comparing with the expected output.
- Include the expected output in the header comment as the acceptance test.
- For each loop, verify the counter value by inspection before writing the body.
- Keep a copy of a minimal working core and add features one at a time.
- If a program grows beyond a screen, split the logic into separate files and concatenate them at build time.

## Anti-Patterns

- Writing `[>++>+++>+++>+]` on one line. Instead: put each bracket on its own line and indent the body.
- Running long arithmetic chains like `+++++++`. Instead: break into groups of at most 5 and separate pointer moves.
- Putting prose comments in code that has already modified cell 0. Instead: use the initial comment loop before any instruction.
- Leaving the loop iteration count unstated. Instead: comment `cell #0 = 5` before the loop.
- Assuming 32-bit cells. Instead: design for 8-bit wrapping and ASCII-only output.
- Using `[` and `]` inside a comment. Instead: write "open bracket" and "close bracket" in words.
- Printing characters above 127. Instead: stick to ASCII and document the encoding.
- Reading an unbounded number of characters from input. Instead: document the exact expected count.

## Code Example

```brainfuck
[
    This program prints "Hi!" followed by a newline to the screen.
    It takes no input and produces exactly four bytes of output.

    Any characters other than balanced brackets inside this loop are
    ignored, because the current cell is 0 when the loop is first
    reached and the loop is therefore skipped.
]

+        cell #0 = 1
+++++    cell #0 = 6
[
    -        cell #0 = 5  (decrement the counter)
    > +      cell #1 = 1  (H)
    > +++    cell #2 = 3  (i)
    > +      cell #3 = 1  (!)
    < <      back to cell #0
]
> .        print 'H'
> .        print 'i'
> .        print '!'
> ++       cell #3 = 3
.         print newline (10 needs to be built, see note)
```

## Sources

- https://codepen.io/renmans/full/JjdJPpW
- https://github.com/renmans/bf-style-guide
- https://en.wikipedia.org/wiki/Brainfuck
