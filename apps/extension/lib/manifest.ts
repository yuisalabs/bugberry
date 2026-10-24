import { createHash } from "node:crypto"

/** Only permissions without an install warning may ever be added: a new warning disables the extension on update. */
export const MANIFEST_PERMISSIONS = ["activeTab", "scripting", "storage", "tabs", "tabCapture", "offscreen"]

/** The extension pages the page layer shows in iframes (Recording Bar, drawing layer, review modal). */
export const WEB_ACCESSIBLE_RESOURCES = [{ resources: ["recorder-bar.html", "draw.html", "review.html", "microphone.html", "confirm-server.html", "options.html"], matches: ["<all_urls>"] }]

/** Keyboard shortcuts. Chrome allows four suggested keys; `_execute_action` opens the toolbar popup. */
export const MANIFEST_COMMANDS = {
  _execute_action: {
    suggested_key: { default: "Ctrl+Shift+K", mac: "Command+Shift+K" },
    description: "Open BugBerry",
  },
  "take-screenshot": {
    suggested_key: { default: "Alt+Shift+C" },
    description: "Take a screenshot for a bug report",
  },
  "start-recording": {
    suggested_key: { default: "Alt+Shift+R" },
    description: "Start recording the tab",
  },
  "stop-recording": {
    suggested_key: { default: "Alt+Shift+S" },
    description: "Stop recording",
  },
}

/** Firefox has neither tabCapture nor offscreen documents: it records through a window of its own. */
export const FIREFOX_PERMISSIONS = ["activeTab", "scripting", "storage", "tabs"]

/** Pinned for good: Firefox identifies the extension (and its signed updates) by this id. */
export const FIREFOX_GECKO = {
  id: "yuisalabs@gmail.com",
  // Firefox 130: WebCodecs video, for trimming recordings (and world: "MAIN" content scripts need 128).
  strict_min_version: "130.0",
  data_collection_permissions: { required: ["websiteContent", "websiteActivity"] },
}

/** Ctrl+Shift+K opens Firefox's Web Console. */
export const FIREFOX_OPEN_SHORTCUT = "Alt+Shift+B"

/** The manifest for one target browser. Chrome and Opera share it; Firefox gets its own permissions and id. */
export function manifestFor(target: string, key: string | undefined): Record<string, unknown> {
  const name = "BugBerry: Stop describing bugs. Show them."
  const description = "Report bugs with a screenshot or recording, plus console, network and the steps that led there."
  const rest = {
    host_permissions: ["<all_urls>"],
    web_accessible_resources: WEB_ACCESSIBLE_RESOURCES,
    action: { default_title: "BugBerry" },
  }
  if (target === "firefox") {
    return {
      name,
      description,
      permissions: FIREFOX_PERMISSIONS,
      ...rest,
      commands: {
        ...MANIFEST_COMMANDS,
        _execute_action: { ...MANIFEST_COMMANDS._execute_action, suggested_key: { default: FIREFOX_OPEN_SHORTCUT } },
      },
      browser_specific_settings: { gecko: FIREFOX_GECKO },
    }
  }
  // Today's key order, so the Chrome build's manifest.json stays byte-for-byte the same.
  return { name, description, permissions: MANIFEST_PERMISSIONS, ...rest, commands: MANIFEST_COMMANDS, ...(key ? { key } : {}) }
}

/** Chrome's extension ID for a public key: SHA-256 of the DER key, first 32 hex digits written as a–p. */
export function extensionIdFromPublicKey(publicKeyBase64: string): string {
  const hex = createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest("hex").slice(0, 32)
  return [...hex].map((digit) => String.fromCharCode(97 + Number.parseInt(digit, 16))).join("")
}

/**
 * The manifest `key` from VITE_EXTENSION_KEY. It pins the extension ID, so every laptop that loads the
 * zip with "Load unpacked" gets the same ID — the one the server expects in EXTENSION_ID.
 */
export function manifestKey(raw: string | undefined): string | undefined {
  const key = raw?.replace(/\s+/g, "")
  if (!key) return undefined
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) {
    throw new Error("VITE_EXTENSION_KEY must be the base64 public key printed by `bun run key`")
  }
  return key
}
