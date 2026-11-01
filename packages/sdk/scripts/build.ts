import { rmSync } from "node:fs"

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")
rmSync(`${root}/dist`, { recursive: true, force: true })

for (const [format, naming] of [["esm", "index.js"], ["cjs", "index.cjs"]] as const) {
  const result = await Bun.build({ entrypoints: [`${root}/src/index.ts`], outdir: `${root}/dist`, naming, format, target: "browser", minify: false })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
}

const tsc = Bun.spawnSync(["bunx", "tsc", "-p", "tsconfig.build.json"], { cwd: root, stdout: "inherit", stderr: "inherit" })
if (tsc.exitCode !== 0) process.exit(tsc.exitCode ?? 1)
