import { clockLabel } from "@bugberry/shared"
import { AiWriteError } from "./errors"
import type { Material } from "./material"
import type { TemplateText } from "./templates"

export interface ChatMessage {
  role: "system" | "user"
  content: string
}

const TITLE_MAX = 200
const DESCRIPTION_MAX = 5000

const SYSTEM = [
  "You write bug reports from a browser recording.",
  "Build the steps only from the numbered events and the reporter's notes. Leave out anything you cannot see in them; never invent clicks, pages, values or errors.",
  'Where the recording does not show the cause, write "cause not visible in the recording" instead of guessing.',
  "The title is short and specific: the page or feature, then the symptom, at most 200 characters. It does not follow the template.",
  "The description follows the template's sections in order, and its extra instructions.",
  "Write in the language of the template and its instructions; if they don't show one, in the language of the reporter's hint or notes; otherwise in English.",
  "The reporter's hint says what they meant to report. It is not evidence of what happened.",
  'Answer with JSON only: {"title": "...", "description": "..."}.',
].join("\n")

function eventList(material: Material): string {
  const lines = material.lines.map((line, index) => {
    const entry = `${index + 1}. [${clockLabel(line.atMs)}] ${line.text}`
    return line.body ? `${entry}\n   Response body:\n   ${line.body.replaceAll("\n", "\n   ")}` : entry
  })
  if (material.omitted > 0) lines.push(`(${material.omitted} more events left out)`)
  return lines.length > 0 ? lines.join("\n") : "(no events)"
}

/** The chat for one write-up: the rules, then the recording, the template and the reporter's hint. */
export function buildMessages(input: {
  material: Material
  template: TemplateText
  hint: { title: string; description: string }
}): ChatMessage[] {
  const { material, template, hint } = input
  const hintText = [hint.title.trim(), hint.description.trim()].filter(Boolean).join("\n")
  const user = [
    `Page: ${material.page.url}${material.page.title ? ` (${material.page.title})` : ""}`,
    `Browser: ${material.device.browser} on ${material.device.os}`,
    "",
    "Events:",
    eventList(material),
    "",
    `Template sections:\n${template.skeleton.trim() || "(none: write free text)"}`,
    `Extra instructions:\n${template.instructions.trim() || "(none)"}`,
    "",
    `Reporter's hint: ${hintText || "none"}`,
  ].join("\n")
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ]
}

function objectIn(content: string): unknown {
  const attempts = [content, content.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1]]
  const first = content.indexOf("{")
  const last = content.lastIndexOf("}")
  if (first >= 0 && last > first) attempts.push(content.slice(first, last + 1))
  for (const text of attempts) {
    if (!text) continue
    try {
      return JSON.parse(text)
    } catch {}
  }
  return null
}

/** The title and description from the model's reply; models that wrap JSON in prose or fences still work. */
export function parseWriteUp(content: string): { title: string; description: string } {
  const found = objectIn(content) as { title?: unknown; description?: unknown } | null
  const title = typeof found?.title === "string" ? found.title.trim() : ""
  if (!title) throw new AiWriteError("unusable_answer")
  const description = typeof found?.description === "string" ? found.description.trim() : ""
  return { title: title.slice(0, TITLE_MAX), description: description.slice(0, DESCRIPTION_MAX) }
}
