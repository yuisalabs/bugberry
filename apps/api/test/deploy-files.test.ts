import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { loadConfig } from "../src/config"

const ROOT = join(import.meta.dir, "..", "..", "..")

/** Values an operator fills in; everything else must already be valid in the example. */
const FILLED_BY_OPERATOR: Record<string, string> = {
  // `openssl rand -base64 32` output often contains "/", which must not break the database URL.
  POSTGRES_PASSWORD: "pg/se+cret=",
  BETTER_AUTH_SECRET: "x".repeat(40),
  ENCRYPTION_KEY: Buffer.alloc(32, 5).toString("base64"),
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  EXTENSION_ID: "a".repeat(32),
}

function parseEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match?.[1]) env[match[1]] = match[2] ?? ""
  }
  return env
}

/** Compose interpolation for the forms this file uses: ${VAR}, ${VAR:-default}, ${VAR:?message}. */
/** Compose's ${NAME}, ${NAME:-default} and ${NAME:?message}, innermost first, so defaults can nest. */
function interpolate(value: string, env: Record<string, string>): string {
  const innermost = /\$\{([A-Z0-9_]+)(?::([-?])([^${}]*))?\}/g
  let result = value
  while (innermost.test(result)) {
    innermost.lastIndex = 0
    result = result.replace(innermost, (_all, name: string, kind?: string, rest?: string) => {
      const current = env[name]
      if (current) return current
      if (kind === "?") throw new Error(`${name} is required: ${rest}`)
      return kind === "-" ? (rest ?? "") : ""
    })
  }
  return result
}

async function deployEnv() {
  const example = parseEnvFile(await Bun.file(join(ROOT, ".env.docker.example")).text())
  for (const [name, value] of Object.entries(example)) if (!value) example[name] = FILLED_BY_OPERATOR[name] ?? ""
  const compose = Bun.YAML.parse(await Bun.file(join(ROOT, "docker-compose.yml")).text()) as {
    name?: string
    services: Record<
      string,
      {
        image?: string
        build?: { context?: string; dockerfile?: string }
        depends_on?: Record<string, { condition?: string }>
        environment?: Record<string, string>
        profiles?: string[]
        ports?: string[]
        stop_grace_period?: string
        cpus?: string | number
        mem_limit?: string
        logging?: { driver?: string; options?: Record<string, string> }
      }
    >
  }
  const overrides = compose.services.api?.environment ?? {}
  const env: Record<string, string> = { ...example }
  for (const [name, value] of Object.entries(overrides)) env[name] = interpolate(String(value), example)
  return { example, compose, env }
}

