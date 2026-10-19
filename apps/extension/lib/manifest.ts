import { createHash } from "node:crypto"

/** Only permissions without an install warning may ever be added: a new warning disables the extension on update. */
export const MANIFEST_PERMISSIONS = ["activeTab", "scripting", "storage", "tabs", "tabCapture", "offscreen"]

/** The extension pages the page layer shows in iframes (Recording Bar, drawing layer, review modal). */
export const WEB_ACCESSIBLE_RESOURCES = [{ resources: ["recorder-bar.html", "draw.html", "review.html"], matches: ["<all_urls>"] }]

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
