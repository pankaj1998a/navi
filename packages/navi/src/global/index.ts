import { xdgData, xdgCache, xdgConfig, xdgState } from "xdg-basedir"
import fs from "fs/promises"
import path from "path"
import os from "os"

const app = "navi"
const homedir = process.env.navi_TEST_HOME || os.homedir()

const data = path.join(xdgData || path.join(homedir, ".local", "share"), app)
const cache = path.join(xdgCache || path.join(homedir, ".cache"), app)
const config = path.join(xdgConfig || path.join(homedir, ".config"), app)
const state = path.join(xdgState || path.join(homedir, ".local", "state"), app)

export namespace Global {
  export const Path = {
    // Allow override via navi_TEST_HOME for test isolation
    get home() {
      return process.env.navi_TEST_HOME || os.homedir()
    },
    get data() {
      if (process.env.navi_TEST_HOME) return path.join(process.env.navi_TEST_HOME, "data")
      return path.join(xdgData || path.join(os.homedir(), ".local", "share"), app)
    },
    get bin() {
      return path.join(this.data, "bin")
    },
    get log() {
      return path.join(this.data, "log")
    },
    get cache() {
      if (process.env.navi_TEST_HOME) return path.join(process.env.navi_TEST_HOME, "cache")
      return path.join(xdgCache || path.join(os.homedir(), ".cache"), app)
    },
    get config() {
      if (process.env.navi_TEST_HOME) return path.join(process.env.navi_TEST_HOME, "config")
      return path.join(xdgConfig || path.join(os.homedir(), ".config"), app)
    },
    get state() {
      if (process.env.navi_TEST_HOME) return path.join(process.env.navi_TEST_HOME, "state")
      return path.join(xdgState || path.join(os.homedir(), ".local", "state"), app)
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

    const CACHE_VERSION = "17"

    const version = await Bun.file(path.join(Global.Path.cache, "version"))
      .text()
      .catch(() => "0")

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
        // Ignore cache cleanup errors (e.g. files already deleted, permissions)
      }
      await Bun.file(path.join(Global.Path.cache, "version")).write(CACHE_VERSION)
    }
  }
}