describe("deploy files", () => {
  test("the example .env plus the compose overrides is a valid server config", async () => {
    const { env } = await deployEnv()
    const config = loadConfig(env)
    const database = new URL(config.databaseUrl)
    expect([database.username, database.hostname, database.port, database.pathname]).toEqual([
      "fdebag",
      "postgres",
      "5432",
      "/fdebag",
    ])
    expect(decodeURIComponent(database.password)).toBe("pg/se+cret=")
    expect(config.storage).toEqual({ driver: "local", dir: "/data/uploads" })
    expect(config.appUrl).toStartWith("https://")
    expect(config.proxyHops).toBe(1)
  })

  test("only secrets are left blank in the example", async () => {
    const example = parseEnvFile(await Bun.file(join(ROOT, ".env.docker.example")).text())
    const blanks = Object.keys(example).filter((name) => !example[name])
    expect(blanks.sort()).toEqual(Object.keys(FILLED_BY_OPERATOR).sort())
  })

  test("the BUGBERRY_* settings win, and an .env that still says FDEBAG_* keeps working", () => {
    const port = "${BUGBERRY_BIND:-${FDEBAG_BIND:-127.0.0.1}}:${BUGBERRY_PORT:-${FDEBAG_PORT:-3000}}:80"
    expect(interpolate(port, {})).toBe("127.0.0.1:3000:80")
    expect(interpolate(port, { FDEBAG_PORT: "4100" })).toBe("127.0.0.1:4100:80")
    expect(interpolate(port, { FDEBAG_PORT: "4100", BUGBERRY_PORT: "4200" })).toBe("127.0.0.1:4200:80")
  })

  test("app and storage ports listen on localhost only, so the reverse proxy is the way in", async () => {
    const { compose, example } = await deployEnv()
    expect(compose.services.api?.ports).toBeUndefined()
    for (const service of ["client", "s3"]) {
      const ports = (compose.services[service]?.ports ?? []).map((port) => interpolate(port, example))
      expect(ports.length).toBeGreaterThan(0)
      for (const port of ports) expect(port).toStartWith("127.0.0.1:")
    }
  })

  test("the production project never shares containers or volumes with docker-compose.dev.yml", async () => {
    const { compose } = await deployEnv()
    const dev = Bun.YAML.parse(await Bun.file(join(ROOT, "docker-compose.dev.yml")).text()) as { name?: string }
    // Without a name, Compose uses the folder name ("fdebag") for both files.
    expect(compose.name).toBeDefined()
    expect(compose.name).not.toBe(dev.name ?? "fdebag")
  })

  test("docker stop gives a large local upload time to finish", async () => {
    const { compose } = await deployEnv()
    expect(compose.services.api?.stop_grace_period).toBe("60s")
    expect(compose.services.client?.stop_grace_period).toBe("60s")
  })

  test("every service rotates its logs, so a long-running server does not fill its disk", async () => {
    const { compose } = await deployEnv()
    for (const [name, service] of Object.entries(compose.services)) {
      expect({ name, driver: service.logging?.driver, maxSize: service.logging?.options?.["max-size"] }).toEqual({
        name,
        driver: "json-file",
        maxSize: "10m",
      })
    }
  })

  test("third-party images are pinned, so an upgrade never changes them silently", async () => {
    const { compose } = await deployEnv()
    for (const [name, service] of Object.entries(compose.services)) {
      if (name === "api" || name === "api-mcp" || name === "client") continue
      expect({ name, image: service.image }).not.toMatchObject({ image: expect.stringMatching(/:latest$|^[^:@]+$/) })
    }
  })

  test("optional services stay off unless their profile is chosen", async () => {
    const { compose } = await deployEnv()
    expect(compose.services.api?.profiles).toBeUndefined()
    expect(compose.services.client?.profiles).toBeUndefined()
    expect(compose.services.postgres?.profiles).toBeUndefined()
    expect(compose.services.s3?.profiles).toEqual(["s3"])
    expect(compose.services["s3-init"]?.profiles).toEqual(["s3"])
    expect(compose.services.caddy?.profiles).toEqual(["caddy"])
  })

  test("the api image carries the city list, and never the local uploads folder", async () => {
    const dockerfile = await Bun.file(join(ROOT, "docker/api.Dockerfile")).text()
    expect(dockerfile).toContain("COPY apps/api/geo apps/api/geo")
    expect(dockerfile).not.toContain("COPY apps/api/data")
    expect(Bun.file(join(ROOT, "apps/api/geo/cities.tsv")).size).toBeGreaterThan(500_000)
  })

  test("api and client are built from docker/", async () => {
    const { compose } = await deployEnv()
    expect(compose.services.api?.build).toEqual({ context: ".", dockerfile: "docker/api.Dockerfile" })
    expect(compose.services.client?.build).toEqual({ context: ".", dockerfile: "docker/client.Dockerfile" })
  })

  test("both images copy every workspace manifest, so bun install --frozen-lockfile accepts the lockfile", async () => {
    const { readdirSync } = await import("node:fs")
    // apps/docs is a project of its own (its own bun.lock), left out of the workspaces with "!apps/docs".
    const { workspaces } = (await Bun.file(join(ROOT, "package.json")).json()) as { workspaces: string[] }
    const excluded = new Set(workspaces.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1)))
    const manifests = ["apps", "packages"].flatMap((dir) =>
      readdirSync(join(ROOT, dir), { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && Bun.file(join(ROOT, dir, entry.name, "package.json")).size > 0)
        .filter((entry) => !excluded.has(`${dir}/${entry.name}`))
        .map((entry) => `${dir}/${entry.name}/package.json`),
    )
    expect(manifests).toContain("packages/player/package.json")
    expect(manifests).not.toContain("apps/docs/package.json")
    for (const dockerfile of ["docker/api.Dockerfile", "docker/client.Dockerfile"]) {
      const text = await Bun.file(join(ROOT, dockerfile)).text()
      for (const manifest of manifests) expect(`${dockerfile}: ${text.includes(`COPY ${manifest} `)}`).toBe(`${dockerfile}: true`)
    }
  })

  test("the client starts after a healthy api, and the api after a healthy database", async () => {
    const { compose } = await deployEnv()
    expect(compose.services.client?.depends_on).toEqual({ api: { condition: "service_healthy" } })
    expect(compose.services.api?.depends_on).toEqual({ postgres: { condition: "service_healthy" } })
  })

  test("MCP runs in a container of its own, which nginx sends /api/mcp to", async () => {
    const { compose, example } = await deployEnv()
    const api = compose.services.api
    const mcp = compose.services["api-mcp"]
    expect(api?.environment?.SERVER_ROLE).toBe("app")
    expect(mcp?.environment?.SERVER_ROLE).toBe("mcp")
    expect(mcp?.build).toEqual(api?.build)
    expect(mcp?.image).toBe(api?.image)
    // It starts once the api has migrated the database.
    expect(mcp?.depends_on).toEqual({ api: { condition: "service_healthy" } })
    // Everything else it needs is the api's.
    for (const name of ["DATABASE_URL", "DATABASE_PASSWORD", "LOCAL_STORAGE_DIR", "PORT", "PROXY_HOPS"]) {
      expect({ name, value: mcp?.environment?.[name] }).toEqual({ name, value: api?.environment?.[name] })
    }

    const env: Record<string, string> = { ...example }
    for (const [name, value] of Object.entries(mcp?.environment ?? {})) env[name] = interpolate(String(value), example)
    const config = loadConfig(env)
    expect([config.serverRole, config.mcp.sharedRateLimit]).toEqual(["mcp", true])

    const nginx = await Bun.file(join(ROOT, "docker/nginx.conf.template")).text()
    const mcpBlock = nginx.slice(nginx.indexOf("location ^~ /api/mcp {"), nginx.indexOf("location ^~ /api {"))
    expect(mcpBlock).toContain("set $mcp_upstream ${MCP_UPSTREAM};")
    expect(mcpBlock).toContain("proxy_pass $mcp_upstream;")
    const dockerfile = await Bun.file(join(ROOT, "docker/client.Dockerfile")).text()
    expect(dockerfile).toContain("MCP_UPSTREAM=http://api-mcp:3000")
    expect(dockerfile).toContain("API_UPSTREAM=http://api:3000")
  })

  test("the MCP container has a ceiling on memory as well as CPU, so agents cannot take the host's from the dashboard", async () => {
    const { compose, example } = await deployEnv()
    const mcp = compose.services["api-mcp"]
    expect([interpolate(String(mcp?.cpus), example), interpolate(String(mcp?.mem_limit), example)]).toEqual(["1", "1g"])
    expect(interpolate(String(mcp?.mem_limit), { MCP_MEMORY: "2g" })).toBe("2g")
    // The dashboard's own container keeps the whole server.
    expect([compose.services.api?.cpus, compose.services.api?.mem_limit]).toEqual([undefined, undefined])
  })

  test("Caddy forwards to the client container, never straight to the api", async () => {
    const caddyfile = await Bun.file(join(ROOT, "deploy", "Caddyfile")).text()
    expect(caddyfile).toContain("reverse_proxy client:80")
    expect(caddyfile).not.toMatch(/reverse_proxy (fdebag|api):/)
  })

  test("the dev storage lets the dashboard read debugger data across origins", async () => {
    const dev = Bun.YAML.parse(await Bun.file(join(ROOT, "docker-compose.dev.yml")).text()) as {
      services: Record<string, { entrypoint?: string; volumes?: string[] }>
    }
    const init = dev.services["s3-init"]
    expect(init?.entrypoint).toContain("put-bucket-cors --bucket fdebag ")
    expect(init?.volumes?.some((volume) => volume.includes("bucket-cors.dev.json"))).toBe(true)
    const cors = (await Bun.file(join(ROOT, "deploy", "bucket-cors.dev.json")).json()) as {
      CORSRules: Array<{ AllowedOrigins: string[]; AllowedMethods: string[] }>
    }
    expect(cors.CORSRules[0]?.AllowedOrigins).toEqual(["http://localhost:5173", "http://localhost:3000"])
    // The dashboard uploads profile photos and workspace logos straight to storage with PUT.
    expect(cors.CORSRules[0]?.AllowedMethods).toEqual(["GET", "HEAD", "PUT"])
  })

  test("the production bucket rule lets the dashboard upload photos and logos", async () => {
    const cors = (await Bun.file(join(ROOT, "deploy", "bucket-cors.json")).json()) as {
      CORSRules: Array<{ AllowedMethods: string[] }>
    }
    expect(cors.CORSRules[0]?.AllowedMethods).toEqual(["GET", "HEAD", "PUT"])
  })
})

