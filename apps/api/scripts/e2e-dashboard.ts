import { existsSync, statSync } from "node:fs"
import { extname, join, resolve, sep } from "node:path"
import { Elysia } from "elysia"
import type { App } from "../src/app"

const NOT_BUILT_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>BugBerry</title></head>
<body><p>The dashboard isn't built yet. Run <code>bun run build:client</code> in the repo root.</p></body></html>`

function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/")
}

/** Maps a URL path to a file inside `root`, or null when it does not exist or would escape it. */
function fileInside(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes("\0")) return null
  const candidate = resolve(root, `.${decoded}`)
  if (!candidate.startsWith(root + sep)) return null
  return existsSync(candidate) && statSync(candidate).isFile() ? candidate : null
}

/**
 * Serves the dashboard build next to the API for the extension E2E run only; production serves it from
 * nginx (docker/nginx.conf). Real files when they exist, `index.html` for every other path so
 * client-side routes survive a reload. API paths never fall through to the app shell.
 */
export function dashboardApp(distDir: string) {
  const root = resolve(distDir)
  const indexFile = join(root, "index.html")

  const serve = ({ request }: { request: Request }) => {
    const { pathname } = new URL(request.url)
    if (isApiPath(pathname)) {
      return Response.json({ code: "not_found", message: "Route not found" }, { status: 404 })
    }
    const file = fileInside(root, pathname)
    if (file) return new Response(Bun.file(file))
    if (extname(pathname)) return new Response("Not found", { status: 404 })
    const htmlHeaders = { "content-type": "text/html; charset=utf-8" }
    if (!existsSync(indexFile)) return new Response(NOT_BUILT_PAGE, { headers: htmlHeaders })
    return new Response(Bun.file(indexFile), { headers: htmlHeaders })
  }

  return new Elysia().get("/", serve).get("/*", serve)
}

/** The API under /api plus the dashboard build for everything else, as the E2E server listens. */
export function withDashboard(api: App, distDir: string) {
  return new Elysia().use(api).use(dashboardApp(distDir))
}
