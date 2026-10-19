import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"
import { MANIFEST_COMMANDS, MANIFEST_PERMISSIONS, manifestKey, WEB_ACCESSIBLE_RESOURCES } from "./lib/manifest"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  vite: () => ({ plugins: [tailwindcss()] }),
  // A function, so WXT has loaded .env files before VITE_EXTENSION_KEY is read.
  manifest: () => {
    const env = import.meta.env as Record<string, string | undefined> | undefined
    const key = manifestKey(env?.VITE_EXTENSION_KEY ?? process.env.VITE_EXTENSION_KEY)
    return {
      name: "BugBerry",
      description: "Report bugs with a screenshot or recording, plus console, network and the steps that led there.",
      permissions: MANIFEST_PERMISSIONS,
      host_permissions: ["<all_urls>"],
      web_accessible_resources: WEB_ACCESSIBLE_RESOURCES,
      action: { default_title: "BugBerry" },
      commands: MANIFEST_COMMANDS,
      ...(key ? { key } : {}),
    }
  },
})
