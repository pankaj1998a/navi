import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { Skill } from "../skill/skill"
import { Storage } from "../storage/storage"
import { errors } from "./error"
import z from "zod"

export const SkillRoute = new Hono()
    .get(
        "/",
        describeRoute({
            summary: "List skills",
            description: "Get a list of all available skills.",
            operationId: "skill.list",
            responses: {
                200: {
                    description: "List of skills",
                    content: {
                        "application/json": {
                            schema: resolver(Skill.Info.array()),
                        },
                    },
                },
            },
        }),
        async (c) => {
            return c.json(await Skill.all())
        },
    )
    .get(
        "/:skillName",
        describeRoute({
            summary: "Get skill",
            description: "Retrieve details for a specific skill.",
            operationId: "skill.get",
            responses: {
                200: {
                    description: "Skill details",
                    content: {
                        "application/json": {
                            schema: resolver(Skill.Info),
                        },
                    },
                },
                ...errors(404),
            },
        }),
        validator("param", z.object({ skillName: z.string() })),
        async (c) => {
            const skill = await Skill.get(c.req.valid("param").skillName)
            if (!skill) throw new Storage.NotFoundError({ message: "Skill not found" })
            return c.json(skill)
        },
    )
