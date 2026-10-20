import { createMDX } from "fumadocs-mdx/next"

const withMDX = createMDX()

/**
 * A static site served at https://bugberry.yuisalabs.com/docs by its own container (docker/docs.Dockerfile);
 * Caddy on the VPS sends /docs there. Internal links are written without /docs: Next adds the basePath.
 * @type {import('next').NextConfig}
 */
const config = {
  output: "export",
  basePath: "/docs",
  images: { unoptimized: true },
  reactStrictMode: true,
  // A project of its own (own bun.lock), not the repo root's workspaces.
  turbopack: { root: import.meta.dirname },
}

export default withMDX(config)
