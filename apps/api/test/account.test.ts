import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { createAuth } from "../src/auth/better-auth"
import { loadConfig } from "../src/config"
import { account, user } from "../src/db/schema"
import { imageType } from "../src/lib/image-type"
import { newId } from "../src/lib/ids"
import { createUserWithToken, putUpload, sessionHeaders, setupTestApp } from "./helpers"

// A 1×1 transparent PNG.
const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
)
const JPEG_START = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46])

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let budi: Awaited<ReturnType<typeof createUserWithToken>>

beforeEach(async () => {
  ctx = await setupTestApp()
  budi = await createUserWithToken(ctx.db, { name: "Budi" })
})

const imageOf = async () => (await ctx.db.select({ image: user.image }).from(user).where(eq(user.id, budi.user.id)))[0]?.image
const me = () => ctx.api.api.me
const upload = async (bytes: Uint8Array<ArrayBuffer>, contentType: "image/png" | "image/jpeg" = "image/png") => {
  const { data, error } = await me().avatar.post({ contentType, size: bytes.byteLength }, { headers: budi.headers })
  if (!data) throw new Error(`no upload target: ${JSON.stringify(error)}`)
  expect((await putUpload(ctx.app, data.upload, bytes)).status).toBeLessThan(300)
  return { avatarId: data.avatarId, confirm: () => me().avatar({ avatarId: data.avatarId }).post(undefined, { headers: budi.headers }) }
}

