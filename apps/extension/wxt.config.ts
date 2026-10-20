import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"
import { manifestFor, manifestKey } from "./lib/manifest"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  // A function, so WXT has loaded .env files before VITE_EXTENSION_KEY is read.
  manifest: ({ browser }) => {
    const env = import.meta.env as Record<string, string | undefined> | undefined
    return manifestFor(browser, manifestKey(env?.VITE_EXTENSION_KEY ?? process.env.VITE_EXTENSION_KEY))
  },
})
