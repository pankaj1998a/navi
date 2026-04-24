import fs from "fs/promises"
import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import path from "path"
import os from "os"
import { Filesystem } from "../util/filesystem"

const app = "Navi"

function getHomeDir(): string {
  return process.env.NAVI_TEST_HOME || process.env.navi_TEST_HOME || os.homedir()
}

function getPath(kind: "data" | "cache" | "config" | "state"): string {
  const home = getHomeDir()

  if (process.env.NAVI_TEST_HOME || process.env.navi_TEST_HOME) {
    switch (kind) {
      case "data":
        return path.join(home, ".local", "share", app)
      case "cache":
        return path.join(home, ".cache", app)
      case "config":
        return path.join(home, ".config", app)
      case "state":
        return path.join(home, ".local", "state", app)
    }
  }

  if (process.platform === "win32") {
    switch (kind) {
      case "data":
        return path.join(home, "AppData", "Local", app)
      case "cache":
        return path.join(home, "AppData", "Local", app, "Cache")
      case "config":
        return path.join(home, "AppData", "Roaming", app)
      case "state":
        return path.join(home, "AppData", "Local", app, "State")
    }
  }

  switch (kind) {
    case "data":
      return path.join(xdgData!, app)
    case "cache":
      return path.join(xdgCache!, app)
    case "config":
      return path.join(xdgConfig!, app)
    case "state":
      return path.join(xdgState!, app)
  }
}

export namespace Global {
  export const Path = {
    // Allow override via NAVI_TEST_HOME for test isolation
    get home() {
      return getHomeDir()
    },
    get data() {
      return getPath("data")
    },
    get bin() {
      return path.join(getPath("cache"), "bin")
    },
    get log() {
      return path.join(getPath("data"), "log")
    },
    get cache() {
      return getPath("cache")
    },
    get config() {
      return getPath("config")
    },
    get state() {
      return getPath("state")
    },
  }

  export async function init() {
    await Promise.all([
      fs.mkdir(Global.Path.data, { recursive: true }),
      fs.mkdir(Global.Path.config, { recursive: true }),
      fs.mkdir(Global.Path.state, { recursive: true }),
      fs.mkdir(Global.Path.log, { recursive: true }),
      fs.mkdir(Global.Path.bin, { recursive: true }),
    ])

    const CACHE_VERSION = "21"

    const version = await Filesystem.readText(path.join(Global.Path.cache, "version")).catch(() => "0")

    if (version !== CACHE_VERSION) {
      try {
        const contents = await fs.readdir(Global.Path.cache)
        await Promise.all(
          contents.map((item) =>
            fs.rm(path.join(Global.Path.cache, item), {
              recursive: true,
              force: true,
            }),
          ),
        )
      } catch (e) {
        console.warn("Failed to clear Navi cache directory", e)
      }
      await Filesystem.write(path.join(Global.Path.cache, "version"), CACHE_VERSION)
    }
  }
}

