import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Page } from "playwright-core"
import type { AutomationDraftMeta } from "../../extension/lib/drafts/automation-draft"
import type { BrowserSession } from "./browser"
import type { RecordingCaps } from "./limits"
import { pickRecordedTab } from "./tabs"

/** 8 MB a call: a long recording crosses CDP in pieces, never as one string bigger than V8 allows. */
const CHUNK_BYTES = 8 * 1024 * 1024

declare const chrome: {
  tabs: { query(filter: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> }
  runtime: { sendMessage(message: unknown): Promise<unknown> }
}
declare const bugberryAutomation: {
  prepareDraft(id: string): Promise<AutomationDraftMeta>
  readChunk(id: string, file: DraftFile, offset: number, length: number): Promise<string>
  deleteDraft(id: string): Promise<void>
}
type DraftFile = "media" | "debugger" | "thumbnail"

/** A tab, so it is opened only for one call and closed right after: the agent's browser tool must not pick it. */
async function withAutomationPage<T>(session: BrowserSession, work: (page: Page) => Promise<T>): Promise<T> {
  const page = await session.context.newPage()
  try {
    await page.goto(`chrome-extension://${session.extensionId}/automation.html`)
    return await work(page)
  } finally {
    await page.close().catch(() => {})
  }
}

function failed(answer: unknown): string | null {
  const reply = (typeof answer === "object" && answer !== null ? answer : {}) as { ok?: unknown; error?: unknown }
  return reply.ok === true ? null : typeof reply.error === "string" ? reply.error : "The extension didn't answer"
}

/**
 * Records `page` the way the popup's Record button does, without the countdown, with the server's limits; resolves
 * with the draft the extension records into and the extension's id for the tab.
 */
export async function startTabRecording(
  session: BrowserSession,
  page: Page,
  caps: RecordingCaps,
): Promise<{ draftId: string; tabId: number }> {
  const { reply, tabId } = await withAutomationPage(session, async (automation) => {
    // Recording a tab asks for it in front, as a person's click on it would leave it.
    await page.bringToFront()
    const tabs = await automation.evaluate(() => chrome.tabs.query({ active: true }))
    const tabId = pickRecordedTab(tabs as Array<{ id?: number; url?: string; active?: boolean }>, page.url())
    if (tabId === null) return { reply: { ok: false, error: "The recorded tab is not known to the extension" }, tabId: -1 }
    const reply = await automation.evaluate((message) => chrome.runtime.sendMessage(message), {
      type: "bugberry:record-start",
      tabId,
      options: { source: "tab", mic: false, systemAudio: false, countdown: false, camera: null },
      caps,
    })
    return { reply, tabId }
  })
  await page.bringToFront()
  const error = failed(reply)
  if (error) throw new Error(`Couldn't start recording: ${error}`)
  return { draftId: String((reply as { draftId: unknown }).draftId), tabId }
}

/**
 * The tab in front, asked of the extension's service worker: Playwright makes every page it drives look visible
 * and focused, so only Chrome itself knows which tab the agent's browser tool switched to. Null when the worker
 * is asleep or can't answer.
 */
export async function frontTab(session: BrowserSession): Promise<{ id: number; url: string } | null> {
  const worker = session.context.serviceWorkers().find((each) => each.url().startsWith(`chrome-extension://${session.extensionId}/`))
  if (!worker) return null
  const [tab] = await worker.evaluate(() => chrome.tabs.query({ active: true, lastFocusedWindow: true }))
  return tab?.id !== undefined && tab.url ? { id: tab.id, url: tab.url } : null
}

/** Stops the running recording with the review left closed; resolves with its draft's id. */
export async function stopTabRecording(session: BrowserSession): Promise<{ draftId: string }> {
  const answer = await withAutomationPage(session, (automation) =>
    automation.evaluate(() => chrome.runtime.sendMessage({ type: "bugberry:automation-stop" })),
  )
  const error = failed(answer)
  if (error) throw new Error(`Couldn't stop the recording: ${error}`)
  return { draftId: String((answer as { draftId: unknown }).draftId) }
}

/** Writes a stopped recording's files into `dir`, a slice at a time, and answers what they hold. */
export function readDraft(session: BrowserSession, draftId: string, dir: string): Promise<AutomationDraftMeta> {
  return withAutomationPage(session, async (automation) => {
    const meta = await automation.evaluate((id) => bugberryAutomation.prepareDraft(id), draftId)
    mkdirSync(dir, { recursive: true })
    const files: Array<[DraftFile, string, number | null]> = [
      ["media", "media.webm", meta.sizes.media],
      ["debugger", "debugger.json.gz", meta.sizes.debugger],
      ["thumbnail", "thumbnail.jpg", meta.sizes.thumbnail],
    ]
    for (const [file, name, size] of files) {
      if (size === null) continue
      const path = join(dir, name)
      writeFileSync(path, new Uint8Array())
      for (let offset = 0; offset < size; offset += CHUNK_BYTES) {
        const chunk = await automation.evaluate(
          ({ id, file, offset, length }) => bugberryAutomation.readChunk(id, file, offset, length),
          { id: draftId, file, offset, length: CHUNK_BYTES },
        )
        appendFileSync(path, Buffer.from(chunk, "base64"))
      }
    }
    return meta
  })
}

export function deleteDraft(session: BrowserSession, draftId: string): Promise<void> {
  return withAutomationPage(session, (automation) => automation.evaluate((id) => bugberryAutomation.deleteDraft(id), draftId))
}
