import { Effect } from "effect"
import type * as Tool from "./tool"

declare const ScopeBrand: unique symbol
export type ScopeKey = object & { readonly [ScopeBrand]: never }

const scopeParents = new WeakMap<ScopeKey, ScopeKey>()
const kScope = Symbol("navi.scope")

function linkScopeParent(key: ScopeKey, parent: ScopeKey): void {
  for (let cur: ScopeKey | undefined = parent; cur !== undefined; cur = scopeParents.get(cur)) {
    if (cur === key) throw new Error("scope parent link would form a cycle")
  }
  scopeParents.set(key, parent)
}

export function bindScopeParent(key: ScopeKey, parent: ScopeKey): { rebind(parent: ScopeKey): void } {
  if (scopeParents.has(key)) throw new Error("scope key already bound; use binding.rebind")
  linkScopeParent(key, parent)
  return { rebind(next: ScopeKey): void { linkScopeParent(key, next) } }
}

export function createScope(parent?: ScopeKey): ScopeKey {
  const key = {} as ScopeKey
  if (parent !== undefined) bindScopeParent(key, parent)
  return key
}

export function scopeOf(ctx: unknown): ScopeKey | undefined {
  if (typeof ctx !== "object" || ctx === null) return undefined
  if (scopeParents.has(ctx as ScopeKey)) return ctx as ScopeKey
  return (ctx as Record<symbol, ScopeKey | undefined>)[kScope]
}

export function scopeParentOf(key: ScopeKey): ScopeKey | undefined {
  return scopeParents.get(key)
}

export function scopeChainOf(key: ScopeKey | undefined): ScopeKey[] {
  const chain: ScopeKey[] = []
  for (let cur = key; cur !== undefined; cur = scopeParents.get(cur)) chain.push(cur)
  return chain
}

export function withScope<T extends object>(scope: ScopeKey, ctx: T): T {
  return Object.assign(Object.create(Object.getPrototypeOf(ctx) as object), ctx, { [kScope]: scope }) as T
}

export interface ScopeLayer {
  isEmpty(): boolean
}

export class NamedEntries<T> {
  private data = new Map<string, T>()
  constructor(private readonly duplicateError: (name: string) => Error) {}
  insert(name: string, value: T): () => void {
    if (this.data.has(name)) throw this.duplicateError(name)
    this.data.set(name, value)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.data.delete(name)
      if (this.data.size === 0) this.data = new Map()
    }
  }
  get(name: string): T | undefined { return this.data.get(name) }
  has(name: string): boolean { return this.data.has(name) }
  keys(): IterableIterator<string> { return this.data.keys() }
  entries(): IterableIterator<[string, T]> { return this.data.entries() }
  values(): IterableIterator<T> { return this.data.values() }
  isEmpty(): boolean { return this.data.size === 0 }
  chain(): T[] { return [...this.data.values()] }
  append(name: string, value: T): () => void { return this.insert(name, value) }
}

export class AnonymousEntries<T> {
  private data = new Map<symbol, T>()
  append(value: T): () => void {
    const key = Symbol()
    this.data.set(key, value)
    let active = true
    return () => {
      if (!active) return
      active = false
      this.data.delete(key)
      if (this.data.size === 0) this.data = new Map()
    }
  }
  values(): IterableIterator<T> { return this.data.values() }
  isEmpty(): boolean { return this.data.size === 0 }
  chain(): T[] { return [...this.data.values()] }
}

export class ScopedLayers<L extends ScopeLayer> {
  readonly global: L
  readonly layers = new Map<ScopeKey, L>()
  constructor(
    private readonly createLayer: (scope: ScopeKey | undefined) => L,
    private readonly onChange?: () => void,
  ) {
    this.global = createLayer(undefined)
  }
  peek(scope: ScopeKey | undefined): L | undefined {
    if (scope === undefined) return undefined
    return this.layers.get(scope)
  }
  chainLayers(scope: ScopeKey | undefined): L[] {
    const out: L[] = []
    for (const key of scopeChainOf(scope).reverse()) {
      const layer = this.layers.get(key)
      if (layer !== undefined) out.push(layer)
    }
    return out
  }
  view(scope: ScopeKey | undefined): L[] {
    return [this.global, ...this.chainLayers(scope)]
  }
  merge<V>(scope: ScopeKey | undefined, pick: (layer: L) => NamedEntries<V>): Map<string, V> {
    const merged = new Map(pick(this.global).entries())
    for (const layer of this.chainLayers(scope)) for (const [k, v] of pick(layer).entries()) merged.set(k, v)
    return merged
  }
  effect(scope: ScopeKey | undefined, action: (layer: L) => () => void): () => void {
    let layer: L
    let created = false
    if (scope === undefined) layer = this.global
    else {
      const existing = this.layers.get(scope)
      if (existing === undefined) {
        layer = this.createLayer(scope)
        this.layers.set(scope, layer)
        created = true
      } else layer = existing
    }
    let undo: () => void
    try {
      undo = action(layer)
    } catch (error) {
      if (scope !== undefined && created && layer.isEmpty()) this.layers.delete(scope)
      throw error
    }
    if (this.onChange) this.onChange()
    return () => {
      undo()
      if (scope !== undefined && layer.isEmpty()) this.layers.delete(scope)
      if (this.onChange) this.onChange()
    }
  }
  effectWithContext(
    ctx: unknown,
    action: (layer: L) => () => void,
    options?: { label?: string },
  ): () => void {
    void options
    return this.effect(scopeOf(ctx), action)
  }
}

