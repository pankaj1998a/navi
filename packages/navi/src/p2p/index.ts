/**
 * P2P Module - Navi Terminal-to-Terminal Communication
 * 
 * This module enables Navi instances to discover, connect, and communicate
 * with each other for collaborative coding, task delegation, and context sharing.
 */

export * from "./types"
export { P2PDiscovery } from "./discovery"
export { P2PClient } from "./client"
export { P2PServer } from "./server"

import { Log } from "@/util/log"
import { P2PConfig } from "./types"
import { P2PDiscovery } from "./discovery"
import { P2PClient } from "./client"
import { P2PServer } from "./server"

const log = Log.create({ service: "p2p" })

/**
 * P2P Module Namespace
 * 
 * Main entry point for P2P functionality.
 */
export namespace P2P {
  let initialized = false
  let config: P2PConfig

  /**
   * Initialize the P2P module
   */
  export function init(port: number, p2pConfig?: Partial<P2PConfig>): void {
    if (initialized) {
      log.warn("P2P already initialized")
      return
    }

    // Merge with defaults
    config = {
      enabled: p2pConfig?.enabled ?? true,
      discovery: {
        mdns: p2pConfig?.discovery?.mdns ?? true,
        interval: p2pConfig?.discovery?.interval ?? 30000,
      },
      security: {
        requireAuth: p2pConfig?.security?.requireAuth ?? false,
        allowedPeers: p2pConfig?.security?.allowedPeers ?? [],
        blockedPeers: p2pConfig?.security?.blockedPeers ?? [],
        secret: p2pConfig?.security?.secret,
      },
      capabilities: {
        acceptTasks: p2pConfig?.capabilities?.acceptTasks ?? true,
        shareFiles: p2pConfig?.capabilities?.shareFiles ?? true,
        collaborate: p2pConfig?.capabilities?.collaborate ?? true,
      },
    }

    if (!config.enabled) {
      log.info("P2P disabled by config")
      return
    }

    // Initialize sub-modules
    P2PClient.init(config)
    P2PServer.init(config)
    P2PDiscovery.init(config, port)

    initialized = true
    log.info("P2P module initialized", { port })
  }

  /**
   * Check if P2P is initialized
   */
  export function isInitialized(): boolean {
    return initialized
  }

  /**
   * Get current configuration
   */
  export function getConfig(): P2PConfig {
    return config
  }

  /**
   * Stop P2P and cleanup
   */
  export function stop(): void {
    if (!initialized) return

    P2PDiscovery.stop()
    P2PClient.cleanup()
    P2PServer.cleanup()

    initialized = false
    log.info("P2P module stopped")
  }
}

