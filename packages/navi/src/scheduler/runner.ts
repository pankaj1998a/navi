/**
 * Navi Cron Scheduler
 *
 * Persistent, process-lifetime cron job runner. Supports:
 *  - Standard 5-field cron expressions
 *  - Named jobs with descriptions
 *  - Enable/disable without removal
 *  - One-shot or repeating jobs
 *  - Persistent storage in .navi/state/cron-jobs.json
 */

import path from "path"
import { Log } from "../util/log"
import { Global } from "../global"
import { parseCronExpression, computeNextCronRun, cronToHuman, type CronFields } from "./cron"

const log = Log.create({ service: "cron-scheduler" })

export type CronJob = {
  id: string
  name: string
  description: string
  expression: string
  command: string
  enabled: boolean
  createdAt: string
  lastRun?: string
  nextRun?: string
  runCount: number
}

type RuntimeJob = {
  job: CronJob
  fields: CronFields
  timer: ReturnType<typeof setTimeout> | null
}

const STORE_PATH = () => path.join(Global.Path.state, "cron-jobs.json")

// In-memory registry of jobs
const registry = new Map<string, RuntimeJob>()

// ─── Persistence ──────────────────────────────────────────────────────────────

async function load(): Promise<CronJob[]> {
  try {
    const file = Bun.file(STORE_PATH())
    if (!(await file.exists())) return []
    const data = await file.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

async function save(jobs: CronJob[]): Promise<void> {
  try {
    await Bun.write(STORE_PATH(), JSON.stringify(jobs, null, 2))
  } catch (err) {
    log.error("Failed to persist cron jobs", { err })
  }
}

async function persist(): Promise<void> {
  const jobs = Array.from(registry.values()).map((r) => r.job)
  await save(jobs)
}

// ─── Scheduling ───────────────────────────────────────────────────────────────

function scheduleNext(runtime: RuntimeJob): void {
  if (runtime.timer) {
    clearTimeout(runtime.timer)
    runtime.timer = null
  }

  if (!runtime.job.enabled) return

  const next = computeNextCronRun(runtime.fields, new Date())
  if (!next) return

  runtime.job.nextRun = next.toISOString()

  const delay = next.getTime() - Date.now()
  runtime.timer = setTimeout(async () => {
    await fire(runtime)
  }, Math.max(0, delay))
}

async function fire(runtime: RuntimeJob): Promise<void> {
  const job = runtime.job
  log.info("cron job fired", { id: job.id, name: job.name, command: job.command })

  job.lastRun = new Date().toISOString()
  job.runCount += 1

  try {
    const proc = Bun.spawn(["bash", "-c", job.command], {
      cwd: process.cwd(),
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    })

    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ])
    const exitCode = await proc.exited

    log.info("cron job completed", { id: job.id, exitCode, stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 200) })
  } catch (err) {
    log.error("cron job failed", { id: job.id, err })
  }

  await persist()
  scheduleNext(runtime)
}

// ─── Public API ───────────────────────────────────────────────────────────────

export namespace CronScheduler {
  /**
   * Initialize the scheduler — load persisted jobs and schedule them.
   * Call once at startup.
   */
  export async function init(): Promise<void> {
    const jobs = await load()
    for (const job of jobs) {
      const fields = parseCronExpression(job.expression)
      if (!fields) {
        log.warn("invalid cron expression, skipping", { id: job.id, expression: job.expression })
        continue
      }
      const runtime: RuntimeJob = { job: { ...job }, fields, timer: null }
      registry.set(job.id, runtime)
      if (job.enabled) scheduleNext(runtime)
    }
    log.info("cron scheduler initialized", { count: registry.size })
  }

  /**
   * Register a new cron job.
   */
  export async function add(params: {
    name: string
    description: string
    expression: string
    command: string
  }): Promise<CronJob> {
    const fields = parseCronExpression(params.expression)
    if (!fields) throw new Error(`Invalid cron expression: "${params.expression}"`)

    const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const job: CronJob = {
      id,
      name: params.name,
      description: params.description,
      expression: params.expression,
      command: params.command,
      enabled: true,
      createdAt: new Date().toISOString(),
      runCount: 0,
    }

    const runtime: RuntimeJob = { job, fields, timer: null }
    registry.set(id, runtime)
    scheduleNext(runtime)
    await persist()

    log.info("cron job added", { id, name: job.name, expression: job.expression, next: job.nextRun })
    return job
  }

  /**
   * List all registered cron jobs.
   */
  export function list(): CronJob[] {
    return Array.from(registry.values()).map((r) => ({ ...r.job }))
  }

  /**
   * Get a single cron job by ID.
   */
  export function get(id: string): CronJob | undefined {
    return registry.get(id) ? { ...registry.get(id)!.job } : undefined
  }

  /**
   * Enable or disable a cron job.
   */
  export async function setEnabled(id: string, enabled: boolean): Promise<CronJob> {
    const runtime = registry.get(id)
    if (!runtime) throw new Error(`Cron job not found: ${id}`)

    runtime.job.enabled = enabled
    if (enabled) {
      scheduleNext(runtime)
    } else if (runtime.timer) {
      clearTimeout(runtime.timer)
      runtime.timer = null
      runtime.job.nextRun = undefined
    }

    await persist()
    return { ...runtime.job }
  }

  /**
   * Remove a cron job permanently.
   */
  export async function remove(id: string): Promise<void> {
    const runtime = registry.get(id)
    if (!runtime) throw new Error(`Cron job not found: ${id}`)

    if (runtime.timer) clearTimeout(runtime.timer)
    registry.delete(id)
    await persist()
    log.info("cron job removed", { id })
  }

  /**
   * Run a cron job immediately (regardless of schedule).
   */
  export async function runNow(id: string): Promise<void> {
    const runtime = registry.get(id)
    if (!runtime) throw new Error(`Cron job not found: ${id}`)
    await fire(runtime)
  }

  /**
   * Get a human-readable summary of all jobs.
   */
  export function summary(): string {
    const jobs = list()
    if (jobs.length === 0) return "No cron jobs scheduled."

    return jobs
      .map((job) => {
        const status = job.enabled ? "✅" : "⏸️"
        const schedule = cronToHuman(job.expression)
        const last = job.lastRun ? new Date(job.lastRun).toLocaleString() : "Never"
        const next = job.nextRun ? new Date(job.nextRun).toLocaleString() : "N/A"
        return [
          `${status} **${job.name}** (${job.id})`,
          `   Schedule: ${schedule} (\`${job.expression}\`)`,
          `   Command: \`${job.command}\``,
          `   Runs: ${job.runCount} | Last: ${last} | Next: ${next}`,
        ].join("\n")
      })
      .join("\n\n")
  }
}
