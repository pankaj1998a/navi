import { Log } from "./log"

export namespace Profile {
  const start = performance.now()
  const checkpoints: { name: string; time: number; diff: number }[] = []
  let last = start

  export function checkpoint(name: string) {
    if (!process.env.NAVI_PROFILE) return
    const now = performance.now()
    const diff = now - last
    const total = now - start
    checkpoints.push({ name, time: total, diff })
    last = now
  }

  export function report() {
    if (!process.env.NAVI_PROFILE) return
    console.error("\n🚀 Navi Startup Profile Report")
    console.error("======================================")
    console.error(`${"Step".padEnd(25)} | ${"Delta (ms)".padStart(10)} | ${"Total (ms)".padStart(10)}`)
    console.error("--------------------------------------")
    for (const c of checkpoints) {
      const color = c.diff > 100 ? "\x1b[31m" : c.diff > 50 ? "\x1b[33m" : "\x1b[32m"
      const reset = "\x1b[0m"
      console.error(`${c.name.padEnd(25)} | ${color}${c.diff.toFixed(2).padStart(10)}${reset} | ${c.time.toFixed(2).padStart(10)}`)
    }
    console.error("======================================\n")
  }
}