export type ToolPresentationMode = "native" | "code" | "both"

export interface ToolRestriction {
  readonly allow?: readonly string[]
  readonly deny?: readonly string[]
}

export type ToolGuard = (exec: Readonly<Tool.Context>) => string | undefined

export class ToolLayer implements ScopeLayer {
  readonly tools: NamedEntries<Tool.Def>
  readonly restrictions = new AnonymousEntries<ToolRestriction>()
  readonly guards = new AnonymousEntries<ToolGuard>()
  mode: ToolPresentationMode | undefined
  constructor(scope: ScopeKey | undefined) {
    this.tools = new NamedEntries<Tool.Def>(
      (name) =>
        new Error(
          scope === undefined
            ? `tool "${name}" already registered (use scoped ctx for per-agent variant)`
            : `tool "${name}" already registered in this scope`,
        ),
    )
  }
  isEmpty(): boolean {
    return this.tools.isEmpty() && this.restrictions.isEmpty() && this.guards.isEmpty() && this.mode === undefined
  }
  admits(name: string): boolean {
    for (const f of this.restrictions.values()) {
      if (f.allow !== undefined && !f.allow.includes(name)) return false
      if (f.deny !== undefined && f.deny.includes(name)) return false
    }
    return true
  }
  guardReason(ctx: Tool.Context): string | undefined {
    for (const g of this.guards.values()) {
      const r = g(ctx)
      if (r !== undefined) return r
    }
    return undefined
  }
}

export const RUN_CODE_NAME = "run_code"

export type ExecutionMode = { kind: "parallel" } | { kind: "exclusive" }

type ConcurrencyAware = Tool.Def & { isConcurrencySafe?: (args: unknown) => boolean }

export function isConcurrencySafe(def: Tool.Def, args: unknown): boolean {
  const aware = def as ConcurrencyAware
  if (typeof aware.isConcurrencySafe !== "function") return false
  try {
    return aware.isConcurrencySafe(args) === true
  } catch {
    return false
  }
}

export function executionMode(def: Tool.Def, args: unknown): ExecutionMode {
  return isConcurrencySafe(def, args) ? { kind: "parallel" } : { kind: "exclusive" }
}

const toolLayers = new ScopedLayers<ToolLayer>((scope) => new ToolLayer(scope))

export function view(scope?: ScopeKey): Map<string, Tool.Def> {
  const merged = toolLayers.merge(scope, (l) => l.tools)
  for (const layer of toolLayers.view(scope)) {
    for (const [name] of [...merged]) if (!layer.admits(name)) merged.delete(name)
  }
  if (toolLayers.view(scope).some((l) => l.mode === "code" || l.mode === "both")) {
    if (!merged.has(RUN_CODE_NAME)) {
      const placeholder = { id: RUN_CODE_NAME, description: "run_code transport", parameters: undefined as unknown as Tool.Def["parameters"], execute: () => Effect.fail(new Error("run_code not mounted")) } as unknown as Tool.Def
      merged.set(RUN_CODE_NAME, placeholder)
    }
  }
  return merged
}

export function restrict(filter: ToolRestriction, scope?: ScopeKey): () => void {
  if (scope === undefined) throw new Error("restrict() requires a scoped key")
  if (filter.allow === undefined && filter.deny === undefined) throw new Error("restrict({}) is a no-op")
  const compiled: ToolRestriction = { ...filter }
  return toolLayers.effect(scope, (layer) => layer.restrictions.append(compiled))
}

export function guard(fn: ToolGuard, scope?: ScopeKey): () => void {
  return toolLayers.effect(scope, (layer) => layer.guards.append(fn))
}

export function presentAs(mode: ToolPresentationMode, scope?: ScopeKey): () => void {
  if (scope === undefined) throw new Error("presentAs() requires a scoped key")
  return toolLayers.effect(scope, (layer) => {
    if (layer.mode !== undefined) throw new Error(`presentAs("${mode}") conflicts with "${layer.mode}" already declared for this scope`)
    layer.mode = mode
    return () => { layer.mode = undefined }
  })
}

export const ToolRuntime = { view, restrict, guard, presentAs, isConcurrencySafe, executionMode, layers: toolLayers, RUN_CODE_NAME }
