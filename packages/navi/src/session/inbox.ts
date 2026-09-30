export type InboxTarget = "next-turn" | "next-step"

export interface InboxState {
  nextTurn: unknown[]
  nextStep: unknown[]
}

export type WakeReason = "followup" | "steer" | "inject"

export class Inbox {
  private state: InboxState = { nextTurn: [], nextStep: [] }

  constructor(private readonly seedLength = 0) {}

  get snapshot(): InboxState {
    return { nextTurn: [...this.state.nextTurn], nextStep: [...this.state.nextStep] }
  }

  send(message: unknown, target: InboxTarget, wake = true): { target: InboxTarget; wake: boolean } {
    if (target === "next-turn") this.state.nextTurn.push(structuredClone(message))
    else this.state.nextStep.push(structuredClone(message))
    return { target, wake }
  }

  followup(message: unknown): { target: InboxTarget; wake: boolean } {
    return this.send(message, "next-turn", true)
  }

  steer(message: unknown): { target: InboxTarget; wake: boolean } {
    return this.send(message, "next-step", true)
  }

  inject(message: unknown): { target: InboxTarget; wake: boolean } {
    return this.send(message, "next-step", false)
  }

  splice(start: number, deleteCount: number, items: unknown[] = []): void {
    const merged = [...this.state.nextTurn, ...this.state.nextStep]
    merged.splice(start, deleteCount, ...items.map((i) => structuredClone(i)))
    const turnLen = this.state.nextTurn.length
    this.state.nextTurn = merged.slice(0, turnLen)
    this.state.nextStep = merged.slice(turnLen)
  }

  claim(target: "turn" | "step"): unknown[] {
    if (target === "step") return this.state.nextStep.splice(0)
    const step = this.state.nextStep.splice(0)
    const turn = this.state.nextTurn.length > 0 ? [this.state.nextTurn.shift()!] : []
    return [...step, ...turn]
  }

  clear(): void {
    this.state.nextTurn.length = 0
    this.state.nextStep.length = 0
  }

  validate(ids: string[]): void {
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) throw new Error(`duplicate inbox id: ${id}`)
      seen.add(id)
    }
  }

  toJSON(): InboxState {
    return this.snapshot
  }

  fromJSON(state: InboxState): void {
    this.state.nextTurn = state.nextTurn.map((m) => structuredClone(m))
    this.state.nextStep = state.nextStep.map((m) => structuredClone(m))
  }

  replay(events: { target: InboxTarget; message: unknown }[]): void {
    this.clear()
    for (const e of events) this.send(e.message, e.target, false)
  }
}

export * as InboxModule from "./inbox"
