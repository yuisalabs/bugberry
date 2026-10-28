import { posix, win32 } from "node:path"
import { parseArgs } from "node:util"
import { BUGBERRY_CLOUD_ORIGIN } from "@bugberry/shared"

/**
 * Where Chromium listens for the agent's browser tool. Outside the ranges Windows reserves for Hyper-V on the machines
 * we know of (9333, the docs' port, falls in one); `--port` moves it when this one is taken too.
 */
export const DEFAULT_PORT = 9555

export interface RecorderOptions {
  /** The BugBerry server: its limits apply, and recordings only ever go to it. An origin. */
  server: string
  port: number
  headless: boolean
  /** Chromium's profile, kept between runs so the agent stays signed in to the app it tests. */
  profileDir: string
}

export interface RecorderEnv {
  platform: NodeJS.Platform
  home: string
  localAppData?: string
  xdgDataHome?: string
}

function profileDirFor(env: RecorderEnv): string {
  if (env.platform === "win32") return win32.join(env.localAppData ?? win32.join(env.home, "AppData", "Local"), "BugBerry", "recorder", "profile")
  if (env.platform === "darwin") return posix.join(env.home, "Library", "Application Support", "BugBerry", "recorder", "profile")
  return posix.join(env.xdgDataHome ?? posix.join(env.home, ".local", "share"), "bugberry", "recorder", "profile")
}

function serverOrigin(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`--server must be the BugBerry address, like ${BUGBERRY_CLOUD_ORIGIN}`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("--server must start with https:// or http://")
  return url.origin
}

function portOf(raw: string): number {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("--port must be a whole number from 1024 to 65535")
  return port
}

/** The command line, without node and the script: `--server <url> --port <n> --headless --profile <dir>`. */
export function parseOptions(argv: string[], env: RecorderEnv): RecorderOptions {
  const { values } = parseArgs({
    args: argv,
    options: { server: { type: "string" }, port: { type: "string" }, headless: { type: "boolean" }, profile: { type: "string" } },
    strict: true,
  })
  return {
    server: serverOrigin(values.server ?? BUGBERRY_CLOUD_ORIGIN),
    port: values.port === undefined ? DEFAULT_PORT : portOf(values.port),
    headless: values.headless === true,
    profileDir: values.profile ?? profileDirFor(env),
  }
}
