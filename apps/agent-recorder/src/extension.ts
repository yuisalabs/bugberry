import type { Page } from "playwright-core"
import type { AutomationDraft } from "../../extension/lib/automation-draft"
import type { BrowserSession } from "./browser"
import type { RecordingCaps } from "./limits"

declare const chrome: {
  tabs: { query(filter: Record<string, unknown>): Promise<Array<{ id?: number; url?: string }>> }
  runtime: { sendMessage(message: unknown): Promise<unknown> }
}
declare const bugberryAutomation: {
  readDraft(id: string): Promise<AutomationDraft>
  deleteDraft(id: string): Promise<void>
}

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

/** Records `page` the way the popup's Record button does, without the countdown, with the server's limits. */
export async function startTabRecording(session: BrowserSession, page: Page, caps: RecordingCaps): Promise<void> {
  const error = await withAutomationPage(session, async (automation) => {
    // Recording a tab asks for it in front, as a person's click on it would leave it.
    await page.bringToFront()
    const tabId = await automation.evaluate(async (url) => (await chrome.tabs.query({ url }))[0]?.id ?? null, page.url())
    if (tabId === null) return "The recorded tab is not known to the extension"
    return failed(
      await automation.evaluate((message) => chrome.runtime.sendMessage(message), {
        type: "bugberry:record-start",
        tabId,
        options: { source: "tab", mic: false, systemAudio: false, countdown: false, camera: null },
        caps,
      }),
    )
  })
  await page.bringToFront()
  if (error) throw new Error(`Couldn't start recording: ${error}`)
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

export function readDraft(session: BrowserSession, draftId: string): Promise<AutomationDraft> {
  return withAutomationPage(session, (automation) => automation.evaluate((id) => bugberryAutomation.readDraft(id), draftId))
}

export function deleteDraft(session: BrowserSession, draftId: string): Promise<void> {
  return withAutomationPage(session, (automation) => automation.evaluate((id) => bugberryAutomation.deleteDraft(id), draftId))
}
