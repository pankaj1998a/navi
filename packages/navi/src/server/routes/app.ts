import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"
import { Config } from "../../config/config"
import { Agent } from "../../agent/agent"
import { Command } from "../../command"
import { LSP } from "../../lsp"
import { Format } from "../../format"
import { Permission } from "../../permission"
import { errors } from "../error"

export const appRoute = new Hono()
  .get(
    "/agent",
    describeRoute({
      summary: "List agents",
      operationId: "app.agents",
      responses: {
        200: {
          description: "List of available agents",
          content: { "application/json": { schema: resolver(z.any().array()) } },
        },
      },
    }),
    async (c) => {
      return c.json(await Agent.list())
    },
  )
  .get(
    "/command",
    describeRoute({
      summary: "List commands",
      operationId: "command.list",
      responses: {
        200: {
          description: "List of available commands",
          content: { "application/json": { schema: resolver(z.any().array()) } },
        },
      },
    }),
    async (c) => {
      const list = await Command.list()
      return c.json(list.sort((a, b) => a.name.localeCompare(b.name)))
    },
  )
  .get(
    "/lsp/status",
    describeRoute({
      summary: "Get LSP status",
      operationId: "lsp.status",
      responses: {
        200: {
          description: "LSP server status",
          content: { "application/json": { schema: resolver(z.any().array()) } },
        },
      },
    }),
    async (c) => {
      return c.json(await LSP.status())
    },
  )
  .get(
    "/formatter/status",
    describeRoute({
      summary: "Get Formatter status",
      operationId: "formatter.status",
      responses: {
        200: {
          description: "Formatter status",
          content: { "application/json": { schema: resolver(z.any().array()) } },
        },
      },
    }),
    async (c) => {
      return c.json(await Format.status())
    },
  )
  .get(
    "/permission",
    describeRoute({
      summary: "List permissions",
      operationId: "permission.list",
      responses: {
        200: {
          description: "List of pending permissions",
          content: { "application/json": { schema: resolver(Permission.Info.array()) } },
        },
      },
    }),
    async (c) => {
      return c.json(Permission.list())
    },
  )
  .post(
    "/permission/:permissionID/respond",
    describeRoute({
      summary: "Respond to permission request",
      operationId: "permission.respond",
      responses: {
        200: { description: "Success" },
        ...errors(400, 404),
      },
    }),
    async (c) => {
        const { permissionID } = c.req.param()
        const { response } = await c.req.json()
        Permission.respond({
            sessionID: c.req.query("sessionID")!,
            permissionID,
            response
        })
        return c.json({ success: true })
    }
  )




