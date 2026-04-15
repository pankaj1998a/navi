import { RequestError, type McpServer } from "@agentclientprotocol/sdk"
import type { ACPSessionState } from "./types"
import { Log } from "@/util/log"
import type { NaviClient } from "@navi-ai/sdk/v2"

const log = Log.create({ service: "acp-session-manager" })

export class ACPSessionManager {
  private sessions = new Map<string, ACPSessionState>()
  private sdk: NaviClient

  constructor(sdk: NaviClient) {
    this.sdk = sdk
  }

  tryGet(sessionID: string): ACPSessionState | undefined {
    return this.sessions.get(sessionID)
  }

  async create(cwd: string, mcpServers: McpServer[], model?: ACPSessionState["model"]): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .create(
        {
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    const sessionID = session.id
    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionID,
      cwd,
      mcpServers,
      createdAt: new Date(),
      model: resolvedModel,
    }
    log.info("creating_session", { state })

    this.sessions.set(sessionID, state)
    return state
  }

  async load(
    sessionID: string,
    cwd: string,
    mcpServers: McpServer[],
    model?: ACPSessionState["model"],
  ): Promise<ACPSessionState> {
    const session = await this.sdk.session
      .get(
        {
          sessionID: sessionID,
          directory: cwd,
        },
        { throwOnError: true },
      )
      .then((x) => x.data!)

    const resolvedModel = model

    const state: ACPSessionState = {
      id: sessionID,
      cwd,
      mcpServers,
      createdAt: new Date(session.time.created),
      model: resolvedModel,
    }
    log.info("loading_session", { state })

    this.sessions.set(sessionID, state)
    return state
  }

  get(sessionID: string): ACPSessionState {
    const session = this.sessions.get(sessionID)
    if (!session) {
      log.error("session not found", { sessionID })
      throw RequestError.invalidParams(JSON.stringify({ error: `Session not found: ${sessionID}` }))
    }
    return session
  }

  getModel(sessionID: string) {
    const session = this.get(sessionID)
    return session.model
  }

  setModel(sessionID: string, model: ACPSessionState["model"]) {
    const session = this.get(sessionID)
    session.model = model
    this.sessions.set(sessionID, session)
    return session
  }

  getVariant(sessionID: string) {
    const session = this.get(sessionID)
    return session.variant
  }

  setVariant(sessionID: string, variant?: string) {
    const session = this.get(sessionID)
    session.variant = variant
    this.sessions.set(sessionID, session)
    return session
  }

  setMode(sessionID: string, modeId: string) {
    const session = this.get(sessionID)
    session.modeId = modeId
    this.sessions.set(sessionID, session)
    return session
  }
}

