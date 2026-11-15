import { exportJWK, generateKeyPair, SignJWT } from "jose"
import type { Config } from "../src/config"

export const FAKE_OIDC_CLIENT = { clientId: "bugberry", clientSecret: "fake-secret" }

/** An identity provider that runs inside the test process: discovery, authorize, token, userinfo and keys. */
export interface FakeOidc {
  issuer: string
  /** Claims of the next id token and userinfo answer; `sub` is required. */
  setClaims(claims: Record<string, unknown>): void
  setDiscovery(mode: "ok" | "refuse" | "hang"): void
  setTokenEndpoint(mode: "ok" | "fail"): void
  /** A valid id token for the current claims, outside any sign-in the server started. */
  mintIdToken(): Promise<string>
  stop(): Promise<void>
}

export async function startFakeOidc(): Promise<FakeOidc> {
  const { publicKey, privateKey } = await generateKeyPair("RS256")
  const jwk = { ...(await exportJWK(publicKey)), kid: "fake-key", alg: "RS256", use: "sig" }
  let claims: Record<string, unknown> = { sub: "nobody" }
  let discovery: "ok" | "refuse" | "hang" = "ok"
  let tokenEndpoint: "ok" | "fail" = "ok"
  const nonces = new Map<string, string | null>()
  const hanging: Array<() => void> = []

  const server = Bun.serve({
    port: 0,
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      const issuer = url.origin
      if (url.pathname === "/.well-known/openid-configuration") {
        if (discovery === "refuse") return new Response("down", { status: 503 })
        if (discovery === "hang") await new Promise<void>((release) => hanging.push(release))
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          userinfo_endpoint: `${issuer}/userinfo`,
          jwks_uri: `${issuer}/jwks`,
          end_session_endpoint: `${issuer}/logout`,
          id_token_signing_alg_values_supported: ["RS256"],
        })
      }
      if (url.pathname === "/authorize") {
        const code = crypto.randomUUID()
        nonces.set(code, url.searchParams.get("nonce"))
        const back = new URL(url.searchParams.get("redirect_uri") ?? "")
        back.searchParams.set("code", code)
        back.searchParams.set("state", url.searchParams.get("state") ?? "")
        return Response.redirect(back.href, 302)
      }
      if (url.pathname === "/token") {
        if (tokenEndpoint === "fail") return new Response("down", { status: 500 })
        const code = new URLSearchParams(await request.text()).get("code") ?? ""
        const nonce = nonces.get(code)
        const idToken = await new SignJWT({ ...claims, ...(nonce ? { nonce } : {}) })
          .setProtectedHeader({ alg: "RS256", kid: "fake-key" })
          .setIssuer(issuer)
          .setAudience(FAKE_OIDC_CLIENT.clientId)
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey)
        return Response.json({ access_token: `access-${code}`, token_type: "Bearer", expires_in: 300, id_token: idToken })
      }
      if (url.pathname === "/userinfo") return Response.json(claims)
      if (url.pathname === "/jwks") return Response.json({ keys: [jwk] })
      return new Response("not found", { status: 404 })
    },
  })

  return {
    issuer: `http://localhost:${server.port}`,
    setClaims: (next) => void (claims = next),
    setDiscovery: (mode) => void (discovery = mode),
    setTokenEndpoint: (mode) => void (tokenEndpoint = mode),
    mintIdToken: () =>
      new SignJWT({ ...claims })
        .setProtectedHeader({ alg: "RS256", kid: "fake-key" })
        .setIssuer(`http://localhost:${server.port}`)
        .setAudience(FAKE_OIDC_CLIENT.clientId)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey),
    async stop() {
      for (const release of hanging) release()
      await server.stop(true)
    },
  }
}

/** The Config override that points the server at the fake. */
export function oidcOverride(fake: FakeOidc, name: string | null = null): Pick<Config, "oidc"> {
  return { oidc: { issuer: fake.issuer, ...FAKE_OIDC_CLIENT, name } }
}

type Handler = { handle(request: Request): Promise<Response> }

const cookiePairs = (response: Response) => response.headers.getSetCookie().map((line) => line.split(";")[0] ?? "")

/** Asks the server to start a company sign-in, as the dashboard's button does. */
export function startOidcSignIn(ctx: { app: Handler; config: Config }): Promise<Response> {
  return ctx.app.handle(
    new Request(`${ctx.config.appUrl}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "oidc", callbackURL: "/app", errorCallbackURL: "/login" }),
    }),
  )
}

/** The browser's half of a sign-in: start, visit the IdP, come back. `cookie` is null when no session was made. */
export async function signInThroughOidc(ctx: {
  app: Handler
  config: Config
}): Promise<{ status: number; location: string; cookie: string | null }> {
  const started = await startOidcSignIn(ctx)
  const { url } = (await started.json()) as { url?: string }
  if (!url) throw new Error(`sign-in did not start (HTTP ${started.status})`)
  const atIdp = await fetch(url, { redirect: "manual" })
  const back = atIdp.headers.get("location")
  if (!back) throw new Error(`the fake IdP did not redirect (HTTP ${atIdp.status})`)
  const done = await ctx.app.handle(new Request(back, { headers: { cookie: cookiePairs(started).join("; ") } }))
  const session = cookiePairs(done).find((pair) => /session_token=.+/.test(pair)) ?? null
  return { status: done.status, location: done.headers.get("location") ?? "", cookie: session }
}