describe("imageType", () => {
  test("knows PNG and JPEG by their first bytes only", () => {
    expect(imageType(PNG)).toBe("image/png")
    expect(imageType(JPEG_START)).toBe("image/jpeg")
    expect(imageType(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull()
    expect(imageType(new Uint8Array())).toBeNull()
  })
})

describe("account", () => {
  test("changing the display name", async () => {
    const { data } = await me().patch({ name: " Budi S " }, { headers: budi.headers })
    expect(data?.name).toBe("Budi S")
    for (const name of ["   ", "x".repeat(81)]) {
      const { error } = await me().patch({ name }, { headers: budi.headers })
      expect(error?.status as number | undefined).toBe(422)
    }
  })

  test("uploading a photo sets it everywhere", async () => {
    const { avatarId, confirm } = await upload(PNG)
    expect(avatarId).toMatch(/^[A-Za-z0-9_-]+\.png$/)
    const { data } = await confirm()
    const image = (await ctx.api.api.me.get({ headers: budi.headers })).data?.image ?? ""
    expect(data?.image).toBe(image)
    expect(image).toBe(`${ctx.config.appUrl}/api/avatars/${budi.user.id}/${avatarId}`)
    const served = await ctx.app.handle(new Request(`http://localhost/api/avatars/${budi.user.id}/${avatarId}`))
    expect(served.status).toBe(302)
    const missing = await ctx.app.handle(new Request(`http://localhost/api/avatars/${budi.user.id}/nope.png`))
    expect(missing.status).toBe(404)
  })

  test("a file that is not PNG or JPEG is refused", async () => {
    const svg = Uint8Array.from(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"))
    const { avatarId, confirm } = await upload(svg)
    const { error } = await confirm()
    expect(error?.status as number | undefined).toBe(422)
    expect(error?.value).toMatchObject({ code: "invalid_image" })
    expect(await imageOf()).toBeNull()
    expect(await ctx.storage.head(`avatars/${budi.user.id}/${avatarId}`)).toBeNull()
  })

  test("a photo over 2 MB is refused", async () => {
    const { error } = await me().avatar.post({ contentType: "image/png", size: 2_097_153 }, { headers: budi.headers })
    expect(error?.status as number | undefined).toBe(413)
  })

  test("replacing and removing a photo deletes the old file", async () => {
    const first = await upload(PNG)
    await first.confirm()
    const second = await upload(PNG)
    await second.confirm()
    expect(await ctx.storage.head(`avatars/${budi.user.id}/${first.avatarId}`)).toBeNull()
    const { data } = await me().avatar.delete(undefined, { headers: budi.headers })
    expect(data?.image).toBeNull()
    expect(await ctx.storage.head(`avatars/${budi.user.id}/${second.avatarId}`)).toBeNull()
  })

  test("an unconfirmed upload is deleted when the next one starts", async () => {
    const abandoned = await upload(PNG)
    const kept = await upload(PNG)
    expect(await ctx.storage.head(`avatars/${budi.user.id}/${abandoned.avatarId}`)).toBeNull()
    await kept.confirm()
    const next = await upload(PNG)
    // The photo in use is never the one cleaned up.
    expect(await ctx.storage.head(`avatars/${budi.user.id}/${kept.avatarId}`)).not.toBeNull()
    expect(await ctx.storage.head(`avatars/${budi.user.id}/${next.avatarId}`)).not.toBeNull()
  })

  test("photo uploads are rate limited", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) {
      const { error } = await me().avatar.post({ contentType: "image/png", size: 10 }, { headers: budi.headers })
      statuses.push((error?.status as number | undefined) ?? 200)
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
  })

  test("update-user cannot change the image", async () => {
    const headers = { ...(await sessionHeaders(ctx, budi.user.id)), origin: ctx.config.appUrl, "content-type": "application/json" }
    const response = await ctx.app.handle(
      new Request("http://localhost/api/auth/update-user", {
        method: "POST",
        headers,
        body: JSON.stringify({ image: "https://evil.test/x.png", name: "Hacked" }),
      }),
    )
    expect(response.status).toBeGreaterThanOrEqual(400)
    const [row] = await ctx.db.select({ image: user.image, name: user.name }).from(user).where(eq(user.id, budi.user.id))
    expect(row).toEqual({ image: null, name: "Budi" })
  })

  test("signing in again keeps a changed name", () => {
    const auth = createAuth(ctx.config, ctx.db)
    const providers = auth.options.socialProviders as Record<string, { overrideUserInfoOnSignIn?: boolean } | undefined>
    for (const id of ["google", "github", "gitlab"]) expect(providers[id]?.overrideUserInfoOnSignIn).not.toBe(true)
  })

  test("sign-in methods", async () => {
    await ctx.db.insert(account).values({ id: newId(), accountId: "g-1", providerId: "google", userId: budi.user.id })
    const { data } = await me()["sign-in-methods"].get({ headers: budi.headers })
    expect(data).toEqual({ methods: ["google", "email"] })
  })

  test("client config", async () => {
    // The test config allows 1 MB uploads.
    expect((await ctx.api.api["client-config"].get()).data).toEqual({ extensionInstallUrl: null, maxUploadMb: 1, publicSite: false })
    const configured = await setupTestApp({
      extensionInstallUrl: "https://chromewebstore.google.com/detail/x",
      maxUploadBytes: 120 * 1024 * 1024,
    })
    expect((await configured.api.api["client-config"].get()).data).toEqual({
      extensionInstallUrl: "https://chromewebstore.google.com/detail/x",
      maxUploadMb: 120,
      publicSite: false,
    })
    const hosted = await setupTestApp({ publicSite: true })
    expect((await hosted.api.api["client-config"].get()).data).toMatchObject({ publicSite: true })
    const env = {
      APP_URL: "http://localhost:3000",
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      BETTER_AUTH_SECRET: "a".repeat(32),
      GOOGLE_CLIENT_ID: "id",
      GOOGLE_CLIENT_SECRET: "secret",
      ALLOWED_EMAIL_DOMAINS: "kantor.com",
      ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    }
    expect(loadConfig({ ...env, EXTENSION_INSTALL_URL: "https://example.test/install" }).extensionInstallUrl).toBe(
      "https://example.test/install",
    )
    expect(() => loadConfig({ ...env, EXTENSION_INSTALL_URL: "ftp://x" })).toThrow(/EXTENSION_INSTALL_URL/)
  })
})
