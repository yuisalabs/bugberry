import { describe, expect, test } from "bun:test"
import { legacyAppPath } from "../src/lib/legacy-paths"

describe("legacyAppPath", () => {
  test("old dashboard paths move under /app", () => {
    expect(legacyAppPath("/r/0199-abc")).toBe("/app/r/0199-abc")
    expect(legacyAppPath("/p/checkout")).toBe("/app/p/checkout")
    expect(legacyAppPath("/settings")).toBe("/app/settings")
    expect(legacyAppPath("/settings/projects/p1/integrations")).toBe("/app/settings/projects/p1/integrations")
  })

  test("retired token pages go to the dashboard", () => {
    expect(legacyAppPath("/app/settings/tokens")).toBe("/app")
    expect(legacyAppPath("/extension/connect")).toBe("/app")
  })

  test("everything else is left alone", () => {
    for (const path of ["/", "/login", "/s/AbC", "/app/r/x", "/pricing", "/rabbit", "/settingsx"]) {
      expect(legacyAppPath(path)).toBeNull()
    }
  })
})
