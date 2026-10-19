import { describe, expect, test } from "bun:test"
import { createSecretBox, SecretError } from "../src/lib/secret-box"

const KEY = Buffer.alloc(32, 7).toString("base64")
const OTHER_KEY = Buffer.alloc(32, 9).toString("base64")

describe("createSecretBox", () => {
  test("round-trips secrets, including empty ones", () => {
    const box = createSecretBox(KEY)
    expect(box.open(box.seal("ghp_secret-token"))).toBe("ghp_secret-token")
    expect(box.open(box.seal(""))).toBe("")
  })

  test("never stores the plain text and uses a fresh IV every time", () => {
    const box = createSecretBox(KEY)
    const first = box.seal("ghp_secret-token")
    const second = box.seal("ghp_secret-token")
    expect(first).not.toContain("ghp_secret-token")
    expect(first).not.toBe(second)
    expect(first).toStartWith("v1.")
  })

  test("refuses tampered data, another key and unknown formats", () => {
    const sealed = createSecretBox(KEY).seal("token")
    const parts = sealed.split(".")
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("x").toString("base64url")].join(".")
    expect(() => createSecretBox(KEY).open(tampered)).toThrow(SecretError)
    expect(() => createSecretBox(OTHER_KEY).open(sealed)).toThrow(SecretError)
    expect(() => createSecretBox(KEY).open("plain-token")).toThrow(SecretError)
  })

  test("refuses a truncated authentication tag", () => {
    const [version, iv, tag, data] = createSecretBox(KEY).seal("token").split(".")
    const shortTag = Buffer.from(tag ?? "", "base64url").subarray(0, 4).toString("base64url")
    expect(() => createSecretBox(KEY).open([version, iv, shortTag, data].join("."))).toThrow(SecretError)
  })

  test("rejects keys that are not 32 bytes", () => {
    expect(() => createSecretBox(Buffer.alloc(16).toString("base64"))).toThrow(SecretError)
  })
})
