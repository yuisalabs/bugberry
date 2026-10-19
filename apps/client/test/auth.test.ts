import { describe, expect, test } from "bun:test"
import { type AuthDeps, sendLoginCode, signInWithProvider, signOut, verifyLoginCode } from "../src/lib/auth"

function recorder(response: Response) {
  const calls: Array<{ url: string; init: RequestInit }> = []
  const assigned: string[] = []
  const deps: AuthDeps = {
    fetch: async (url, init) => {
      calls.push({ url, init })
      return response
    },
    assign: (url) => {
      assigned.push(url)
    },
  }
  return { calls, assigned, deps }
}

describe("signInWithProvider", () => {
  test("asks Better Auth for the Google URL and goes there", async () => {
    const { calls, assigned, deps } = recorder(
      Response.json({ url: "https://accounts.google.com/o/oauth2/auth?x=1", redirect: true }),
    )
    await signInWithProvider("google", "/r/abc", deps)
    expect(calls[0]?.url).toBe("/api/auth/sign-in/social")
    expect(calls[0]?.init.method).toBe("POST")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      provider: "google",
      callbackURL: "/r/abc",
      errorCallbackURL: "/login?next=%2Fr%2Fabc",
    })
    expect(assigned).toEqual(["https://accounts.google.com/o/oauth2/auth?x=1"])
  })

  test("never asks for an off-site callback", async () => {
    const { calls, deps } = recorder(Response.json({ url: "https://accounts.google.com/x" }))
    await signInWithProvider("google", "//evil.com", deps)
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ callbackURL: "/app", errorCallbackURL: "/login" })
  })

  test("reports a failure to start", async () => {
    const { assigned, deps } = recorder(Response.json({ message: "Provider not found" }, { status: 404 }))
    await expect(signInWithProvider("google", "/", deps)).rejects.toThrow("Provider not found")
    expect(assigned).toEqual([])
  })
})

describe("GitHub and GitLab", () => {
  test("start through the same Better Auth route with their own provider id", async () => {
    for (const provider of ["github", "gitlab"] as const) {
      const { calls, deps } = recorder(Response.json({ url: `https://${provider}.test/authorize` }))
      await signInWithProvider(provider, "/p/x", deps)
      expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ provider, callbackURL: "/p/x" })
    }
  })
})

describe("email codes", () => {
  test("sendLoginCode asks Better Auth to email a sign-in code", async () => {
    const { calls, deps } = recorder(Response.json({ success: true }))
    await sendLoginCode("ana@kantor.com", deps)
    expect(calls[0]?.url).toBe("/api/auth/email-otp/send-verification-otp")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ email: "ana@kantor.com", type: "sign-in" })
  })

  test("verifyLoginCode signs in and continues to where the person was going", async () => {
    const { calls, assigned, deps } = recorder(Response.json({ token: "t", user: {} }))
    await verifyLoginCode("ana@kantor.com", "123456", "/p/x", deps)
    expect(calls[0]?.url).toBe("/api/auth/sign-in/email-otp")
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ email: "ana@kantor.com", otp: "123456" })
    expect(assigned).toEqual(["/p/x"])
  })

  test("a refused code explains what to do", async () => {
    const { assigned, deps } = recorder(Response.json({ code: "INVALID_OTP" }, { status: 400 }))
    await expect(verifyLoginCode("ana@kantor.com", "000000", "/", deps)).rejects.toThrow(
      "That code is wrong or has expired. Request a new one.",
    )
    expect(assigned).toEqual([])
  })
})

describe("signOut", () => {
  test("posts to Better Auth", async () => {
    const { calls, deps } = recorder(Response.json({ success: true }))
    await signOut(deps)
    expect(calls[0]).toMatchObject({ url: "/api/auth/sign-out", init: { method: "POST" } })
  })

  test("a refused sign-out is an error, not a silent success", async () => {
    const { deps } = recorder(Response.json({ message: "nope" }, { status: 500 }))
    await expect(signOut(deps)).rejects.toThrow(/Couldn't sign out/)
  })
})
