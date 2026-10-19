import { describe, expect, test } from "bun:test"
import { sign, verify } from "../src/lib/signing"

describe("signing", () => {
  test("round-trips a payload", () => {
    const token = sign({ k: "reports/a/media.png", exp: 123 }, "secret")
    expect(verify<{ k: string; exp: number }>(token, "secret")).toEqual({ k: "reports/a/media.png", exp: 123 })
  })

  test("rejects a different secret, a tampered body and garbage", () => {
    const token = sign({ k: "a" }, "secret")
    expect(verify(token, "other")).toBeNull()
    const [, mac] = token.split(".")
    const forgedBody = Buffer.from(JSON.stringify({ k: "b" })).toString("base64url")
    expect(verify(`${forgedBody}.${mac}`, "secret")).toBeNull()
    expect(verify("not-a-token", "secret")).toBeNull()
  })
})
