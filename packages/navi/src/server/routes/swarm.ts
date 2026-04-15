import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { z } from "zod"
import { P2PDiscovery } from "@/p2p/discovery"
import { Log } from "../../util/log"
import { errors } from "../error"

const log = Log.create({ service: "swarm-route" })

export const swarmRoute = new Hono()
  .get(
    "/peers",
    describeRoute({
      summary: "List swarm peers",
      description: "Get a list of all discovered Navi peers on the local network.",
      operationId: "swarm.peers",
      responses: {
        200: {
          description: "List of peers",
          content: {
            "application/json": {
              schema: resolver(z.object({ peers: z.any() })),
            },
          },
        },
      },
    }),
    async (c) => {
      return c.json({ peers: P2PDiscovery.getPeers() })
    },
  )
  .post(
    "/delegate",
    describeRoute({
      summary: "Delegate task to peer",
      description: "Hand off a high-compute task (like testing or code review) to a swarm peer.",
      operationId: "swarm.delegate",
      responses: {
        200: {
          description: "Task successfully delegated",
        },
        ...errors(400, 404),
      },
    }),
    validator(
      "json",
      z.object({
        peerID: z.string(),
        taskName: z.string(),
        context: z.record(z.string(), z.any()).optional(),
      }),
    ),
    async (c) => {
      const { peerID, taskName } = c.req.valid("json")
      const peer = P2PDiscovery.getPeer(peerID)
      if (!peer) throw new Error(`Peer ${peerID} not found or offline`)
      
      log.info("delegating swarm task", { peer: peer.name, task: taskName })
      
      return c.json({ success: true, message: `Task '${taskName}' delegated to ${peer.name}` })
    },
  )




