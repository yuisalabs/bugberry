import { beforeEach, describe, expect, test } from "bun:test"
import { createProject, createUserWithToken, putUpload, setupTestApp } from "./helpers"

const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64",
  ),
)

let ctx: Awaited<ReturnType<typeof setupTestApp>>
let admin: Awaited<ReturnType<typeof createUserWithToken>>
let projectId: string

beforeEach(async () => {
  ctx = await setupTestApp()
  admin = await createUserWithToken(ctx.db, { role: "admin" })
  projectId = (await createProject(ctx.db, { name: "Quinella AI" })).id
})

const logo = () => ctx.api.api.projects({ id: projectId }).logo
const upload = async (bytes: Uint8Array<ArrayBuffer>) => {
  const { data, error } = await logo().post({ contentType: "image/png", size: bytes.byteLength }, { headers: admin.headers })
  if (!data) throw new Error(`no upload target: ${JSON.stringify(error)}`)
  expect((await putUpload(ctx.app, data.upload, bytes)).status).toBeLessThan(300)
  return { logoId: data.logoId, confirm: () => logo()({ logoId: data.logoId }).post(undefined, { headers: admin.headers }) }
}

describe("project logo", () => {
  test("an admin uploads a logo and the project list carries it", async () => {
    const { logoId, confirm } = await upload(PNG)
    expect((await confirm()).data).toMatchObject({ id: projectId, name: "Quinella AI" })
    const row = (await ctx.api.api.projects.get({ headers: admin.headers })).data?.find((item) => item.id === projectId)
    expect(row?.logoUrl).toBe(`${ctx.config.appUrl}/api/project-logos/${projectId}/${logoId}`)
    const served = await ctx.app.handle(new Request(`http://localhost/api/project-logos/${projectId}/${logoId}`))
    expect(served.status).toBe(302)
  })

  test("a file that isn't PNG or JPEG is refused", async () => {
    const { confirm } = await upload(Uint8Array.from(new TextEncoder().encode("<svg/>")))
    expect((await confirm()).error?.value).toMatchObject({ code: "invalid_image" })
  })

  test("members can't change it", async () => {
    const member = await createUserWithToken(ctx.db)
    const { error } = await logo().post({ contentType: "image/png", size: 10 }, { headers: member.headers })
    expect(error?.status as number | undefined).toBe(403)
  })

  test("replacing, removing or deleting the project deletes the old file", async () => {
    const first = await upload(PNG)
    await first.confirm()
    const second = await upload(PNG)
    await second.confirm()
    expect(await ctx.storage.head(`project-logos/${projectId}/${first.logoId}`)).toBeNull()
    expect((await logo().delete(undefined, { headers: admin.headers })).data).toMatchObject({ logoUrl: null })
    expect(await ctx.storage.head(`project-logos/${projectId}/${second.logoId}`)).toBeNull()

    const third = await upload(PNG)
    await third.confirm()
    await ctx.api.api.projects({ id: projectId }).delete(undefined, { headers: admin.headers })
    expect(await ctx.storage.head(`project-logos/${projectId}/${third.logoId}`)).toBeNull()
  })
})
