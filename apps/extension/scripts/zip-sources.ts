import { existsSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * The source code Mozilla and Opera reviewers ask for, since the extension is bundled.
 * Usage: bun run zip:sources (after committing: the zip is made from the last commit).
 *
 * `git archive` takes only tracked files, so the extension's private key (`*.pem`) and `.env` files, which
 * git ignores, can never end up in it. The workspace files and packages the build needs are included;
 * the dashboard and deployment files are not.
 */
export const SOURCE_PATHSPECS = [
  "package.json",
  "bun.lock",
  "tsconfig.base.json",
  // Tailwind skips what git ignores; without it a rebuild scans .output and its CSS differs.
  ".gitignore",
  "apps/extension",
  // Its types describe the API the extension calls, and the workspace install expects the package.
  "apps/api",
  "packages",
  ":(exclude,glob)**/.env*",
  ":(exclude,glob)**/*.pem",
] as const

const SERVER_ORIGIN = "VITE_SERVER_ORIGIN=https://bugberry.yuisalabs.com"

export function buildNotes(version: string, envLines: string[] = [SERVER_ORIGIN]): string {
  return [
    `# Building BugBerry ${version}`,
    "",
    "Requirements: Bun 1.4 (https://bun.sh). Nothing else is downloaded during the build besides npm packages.",
    "",
    "1. From this folder (the repository root):",
    "",
    "       bun install",
    "",
    "2. Create apps/extension/.env.production with exactly these lines (public values, the ones this package",
    "   was built with):",
    "",
    ...envLines.map((line) => `       ${line}`),
    "",
    "3. From apps/extension:",
    "",
    "       bun run zip:firefox   # Firefox: .output/bugberryextension-<version>-firefox.zip",
    "       bun run zip:opera     # Opera:   .output/bugberryextension-<version>-opera.zip",
    "",
    "The unpacked builds are in apps/extension/.output/firefox-mv3 and .output/opera-mv3.",
    "Source: apps/extension (entrypoints/, lib/) and packages/ (capture, ui, player, shared, debugger-view).",
    "",
  ].join("\n")
}

export function archiveArgs(version: string, output: string, notes: string): string[] {
  const prefix = `bugberry-${version}-sources/`
  return [
    "archive",
    "--format=zip",
    `--output=${output}`,
    `--prefix=${prefix}`,
    `--add-virtual-file=${prefix}BUILD.md:${notes}`,
    "HEAD",
    "--",
    ...SOURCE_PATHSPECS,
  ]
}

/** The public build settings from .env.production (the server address and the public key), as KEY=value lines. */
function publicEnvLines(path: string): string[] {
  if (!existsSync(path)) return [SERVER_ORIGIN]
  const lines = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^VITE_(SERVER_ORIGIN|EXTENSION_KEY)=/.test(line))
  return lines.length > 0 ? lines : [SERVER_ORIGIN]
}

if (import.meta.main) {
  const extensionDir = fileURLToPath(new URL("..", import.meta.url))
  const repoRoot = fileURLToPath(new URL("../../..", import.meta.url))
  const dirty = Bun.spawnSync(["git", "status", "--porcelain", "--", ...SOURCE_PATHSPECS], { cwd: repoRoot }).stdout.toString().trim()
  if (dirty) {
    console.error("Commit your changes first: the sources zip is made from the last commit.\n" + dirty)
    process.exit(1)
  }
  const { version } = JSON.parse(readFileSync(`${extensionDir}package.json`, "utf8")) as { version: string }
  const output = `${extensionDir}.output/bugberryextension-${version}-sources.zip`
  const notes = buildNotes(version, publicEnvLines(`${extensionDir}.env.production`))
  const archived = Bun.spawnSync(["git", ...archiveArgs(version, output, notes)], { cwd: repoRoot, stderr: "inherit" })
  if (archived.exitCode !== 0) process.exit(archived.exitCode ?? 1)
  console.log(`Sources for ${version}: ${output}`)
}
