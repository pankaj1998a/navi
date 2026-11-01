import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Skill, invalidateSkillCaches } from "../../src/skill"
import { CrossSpawnSpawner } from "@navi-ai/core/cross-spawn-spawner"
import {
  provideInstance,
  provideTmpdirInstance,
  reloadTestInstance,
  tmpdir,
  tmpdirScoped,
} from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import path from "path"
import fs from "fs/promises"

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(Skill.defaultLayer, node))

async function createGlobalSkill(homeDir: string) {
  const skillDir = path.join(homeDir, ".claude", "skills", "global-test-skill")
  await fs.mkdir(skillDir, { recursive: true })
  await Bun.write(
    path.join(skillDir, "SKILL.md"),
    `---
name: global-test-skill
description: A global skill from ~/.claude/skills for testing.
---

# Global Test Skill

This skill is loaded from the global home directory.
`,
  )
}

const withHome = <A, E, R>(home: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.NAVI_TEST_HOME
      process.env.NAVI_TEST_HOME = home
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        process.env.NAVI_TEST_HOME = prev
      }),
  )

describe("skill", () => {
  it.live("discovers skills from .navi/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".navi", "skill", "test-skill", "SKILL.md"),
              `---
name: test-skill
description: A test skill for verification.
---

# Test Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "test-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBe("A test skill for verification.")
          expect(item!.location).toContain(path.join("skill", "test-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("returns skill directories from Skill.dirs", () =>
    provideTmpdirInstance(
      (dir) =>
        withHome(
          dir,
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              Bun.write(
                path.join(dir, ".navi", "skill", "dir-skill", "SKILL.md"),
                `---
name: dir-skill
description: Skill for dirs test.
---

# Dir Skill
`,
              ),
            )

            const skill = yield* Skill.Service
            const dirs = yield* skill.dirs()
            expect(dirs).toContain(path.join(dir, ".navi", "skill", "dir-skill"))
            expect(dirs.length).toBe(1)
          }),
        ),
      { git: true },
    ),
  )

  it.live("discovers multiple skills from .navi/skill/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".navi", "skill", "skill-one", "SKILL.md"),
                `---
name: skill-one
description: First test skill.
---

# Skill One
`,
              ),
              Bun.write(
                path.join(dir, ".navi", "skill", "skill-two", "SKILL.md"),
                `---
name: skill-two
description: Second test skill.
---

# Skill Two
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "skill-one")).toBeDefined()
          expect(list.find((x) => x.name === "skill-two")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("skips skills with missing frontmatter", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".navi", "skill", "no-frontmatter", "SKILL.md"),
              `# No Frontmatter

Just some content without YAML frontmatter.
`,
            ),
          )

          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("discovers skills without descriptions", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".navi", "skill", "manual-skill", "SKILL.md"),
              `---
name: manual-skill
---

# Manual Skill

Instructions here.
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "manual-skill")
          expect(item).toBeDefined()
          expect(item!.description).toBeUndefined()
          expect(Skill.fmt(list, { verbose: false })).toBe("No skills are currently available.")
          expect(Skill.fmt(list, { verbose: true })).toBe("No skills are currently available.")
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .claude/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
              `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "claude-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".claude", "skills", "claude-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.claude/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          yield* Effect.promise(() => createGlobalSkill(tmp.path))
          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = yield* skill.all()
            expect(list.length).toBe(1)
            const first = list[0]
            if (!first) throw new Error("missing global-test-skill")
            expect(first.name).toBe("global-test-skill")
            expect(first.description).toBe("A global skill from ~/.claude/skills for testing.")
            expect(first.location).toContain(path.join(".claude", "skills", "global-test-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("returns empty array when no skills exist", () =>
    provideTmpdirInstance(
      () =>
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          expect(yield* skill.all()).toEqual([])
        }),
      { git: true },
    ),
  )

  it.live("discovers skills from .agents/skills/ directory", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Bun.write(
              path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
              `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
            ),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(1)
          const item = list.find((x) => x.name === "agent-skill")
          expect(item).toBeDefined()
          expect(item!.location).toContain(path.join(".agents", "skills", "agent-skill", "SKILL.md"))
        }),
      { git: true },
    ),
  )

  it.live("discovers global skills from ~/.agents/skills/ directory", () =>
    Effect.gen(function* () {
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => tmpdir({ git: true })),
        (tmp) => Effect.promise(() => tmp[Symbol.asyncDispose]()),
      )

      yield* withHome(
        tmp.path,
        Effect.gen(function* () {
          const skillDir = path.join(tmp.path, ".agents", "skills", "global-agent-skill")
          yield* Effect.promise(() => fs.mkdir(skillDir, { recursive: true }))
          yield* Effect.promise(() =>
            Bun.write(
              path.join(skillDir, "SKILL.md"),
              `---
name: global-agent-skill
description: A global skill from ~/.agents/skills for testing.
---

# Global Agent Skill

This skill is loaded from the global home directory.
`,
            ),
          )

          yield* Effect.gen(function* () {
            const skill = yield* Skill.Service
            const list = yield* skill.all()
            expect(list.length).toBe(1)
            const first = list[0]
            if (!first) throw new Error("missing global-agent-skill")
            expect(first.name).toBe("global-agent-skill")
            expect(first.description).toBe("A global skill from ~/.agents/skills for testing.")
            expect(first.location).toContain(path.join(".agents", "skills", "global-agent-skill", "SKILL.md"))
          }).pipe(provideInstance(tmp.path))
        }),
      )
    }),
  )

  it.live("discovers skills from both .claude/skills/ and .agents/skills/", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          const list = yield* skill.all()
          expect(list.length).toBe(2)
          expect(list.find((x) => x.name === "claude-skill")).toBeDefined()
          expect(list.find((x) => x.name === "agent-skill")).toBeDefined()
        }),
      { git: true },
    ),
  )

  it.live("properly resolves directories that skills live in", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            Promise.all([
              Bun.write(
                path.join(dir, ".claude", "skills", "claude-skill", "SKILL.md"),
                `---
name: claude-skill
description: A skill in the .claude/skills directory.
---

# Claude Skill
`,
              ),
              Bun.write(
                path.join(dir, ".agents", "skills", "agent-skill", "SKILL.md"),
                `---
name: agent-skill
description: A skill in the .agents/skills directory.
---

# Agent Skill
`,
              ),
              Bun.write(
                path.join(dir, ".navi", "skill", "agent-skill", "SKILL.md"),
                `---
name: navi-skill
description: A skill in the .navi/skill directory.
---

# Navi Skill
`,
              ),
              Bun.write(
                path.join(dir, ".navi", "skills", "agent-skill", "SKILL.md"),
                `---
name: navi-skill
description: A skill in the .navi/skills directory.
---

# Navi Skill
`,
              ),
            ]),
          )

          const skill = yield* Skill.Service
          expect((yield* skill.dirs()).length).toBe(4)
        }),
      { git: true },
    ),
  )

  describe("discovery cache", () => {
    const skillFile = (name: string, description: string) =>
      ["---", `name: ${name}`, `description: ${description}`, "---", "", `# ${name}`, ""].join("\n")

    // `it.instance` loads through a different InstanceStore than
    // `reloadTestInstance`, and only that store's reload runs instance disposers,
    // so these tests drive `provideInstance` explicitly.
    const names = (dir: string) =>
      provideInstance(dir)(
        Effect.gen(function* () {
          const skill = yield* Skill.Service
          const list = yield* skill.all()
          return list.map((item) => item.name).sort()
        }),
      )

    it.live("picks up a skill folder added under skills/ after reload", () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() =>
          Bun.write(path.join(dir, ".navi", "skills", "inv-one", "SKILL.md"), skillFile("inv-one", "first")),
        )
        expect(yield* names(dir)).toEqual(["inv-one"])

        yield* Effect.promise(() =>
          Bun.write(path.join(dir, ".navi", "skills", "inv-two", "SKILL.md"), skillFile("inv-two", "second")),
        )
        yield* Effect.promise(() => reloadTestInstance({ directory: dir }))

        expect(yield* names(dir)).toEqual(["inv-one", "inv-two"])
      }),
    )

    it.live("drops a skill whose SKILL.md was removed", () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() =>
          Bun.write(path.join(dir, ".navi", "skills", "inv-keep", "SKILL.md"), skillFile("inv-keep", "keep")),
        )
        yield* Effect.promise(() =>
          Bun.write(path.join(dir, ".navi", "skills", "inv-drop", "SKILL.md"), skillFile("inv-drop", "drop")),
        )
        expect(yield* names(dir)).toEqual(["inv-drop", "inv-keep"])

        yield* Effect.promise(() => fs.rm(path.join(dir, ".navi", "skills", "inv-drop", "SKILL.md")))
        yield* Effect.promise(() => reloadTestInstance({ directory: dir }))

        expect(yield* names(dir)).toEqual(["inv-keep"])
      }),
    )

    it.live("re-reads an edited SKILL.md without dropping the discovery cache", () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        const file = path.join(dir, ".navi", "skills", "inv-edit", "SKILL.md")
        yield* Effect.promise(() => Bun.write(file, skillFile("inv-edit", "before edit")))
        const before = yield* provideInstance(dir)(
          Effect.gen(function* () {
            return yield* (yield* Skill.Service).get("inv-edit")
          }),
        )
        expect(before?.description).toBe("before edit")

        // Same path, no new skill folder: only the per-file mtime/size cache can
        // notice this, so this covers the parse cache invalidation path.
        yield* Effect.promise(() => Bun.write(file, skillFile("inv-edit", "after edit, now longer")))
        yield* Effect.promise(() => reloadTestInstance({ directory: dir }))
        const after = yield* provideInstance(dir)(
          Effect.gen(function* () {
            return yield* (yield* Skill.Service).get("inv-edit")
          }),
        )
        expect(after?.description).toBe("after edit, now longer")
      }),
    )

    it.live("invalidateSkillCaches() picks up nested additions roots cannot see", () =>
      Effect.gen(function* () {
        const dir = yield* tmpdirScoped({ git: true })
        yield* Effect.promise(() =>
          Bun.write(path.join(dir, ".navi", "skills", "inv-group", "SKILL.md"), skillFile("inv-group", "group")),
        )
        expect(yield* names(dir)).toEqual(["inv-group"])

        // A nested folder does not change the mtimes of the skill roots, so the
        // cached discovery list is still reused until the TTL or an explicit drop.
        yield* Effect.promise(() =>
          Bun.write(
            path.join(dir, ".navi", "skills", "inv-group", "nested", "SKILL.md"),
            skillFile("inv-nested", "nested"),
          ),
        )
        yield* Effect.promise(() => reloadTestInstance({ directory: dir }))
        expect(yield* names(dir)).toEqual(["inv-group"])

        invalidateSkillCaches()
        yield* Effect.promise(() => reloadTestInstance({ directory: dir }))
        expect(yield* names(dir)).toEqual(["inv-group", "inv-nested"])
      }),
    )
  })
})
