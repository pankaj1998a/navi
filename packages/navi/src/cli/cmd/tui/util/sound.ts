import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"
import { Process } from "@/util/process"
import { which } from "@/util/which"
import pulseA from "../asset/pulse-a.wav" with { type: "file" }
import pulseB from "../asset/pulse-b.wav" with { type: "file" }
import pulseC from "../asset/pulse-c.wav" with { type: "file" }
import charge from "../asset/charge.wav" with { type: "file" }

const FILE = [pulseA, pulseB, pulseC]

const HUM = charge
const DIR = join(tmpdir(), "navi-sfx")

const LIST = [
  "ffplay",
  "mpv",
  "mpg123",
  "mpg321",
  "mplayer",
  "afplay",
  "play",
  "omxplayer",
  "aplay",
  "cmdmp3",
  "cvlc",
  "powershell.exe",
] as const

type Kind = (typeof LIST)[number]

function args(kind: Kind, file: string, volume: number) {
  if (kind === "ffplay") return [kind, "-autoexit", "-nodisp", "-af", `volume=${volume}`, file]
  if (kind === "mpv")
    return [kind, "--no-video", "--audio-display=no", "--volume", String(Math.round(volume * 100)), file]
  if (kind === "mpg123" || kind === "mpg321") return [kind, "-g", String(Math.round(volume * 100)), file]
  if (kind === "mplayer") return [kind, "-vo", "null", "-volume", String(Math.round(volume * 100)), file]
  if (kind === "afplay" || kind === "omxplayer" || kind === "aplay" || kind === "cmdmp3") return [kind, file]
  if (kind === "play") return [kind, "-v", String(volume), file]
  if (kind === "cvlc") return [kind, `--gain=${volume}`, "--play-and-exit", file]
  return [kind, "-c", `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').PlaySync()`]
}

let kind: Kind | null | undefined
let proc: Process.Child | undefined
let tail: ReturnType<typeof setTimeout> | undefined
let cache: Promise<{ hum: string; pulse: string[] }> | undefined
let seq = 0
let shot = 0

function clear() {
  if (!tail) return
  clearTimeout(tail)
  tail = undefined
}

function asset(): Promise<{ hum: string; pulse: string[] }> {
  if (cache) return cache
  cache = (async () => {
    mkdirSync(DIR, { recursive: true })
    const pulsePaths: string[] = []
    for (const f of FILE) {
      const target = join(DIR, basename(f))
      await Bun.write(target, Bun.file(f))
      pulsePaths.push(target)
    }
    const humTarget = join(DIR, basename(HUM))
    await Bun.write(humTarget, Bun.file(HUM))
    return { hum: humTarget, pulse: pulsePaths }
  })()
  return cache
}

function run(file: string, volume: number): Process.Child | undefined {
  if (kind === null) return
  if (kind === undefined) {
    for (const item of LIST) {
      if (which(item)) {
        kind = item
        break
      }
    }
    if (!kind) {
      kind = null
      return
    }
  }
  const cmdArgs = args(kind, file, volume)
  return Process.spawn(cmdArgs, { stdin: "ignore", stdout: "ignore", stderr: "ignore" })
}

function play(file: string, volume: number) {
  return run(file, volume)?.exited
}

export function start() {
  stop()
  const id = ++seq
  void asset().then(({ hum }) => {
    if (id !== seq) return
    const next = run(hum, 0.24)
    if (!next) return
    proc = next
    void next.exited.then(
      () => {
        if (id !== seq) return
        if (proc === next) proc = undefined
      },
      () => {
        if (id !== seq) return
        if (proc === next) proc = undefined
      },
    )
  })
}

export function stop(delay = 0) {
  seq++
  clear()
  if (!proc) return
  const next = proc
  if (delay <= 0) {
    proc = undefined
    void Process.stop(next).catch(() => undefined)
    return
  }
  tail = setTimeout(() => {
    tail = undefined
    if (proc === next) proc = undefined
    void Process.stop(next).catch(() => undefined)
  }, delay)
}

export function pulse(scale = 1) {
  stop(140)
  const index = shot++ % FILE.length
  void asset()
    .then(({ pulse }) => {
      const target = pulse[index]
      if (target) void play(target, 0.26 + 0.14 * scale)
    })
    .catch(() => undefined)
}

export function dispose() {
  stop()
}

export * as Sound from "./sound"
