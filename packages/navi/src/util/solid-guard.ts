// Prevent duplicate Solid instance warnings across bundled chunks and dynamic imports
if (typeof globalThis !== "undefined") {
  try {
    if (!Object.getOwnPropertyDescriptor(globalThis, "Solid$$")?.get) {
      Object.defineProperty(globalThis, "Solid$$", {
        get() {
          return false
        },
        set() {},
        configurable: true,
      })
    }
  } catch {}

  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("multiple instances of Solid")) {
      return
    }
    originalWarn.apply(console, args)
  }
}
