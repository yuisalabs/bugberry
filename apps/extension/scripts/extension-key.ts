import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { extensionIdFromPublicKey } from "../lib/manifest"

/**
 * Prints the manifest key and extension ID for a private key file, creating the key the first time.
 * Usage: bun run key [path/to/bugberry-extension.pem]
 *
 * Without a path it uses bugberry-extension.pem, or the older fdebag-extension.pem when only that one exists,
 * so a team that already made a key keeps its extension ID.
 */
const KEY_FILE = "bugberry-extension.pem"
const LEGACY_KEY_FILE = "fdebag-extension.pem"
const path = process.argv[2] ?? (!existsSync(KEY_FILE) && existsSync(LEGACY_KEY_FILE) ? LEGACY_KEY_FILE : KEY_FILE)

let publicKey: KeyObject
if (existsSync(path)) {
  publicKey = createPublicKey(createPrivateKey(readFileSync(path)))
} else {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 })
  writeFileSync(path, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 })
  publicKey = pair.publicKey
  console.error(`Kunci baru disimpan di ${path}. Simpan di tempat aman dan jangan di-commit.`)
}

const key = publicKey.export({ type: "spki", format: "der" }).toString("base64")
console.log(`VITE_EXTENSION_KEY=${key}`)
console.log(`EXTENSION_ID=${extensionIdFromPublicKey(key)}`)
