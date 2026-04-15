import { Bonjour, Service } from "bonjour-service"
import { Log } from "@/util/log"
import { z } from "zod"
import { PeerInfo, PeerId, type P2PConfig } from "./types"
import { EventEmitter } from "events"
import { Global } from "@/global"
import { Installation } from "@/installation"
import { v4 as uuidv4 } from "uuid"

const log = Log.create({ service: "p2p-discovery" })

// Service type for Navi P2P
const NAVI_SERVICE_TYPE = "navi-p2p"
const NAVI_SERVICE_PROTOCOL = "tcp"

/**
 * P2P Discovery Module
 * 
 * Discovers and announces Navi instances on the local network using mDNS.
 */
export namespace P2PDiscovery {
  // Event emitter for discovery events
  const emitter = new EventEmitter<{
    "peer:joined": [PeerInfo]
    "peer:left": [string]
    "peer:updated": [PeerInfo]
  }>()

  // Active bonjour instance
  let bonjour: Bonjour | undefined
  let browser: ReturnType<Bonjour["find"]> | undefined
  let publishedService: Service | undefined

  // Known peers
  const peers = new Map<string, PeerInfo>()

  // This peer's info
  let selfInfo: PeerInfo | undefined
  let currentPort: number | undefined
  let discoveryInterval: Timer | undefined

  // Generate unique peer ID
  function generatePeerId(): string {
    const hostname = require("os").hostname()
    const shortId = uuidv4().split("-")[0]
    return `navi-${hostname}-${shortId}`
  }

  /**
   * Initialize discovery and start announcing this peer
   */
  export function init(config: P2PConfig, port: number): void {
    if (!config.enabled || !config.discovery.mdns) {
      log.info("P2P discovery disabled by config")
      return
    }

    // Create self info
    selfInfo = {
      id: generatePeerId(),
      name: `Navi @ ${require("os").hostname()}`,
      hostname: "0.0.0.0",
      port,
      version: Installation.VERSION,
      capabilities: getCapabilities(config),
      status: "online",
      lastSeen: Date.now(),
    }

    currentPort = port

    // Start announcing
    publish(port, selfInfo)

    // Start browsing for other peers
    browse()

    // Periodic refresh
    discoveryInterval = setInterval(() => {
      refreshPeerList()
    }, config.discovery.interval)

    log.info("P2P discovery initialized", { peerId: selfInfo.id, port })
  }

  /**
   * Publish this Navi instance as a discoverable service
   */
  function publish(port: number, info: PeerInfo): void {
    if (bonjour && publishedService) {
      // Already published
      if (currentPort === port) return
      unpublish()
    }

    try {
      bonjour = new Bonjour()

      // Suppress "Service name is already in use on the network" from bonjour-service internals
      const origConsoleLog = console.log
      console.log = (...args: any[]) => {
        const msg = args.join(" ")
        if (msg.includes("Service name is already in use")) {
          log.warn("mDNS service name conflict (suppressed)", { name: info.id })
          return
        }
        origConsoleLog(...args)
      }

      publishedService = bonjour.publish({
        name: info.id,
        type: NAVI_SERVICE_TYPE,
        protocol: NAVI_SERVICE_PROTOCOL,
        port,
        txt: {
          version: info.version || Installation.VERSION,
          name: info.name,
          capabilities: info.capabilities?.join(",") || "",
          workspaces: info.workspaces?.join(",") || "",
          status: info.status || "online",
        },
      })

      // Restore console.log after a short delay (publish is async)
      setTimeout(() => { console.log = origConsoleLog }, 3000)

      publishedService.on("up", () => {
        log.info("Published P2P service", { name: info.id, port })
      })

      publishedService.on("error", (err) => {
        log.warn("P2P service publish error (non-fatal)", { error: String(err) })
      })

      currentPort = port
    } catch (err) {
      log.warn("Failed to publish P2P service (non-fatal)", { error: String(err) })
    }
  }

  /**
   * Browse for other Navi instances on the network
   */
  function browse(): void {
    if (!bonjour) {
      bonjour = new Bonjour()
    }

    try {
      browser = bonjour.find(
        { type: NAVI_SERVICE_TYPE, protocol: NAVI_SERVICE_PROTOCOL },
        (service) => {
          handleServiceUp(service)
        }
      )

      browser.on("down", (service) => {
        handleServiceDown(service)
      })

      log.info("Started browsing for Navi peers")
    } catch (err) {
      log.error("Failed to browse for peers", { error: err })
    }
  }

