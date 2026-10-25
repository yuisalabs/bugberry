import { describe, expect, test } from "bun:test"
import type { CaptureEvent, DebuggerPayload } from "@bugberry/capture"
import { buildMaterial, MAX_BODY_CHARS, MAX_LINES, MAX_MATERIAL_CHARS, type Material, restrictMaterial } from "../src/material"

const START = 1_000_000
const device = { browser: "Chrome 141", os: "macOS" }

function payloadWith(events: CaptureEvent[], notes: DebuggerPayload["notes"] = []): DebuggerPayload {
  return { version: 1, capturedAt: START + 60_000, recordingStartedAt: START, incomplete: [], events, notes }
}
const action = (atMs: number, type: "click" | "input" | "submit" | "rage-click" | "scroll", target: string, value?: string): CaptureEvent => ({
  kind: "action",
  t: START + atMs,
  type,
  target,
  ...(value !== undefined ? { value } : {}),
})
const nav = (atMs: number, url: string): CaptureEvent => ({ kind: "action", t: START + atMs, type: "navigate", url })
const consoleError = (atMs: number, text: string): CaptureEvent => ({ kind: "console", t: START + atMs, level: "error", args: [text] })
const request = (atMs: number, method: string, url: string, status: number, responseBody?: string): CaptureEvent => ({
  kind: "network",
  t: START + atMs,
  method,
  url,
  status,
  ...(responseBody !== undefined ? { responseBody } : {}),
})
const note = (n: number, atMs: number, text: string) => ({ n, atMs, text, author: "Dana" })

describe("buildMaterial", () => {
  test("actions, navigations, errors, failed requests and notes become time-ordered lines", () => {
    const m = buildMaterial({
      payload: payloadWith(
        [
          action(1000, "click", 'button "Pay"'),
          nav(500, "https://shop.test/checkout?step=2"),
          consoleError(1500, "TypeError: x is undefined"),
          request(1600, "POST", "https://shop.test/api/pay?debug=1", 500, '{"error":"Card declined"}'),
          request(1700, "GET", "https://shop.test/api/ok", 200, "{}"),
          action(1800, "scroll", "window"),
        ],
        [note(1, 1200, "spins forever")],
      ),
      page: { url: "https://shop.test/checkout?step=2" },
      device,
      includeResponseBodies: false,
    })
    expect(m.lines.map((line) => [line.kind, line.text])).toEqual([
      ["navigate", "Opened /checkout"],
      ["action", 'Clicked button "Pay"'],
      ["note", "Note 1: spins forever"],
      ["error", "TypeError: x is undefined"],
      ["request", "POST /api/pay → 500"],
    ])
    expect(m.lines.map((line) => line.atMs)).toEqual([500, 1000, 1200, 1500, 1600])
    expect(m.page).toEqual({ url: "https://shop.test/checkout", title: null })
    expect(m.lines.some((line) => line.body)).toBe(false)
    expect(m.omitted).toBe(0)
  })

  test("typing names the field but never its value, and uncaught errors count as errors", () => {
    const m = buildMaterial({
      payload: payloadWith([action(100, "input", 'input "Card"', "••••"), { kind: "error", t: START + 200, message: "Boom" }]),
      page: { url: "https://shop.test/" },
      device,
      includeResponseBodies: false,
    })
    expect(m.lines.map((line) => line.text)).toEqual(['Typed into input "Card"', "Boom"])
  })

  test("a request that never got an answer is a failed request too", () => {
    const m = buildMaterial({
      payload: payloadWith([{ kind: "network", t: START + 10, method: "get", url: "https://a.test/x", failed: "Failed to fetch" }]),
      page: { url: "https://a.test/" },
      device,
      includeResponseBodies: false,
    })
    expect(m.lines[0]?.text).toBe("GET /x → failed: Failed to fetch")
  })

  test("with response bodies on, a failed request carries its body cut to MAX_BODY_CHARS", () => {
    const m = buildMaterial({
      payload: payloadWith([request(10, "POST", "https://a.test/pay", 500, "x".repeat(5000))]),
      page: { url: "https://a.test/" },
      device,
      includeResponseBodies: true,
    })
    const body = m.lines.find((line) => line.kind === "request")?.body ?? ""
    expect(body.length).toBeGreaterThan(0)
    expect(body.length).toBeLessThanOrEqual(MAX_BODY_CHARS + 20)
  })

  test("a huge recording stays under the caps and counts what it left out", () => {
    const events: CaptureEvent[] = []
    for (let i = 0; i < 5000; i++) events.push(action(i * 10, "click", `button "B${i}"`))
    for (let i = 0; i < 300; i++) events.push(request(i * 10 + 5, "POST", `https://a.test/api/${i}`, 500, "y".repeat(10_000)))
    const m = buildMaterial({ payload: payloadWith(events), page: { url: "https://a.test/" }, device, includeResponseBodies: true })
    expect(m.lines.length).toBeLessThanOrEqual(MAX_LINES)
    expect(JSON.stringify(m).length).toBeLessThanOrEqual(MAX_MATERIAL_CHARS)
    expect(m.omitted).toBeGreaterThan(0)
    expect(m.lines.filter((line) => line.kind === "request").length).toBeGreaterThan(0)
    expect(m.lines.filter((line) => line.kind === "action").length).toBeGreaterThan(0)
    const times = m.lines.map((line) => line.atMs)
    expect(times).toEqual([...times].sort((a, b) => a - b))
  })
})

describe("restrictMaterial", () => {
  const sent: Material = {
    page: { url: "https://a.test/p?q=1", title: null },
    device,
    omitted: 0,
    lines: [{ atMs: 0, kind: "request", text: "GET /x?token=1 → 500", body: "secret" }],
  }

  test("removes bodies and query strings it was sent when bodies are off", () => {
    const out = restrictMaterial(sent, { includeResponseBodies: false })
    expect(out.lines[0]).toEqual({ atMs: 0, kind: "request", text: "GET /x → 500" })
    expect(out.page.url).toBe("https://a.test/p")
  })

  test("keeps bodies, cut short, when bodies are on", () => {
    const out = restrictMaterial({ ...sent, lines: [{ ...sent.lines[0]!, body: "z".repeat(5000) }] }, { includeResponseBodies: true })
    expect(out.lines[0]?.body?.length).toBeLessThanOrEqual(MAX_BODY_CHARS + 20)
  })

  test("query strings and fragments are cut from addresses inside any line", () => {
    const out = restrictMaterial(
      {
        ...sent,
        lines: [
          { atMs: 0, kind: "error", text: "Failed to load https://cdn.test/a.js?token=abc#x at line 3" },
          { atMs: 1, kind: "note", text: "see https://shop.test/p?email=budi@contoh.com" },
        ],
      },
      { includeResponseBodies: false },
    )
    expect(out.lines.map((line) => line.text)).toEqual(["Failed to load https://cdn.test/a.js at line 3", "see https://shop.test/p"])
  })

  test("re-applies the caps to whatever it was sent", () => {
    const many: Material = { ...sent, lines: Array.from({ length: 1000 }, (_, i) => ({ atMs: i, kind: "action" as const, text: "a".repeat(2000) })) }
    const out = restrictMaterial(many, { includeResponseBodies: false })
    expect(out.lines.length).toBeLessThanOrEqual(MAX_LINES)
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(MAX_MATERIAL_CHARS)
    expect(out.omitted).toBeGreaterThanOrEqual(1000 - MAX_LINES)
  })
})
