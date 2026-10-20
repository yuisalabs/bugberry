import { readFileSync } from "node:fs"

/**
 * Signs the Firefox build on addons.mozilla.org's unlisted channel, so the .xpi installs for good in regular
 * Firefox without a public listing. Usage: bun run sign:firefox (with WEB_EXT_API_KEY and WEB_EXT_API_SECRET set).
 * AMO never signs the same version twice: raise `version` in package.json first.
 */
const KEYS = ["WEB_EXT_API_KEY", "WEB_EXT_API_SECRET"] as const

export function missingKeys(env: Record<string, string | undefined>): string[] {
  return KEYS.filter((name) => !env[name]?.trim())
}

/** web-ext's arguments; WXT's `zip -b firefox` writes the sources zip AMO may ask for. */
export function signArgs(version: string): string[] {
  return [
    "sign",
    "--channel",
    "unlisted",
    "--source-dir",
    ".output/firefox-mv3",
    "--artifacts-dir",
    ".output",
    "--upload-source-code",
    `.output/bugberryextension-${version}-sources.zip`,
  ]
}

/**
 * The Firefox package, then the reviewers' sources zip (scripts/zip-sources.ts). That one comes last: it
 * replaces the sources zip WXT writes next to the package, which would carry the private key.
 */
export const PREPARE_COMMANDS = [
  ["bun", "run", "zip:firefox"],
  ["bun", "run", "zip:sources"],
]

async function run(command: string[]): Promise<void> {
  const code = await Bun.spawn(command, { stdio: ["inherit", "inherit", "inherit"] }).exited
  if (code !== 0) process.exit(code)
}

if (import.meta.main) {
  if (missingKeys(process.env).length > 0) {
    console.error("Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET (from addons.mozilla.org → Developer Hub → API keys) in your environment.")
    process.exit(1)
  }
  const { version } = JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
  for (const command of PREPARE_COMMANDS) await run(command)
  await run(["bun", "x", "web-ext", ...signArgs(version)])
}