  /**
   * Handle a discovered service coming online
   */
  function handleServiceUp(service: Service): void {
    // Skip self
    if (selfInfo && service.name === selfInfo.id) return

    const txt = service.txt || {}

    // Get the best IP address - prefer IPv4 over IPv6
    let hostname = "127.0.0.1"

    if (service.addresses && service.addresses.length > 0) {
      // Prefer IPv4 addresses, skip link-local
      const ipv4 = service.addresses.find((addr: string) =>
        addr.includes(".") && !addr.startsWith("169.254.")
      )
      const ipv6 = service.addresses.find((addr: string) =>
        addr.includes(":") && !addr.startsWith("fe80:")
      )
      hostname = ipv4 || ipv6 || service.addresses[0]
    } else if (service.host) {
      // Fallback to service.host, but clean it up
      const cleanHost = service.host.replace(/\.local\.?$/, "").replace(/\.local$/, "")
      // If it's a .local hostname, use localhost for same-machine connections
      if (service.host.includes(".local")) {
        hostname = "127.0.0.1"
      } else if (cleanHost && !cleanHost.includes(":")) {
        hostname = cleanHost
      }
    }

    // Ensure hostname is a valid IP or hostname
    if (!hostname || hostname === "") {
      hostname = "127.0.0.1"
    }

    const peer: PeerInfo = {
      id: service.name,
      name: txt.name || service.name,
      hostname,
      port: service.port,
      version: txt.version,
      capabilities: txt.capabilities?.split(",").filter(Boolean) || [],
      workspaces: txt.workspaces?.split(",").filter(Boolean) || [],
      status: (txt.status as PeerInfo["status"]) || "online",
      lastSeen: Date.now(),
    }

    const existing = peers.get(peer.id)
    if (existing) {
      // Update existing peer
      peers.set(peer.id, peer)
      emitter.emit("peer:updated", peer)
      log.debug("Peer updated", { peerId: peer.id })
    } else {
      // New peer discovered
      peers.set(peer.id, peer)
      emitter.emit("peer:joined", peer)
      log.info("Peer discovered", {
        peerId: peer.id,
        name: peer.name,
        host: `${peer.hostname}:${peer.port}`,
        addresses: service.addresses,
        serviceHost: service.host
      })
    }
  }

  /**
   * Handle a discovered service going offline
   */
  function handleServiceDown(service: Service): void {
    const peerId = service.name

    if (peers.has(peerId)) {
      peers.delete(peerId)
      emitter.emit("peer:left", peerId)
      log.info("Peer left", { peerId })
    }
  }

  /**
   * Refresh peer list by removing stale peers
   */
  function refreshPeerList(): void {
    const now = Date.now()
    const staleThreshold = 60000 // 1 minute

    for (const [id, peer] of peers) {
      if (peer.lastSeen && (now - peer.lastSeen) > staleThreshold) {
        peers.delete(id)
        emitter.emit("peer:left", id)
        log.info("Peer removed (stale)", { peerId: id })
      }
    }
  }

  /**
   * Stop discovery and unpublish service
   */
  export function stop(): void {
    if (discoveryInterval) {
      clearInterval(discoveryInterval)
      discoveryInterval = undefined
    }

    if (browser) {
      browser.stop()
      browser = undefined
    }

    unpublish()

    if (bonjour) {
      bonjour.destroy()
      bonjour = undefined
    }

    peers.clear()
    log.info("P2P discovery stopped")
  }

  /**
   * Unpublish this service
   */
  function unpublish(): void {
    const service = publishedService
    publishedService = undefined
    if (service && typeof service.stop === 'function') {
      try {
        service.stop()
      } catch (err) {
        log.error("Error unpublishing service", { error: err })
      }
    }
  }

  /**
   * Get all discovered peers
   */
  export function getPeers(): PeerInfo[] {
    return Array.from(peers.values())
  }

  /**
   * Get a specific peer by ID
   */
  export function getPeer(peerId: string): PeerInfo | undefined {
    return peers.get(peerId)
  }

  /**
   * Get this peer's info
   */
  export function getSelfInfo(): PeerInfo | undefined {
    return selfInfo
  }

  /**
   * Update this peer's info (e.g., when changing workspace)
   */
  export function updateSelfInfo(updates: Partial<PeerInfo>): void {
    if (!selfInfo) return

    selfInfo = { ...selfInfo, ...updates, lastSeen: Date.now() }

    // Re-publish with updated info
    if (currentPort) {
      unpublish()
      publish(currentPort, selfInfo)
    }
  }

  /**
   * Add workspace to this peer's info
   */
  export function addWorkspace(workspacePath: string): void {
    if (!selfInfo) return

    const workspaces = selfInfo.workspaces || []
    if (!workspaces.includes(workspacePath)) {
      workspaces.push(workspacePath)
      updateSelfInfo({ workspaces })
    }
  }

  /**
   * Remove workspace from this peer's info
   */
  export function removeWorkspace(workspacePath: string): void {
    if (!selfInfo) return

    const workspaces = selfInfo.workspaces || []
    const index = workspaces.indexOf(workspacePath)
    if (index >= 0) {
      workspaces.splice(index, 1)
      updateSelfInfo({ workspaces })
    }
  }

  /**
   * Set this peer's status
   */
  export function setStatus(status: PeerInfo["status"]): void {
    updateSelfInfo({ status })
  }

  /**
   * Subscribe to peer events
   */
  export function onPeerJoined(callback: (peer: PeerInfo) => void): () => void {
    emitter.on("peer:joined", callback)
    return () => emitter.off("peer:joined", callback)
  }

  export function onPeerLeft(callback: (peerId: string) => void): () => void {
    emitter.on("peer:left", callback)
    return () => emitter.off("peer:left", callback)
  }

  export function onPeerUpdated(callback: (peer: PeerInfo) => void): () => void {
    emitter.on("peer:updated", callback)
    return () => emitter.off("peer:updated", callback)
  }

  /**
   * Check if a peer ID matches this instance
   */
  export function isSelf(peerId: string): boolean {
    return selfInfo?.id === peerId
  }

  // Helper to get capabilities from config
  function getCapabilities(config: P2PConfig): string[] {
    const caps: string[] = []
    if (config.capabilities.acceptTasks) caps.push("accept-tasks")
    if (config.capabilities.shareFiles) caps.push("share-files")
    if (config.capabilities.collaborate) caps.push("collaborate")
    return caps
  }
}

