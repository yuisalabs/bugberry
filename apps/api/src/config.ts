import { clockLabel } from "@bugberry/shared"

export type StorageConfig =
  | { driver: "local"; dir: string }
  | {
      driver: "s3"
      endpoint: string
      region: string
      bucket: string
      accessKeyId: string
      secretAccessKey: string
      virtualHostedStyle: boolean
    }

export interface OAuthClient {
  clientId: string
  clientSecret: string
}

/** The company's own identity provider (OIDC_*). */
export interface OidcConfig {
  /** Without a trailing slash; discovery is read from `{issuer}/.well-known/openid-configuration`. */
  issuer: string
  clientId: string
  clientSecret: string
  /** The name on the sign-in button; null shows "SSO". */
  name: string | null
}

/** Where sign-in codes go: Resend, an SMTP server, or the server log (development only). */
export type EmailConfig =
  | { driver: "resend"; from: string; apiKey: string }
  | {
      driver: "smtp"
      from: string
      host: string
      port: number
      user: string | null
      password: string | null
      secure: boolean
    }
  | { driver: "log"; from: string }

/** BugBerry cloud's per-account caps; exempt accounts are marked `unlimited` from the CLI. */
export interface AccountLimits {
  screenshots: number
  recordings: number
  ownedWorkspaces: number
  /** The longest recording one workspace takes. */
  recordingMs: number
}

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`

/** The startup line that confirms ACCOUNT_LIMITS took effect; null when limits are off. */
export function accountLimitsNotice(limits: AccountLimits | null): string | null {
  if (!limits) return null
  return `Account limits on: ${counted(limits.screenshots, "screenshot")} / ${counted(limits.recordings, "recording")} / ${counted(limits.ownedWorkspaces, "workspace")} per account, recordings up to ${clockLabel(limits.recordingMs)}`
}

export interface Config {
  port: number
  appUrl: string
  databaseUrl: string
  authSecret: string
  /** Each sign-in method is optional; at least one is on. */
  google: OAuthClient | null
  github: OAuthClient | null
  gitlab: (OAuthClient & { url: string }) | null
  oidc: OidcConfig | null
  /** How every email is sent (codes, invitations, notifications); null in production without EMAIL_DRIVER. */
  email: EmailConfig | null
  /** Email-code sign-in is on: there is a way to send email and EMAIL_SIGN_IN is not false. */
  emailSignIn: boolean
  allowedEmailDomains: string[]
  extensionId: string | null
  /** Where the dashboard sends people to install the extension; null shows "Ask your admin". */
  extensionInstallUrl: string | null
  maxUploadBytes: number
  uploadUrlTtlSeconds: number
  readUrlTtlSeconds: number
  /**
   * Proxies that append to X-Forwarded-For in front of the server: nginx (PROXY_HOPS, set by compose)
   * plus Caddy or the operator's own proxy (TRUST_PROXY).
   */
  proxyHops: number
  /** Base64 of 32 random bytes; encrypts tracker tokens at rest. */
  encryptionKey: string
  storage: StorageConfig
  /** Null unless ACCOUNT_LIMITS=true: self-hosted servers have no limits. */
  accountLimits: AccountLimits | null
  /** ALLOW_PRIVATE_INTEGRATION_HOSTS=true lets integrations reach private network addresses (an internal GitLab). */
  allowPrivateIntegrationHosts: boolean
  /** BugBerry cloud only (PUBLIC_SITE=true): the marketing pages and the demo form. Off on self-hosted servers. */
  publicSite: boolean
  /** Who is emailed each demo request (DEMO_REQUEST_EMAIL); null stores requests without emailing anyone. */
  demoRequestEmail: string | null
  /**
   * Which routes this process serves (SERVER_ROLE): "all" in one process, or "app" and "mcp" when MCP runs in its
   * own container, so agents cannot slow the dashboard down.
   */
  serverRole: ServerRole
  /** Database connections for the dashboard, extension and integrations (DB_POOL_MAX). */
  dbPoolMax: number
  mcp: McpServerConfig
  /** Threads that unpack and parse captured payloads off the request thread (PAYLOAD_WORKERS). */
  payloadWorkers: number
}

export type ServerRole = "all" | "app" | "mcp"

/** How much of the server MCP may use, so a flood of agent calls waits its turn instead of the dashboard. */
export interface McpServerConfig {
  /** Its own database connections, apart from the dashboard's (MCP_DB_POOL_MAX). */
  dbPoolMax: number
  /** A query from a tool is cancelled after this long (MCP_STATEMENT_TIMEOUT_MS). */
  statementTimeoutMs: number
  /** Tool calls running at once (MCP_MAX_ACTIVE). */
  maxActive: number
  /** Calls waiting for a place; more are answered 503 right away (MCP_MAX_QUEUED). */
  maxQueued: number
  /** Of those places, how many one person's agents may hold at once (MCP_MAX_ACTIVE_PER_PERSON). */
  maxActivePerPerson: number
  /** Of the waiting calls, how many may be one person's (MCP_MAX_QUEUED_PER_PERSON). */
  maxQueuedPerPerson: number
  /** A waiting call is answered 503 after this long (MCP_QUEUE_TIMEOUT_MS). */
  queueTimeoutMs: number
  /**
   * Per-person call limits counted in Postgres, so they hold across several MCP containers (MCP_SHARED_RATE_LIMIT).
   * On by default when SERVER_ROLE=mcp.
   */
  sharedRateLimit: boolean
}

export class ConfigError extends Error {
  override name = "ConfigError"
}

type Env = Record<string, string | undefined>

const MIN_URL_TTL_SECONDS = 60
const MAX_URL_TTL_SECONDS = 604_800 // 7 days: the SigV4 presign limit on S3, R2 and MinIO
const MIN_AUTH_SECRET_LENGTH = 32

/**
 * Puts DATABASE_PASSWORD into the URL percent-encoded. Generated passwords often contain "/" or "@",
 * which would otherwise end the URL's host part (Docker Compose pastes it into the URL as-is).
 */
function withDatabasePassword(databaseUrl: string, password: string | undefined): string {
  if (!password) return databaseUrl
  let url: URL
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new ConfigError("DATABASE_URL is not a valid URL")
  }
  url.password = password
  return url.href
}

export function loadConfig(env: Env): Config {
  const optional = (name: string): string | undefined => env[name]?.trim() || undefined

  const required = (name: string): string => {
    const value = optional(name)
    if (!value) throw new ConfigError(`${name} is required`)
    return value
  }

  const integer = (name: string, fallback: number, min: number, max: number): number => {
    const raw = optional(name)
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < min || value > max) {
      throw new ConfigError(`${name} must be an integer between ${min} and ${max}`)
    }
    return value
  }

  const flag = (name: string, fallback: boolean): boolean => {
    const raw = optional(name)
    if (raw === undefined) return fallback
    if (raw !== "true" && raw !== "false") throw new ConfigError(`${name} must be 'true' or 'false'`)
    return raw === "true"
  }

  const list = (name: string): string[] =>
    (env[name] ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => item.length > 0)

  const extensionInstallUrl = optional("EXTENSION_INSTALL_URL") ?? null
  if (extensionInstallUrl !== null && !/^https?:\/\/\S+$/i.test(extensionInstallUrl)) {
    throw new ConfigError("EXTENSION_INSTALL_URL must be an http(s) URL")
  }

  const authSecret = required("BETTER_AUTH_SECRET")
  if (authSecret.length < MIN_AUTH_SECRET_LENGTH) {
    throw new ConfigError(`BETTER_AUTH_SECRET must be at least ${MIN_AUTH_SECRET_LENGTH} characters`)
  }

  // Empty: anyone can sign up (BugBerry cloud). Set: only these domains sign in (a company's own server).
  const allowedEmailDomains = list("ALLOWED_EMAIL_DOMAINS")

  const driver = optional("STORAGE_DRIVER") ?? "local"
  let storage: StorageConfig
  if (driver === "local") {
    storage = { driver, dir: optional("LOCAL_STORAGE_DIR") ?? "./data/uploads" }
  } else if (driver === "s3") {
    storage = {
      driver,
      endpoint: required("S3_ENDPOINT"),
      region: optional("S3_REGION") ?? "auto",
      bucket: required("S3_BUCKET"),
      accessKeyId: required("S3_ACCESS_KEY_ID"),
      secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
      virtualHostedStyle: optional("S3_VIRTUAL_HOSTED_STYLE") === "true",
    }
  } else {
    throw new ConfigError("STORAGE_DRIVER must be 'local' or 's3'")
  }

  /** A provider is on when both its id and secret are set; one without the other is a mistake. */
  const oauthClient = (prefix: string): OAuthClient | null => {
    const clientId = optional(`${prefix}_CLIENT_ID`)
    const clientSecret = optional(`${prefix}_CLIENT_SECRET`)
    if (!clientId && !clientSecret) return null
    if (!clientId) throw new ConfigError(`${prefix}_CLIENT_ID is required when ${prefix}_CLIENT_SECRET is set`)
    if (!clientSecret) throw new ConfigError(`${prefix}_CLIENT_SECRET is required when ${prefix}_CLIENT_ID is set`)
    return { clientId, clientSecret }
  }
  const google = oauthClient("GOOGLE")
  const github = oauthClient("GITHUB")
  const gitlabClient = oauthClient("GITLAB")
  const gitlab = gitlabClient
    ? { ...gitlabClient, url: (optional("GITLAB_URL") ?? "https://gitlab.com").replace(/\/+$/, "") }
    : null

  const oidcIssuer = optional("OIDC_ISSUER")
  const oidcClientId = optional("OIDC_CLIENT_ID")
  const oidcClientSecret = optional("OIDC_CLIENT_SECRET")
  const oidcName = optional("OIDC_NAME")
  let oidc: OidcConfig | null = null
  if (oidcIssuer || oidcClientId || oidcClientSecret || oidcName) {
    // Half-set company sign-in must not start quietly with SSO off.
    const needed = { OIDC_ISSUER: oidcIssuer, OIDC_CLIENT_ID: oidcClientId, OIDC_CLIENT_SECRET: oidcClientSecret }
    for (const [name, value] of Object.entries(needed)) {
      if (!value) throw new ConfigError(`${name} is required when company sign-in (OIDC) is set up`)
    }
    const issuer = (oidcIssuer ?? "").replace(/\/\.well-known\/openid-configuration\/?$/, "").replace(/\/+$/, "")
    if (!/^https?:\/\/\S+$/i.test(issuer)) throw new ConfigError("OIDC_ISSUER must be an http(s) URL")
    if (oidcName && oidcName.length > 40) throw new ConfigError("OIDC_NAME must be at most 40 characters")
    oidc = { issuer, clientId: oidcClientId ?? "", clientSecret: oidcClientSecret ?? "", name: oidcName ?? null }
  }

  const emailDriver = optional("EMAIL_DRIVER")
  let email: EmailConfig | null
  if (emailDriver === "resend") {
    email = { driver: "resend", from: required("EMAIL_FROM"), apiKey: required("RESEND_API_KEY") }
  } else if (emailDriver === "smtp") {
    email = {
      driver: "smtp",
      from: required("EMAIL_FROM"),
      host: required("SMTP_HOST"),
      port: integer("SMTP_PORT", 587, 1, 65_535),
      user: optional("SMTP_USER") ?? null,
      password: optional("SMTP_PASSWORD") ?? null,
      secure: optional("SMTP_SECURE") === "true",
    }
  } else if (emailDriver === undefined) {
    // Outside production, codes are printed to the server log so sign-in works without a mail service.
    email = optional("NODE_ENV") === "production" ? null : { driver: "log", from: optional("EMAIL_FROM") ?? "BugBerry <no-reply@localhost>" }
  } else {
    throw new ConfigError("EMAIL_DRIVER must be 'resend' or 'smtp'")
  }
  const emailSignIn = email !== null && flag("EMAIL_SIGN_IN", true)
  if (!google && !github && !gitlab && !oidc && !emailSignIn) {
    throw new ConfigError(
      "Enable at least one sign-in method: Google, GitHub, GitLab, company sign-in (OIDC_ISSUER) or email codes (EMAIL_DRIVER)",
    )
  }

  const demoRequestEmail = optional("DEMO_REQUEST_EMAIL") ?? null
  if (demoRequestEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(demoRequestEmail)) {
    throw new ConfigError("DEMO_REQUEST_EMAIL must be an email address")
  }

  const serverRole = optional("SERVER_ROLE") ?? "all"
  if (serverRole !== "all" && serverRole !== "app" && serverRole !== "mcp") {
    throw new ConfigError("SERVER_ROLE must be 'all', 'app' or 'mcp'")
  }

  const encryptionKey = required("ENCRYPTION_KEY")
  if (Buffer.from(encryptionKey, "base64").length !== 32) {
    throw new ConfigError("ENCRYPTION_KEY must be 32 random bytes in base64 (openssl rand -base64 32)")
  }

  return {
    port: integer("PORT", 3000, 1, 65_535),
    appUrl: required("APP_URL").replace(/\/+$/, ""),
    databaseUrl: withDatabasePassword(required("DATABASE_URL"), optional("DATABASE_PASSWORD")),
    authSecret,
    google,
    github,
    gitlab,
    oidc,
    email,
    emailSignIn,
    allowedEmailDomains,
    extensionId: optional("EXTENSION_ID") ?? null,
    extensionInstallUrl,
    maxUploadBytes: integer("MAX_UPLOAD_MB", 300, 1, 2000) * 1024 * 1024,
    uploadUrlTtlSeconds: integer("UPLOAD_URL_TTL_SECONDS", 3600, MIN_URL_TTL_SECONDS, MAX_URL_TTL_SECONDS),
    readUrlTtlSeconds: integer("READ_URL_TTL_SECONDS", 3600, MIN_URL_TTL_SECONDS, MAX_URL_TTL_SECONDS),
    proxyHops: integer("PROXY_HOPS", 0, 0, 5) + (optional("TRUST_PROXY") === "true" ? 1 : 0),
    encryptionKey,
    storage,
    accountLimits:
      optional("ACCOUNT_LIMITS") === "true"
        ? {
            screenshots: integer("LIMIT_SCREENSHOTS", 5, 1, 10_000),
            recordings: integer("LIMIT_RECORDINGS", 5, 1, 10_000),
            ownedWorkspaces: integer("LIMIT_OWNED_WORKSPACES", 1, 1, 10_000),
            recordingMs: integer("LIMIT_RECORDING_SECONDS", 120, 10, 3600) * 1000,
          }
        : null,
    allowPrivateIntegrationHosts: optional("ALLOW_PRIVATE_INTEGRATION_HOSTS") === "true",
    publicSite: optional("PUBLIC_SITE") === "true",
    demoRequestEmail,
    serverRole,
    dbPoolMax: integer("DB_POOL_MAX", 10, 1, 500),
    mcp: {
      dbPoolMax: integer("MCP_DB_POOL_MAX", 5, 1, 500),
      statementTimeoutMs: integer("MCP_STATEMENT_TIMEOUT_MS", 10_000, 100, 600_000),
      maxActive: integer("MCP_MAX_ACTIVE", 8, 1, 1000),
      maxQueued: integer("MCP_MAX_QUEUED", 32, 0, 10_000),
      maxActivePerPerson: integer("MCP_MAX_ACTIVE_PER_PERSON", 4, 1, 1000),
      maxQueuedPerPerson: integer("MCP_MAX_QUEUED_PER_PERSON", 16, 0, 10_000),
      queueTimeoutMs: integer("MCP_QUEUE_TIMEOUT_MS", 10_000, 100, 300_000),
      sharedRateLimit: flag("MCP_SHARED_RATE_LIMIT", serverRole === "mcp"),
    },
    payloadWorkers: integer("PAYLOAD_WORKERS", 2, 1, 64),
  }
}
