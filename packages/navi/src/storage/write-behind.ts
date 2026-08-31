export const DEFAULT_WRITE_BATCH_MAX_DELAY_MS = 200
export const MAX_TIMER_DELAY_MS = 2147483647

export interface WriteBehindOptions {
  readonly maxDelayMs: number
  readonly write: (events: readonly unknown[]) => Promise<void>
  readonly reportBackgroundFailure: (error: unknown) => void
}

export class SessionWriteBehind {
  private pending: unknown[] = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<void> | undefined
  private barrier: Promise<void> | undefined
  private barrierResolve: (() => void) | undefined
  private barrierReject: ((e: unknown) => void) | undefined
  private deadlineExpired = false
  private automaticPaused = false

  constructor(private readonly options: WriteBehindOptions) {}

  get hasWork(): boolean {
    return this.pending.length > 0 || this.active !== undefined
  }

  enqueue(event: unknown): void {
    const wasEmpty = this.pending.length === 0
    this.pending.push(structuredClone(event))
    if (this.barrier !== undefined) return
    if (this.automaticPaused) {
      this.automaticPaused = false
      this.deadlineExpired = false
      this.armTimer()
      return
    }
    if (wasEmpty) this.armTimer()
  }

  flush(): Promise<void> {
    if (this.barrier !== undefined) return this.barrier
    this.cancelTimer()
    this.deadlineExpired = false
    this.automaticPaused = false
    let resolve!: () => void
    let reject!: (e: unknown) => void
    const barrier = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })
    this.barrier = barrier
    this.barrierResolve = resolve
    this.barrierReject = reject
    void this.drainBarrier()
    return barrier
  }

  cancelAutomaticWait(): void {
    this.cancelTimer()
    this.deadlineExpired = false
  }

  private armTimer(): void {
    this.timer = setTimeout(() => this.onDeadline(), this.options.maxDelayMs)
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private onDeadline(): void {
    this.timer = undefined
    if (this.active !== undefined) {
      this.deadlineExpired = true
      return
    }
    this.startBackground()
  }

  private startBackground(): void {
    const active = this.startWrite(true)
    void active.then(() => this.continueAutomatic(), () => {})
  }

  private continueAutomatic(): void {
    if (this.barrier !== undefined || this.pending.length === 0) return
    if (this.deadlineExpired) {
      this.deadlineExpired = false
      this.startBackground()
    }
  }

  private async drainBarrier(): Promise<void> {
    try {
      if (this.active !== undefined) {
        await Promise.allSettled([this.active])
        this.automaticPaused = false
      }
      while (this.pending.length > 0) await this.startWrite(false)
    } catch (error) {
      const rej = this.barrierReject!
      this.barrier = undefined
      this.barrierResolve = undefined
      this.barrierReject = undefined
      rej(error)
      return
    }
    const res = this.barrierResolve!
    this.barrier = undefined
    this.barrierResolve = undefined
    this.barrierReject = undefined
    res()
  }

  private startWrite(background: boolean): Promise<void> {
    const batch = this.pending.splice(0)
    this.cancelTimer()
    this.deadlineExpired = false
    const op = Promise.resolve().then(() => this.options.write(batch))
    const active = op
      .catch((error: unknown) => {
        this.pending = batch.concat(this.pending)
        this.cancelTimer()
        this.deadlineExpired = false
        this.automaticPaused = true
        if (background) this.options.reportBackgroundFailure(error)
        throw error
      })
      .finally(() => {
        this.active = undefined
      })
    this.active = active
    return active
  }
}

export * as WriteBehind from "./write-behind"
