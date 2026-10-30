import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "..", "..")
const FOLDERS = new Set(["ai", "annotate", "capture", "devices", "drafts", "platform", "prompts", "recording", "review", "server", "shared"])
const MAX_LINES = 500
/** Modules and tests not yet in their folder; each move deletes its names here. */
const PENDING_LIB = new Set([
  "ai-assist", "ai-key", "ai-relay", "annotations", "auto-grow", "automation-draft", "badge", "bar-drag",
  "browser-ai-key", "browser-recording-state", "browser-support", "camera-grant", "camera",
  "capture-flow", "capture-prefs", "device", "draft-store", "draft-writer", "editor-load", "environment", "keep-alive", "latest",
  "location", "manifest", "messages", "microphone", "page-flush", "page-merge", "page-ui", "pixelate", "popup",
  "prompt-opener", "prompt-page", "recorder-build", "recorder-handler", "recorder-window", "recorder", "recording-flow",
  "recording-stream", "recording-watch", "render", "report-form", "review-data", "review-draft", "review-limits", "review-opener",
  "seeker", "select-area", "sender-rules", "store-build-check", "strokes", "take-again",
  "thumbnail-browser", "thumbnail", "trim-send", "trim-video", "types", "upload", "video-frames", "webm-duration",
  "when-back",
])
const PENDING_TEST = new Set([
  "ai-assist", "ai-relay", "annotation-canvas", "annotations", "automation-draft", "badge", "bar-drag",
  "bar-view", "brand", "browser-support", "camera-bubble", "camera-grant", "camera", "capture-flow", "capture-prefs",
  "device", "draft-store", "draft-writer", "draw-notes", "editor-load", "english", "environment", "extension-key", "icon-states",
  "icons", "keep-alive", "latest", "location", "manifest", "messages", "microphone", "options-ai", "page-flush",
  "page-merge", "page-ui", "pixelate", "popup-view", "popup", "prompt-opener", "recorder-bar-page", "recorder-handler",
  "recorder-window", "recorder", "recording-flow", "recording-stream", "recording-watch", "report-form", "review-ai", "review-data",
  "review-draft", "review-fields", "review-limits", "review-opener", "review-view", "seeker", "select-area", "sender-rules",
  "sent-trackers", "sign-firefox", "store-build-check", "strokes", "take-again", "thumbnail",
  "trim-send", "trim-video", "upload", "webm-duration", "when-back", "zip-sources",
])
/** Files split for length; each stays under MAX_LINES. */
const SPLIT: string[] = []

type Entry = { name: string; folder: boolean }

/** Entries of lib/ or test/ that sit outside the feature folders. */
function misplaced(dir: "lib" | "test", entries: Entry[], pending: Set<string>): string[] {
  return entries.flatMap((entry) => {
    if (entry.folder) return FOLDERS.has(entry.name) ? [] : [`${entry.name}/`]
    if (dir === "test" && entry.name === "setup.ts") return []
    const base = entry.name.replace(dir === "test" ? /\.test\.tsx?$/ : /\.tsx?$/, "")
    return pending.has(base) ? [] : [entry.name]
  })
}

/** Counts lines the way `wc -l` does. */
function tooLong(text: string): boolean {
  return text.split("\n").length - 1 > MAX_LINES
}

const entries = (dir: string): Entry[] =>
  readdirSync(join(ROOT, dir), { withFileTypes: true }).map((entry) => ({ name: entry.name, folder: entry.isDirectory() }))

describe("structure", () => {
  test("lib/ and test/ hold only feature folders", () => {
    expect([...misplaced("lib", entries("lib"), PENDING_LIB), ...misplaced("test", entries("test"), PENDING_TEST)]).toEqual([])
  })

  test("split files stay under the line ceiling", () => {
    const long = SPLIT.filter((path) => {
      try {
        return tooLong(readFileSync(join(ROOT, path), "utf8"))
      } catch {
        return true
      }
    })
    expect(long).toEqual([])
  })

  test("the rules catch what they are for", () => {
    const file = (name: string): Entry => ({ name, folder: false })
    const folder = (name: string): Entry => ({ name, folder: true })
    expect(misplaced("lib", [file("new-thing.ts")], new Set())).toEqual(["new-thing.ts"])
    expect(misplaced("lib", [file("api.ts")], new Set(["api"]))).toEqual([])
    expect(misplaced("lib", [folder("misc")], new Set())).toEqual(["misc/"])
    expect(misplaced("lib", [folder("server")], new Set())).toEqual([])
    expect(misplaced("test", [file("setup.ts")], new Set())).toEqual([])
    expect(misplaced("test", [file("x.test.ts")], new Set())).toEqual(["x.test.ts"])
    expect(misplaced("test", [file("x.test.tsx")], new Set(["x"]))).toEqual([])
    expect(tooLong("a\n".repeat(501))).toBe(true)
    expect(tooLong("a\n".repeat(500))).toBe(false)
  })
})
