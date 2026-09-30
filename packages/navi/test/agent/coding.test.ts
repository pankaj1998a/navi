import { afterEach, test, expect } from "bun:test"
import { Effect } from "effect"
import { disposeAllInstances, provideInstance, tmpdir } from "../fixture/fixture"
import { WithInstance } from "../../src/project/with-instance"
import { Agent } from "../../src/agent/agent"
import { Permission } from "../../src/permission"
import { ToolRegistry } from "../../src/tool/registry"

function evalPerm(agent: Agent.Info | undefined, permission: string): Permission.Action | undefined {
  if (!agent) return undefined
  return Permission.evaluate(permission, "*", agent.permission).action
}

function load<A>(dir: string, fn: (svc: Agent.Interface) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(Agent.Service.use(fn)).pipe(Effect.provide(Agent.defaultLayer)))
}

function loadTools<A>(dir: string, fn: (svc: typeof ToolRegistry.Service.Service) => Effect.Effect<A>) {
  return Effect.runPromise(provideInstance(dir)(ToolRegistry.Service.use(fn)).pipe(Effect.provide(ToolRegistry.defaultLayer)))
}

afterEach(async () => {
  await disposeAllInstances()
})

test("registers specialized coding agents with proper configuration and permissions", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const agents = await load(tmp.path, (svc) => svc.list())
      const names = agents.map((a) => a.name)

      // Verify all specialized agents exist
      expect(names).toContain("architect")
      expect(names).toContain("tdd")
      expect(names).toContain("reviewer")
      expect(names).toContain("researcher")
      expect(names).toContain("bridge")

      // Architect
      const architect = await load(tmp.path, (svc) => svc.get("architect"))
      expect(architect).toBeDefined()
      expect(architect?.mode).toBe("all")
      expect(evalPerm(architect, "arch_map")).toBe("allow")

      // TDD
      const tdd = await load(tmp.path, (svc) => svc.get("tdd"))
      expect(tdd).toBeDefined()
      expect(tdd?.mode).toBe("subagent")
      expect(evalPerm(tdd, "test_runner")).toBe("allow")

      // Reviewer (Read-only)
      const reviewer = await load(tmp.path, (svc) => svc.get("reviewer"))
      expect(reviewer).toBeDefined()
      expect(reviewer?.mode).toBe("subagent")
      expect(evalPerm(reviewer, "edit")).toBe("deny")
      expect(evalPerm(reviewer, "write")).toBe("deny")

      // Researcher
      const researcher = await load(tmp.path, (svc) => svc.get("researcher"))
      expect(researcher).toBeDefined()
      expect(researcher?.mode).toBe("subagent")
      expect(evalPerm(researcher, "arch_map")).toBe("allow")

      // Bridge
      const bridge = await load(tmp.path, (svc) => svc.get("bridge"))
      expect(bridge).toBeDefined()
      expect(bridge?.mode).toBe("subagent")
      expect(evalPerm(bridge, "browser")).toBe("allow")
    },
  })
})

test("tool registry includes developer coding tools", async () => {
  await using tmp = await tmpdir()
  await WithInstance.provide({
    directory: tmp.path,
    fn: async () => {
      const toolIDs = await loadTools(tmp.path, (svc) => svc.ids())

      expect(toolIDs).toContain("test_runner")
      expect(toolIDs).toContain("browser")
      expect(toolIDs).toContain("arch_map")
      expect(toolIDs).toContain("checkpoint")
    },
  })
})
