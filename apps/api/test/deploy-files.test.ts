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
      if (name === "api" || name === "client") continue
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