describe("the share page's nginx block", () => {
  const nginx = () => Bun.file(join(ROOT, "docker/nginx.conf.template")).text()
  const block = (text: string, start: string) => text.slice(text.indexOf(start), text.indexOf("\n    }", text.indexOf(start)))

  test("a slow api costs the page at most about five seconds", async () => {
    const text = await nginx()
    expect(text).toContain("resolver_timeout 2s;")
    const meta = block(text, "location ^~ /__share_meta/ {")
    expect(meta).toContain("proxy_connect_timeout 1s;")
    expect(meta).toContain("proxy_read_timeout 2s;")
    expect(meta).toContain("proxy_send_timeout 2s;")
  })

  test("any answer but a 200 is left out of the page", async () => {
    const meta = block(await nginx(), "location ^~ /__share_meta/ {")
    const codes = meta.match(/error_page ([0-9 ]+) = @share_meta_empty;/)?.[1]?.split(" ").map(Number) ?? []
    for (const code of [301, 302, 307, 308, 400, 401, 403, 404, 405, 408, 409, 410, 413, 422, 429, 500, 501, 502, 503, 504]) {
      expect(codes).toContain(code)
    }
  })

  test("the page is never indexed, its tags or not, and its slug has a length", async () => {
    const text = await nginx()
    const page = block(text, 'location ~ "^/s/')
    expect(page).toContain('add_header X-Robots-Tag "noindex" always;')
    expect(page).toContain('location ~ "^/s/([A-Za-z0-9_-]{1,64})/?$" {')
  })
})

describe("the platform templates", () => {
  const templates = ["deploy/coolify/docker-compose.yml", "deploy/dokploy/docker-compose.yml"]

  test("S3 storage and the rarer sign-in settings reach the containers", async () => {
    for (const path of templates) {
      const text = await Bun.file(join(ROOT, path)).text()
      for (const name of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "GITLAB_URL", "OIDC_NAME", "EMAIL_SIGN_IN", "EXTENSION_INSTALL_URL"]) {
        expect(text, `${path} ${name}`).toContain(`${name}: \${${name}`)
      }
      expect(text, path).toContain("STORAGE_DRIVER: ${STORAGE_DRIVER:-local}")
    }
  })

  test("Dokploy's containers come back after a crash or a reboot", async () => {
    const text = await Bun.file(join(ROOT, "deploy/dokploy/docker-compose.yml")).text()
    const services = text.slice(text.indexOf("services:"), text.indexOf("\nvolumes:"))
    const names = [...services.matchAll(/^  ([a-z-]+):$/gm)].map((match) => match[1])
    expect(names).toEqual(["api", "api-mcp", "client", "postgres"])
    expect(services.match(/^    restart: unless-stopped$/gm)).toHaveLength(names.length)
  })
})
