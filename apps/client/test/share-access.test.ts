import { describe, expect, test } from "bun:test"
import { accessOptions, copiedDescription } from "../src/lib/share-access"

describe("accessOptions", () => {
  test("offers the three levels in order, naming the company domain", () => {
    expect(accessOptions("ptmaju.com")).toEqual([
      { value: "workspace", title: "Workspace members only", description: "They sign in to BugBerry first" },
      { value: "internal", title: "Anyone at @ptmaju.com", description: "Signs in with a company email" },
      { value: "public", title: "Anyone with the link", description: "No sign-in needed to watch" },
    ])
  })

  test("free email reporters have no company level", () => {
    expect(accessOptions(null).map((option) => option.value)).toEqual(["workspace", "public"])
  })
})

describe("copiedDescription", () => {
  test("says who can open the link", () => {
    expect(copiedDescription("workspace", "ptmaju.com")).toBe("Only workspace members can open it")
    expect(copiedDescription("internal", "ptmaju.com")).toBe("Anyone at @ptmaju.com can open it")
    expect(copiedDescription("internal", null)).toBe("Anyone at your company can open it")
    expect(copiedDescription("public", null)).toBe("Anyone with the link can open it")
  })
})
