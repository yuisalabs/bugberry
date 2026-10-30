import { describe, expect, test } from "bun:test"
import {
  defaultServerUrl,
  loadSettings,
  normalizeServerUrl,
  SettingsError,
  type SettingsStorage,
} from "../../lib/server/settings"

describe("normalizeServerUrl", () => {
  test("keeps only the origin and adds https when missing", () => {
    expect(normalizeServerUrl(" https://bugberry.kantor.com/dashboard/ ")).toBe("https://bugberry.kantor.com")
    expect(normalizeServerUrl("bugberry.kantor.com")).toBe("https://bugberry.kantor.com")
  })

  test("allows plain http only for this machine", () => {
    expect(normalizeServerUrl("http://localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeServerUrl("http://127.0.0.1:3999/")).toBe("http://127.0.0.1:3999")
    expect(() => normalizeServerUrl("http://10.0.0.5:3000")).toThrow(SettingsError)
  })

  test("rejects input that is not a URL", () => {
    expect(() => normalizeServerUrl("ht tp://")).toThrow(SettingsError)
  })
})

describe("loadSettings", () => {
  const storage = (value: object): SettingsStorage => ({
    get: async () => value,
    set: async () => {},
    clear: async () => {},
    removeLegacyToken: async () => {},
  })

  test("falls back to the build-time server when nothing is stored", async () => {
    expect(await loadSettings(storage({}), "https://app.bugberry.dev")).toEqual({ serverUrl: "https://app.bugberry.dev" })
  })

  test("no stored server and no build default means no server", async () => {
    expect(await loadSettings(storage({}), "")).toBeNull()
  })

  test("a stored server wins over the build default", async () => {
    expect(await loadSettings(storage({ serverUrl: "https://bugberry.kantor.com" }), "https://app.bugberry.dev")).toEqual({
      serverUrl: "https://bugberry.kantor.com",
    })
  })

  test("a token left by an older version is not part of the settings", async () => {
    expect(await loadSettings(storage({ serverUrl: "https://a.test", token: "fdb_x" }), "")).toEqual({
      serverUrl: "https://a.test",
    })
  })
})

describe("defaultServerUrl", () => {
  test("offers the build-time server origin, normalised", () => {
    expect(defaultServerUrl("https://bugberry.kantor.com/")).toBe("https://bugberry.kantor.com")
    expect(defaultServerUrl("bugberry.kantor.com")).toBe("https://bugberry.kantor.com")
  })

  test("nothing usable means an empty field", () => {
    expect(defaultServerUrl(undefined)).toBe("")
    expect(defaultServerUrl("http://bugberry.kantor.com")).toBe("")
  })
})
