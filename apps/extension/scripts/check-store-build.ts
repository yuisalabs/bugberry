import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { storeBuildLeaks } from "../lib/store-build-check"

/**
 * Fails when a store build in .output carries the agent recorder's automation path, so a misset build flag can't
 * reach the stores. Runs after every store build and zip.
 */
const output = fileURLToPath(new URL("../.output", import.meta.url))

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })
}

const builds = readdirSync(output).filter((name) => statSync(join(output, name)).isDirectory())
const files = builds.flatMap((build) => filesUnder(join(output, build)))
  .filter((path) => /\.(js|html|json)$/.test(path))
  .map((path) => ({ path: relative(output, path).replaceAll("\\", "/"), text: readFileSync(path, "utf8") }))
const leaks = storeBuildLeaks(files)
if (leaks.length > 0) {
  console.error(`The store build carries the agent recorder's automation path:\n${leaks.map((leak) => `  ${leak}`).join("\n")}`)
  process.exit(1)
}
console.info(`check-store-build: ${files.length} files in ${builds.length} build(s), clean`)
