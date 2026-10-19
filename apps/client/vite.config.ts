import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    // Same origin as the API in dev too (APP_URL=http://localhost:5173), so session cookies and
    // local file URLs work unchanged.
    proxy: { "/api": "http://localhost:3000" },
  },
})
