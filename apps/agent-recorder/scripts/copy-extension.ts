import { cpSync, existsSync, rmSync } from "node:fs"

/** Puts the recorder build of the extension next to dist/, where the published package loads it from. */
const from = new URL("../../extension/.output-recorder/chrome-mv3", import.meta.url)
const to = new URL("../extension", import.meta.url)
if (!existsSync(from)) throw new Error("Build the extension first: bun run --cwd ../extension build:recorder")
rmSync(to, { recursive: true, force: true })
cpSync(from, to, { recursive: true })
