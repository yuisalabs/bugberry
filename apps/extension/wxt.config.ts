import { readFileSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"
import { entrypointsFor, isRecorderBuild, manifestFor, manifestKey } from "./lib/manifest"

/** The agent recorder's build: its automation page, and a fixed public key so its extension ID never changes. */
const recorderBuild = isRecorderBuild(process.env)

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  // Apart from the store build, so neither overwrites the other.
  outDir: recorderBuild ? ".output-recorder" : ".output",
  vite: () => ({ plugins: [tailwindcss()] }),
  // WXT writes a sources zip next to each package; the private key and env files never go in it. The one
  // reviewers get is made by scripts/zip-sources.ts, from the whole workspace the build needs.
  zip: { excludeSources: ["*.pem", "**/*.pem", ".env*", "**/.env*"] },
  hooks: {
    "entrypoints:found": (_wxt, infos) => {
      const kept = entrypointsFor(infos, recorderBuild)
      infos.splice(0, infos.length, ...kept)
    },
  },
  // A function, so WXT has loaded .env files before VITE_EXTENSION_KEY is read.
  manifest: ({ browser }) => {
    const env = import.meta.env as Record<string, string | undefined> | undefined
    const key = recorderBuild
      ? readFileSync(new URL("./recorder-key.txt", import.meta.url), "utf8").trim()
      : (env?.VITE_EXTENSION_KEY ?? process.env.VITE_EXTENSION_KEY)
    return manifestFor(browser, manifestKey(key))
  },
})
