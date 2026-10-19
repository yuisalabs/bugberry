import { beforeEach, describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { workspace } from "../src/db/schema"
import { createUserWithToken, putUpload, setupTestApp } from "./helpers"

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
)

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let workspaceId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  admin = await createUserWithToken(ctx.db, { name: "Admin", workspaceId: null })
  workspaceId = (await ctx.api.api.workspaces.post({ name: "Javan QA" }, { headers: admin.headers })).data?.id ?? ""
})

const logo = (headers = admin.headers) => ctx.api.api.workspaces({ id: workspaceId }).logo
const logoUrlOf = async () =>
  (await ctx.db.select({ logoUrl: workspace.logoUrl }).from(workspace).where(eq(workspace.id, workspaceId)))[0]?.logoUrl
const upload = async (bytes: Uint8Array<ArrayBuffer>, headers = admin.headers) => {
  const { data, error } = await logo().post({ contentType: "image/png", size: bytes.byteLength }, { headers })
  if (!data) throw new Error(`no upload target: ${JSON.stringify(error)}`)
  expect((await putUpload(ctx.app, data.upload, bytes)).status).toBeLessThan(300)
  return {
    logoId: data.logoId,
    confirm: () => logo()({ logoId: data.logoId }).post(undefined, { headers }),
  }
}

describe("workspace logo", () => {
  test("an admin uploads a logo and it shows in the list", async () => {
    const { logoId, confirm } = await upload(PNG)
    expect((await confirm()).data).toMatchObject({ id: workspaceId, slug: "javan-qa" })
    const row = (await ctx.api.api.workspaces.get({ headers: admin.headers })).data?.find((item) => item.id === workspaceId)
    expect(row?.logoUrl).toBe(`${ctx.config.appUrl}/api/workspace-logos/${workspaceId}/${logoId}`)
    const served = await ctx.app.handle(new Request(`http://localhost/api/workspace-logos/${workspaceId}/${logoId}`))
    expect(served.status).toBe(302)
    expect((await ctx.app.handle(new Request(`http://localhost/api/workspace-logos/${workspaceId}/nope.png`))).status).toBe(404)
  })

  test("a logo that is not PNG or JPEG is refused", async () => {
    const svg = Uint8Array.from(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"))
    const { logoId, confirm } = await upload(svg)
    const { error } = await confirm()
    expect(error?.status as number | undefined).toBe(422)
    expect(error?.value).toMatchObject({ code: "invalid_image" })
    expect(await logoUrlOf()).toBeNull()
    expect(await ctx.storage.head(`logos/${workspaceId}/${logoId}`)).toBeNull()
  })

  test("a logo over 2 MB is refused", async () => {
    const { error } = await logo().post({ contentType: "image/png", size: 2_097_153 }, { headers: admin.headers })
    expect(error?.status as number | undefined).toBe(413)
  })

  test("only admins change the slug and logo", async () => {
    const member = await createUserWithToken(ctx.db, { workspaceId, workspaceRole: "member" })
    const outsider = await createUserWithToken(ctx.db, { name: "Out" })
    const asMember = await logo().post({ contentType: "image/png", size: 10 }, { headers: member.headers })
    expect(asMember.error?.status as number | undefined).toBe(403)
    const asOutsider = await logo().post({ contentType: "image/png", size: 10 }, { headers: outsider.headers })
    expect(asOutsider.error?.status as number | undefined).toBe(404)
    expect((await logo().delete(undefined, { headers: member.headers })).error?.status as number | undefined).toBe(403)
  })

  test("replacing and removing deletes the old file; an abandoned upload goes when the next starts", async () => {
    const first = await upload(PNG)
    await first.confirm()
    const abandoned = await upload(PNG)
    const second = await upload(PNG)
    expect(await ctx.storage.head(`logos/${workspaceId}/${abandoned.logoId}`)).toBeNull()
    await second.confirm()
    expect(await ctx.storage.head(`logos/${workspaceId}/${first.logoId}`)).toBeNull()
    expect((await logo().delete(undefined, { headers: admin.headers })).data).toMatchObject({ logoUrl: null })
    expect(await ctx.storage.head(`logos/${workspaceId}/${second.logoId}`)).toBeNull()
  })

  test("logo uploads are rate limited", async () => {
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) {
      const { error } = await logo().post({ contentType: "image/png", size: 10 }, { headers: admin.headers })
      statuses.push((error?.status as number | undefined) ?? 200)
    }
    expect(statuses.slice(0, 20).every((status) => status === 200)).toBe(true)
    expect(statuses[20]).toBe(429)
  })
})
