import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"
import { manifestFor, manifestKey } from "./lib/manifest"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  // WXT writes a sources zip next to each package; the private key and env files never go in it. The one
  // reviewers get is made by scripts/zip-sources.ts, from the whole workspace the build needs.
  zip: { excludeSources: ["*.pem", "**/*.pem", ".env*", "**/.env*"] },
  // A function, so WXT has loaded .env files before VITE_EXTENSION_KEY is read.
  manifest: ({ browser }) => {
    const env = import.meta.env as Record<string, string | undefined> | undefined
    return manifestFor(browser, manifestKey(env?.VITE_EXTENSION_KEY ?? process.env.VITE_EXTENSION_KEY))
  },
})
