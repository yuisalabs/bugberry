import { describe, expect, test } from "bun:test"
import { isEmailAllowed } from "../src/modules/auth/policy"

describe("isEmailAllowed with no domain list", () => {
  test("any real address is allowed; one without a domain is not", () => {
    expect(isEmailAllowed("anyone@anywhere.test", [])).toBe(true)
    expect(isEmailAllowed("no-at-sign", [])).toBe(false)
  })
})

describe("isEmailAllowed", () => {
  const domains = ["kantor.com"]
  test.each([
    ["boss@kantor.com", true],
    ["Boss@KANTOR.com", true],
    [" ana@kantor.com ", true],
    ["x@sub.kantor.com", false],
    ["x@evil-kantor.com", false],
    ["x@kantor.com.evil.io", false],
    ["no-at-sign", false],
    ["@kantor.com", false],
  ])("%s → %p", (email, expected) => {
    expect(isEmailAllowed(email, domains)).toBe(expected)
  })
})

