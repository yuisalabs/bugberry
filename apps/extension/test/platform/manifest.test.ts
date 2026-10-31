import { describe, expect, test } from "bun:test"
import { createHash, generateKeyPairSync } from "node:crypto"
import { EXTENSION_ID_PATTERN } from "@bugberry/shared"
import {
  AUTOMATION_ENTRYPOINT,
  entrypointsFor,
  extensionIdFromPublicKey,
  isRecorderBuild,
  MANIFEST_COMMANDS,
  manifestFor,
  MANIFEST_PERMISSIONS,
  manifestKey,
  WEB_ACCESSIBLE_RESOURCES,
} from "../../lib/platform/manifest"

const publicKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .publicKey.export({ type: "spki", format: "der" })
  .toString("base64")

describe("extensionIdFromPublicKey", () => {
  test("follows Chrome's rule: SHA-256 of the key, first 32 hex digits written as a–p", () => {
    const hex = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 32)
    const expected = [...hex].map((digit) => "abcdefghijklmnop"[Number.parseInt(digit, 16)]).join("")
    expect(extensionIdFromPublicKey(publicKey)).toBe(expected)
    expect(extensionIdFromPublicKey(publicKey)).toMatch(new RegExp(EXTENSION_ID_PATTERN))
  })
})

describe("manifestKey", () => {
  test("accepts a base64 key, also when wrapped over lines", () => {
    expect(manifestKey(`${publicKey.slice(0, 40)}\n  ${publicKey.slice(40)}\n`)).toBe(publicKey)
  })

  test("no key configured means no key in the manifest", () => {
    expect(manifestKey(undefined)).toBeUndefined()
    expect(manifestKey("  ")).toBeUndefined()
  })

  test("refuses something that is not a base64 key", () => {
    expect(() => manifestKey("-----BEGIN PRIVATE KEY-----")).toThrow(/VITE_EXTENSION_KEY/)
  })
})

describe("MANIFEST_COMMANDS", () => {
  test("the toolbar shortcut is Ctrl+Shift+K and Command+Shift+K", () => {
    expect(MANIFEST_COMMANDS._execute_action.suggested_key).toEqual({ default: "Ctrl+Shift+K", mac: "Command+Shift+K" })
    // Chrome allows four suggested shortcuts per extension.
    expect(Object.values(MANIFEST_COMMANDS).filter((command) => "suggested_key" in command)).toHaveLength(4)
  })
})

describe("manifest pages and permissions", () => {
  test("the page layer's frames are web accessible, and no permission was added", () => {
    expect(MANIFEST_PERMISSIONS).toEqual(["activeTab", "scripting", "storage", "tabs", "tabCapture", "offscreen"])
    expect(WEB_ACCESSIBLE_RESOURCES).toEqual([
      {
        resources: ["recorder-bar.html", "draw.html", "review.html", "microphone.html", "confirm-server.html", "options.html", "camera-bubble.html", "camera.html"],
        matches: ["<all_urls>"],
      },
    ])
  })
})

describe("manifestFor", () => {
  const chrome = {
    name: "BugBerry: Stop describing bugs. Show them.",
    description: "Report bugs with a screenshot or recording, plus console, network and the steps that led there.",
    permissions: MANIFEST_PERMISSIONS,
    host_permissions: ["<all_urls>"],
    web_accessible_resources: WEB_ACCESSIBLE_RESOURCES,
    action: { default_title: "BugBerry" },
    commands: MANIFEST_COMMANDS,
  }

  test("chrome and opera get today's manifest", () => {
    expect(manifestFor("chrome", "KEY")).toEqual({ ...chrome, key: "KEY" })
    expect(manifestFor("opera", "KEY")).toEqual(manifestFor("chrome", "KEY"))
    expect("key" in manifestFor("chrome", undefined)).toBe(false)
  })

  test("chrome keeps today's key order, so the built manifest.json is byte-for-byte the same", () => {
    expect(Object.keys(manifestFor("chrome", "KEY"))).toEqual([
      "name",
      "description",
      "permissions",
      "host_permissions",
      "web_accessible_resources",
      "action",
      "commands",
      "key",
    ])
  })

  test("firefox drops Chrome-only permissions and the key, and adds the gecko blocks", () => {
    const manifest = manifestFor("firefox", "KEY") as Record<string, unknown> & {
      browser_specific_settings: { gecko: unknown; gecko_android: unknown }
    }
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage", "tabs"])
    expect("key" in manifest).toBe(false)
    expect(manifest.browser_specific_settings.gecko).toEqual({
      id: "yuisalabs@gmail.com",
      strict_min_version: "140.0",
      data_collection_permissions: { required: ["websiteContent", "websiteActivity"] },
    })
    expect(manifest.browser_specific_settings.gecko_android).toEqual({ strict_min_version: "142.0" })
  })

  test("firefox opens BugBerry with Alt+Shift+B and keeps the other shortcuts", () => {
    const commands = (manifestFor("firefox", undefined) as { commands: Record<string, { suggested_key: unknown }> }).commands
    expect(commands._execute_action?.suggested_key).toEqual({ default: "Alt+Shift+B" })
    expect(commands["take-screenshot"]).toEqual(MANIFEST_COMMANDS["take-screenshot"])
    expect(commands["start-recording"]).toEqual(MANIFEST_COMMANDS["start-recording"])
    expect(commands["stop-recording"]).toEqual(MANIFEST_COMMANDS["stop-recording"])
  })
})

describe("recorder build", () => {
  const found = [{ name: "background" }, { name: "popup" }, { name: AUTOMATION_ENTRYPOINT }, { name: "review" }]

  test("store build has no automation entrypoint", () => {
    expect(entrypointsFor(found, false).map((entry) => entry.name)).toEqual(["background", "popup", "review"])
    expect(JSON.stringify(manifestFor("chrome", undefined))).not.toContain("automation")
  })

  test("the recorder build keeps it, and only VITE_RECORDER_BUILD=true makes one", () => {
    expect(entrypointsFor(found, true).map((entry) => entry.name)).toContain(AUTOMATION_ENTRYPOINT)
    expect(isRecorderBuild({ VITE_RECORDER_BUILD: "true" })).toBe(true)
    expect(isRecorderBuild({ VITE_RECORDER_BUILD: "1" })).toBe(false)
    expect(isRecorderBuild({})).toBe(false)
  })

  test("the automation page is never web accessible", () => {
    expect(WEB_ACCESSIBLE_RESOURCES.flatMap((entry) => entry.resources)).not.toContain("automation.html")
  })
})
