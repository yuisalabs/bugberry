import { describe, expect, test } from "bun:test"
import { AiWriteError, aiErrorText } from "../src/errors"
import type { Material } from "../src/material"
import { buildMessages, parseWriteUp } from "../src/prompt"
import { BUILT_IN_TEMPLATES } from "../src/templates"

const material: Material = {
  page: { url: "https://shop.test/checkout", title: "Checkout" },
  device: { browser: "Chrome 141", os: "macOS" },
  omitted: 3,
  lines: [
    { atMs: 1000, kind: "action", text: 'Clicked button "Pay"' },
    { atMs: 65_000, kind: "request", text: "POST /api/pay → 500", body: '{"error":"Card declined"}' },
  ],
}

describe("buildMessages", () => {
  test("the system message forbids invented steps and asks for JSON with title and description", () => {
    const [system, user] = buildMessages({
      material,
      template: { skeleton: "## Steps to reproduce", instructions: "Write in Indonesian" },
      hint: { title: "", description: "pay fails with debit card" },
    })
    expect(system?.role).toBe("system")
    expect(system?.content).toContain("only from the numbered events")
    expect(system?.content).toContain("cause not visible in the recording")
    expect(system?.content).toContain('"title"')
    expect(user?.content).toContain("## Steps to reproduce")
    expect(user?.content).toContain("Write in Indonesian")
    expect(user?.content).toContain("pay fails with debit card")
    expect(user?.content).toContain('1. [0:01] Clicked button "Pay"')
    expect(user?.content).toContain("2. [1:05] POST /api/pay → 500")
    expect(user?.content).toContain('{"error":"Card declined"}')
    expect(user?.content).toContain("(3 more events left out)")
    expect(user?.content).toContain("Chrome 141")
  })

  test("without a hint or instructions the message says so instead of leaving blanks", () => {
    const [, user] = buildMessages({ material, template: { skeleton: "", instructions: "" }, hint: { title: "", description: "" } })
    expect(user?.content).toContain("Reporter's hint: none")
    expect(user?.content).not.toContain("undefined")
  })
})

describe("parseWriteUp", () => {
  test("parses plain, fenced and embedded JSON", () => {
    expect(parseWriteUp('{"title":"A","description":"B"}')).toEqual({ title: "A", description: "B" })
    expect(parseWriteUp('Here you go:\n```json\n{"title":"A","description":"B"}\n```')).toEqual({ title: "A", description: "B" })
    expect(parseWriteUp('Sure! {"title":"A","description":"B"} Hope it helps')).toEqual({ title: "A", description: "B" })
  })

  test("an empty title or no object is unusable; long fields are cut to 200 and 5000", () => {
    expect(() => parseWriteUp('{"title":"  ","description":"B"}')).toThrow(AiWriteError)
    expect(() => parseWriteUp("I can't help with that")).toThrow(AiWriteError)
    expect(() => parseWriteUp('{"title":1,"description":"B"}')).toThrow(AiWriteError)
    const long = parseWriteUp(JSON.stringify({ title: "x".repeat(300), description: "y".repeat(6000) }))
    expect([long.title.length, long.description.length]).toEqual([200, 5000])
  })

  test("a missing description becomes empty, not an error", () => {
    expect(parseWriteUp('{"title":"A"}')).toEqual({ title: "A", description: "" })
  })

  test("reasoning blocks and stray braces around the answer don't hide it", () => {
    expect(parseWriteUp('<think>Need {title} and {description}</think>{"title":"T","description":"D"}')).toEqual({ title: "T", description: "D" })
    expect(parseWriteUp('Here: {"title":"T","description":"D"} Hope it helps {:)}')).toEqual({ title: "T", description: "D" })
    expect(parseWriteUp('{"note":"x"} then {"title":"T","description":"a } b"}')).toEqual({ title: "T", description: "a } b" })
  })
})

describe("aiErrorText", () => {
  test("error texts name who can fix it", () => {
    expect(aiErrorText(new AiWriteError("key_rejected"), { path: "team", model: "m" })).toBe(
      "The AI key was rejected. Update it in Settings → AI (ask your admin).",
    )
    expect(aiErrorText(new AiWriteError("key_rejected"), { path: "personal", model: "m" })).toBe(
      "The AI key was rejected. Update it in the extension's settings.",
    )
    expect(aiErrorText(new AiWriteError("model_not_found"), { path: "personal", model: "gpt-x" })).toBe('The model "gpt-x" wasn\'t found at this provider.')
    expect(aiErrorText(new AiWriteError("quota"), { path: "team", model: "m" })).toBe("Your AI provider says the quota is used up.")
    expect(aiErrorText(new AiWriteError("unreachable"), { path: "team", model: "m" })).toBe("The AI server didn't answer. Try again.")
    expect(aiErrorText(new AiWriteError("unusable_answer"), { path: "team", model: "m" })).toBe("The AI's answer couldn't be used. Try again.")
    expect(aiErrorText(new AiWriteError("busy"), { path: "team", model: "m" })).toBe("The AI provider is busy. Try again in a moment.")
    expect(aiErrorText(new AiWriteError("provider_error", "boom"), { path: "team", model: "m" })).toBe("The AI provider returned an error: boom.")
  })
})

test("two built-in templates: Steps to reproduce, then Short", () => {
  expect(BUILT_IN_TEMPLATES.map((template) => template.name)).toEqual(["Steps to reproduce", "Short"])
  expect(BUILT_IN_TEMPLATES[0]?.skeleton).toContain("## Steps to reproduce")
  expect(BUILT_IN_TEMPLATES[0]?.skeleton).toContain("## Expected")
  expect(BUILT_IN_TEMPLATES[0]?.skeleton).toContain("## Actual")
})
