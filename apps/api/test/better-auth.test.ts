import { describe, expect, test } from "bun:test"
import { createAuth } from "../src/modules/auth/better-auth"
import { getTestDb, testConfig } from "./helpers"

// Drives the provisioning hooks Better Auth runs during the Google callback, without a real OAuth round trip.
async function hooks() {
  const auth = createAuth(testConfig(), await getTestDb())
  const validateUserInfo = auth.options.user?.validateUserInfo
  const createBefore = auth.options.databaseHooks?.user?.create?.before
  if (!validateUserInfo || !createBefore) throw new Error("expected Better Auth provisioning hooks to be configured")
  const source = { action: "create-user", method: "oauth", oauth: { providerId: "google" } } as never
  return {
    validate: (user: { email?: string; emailVerified?: boolean }) =>
      validateUserInfo({ user, source }),
    createBefore: (data: { email: string }) =>
      createBefore({ id: "u1", name: "N", emailVerified: true, createdAt: new Date(), updatedAt: new Date(), ...data }, null),
  }
}

describe("Better Auth provisioning hooks", () => {
  test("accept a verified email from an allowed domain", async () => {
    const { validate } = await hooks()
    expect(await validate({ email: "ana@kantor.test", emailVerified: true })).toBeUndefined()
  })

  test("reject other domains", async () => {
    const { validate } = await hooks()
    expect(await validate({ email: "ana@other.test", emailVerified: true })).toMatchObject({ error: "email_not_allowed" })
  })

  test("reject an unverified email even from an allowed domain", async () => {
    const { validate } = await hooks()
    expect(await validate({ email: "admin@kantor.test", emailVerified: false })).toMatchObject({
      error: "email_not_verified",
    })
  })

  test("user creation refuses other domains and keeps a name", async () => {
    const { createBefore } = await hooks()
    await expect(Promise.resolve().then(() => createBefore({ email: "x@other.test" }))).rejects.toThrow()
    expect(await createBefore({ email: "ana@kantor.test" })).toMatchObject({ data: { email: "ana@kantor.test", name: "N" } })
  })
})

describe("sign-in providers", () => {
  test("GitHub and GitLab are mounted when configured, with linking across all methods", async () => {
    const auth = createAuth(
      testConfig({
        github: { clientId: "gh", clientSecret: "s" },
        gitlab: { clientId: "gl", clientSecret: "s", url: "https://gitlab.kantor.test" },
      }),
      await getTestDb(),
    )
    const providers = auth.options.socialProviders as Record<string, { issuer?: string } | undefined>
    expect(Object.keys(providers).sort()).toEqual(["github", "gitlab", "google"])
    expect(providers.gitlab?.issuer).toBe("https://gitlab.kantor.test")
    expect([...(auth.options.account?.accountLinking?.trustedProviders as string[])].sort()).toEqual(
      ["email-otp", "github", "gitlab", "google"],
    )
  })
})
