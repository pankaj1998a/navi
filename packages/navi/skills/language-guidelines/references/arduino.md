# Arduino Style Guide

> Source: Arduino CLI Library Specification (https://arduino.github.io/arduino-cli/1.5/library-specification/) plus Arduino CLI Sketch Specification (https://arduino.github.io/arduino-cli/1.5/sketch-specification/). The primary link in the curated list, the Arduino Library Style Guide (https://docs.arduino.cc/learn/contributions/arduino-library-style-guide/), was unreachable at fetch time, so the official Arduino CLI specifications are used as the fallback source.

## Quick Rules
- A sketch is a folder: the folder name and the primary `.ino` file name must match exactly.
- Libraries live in a `src/` folder; put the public header at the root of `src/` and internal headers in a subfolder.
- Ship a `library.properties` file in the library root with every required field filled in.
- Put runnable examples in `examples/<ExampleName>/<ExampleName>.ino`; the folder name is lowercase `examples`.
- Use `const` for pin numbers, buffer sizes, and other values that never change.
- Guard every long-running loop with `millis()` timing instead of `delay()` so the sketch stays responsive.
- Reserve `setup()` for initialization and `loop()` for the repeated work; keep `loop()` short.
- Use `pinMode()` once during setup; calling it every loop iteration wastes cycles and can cause glitches.
- Never block inside an interrupt handler; set a flag and handle the work in `loop()`.
- Read serial input with a non-blocking check for available bytes, not a blocking read.

## Formatting
- Indent with 2 spaces per level; no tabs.
- Opening brace on the same line as the function signature; closing brace on its own line.
- One statement per line, blank line between logical sections, no trailing whitespace.
- Prefer `const char *msg = "text";` over `String` objects to avoid heap fragmentation on AVR boards.
- Declare and initialize variables at the point of first use, not in a block of global declarations.
- Use `uint8_t`, `uint16_t`, `int32_t` and friends from `<stdint.h>` for portable, fixed-width types.
- Keep lines short enough to read on a typical editor without wrapping.

## Naming
- Sketch folder and primary file: valid identifier characters only (letters, digits, `_`, `.`, `-`); max 63 characters.
- Library folder: same character rules, max 63 characters, must not end with a dot.
- Library `name` in `library.properties`: letters, digits, spaces, `_`, `.`, `-`; must start with a letter or digit; `Arduino*` is reserved for official libraries.
- Constants: `UPPER_SNAKE_CASE` (`SERIAL_BAUD`, `LED_PIN`).
- Global and class variables: `camelCase`; private members prefixed with `_` or `m_` per project convention.
- Functions: `camelCase` verbs (`readTemperature`, `beginTransmission`); classes: `PascalCase`.
- Library version must be semver compliant (`1.2.0`); `1.2` is accepted, `r5` and `003` are not.

## Structure
- Sketch layout: `SketchName/SketchName.ino`, optional `src/` for extra compilation units, `data/` for non-compiled assets, `arduino_secrets.h` for secrets.
- Library layout: `library.properties`, `keywords.txt`, `src/`, `examples/`, optional `extras/`.
- Put only headers meant to be part of the public API in the root of `src/`; everything else goes in a subfolder.
- Declare architecture-specific code with `ARDUINO_ARCH_*` macros and provide a generic fallback branch.
- Document each example with a comment block at the top stating what it demonstrates and which board it needs.
- Add a `keywords.txt` file so the IDE highlights your classes, methods, and constants.

## Tooling
- Build and upload with `arduino-cli compile --fqbn <board:variant> <sketch>` and `arduino-cli upload`.
- Use `arduino-cli lib install <name>` to pull dependencies; declare them in `library.properties` with `depends=`.
- Pin the platform and libraries with a `sketch.yaml` project file for reproducible builds.
- Add a `.development` file to the library root while developing examples; never publish it.
- Enable `Serial.begin(115200)` and print structured output (`key:value` pairs) so serial logs are parseable.
- Test on the lowest-memory board the library claims to support.

## Anti-Patterns
- `delay(1000)` inside `loop()` to pace the sketch. Instead: compare `millis()` against the last run time.
- `String` for every string operation. Instead: use `const char[]` and `strncpy`-style buffer handling.
- `pinMode()` called inside `loop()`. Instead: set the mode once in `setup()`.
- Blocking serial reads in a loop. Instead: check `Serial.available()` and consume the bytes.
- Heavy work in an ISR. Instead: set a volatile flag and process it in `loop()`.
- Missing `library.properties`, so the library cannot be indexed by Library Manager. Instead: ship the full metadata file.
- A sketch folder whose `.ino` name differs from the folder name. Instead: rename both to match.
- Committing credentials in the sketch. Instead: use `arduino_secrets.h` with `SECRET_` macros and keep it out of version control.

## Code/Config Example
```cpp
// BlinkEveryHalfSecond.ino
#include <Arduino.h>

const uint8_t LED_PIN = 13;
const uint32_t INTERVAL_MS = 500;

uint32_t lastToggle = 0;

void setup() {
  pinMode(LED_PIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  uint32_t now = millis();
  if (now - lastToggle >= INTERVAL_MS) {
    lastToggle = now;
    digitalWrite(LED_PIN, !digitalRead(LED_PIN));
  }
}
```

```ini
# library.properties
name=Blink
version=1.0.0
author=Your Name <you@example.com>
maintainer=Your Name <you@example.com>
sentence=Non-blocking LED blink helper.
paragraph=Provides a millis-based scheduler for periodic tasks.
category=Device Control
url=https://example.com/blink
architectures=*
```

## Sources
- https://arduino.github.io/arduino-cli/1.5/library-specification/
- https://arduino.github.io/arduino-cli/1.5/sketch-specification/
- https://docs.arduino.cc/learn/contributions/arduino-library-style-guide/ (listed in the curated index, unreachable at fetch time)
