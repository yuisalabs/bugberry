import { describe, expect, test } from "bun:test"
import { canUseInternal, emailDomain, FREE_EMAIL_DOMAINS, VISIBILITIES, visibilityChoices, visibilityOptions, WORKSPACE_ROLES } from "../src"

describe("emailDomain", () => {
  test("lower-cased domain, or null when there is none", () => {
    expect(emailDomain(" Budi@PTMaju.com ")).toBe("ptmaju.com")
    expect(emailDomain("bad")).toBeNull()
  })
})

describe("canUseInternal", () => {
  test("company addresses can share inside their domain; free mail and nonsense cannot", () => {
    expect(canUseInternal("budi@ptmaju.com")).toBe(true)
    expect(canUseInternal("a@gmail.com")).toBe(false)
    expect(canUseInternal("a@Yahoo.co.id")).toBe(false)
    expect(canUseInternal("bad")).toBe(false)
  })

  test("the free list covers the big providers", () => {
    for (const domain of ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "icloud.com", "proton.me", "yahoo.com"]) {
      expect(FREE_EMAIL_DOMAINS.has(domain)).toBe(true)
    }
  })
})

describe("workspace constants", () => {
  test("three access levels, workspace first; two workspace roles", () => {
    expect(VISIBILITIES).toEqual(["workspace", "internal", "public"])
    expect(WORKSPACE_ROLES).toEqual(["admin", "member"])
  })
})

describe("visibilityOptions", () => {
  test("company addresses get all three levels; free mail has no Internal", () => {
    expect(visibilityOptions("budi@ptmaju.com")).toEqual(["workspace", "internal", "public"])
    expect(visibilityOptions("budi@gmail.com")).toEqual(["workspace", "public"])
    expect(visibilityChoices(false)).toEqual(["workspace", "public"])
  })
})

describe("free email list", () => {
  test("covers regional variants and other big providers", () => {
    for (const domain of ["hotmail.co.uk", "live.co.uk", "outlook.fr", "yahoo.co.jp", "hotmail.co.id", "web.de", "naver.com", "mailinator.com"]) {
      expect(FREE_EMAIL_DOMAINS.has(domain)).toBe(true)
    }
  })
})
