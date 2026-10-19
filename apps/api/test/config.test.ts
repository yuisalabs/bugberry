import { describe, expect, test } from "bun:test"
import { ConfigError, loadConfig } from "../src/config"

const baseEnv: Record<string, string | undefined> = {
  APP_URL: "http://localhost:3000/",
  DATABASE_URL: "postgres://u:p@localhost:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  GOOGLE_CLIENT_ID: "client-id",
  GOOGLE_CLIENT_SECRET: "client-secret",
  ALLOWED_EMAIL_DOMAINS: " Kantor.com , ",
  ADMIN_EMAILS: "Boss@Kantor.com",
  ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
}

describe("loadConfig", () => {
  test("DATABASE_PASSWORD is put into DATABASE_URL encoded, so any generated password works", () => {
    const config = loadConfig({
      ...baseEnv,
      DATABASE_URL: "postgres://fdebag@postgres:5432/fdebag",
      DATABASE_PASSWORD: "ab/c+d=e@f:g",
    })
    const url = new URL(config.databaseUrl)
    expect(url.hostname).toBe("postgres")
    expect(url.port).toBe("5432")
    expect(decodeURIComponent(url.password)).toBe("ab/c+d=e@f:g")
    expect(() => loadConfig({ ...baseEnv, DATABASE_URL: "not a url", DATABASE_PASSWORD: "x" })).toThrow(/DATABASE_URL/)
  })

  test("sign-in providers are optional, but each needs both its id and secret", () => {
    const noGoogle = { ...baseEnv, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined }
    expect(loadConfig({ ...noGoogle, GITHUB_CLIENT_ID: "gh", GITHUB_CLIENT_SECRET: "s" })).toMatchObject({
      google: null,
      github: { clientId: "gh", clientSecret: "s" },
      gitlab: null,
    })
    expect(() => loadConfig({ ...baseEnv, GITHUB_CLIENT_ID: "gh" })).toThrow(/GITHUB_CLIENT_SECRET/)
    expect(() => loadConfig({ ...baseEnv, GOOGLE_CLIENT_SECRET: undefined })).toThrow(/GOOGLE_CLIENT_SECRET/)
    expect(loadConfig({ ...baseEnv, GITLAB_CLIENT_ID: "gl", GITLAB_CLIENT_SECRET: "s" }).gitlab).toEqual({
      clientId: "gl",
      clientSecret: "s",
      url: "https://gitlab.com",
    })
    expect(
      loadConfig({ ...baseEnv, GITLAB_CLIENT_ID: "gl", GITLAB_CLIENT_SECRET: "s", GITLAB_URL: "https://gitlab.kantor.com/" })
        .gitlab?.url,
    ).toBe("https://gitlab.kantor.com")
  })

  test("email sign-in uses Resend or SMTP, logs codes outside production, and is off in production without a driver", () => {
    expect(
      loadConfig({ ...baseEnv, EMAIL_DRIVER: "resend", EMAIL_FROM: "BugBerry <a@b.c>", RESEND_API_KEY: "re_1" }).email,
    ).toEqual({ driver: "resend", from: "BugBerry <a@b.c>", apiKey: "re_1" })
    expect(loadConfig({ ...baseEnv, EMAIL_DRIVER: "smtp", EMAIL_FROM: "a@b.c", SMTP_HOST: "smtp.b.c" }).email).toEqual({
      driver: "smtp",
      from: "a@b.c",
      host: "smtp.b.c",
      port: 587,
      user: null,
      password: null,
      secure: false,
    })
    expect(loadConfig({ ...baseEnv, NODE_ENV: "development" }).email?.driver).toBe("log")
    expect(loadConfig({ ...baseEnv, NODE_ENV: "production" }).email).toBeNull()
    expect(() => loadConfig({ ...baseEnv, EMAIL_DRIVER: "resend", EMAIL_FROM: "a@b.c" })).toThrow(/RESEND_API_KEY/)
    expect(() => loadConfig({ ...baseEnv, EMAIL_DRIVER: "sendgrid" })).toThrow(/EMAIL_DRIVER/)
  })

  test("refuses to start with no way to sign in", () => {
    const nothing = { ...baseEnv, GOOGLE_CLIENT_ID: undefined, GOOGLE_CLIENT_SECRET: undefined, NODE_ENV: "production" }
    expect(() => loadConfig(nothing)).toThrow(/at least one sign-in method/)
  })

  test("requires a 32-byte base64 ENCRYPTION_KEY", () => {
    expect(loadConfig(baseEnv).encryptionKey).toBe(Buffer.alloc(32, 1).toString("base64"))
    expect(() => loadConfig({ ...baseEnv, ENCRYPTION_KEY: undefined })).toThrow(/ENCRYPTION_KEY/)
    expect(() => loadConfig({ ...baseEnv, ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") })).toThrow(/ENCRYPTION_KEY/)
  })

  test("applies defaults and normalises lists", () => {
    const config = loadConfig(baseEnv)
    expect(config.port).toBe(3000)
    expect(config.appUrl).toBe("http://localhost:3000")
    expect(config.allowedEmailDomains).toEqual(["kantor.com"])
    expect(config.extensionId).toBeNull()
    expect(config.maxUploadBytes).toBe(300 * 1024 * 1024)
    expect(config.uploadUrlTtlSeconds).toBe(3600)
    expect(config.readUrlTtlSeconds).toBe(3600)
    expect(config.storage).toEqual({ driver: "local", dir: "./data/uploads" })
    expect(config.proxyHops).toBe(0)
  })

  test("counts trusted proxy hops from PROXY_HOPS plus TRUST_PROXY", () => {
    expect(loadConfig({ ...baseEnv, TRUST_PROXY: "true" }).proxyHops).toBe(1)
    expect(loadConfig({ ...baseEnv, TRUST_PROXY: "yes" }).proxyHops).toBe(0)
    expect(loadConfig({ ...baseEnv, PROXY_HOPS: "1" }).proxyHops).toBe(1)
    expect(loadConfig({ ...baseEnv, PROXY_HOPS: "1", TRUST_PROXY: "true" }).proxyHops).toBe(2)
    expect(() => loadConfig({ ...baseEnv, PROXY_HOPS: "-1" })).toThrow(/PROXY_HOPS/)
    expect(() => loadConfig({ ...baseEnv, PROXY_HOPS: "6" })).toThrow(/PROXY_HOPS/)
  })

  test("names the missing variable", () => {
    expect(() => loadConfig({ ...baseEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/)
    expect(() => loadConfig({ ...baseEnv, DATABASE_URL: undefined })).toThrow(ConfigError)
  })

  test("rejects a short auth secret", () => {
    expect(() => loadConfig({ ...baseEnv, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/)
  })

  test("without ALLOWED_EMAIL_DOMAINS anyone can sign up", () => {
    const { ALLOWED_EMAIL_DOMAINS: _unset, ...open } = baseEnv
    expect(loadConfig(open).allowedEmailDomains).toEqual([])
    expect(loadConfig({ ...baseEnv, ALLOWED_EMAIL_DOMAINS: " , " }).allowedEmailDomains).toEqual([])
  })

  test("accepts URL TTLs between 60 seconds and 7 days only", () => {
    expect(loadConfig({ ...baseEnv, UPLOAD_URL_TTL_SECONDS: "604800" }).uploadUrlTtlSeconds).toBe(604800)
    expect(() => loadConfig({ ...baseEnv, UPLOAD_URL_TTL_SECONDS: "59" })).toThrow(/UPLOAD_URL_TTL_SECONDS/)
    expect(() => loadConfig({ ...baseEnv, READ_URL_TTL_SECONDS: "604801" })).toThrow(/READ_URL_TTL_SECONDS/)
    expect(() => loadConfig({ ...baseEnv, READ_URL_TTL_SECONDS: "1.5" })).toThrow(/READ_URL_TTL_SECONDS/)
  })

  test("reads Cloudflare R2 settings for the s3 driver", () => {
    const config = loadConfig({
      ...baseEnv,
      STORAGE_DRIVER: "s3",
      S3_ENDPOINT: "https://abc123.r2.cloudflarestorage.com",
      S3_BUCKET: "fdebag",
      S3_ACCESS_KEY_ID: "key",
      S3_SECRET_ACCESS_KEY: "secret",
    })
    expect(config.storage).toEqual({
      driver: "s3",
      endpoint: "https://abc123.r2.cloudflarestorage.com",
      region: "auto",
      bucket: "fdebag",
      accessKeyId: "key",
      secretAccessKey: "secret",
      virtualHostedStyle: false,
    })
  })

  test("requires bucket settings for the s3 driver", () => {
    expect(() =>
      loadConfig({ ...baseEnv, STORAGE_DRIVER: "s3", S3_ENDPOINT: "http://localhost:9000" }),
    ).toThrow(/S3_BUCKET/)
  })

  test("rejects unknown storage drivers", () => {
    expect(() => loadConfig({ ...baseEnv, STORAGE_DRIVER: "ftp" })).toThrow(/STORAGE_DRIVER/)
  })
})
