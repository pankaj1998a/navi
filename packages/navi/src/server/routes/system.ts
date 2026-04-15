import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { z } from "zod"
import { Config } from "../../config/config"
import { Provider } from "../../provider/provider"
import { Global } from "../../global"
import { Instance } from "../../project/instance"
import { Vcs } from "../../project/vcs"
import { SymbolCache } from "../../util/symbol-cache"
import { VoiceService } from "../../voice/service"
import { Project } from "../../project/project"
import { BridgeService } from "../bridge-service"
import { File } from "../../file"
import { Agent } from "../../agent/agent"
import { Log } from "../../util/log"
import { Installation } from "@/installation"
import { SpeculationEngine } from "../../ai/speculation-engine"
import { errors } from "../error"

export const systemRoute = new Hono()
  .get("/global/health", async (c) => c.json({ healthy: true, version: Installation.VERSION }))
  .get("/config", async (c) => c.json(await Config.get()))
  .get("/config/providers", async (c) => {
    const cfg = await Config.get()
    const providers = Object.values(await Provider.list())
    return c.json({
      providers,
      default: { model: cfg.model, small_model: cfg.small_model }
    })
  })
  .patch("/config", async (c) => {
    const config = await c.req.json()
    await Config.update(config)
    return c.json(config)
  })
  .get("/path", async (c) => c.json({
    home: Global.Path.home,
    state: Global.Path.state,
    config: Global.Path.config,
    worktree: Instance.worktree,
    directory: Instance.directory,
  }))
  .get("/vcs", async (c) => c.json({ branch: await Vcs.branch() }))
  .get("/global/symbols", async (c) => c.json({ symbols: await SymbolCache.getSymbols() }))
  .post("/log", async (c) => {
    const { service, level, message, extra } = await c.req.json()
    const logger = Log.create({ service })
    if (level === "info") logger.info(message, extra)
    else if (level === "error") logger.error(message, extra)
    return c.json(true)
  })
  .get("/file/list", async (c) => c.json(await File.list(c.req.query("path") || "")))
  .get("/file/content", async (c) => c.json(await File.read(c.req.query("path") || "")))
  .get("/file/status", async (c) => c.json(await File.status()))
  .post("/global/speculate", async (c) => {
    const { query } = await c.req.json()
    SpeculationEngine.propose(query).catch(() => {})
    return c.json(true)
  })
  .get("/global/bridge/status", async (c) => c.json({ connections: BridgeService.getConnections() }))
  .post("/voice/start", async (c) => { await VoiceService.start(); return c.json({ ok: true }) })
  .post("/voice/stop", async (c) => c.json({ transcription: await VoiceService.stop() }))
  .post("/instance/dispose", async (c) => { await Instance.dispose(); return c.json(true) })




