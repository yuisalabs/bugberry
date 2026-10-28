import { type Browser, browser } from "wxt/browser"
import { createFailureFlag } from "../lib/badge"
import { bridgeSenderOrigin, createBridge } from "../lib/bridge"
import { browserRecordingState } from "../lib/browser-recording-state"
import { createBugberryApi } from "../lib/api"
import { CAMERA_READY_MS, type CameraGrant, cameraTicketReply, createCameraGrants, uiStateReply } from "../lib/camera-grant"
import { handleAiTest, handleAiWrite, isAiTestRequest, isAiWriteRequest } from "../lib/ai-relay"
import { handleApiFetch, isApiFetchRequest } from "../lib/api-relay"
import { browserAiKeyStorage } from "../lib/browser-ai-key"
import { hasTabRecorder } from "../lib/browser-support"
import { recordOptionsFor, type ScreenshotMode } from "../lib/capture-prefs"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage, capturePrefsStorage, lastSessionStorage, lastWorkspaceStorage } from "../lib/browser-settings"
import { type ActiveTab, type CaptureFlowDeps, type CaptureResult, startScreenshotReport } from "../lib/capture-flow"
import { createIndexedDbDraftStore } from "../lib/draft-store"
import {
  type BarRequest,
  isBarRequest,
  isBridgeHelloRequest,
  isBridgeOpenPopupRequest,
  isBridgeUseServerRequest,
  isCameraTicketRequest,
  isPageFlush,
  isPageStart,
  isPopupRecordingRequest,
  isRecorderReadyNotice,
  isRecordingEndedNotice,
  isAutomationStopRequest,
  isRecordStartRequest,
  isRecordStatusRequest,
  isPopupPromptRequest,
  isOpenDraftRequest,
  isPromptTicketRequest,
  isReviewAgainRequest,
  isReviewAnotherRequest,
  isScreenshotRequest,
  isUiStateRequest,
  type PageUiMessage,
  type PopupRecordingAction,
  type RecordOptions,
} from "../lib/messages"
import { createRecordingController, type RecordingFlowDeps } from "../lib/recording-flow"
import { createWindowRecorderHost, onRecorderClosed } from "../lib/recorder-window"
import { openSessionToContentScripts } from "../lib/session-access"
import { createPromptOpener, type PromptTicket, type PromptTickets, ticketFor } from "../lib/prompt-opener"
import { createReviewOpener } from "../lib/review-opener"
import { fromExtensionPage, fromPopup, ofThisRecording } from "../lib/sender-rules"
import { createTakeAgain } from "../lib/take-again"
import { isBugBerryServer } from "../lib/session"
import { cropBox, pickArea } from "../lib/select-area"
import { loadSettings } from "../lib/settings"
import {
  clientConfigInTime,
  DEFAULT_MAX_UPLOAD_MB,
  expectedRecordingSeconds,
  recordingByteBudget,
  recordingLengthMs,
  signedOutForLength,
  uploadLimitMb,
  workspaceLimitsInTime,
} from "../lib/upload-limit"
import { limitsFor } from "../lib/limits"
import { isSignedOut } from "../lib/popup"
import type { RecordingEndReason } from "../lib/recorder"
import { pickEditorWorkspace } from "../lib/report-form"

/** Casts keep these valid before WXT has generated the path types for the pages. */
const REVIEW_PAGE = "/review.html" as Parameters<typeof browser.runtime.getURL>[0]
const OFFSCREEN_PAGE = "/offscreen.html" as Parameters<typeof browser.runtime.getURL>[0]
/** Session storage key of Firefox's recorder window id. */
const RECORDER_WINDOW_KEY = "recorderWindow"
const PROMPT_TICKETS_KEY = "promptTickets"
/** Session storage key of the camera grant; the page layer reads it to know a page load should ask for the bubble. */
const CAMERA_GRANT_KEY = "camera"
/** The build bundled with the agent recorder (`bun run build:recorder`); the store builds never have its automation path. */
// Compared in place, so Vite writes a literal and the store builds drop the automation path altogether.
const RECORDER_BUILD = import.meta.env.VITE_RECORDER_BUILD === "true"
/** Where WXT puts recording-ui.content.ts. */
const PAGE_LAYER_SCRIPT = "/content-scripts/recording-ui.js"

function toActiveTab(tab: Browser.tabs.Tab | undefined): ActiveTab | null {
  if (tab?.id === undefined || tab.windowId === undefined) return null
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: tab.active,
    url: tab.url,
    title: tab.title,
    width: tab.width,
    height: tab.height,
  }
}

/**
 * Runs in the page's MAIN world: must be self-contained. During a recording `keep` leaves out events from
 * before the take and from its pauses before the 1000-event cut, so they don't push out the ones kept.
 */
function readCaptureSession(keep: { since: number; pauses: Array<{ start: number; end: number }> } | null) {
  const key = Symbol.for("bugberry.capture.session")
  const session = (window as unknown as Record<symbol, { snapshot(): unknown[]; incomplete: readonly string[] } | undefined>)[key]
  const kept = (event: unknown) => {
    const t = (event as { t?: unknown }).t
    if (!keep || typeof t !== "number") return true
    return t >= keep.since && !keep.pauses.some((pause) => t >= pause.start && t < pause.end)
  }
  // 1000 = BUFFER_MAX_EVENTS; this function runs in the page and cannot import it.
  return session
    ? {
        status: "ok",
        events: session.snapshot().filter(kept).slice(-1000),
        incomplete: [...session.incomplete],
        documentId: (session as { documentId?: unknown }).documentId,
      }
    : { status: "missing" }
}

/** Runs in the page's MAIN world: must be self-contained. The extension checks every field it returns. */
async function readEnvironment() {
  const nav = navigator as Navigator & {
    connection?: { effectiveType?: string; downlink?: number; rtt?: number }
    userAgentData?: { getHighEntropyValues(hints: string[]): Promise<Record<string, unknown>> }
  }
  const uaData = await nav.userAgentData?.getHighEntropyValues(["fullVersionList", "platformVersion"]).catch(() => undefined)
  return {
    language: nav.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    pixelRatio: window.devicePixelRatio,
    connection: nav.connection
      ? { effectiveType: nav.connection.effectiveType, downlink: nav.connection.downlink, rtt: nav.connection.rtt }
      : undefined,
    uaData,
  }
}

export default defineBackground(() => {
  const store = createIndexedDbDraftStore()
  const newId = () => crypto.randomUUID()
  const readPageCapture = async (tabId: number, keep?: { since: number; pauses: Array<{ start: number; end: number }> }) => {
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: readCaptureSession,
      // An open pause has no end yet: JSON can't carry Infinity, so it is sent as "until now".
      args: [keep ? { since: keep.since, pauses: keep.pauses.map((pause) => ({ start: pause.start, end: Math.min(pause.end, Date.now()) })) } : null],
    })
    return injection?.result
  }
  const readPageEnvironment = async (tabId: number) => {
    const [injection] = await browser.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readEnvironment })
    return injection?.result
  }
  const toPage = (tabId: number, message: PageUiMessage) => browser.tabs.sendMessage(tabId, message, { frameId: 0 })
  /**
   * The review and prompts over a page. A tab loaded before the extension (installed, updated or reloaded) has no
   * page layer yet: it is added then, so the reporter stays on their page instead of getting a new tab.
   */
  const toPageLayer = async (tabId: number, message: PageUiMessage) => {
    try {
      return await toPage(tabId, message)
    } catch {
      await browser.scripting.executeScript({ target: { tabId }, files: [PAGE_LAYER_SCRIPT] })
      return toPage(tabId, message)
    }
  }
  const openReview = createReviewOpener({
    sendToTab: (tabId, message) => toPageLayer(tabId, message as PageUiMessage),
    openTab: async (url) => void (await browser.tabs.create({ url })),
    focusTab: async (tabId) => {
      const tab = await browser.tabs.update(tabId, { active: true })
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true })
    },
    reviewUrl: (draftId) => `${browser.runtime.getURL(REVIEW_PAGE)}?draft=${encodeURIComponent(draftId)}`,
  })

  /** The signed-in name for notes, asked once per worker. */
  let authorName: Promise<string> | null = null
  const author = () => {
    authorName ??= loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
      .then((settings) => (settings ? createBugberryApi(settings).me() : null))
      .then((me) => (me as { name?: unknown } | null)?.name)
      .then((name) => (typeof name === "string" ? name : ""))
      .catch(() => {
        authorName = null
        return ""
      })
    return authorName
  }

  const screenshotDeps: CaptureFlowDeps = {
    captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId, { format: "png" }),
    pickArea: async (tabId) => {
      const [injection] = await browser.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: pickArea })
      return injection?.result
    },
    cropImage: async (dataUrl, rect, pixelRatio) => {
      const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob())
      const box = cropBox(rect, pixelRatio, bitmap)
      const canvas = new OffscreenCanvas(Math.max(1, box.width), Math.max(1, box.height))
      canvas.getContext("2d")?.drawImage(bitmap, box.x, box.y, box.width, box.height, 0, 0, box.width, box.height)
      bitmap.close()
      return canvas.convertToBlob({ type: "image/png" })
    },
    readPageCapture,
    readEnvironment: readPageEnvironment,
    openReview,
    store,
    userAgent: navigator.userAgent,
    now: Date.now,
    newId,
  }

  const cameraGrants = createCameraGrants({
    store: {
      get: async () => ((await browser.storage.session.get(CAMERA_GRANT_KEY))[CAMERA_GRANT_KEY] as CameraGrant | undefined) ?? null,
      set: (grant) => (grant ? browser.storage.session.set({ [CAMERA_GRANT_KEY]: grant }) : browser.storage.session.remove(CAMERA_GRANT_KEY)),
    },
    newToken: () => crypto.randomUUID(),
    setTimer: (run, ms) => {
      const id = setTimeout(run, ms)
      return () => clearTimeout(id)
    },
  })

  /** Chrome and Opera record a tab through an offscreen document; Firefox records in a window of its own. */
  const tabRecorder = hasTabRecorder(browser)

  const windowHost = tabRecorder
    ? null
    : createWindowRecorderHost({
        createWindow: async (url) => {
          const created = await browser.windows.create({
            url: browser.runtime.getURL(url as Parameters<typeof browser.runtime.getURL>[0]),
            type: "popup",
            width: 380,
            height: 240,
          })
          if (created?.id === undefined) throw new Error("The recorder window didn't open")
          return created.id
        },
        windowExists: (id) => browser.windows.get(id).then(
          () => true,
          () => false,
        ),
        focusWindow: async (id) => void (await browser.windows.update(id, { focused: true })),
        removeWindow: (id) => browser.windows.remove(id),
        sendMessage: (message) => browser.runtime.sendMessage(message),
        windowId: {
          get: async () => {
            const stored = (await browser.storage.session.get(RECORDER_WINDOW_KEY))[RECORDER_WINDOW_KEY]
            return typeof stored === "number" ? stored : null
          },
          set: (id) => browser.storage.session.set({ [RECORDER_WINDOW_KEY]: id }),
        },
      })

  /** The offscreen document's place in Firefox: the recorder window, which the reporter brings back to the tab from. */
  const windowRecorder: Partial<RecordingFlowDeps> = windowHost
    ? {
        getStreamId: async () => {
          throw new Error("Tab capture isn't available in this browser")
        },
        ensureOffscreen: () => windowHost.ensure(),
        closeOffscreen: () => windowHost.close(),
        sendToOffscreen: (message) => windowHost.send(message),
        focusTab: async (tab) => void (await browser.windows.update(tab.windowId, { focused: true })),
      }
    : {}

  const recordingDeps: RecordingFlowDeps = {
    getStreamId: (tabId) => browser.tabCapture.getMediaStreamId({ targetTabId: tabId }),
    ensureOffscreen: async () => {
      const contexts = await browser.runtime.getContexts({
        contextTypes: [browser.runtime.ContextType.OFFSCREEN_DOCUMENT],
        documentUrls: [browser.runtime.getURL(OFFSCREEN_PAGE)],
      })
      if (contexts.length > 0) return
      await browser.offscreen.createDocument({
        url: OFFSCREEN_PAGE,
        reasons: [browser.offscreen.Reason.USER_MEDIA, browser.offscreen.Reason.DISPLAY_MEDIA],
        justification: "Recording the tab, screen or window for a bug report",
      })
    },
    closeOffscreen: async () => {
      try {
        await browser.offscreen.closeDocument()
      } catch {
        // Already closed.
      }
    },
    sendToOffscreen: (message) => browser.runtime.sendMessage(message),
    setBadge: async (recording) => {
      await browser.action.setBadgeBackgroundColor({ color: "#dc2626" })
      await browser.action.setBadgeText({ text: recording ? "REC" : "" })
    },
    readPageCapture,
    readEnvironment: readPageEnvironment,
    // A page the extension can't script has no countdown: recording starts at once.
    countdown: async (tabId) => {
      const answer = await toPage(tabId, { type: "bugberry:ui-countdown" }).catch(() => null)
      return answer === "cancel" ? "cancel" : answer === "done" ? "done" : "unavailable"
    },
    showRecordingUi: async (tabId, on) => {
      const session = (await browserRecordingState.get())?.draftId ?? ""
      await toPage(tabId, { type: "bugberry:ui-recording", on, session }).catch(() => {})
    },
    showCamera: async (tabId, camera) => {
      const { token, shape } = await cameraGrants.open(tabId, camera)
      const ready = cameraGrants.waitReady(token, CAMERA_READY_MS)
      // A page without a page layer (or that can't show the bubble) has nothing to wait for.
      await toPage(tabId, { type: "bugberry:ui-camera", on: true, token, shape }).catch(() => cameraGrants.fail(token, tabId))
      return { ready: ready.then(() => {}) }
    },
    hideCamera: async (tabId) => {
      await cameraGrants.close()
      await toPage(tabId, { type: "bugberry:ui-camera", on: false }).catch(() => {})
    },
    openReview,
    author,
    micUnavailable: async () => void (await capturePrefsStorage.set({ mic: false })),
    state: browserRecordingState,
    store,
    userAgent: navigator.userAgent,
    now: Date.now,
    newId,
    ...windowRecorder,
  }

  const flagFailure = createFailureFlag({
    // null is the documented way to give a tab back to the global badge; WXT's types only allow strings.
    setBadgeText: (details) => browser.action.setBadgeText(details as { tabId: number; text: string }),
    setTitle: (details) => browser.action.setTitle(details),
  })

  /** Without a mode (the shortcut) the popup's stored choice applies. */
  const screenshot = async (tab: ActiveTab | null, mode?: ScreenshotMode): Promise<CaptureResult> => {
    if (!tab) return { ok: false, error: "No active tab" }
    const chosen = mode ?? (await capturePrefsStorage.get()).screenshotMode
    return flagFailure(tab.id, await startScreenshotReport(tab, screenshotDeps, chosen))
  }

  const recordings = createRecordingController(recordingDeps)

  /**
   * Where a recording stops by itself: before the server's upload limit, and at the longest recording the
   * workspace the review will pick takes. Signed out (a 401, or the popup's last check when the server didn't answer
   * in time), the server's account length from `/client-config` applies instead, or BugBerry cloud's 2 minutes.
   */
  const recordingCaps = async (): Promise<{ maxBytes: number; maxMs: number }> => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return { maxBytes: recordingByteBudget(DEFAULT_MAX_UPLOAD_MB), maxMs: recordingLengthMs(null, null) }
    const api = createBugberryApi(settings)
    let saw401 = false
    const [clientConfig, limits] = await Promise.all([
      clientConfigInTime(() => api.clientConfig()),
      workspaceLimitsInTime(async () => {
        const [workspaces, me, lastUsed] = await Promise.all([api.listWorkspaces(), api.me(), lastWorkspaceStorage.get()]).catch(
          (error: unknown) => {
            saw401 = isSignedOut(error)
            throw error
          },
        )
        const workspaceId = pickEditorWorkspace(workspaces, (me as { lastWorkspaceId?: string | null }).lastWorkspaceId, lastUsed)
        return workspaceId ? limitsFor(api, workspaceId) : null
      }),
    ])
    const lastSession = limits === null ? await lastSessionStorage.get(settings.serverUrl).catch(() => null) : null
    const signedOut = signedOutForLength(saw401, limits, lastSession)
    const maxMs = recordingLengthMs(limits, clientConfig, signedOut, expectedRecordingSeconds(settings.serverUrl))
    return { maxBytes: recordingByteBudget(uploadLimitMb(clientConfig)), maxMs }
  }

  /**
   * Without options (the shortcut) the popup's stored choices apply. `caps` comes from the agent recorder, which is
   * never signed in: it read its server's limits itself.
   */
  const record = async (
    tab: ActiveTab | null,
    options?: RecordOptions,
    caps?: { maxBytes: number; maxMs: number },
  ): Promise<CaptureResult> => {
    if (!tab) return { ok: false, error: "No active tab" }
    const picked = options
      ? {
          ...options,
          recordSource: options.source,
          micDeviceId: options.micDeviceId ?? null,
          camera: Boolean(options.camera),
          cameraDeviceId: options.camera?.deviceId ?? null,
          cameraShape: options.camera?.shape ?? "circle",
        }
      : await capturePrefsStorage.get()
    const chosen = recordOptionsFor(picked, tabRecorder)
    return flagFailure(tab.id, await recordings.start(tab, { ...chosen, ...(caps ?? (await recordingCaps())) }))
  }

  /** A stop from the shortcut or the time limit has no popup either, so its failure goes on the badge. */
  /** `reason`: why the recording ended by itself; absent when the reporter stopped it. */
  const stopRecording = async (reason?: RecordingEndReason): Promise<CaptureResult> => {
    const status = await recordings.status()
    // In the recorder build nobody reviews: the agent recorder reads the draft when the agent stops.
    const result = await recordings.stop(reason, { review: !RECORDER_BUILD })
    return status.recording ? flagFailure(status.tabId, result) : result
  }

  /** "Record again" and "Retake": the same kind of capture on the draft's tab; the old draft goes once it started. */
  const takeAgainDeps: Parameters<typeof createTakeAgain>[0] = {
    getDraft: (id) => store.get(id),
    getTab: async (tabId) => toActiveTab(await browser.tabs.get(tabId).catch(() => undefined)),
    deleteDraft: (id) => store.delete(id),
    hideReview: async (tabId) => {
      await browser.tabs.update(tabId, { active: true }).catch(() => {})
      // The review must be off the page before the next capture sees it.
      await toPage(tabId, { type: "bugberry:ui-review-close" }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 150))
    },
    showReview: openReview,
    screenshot: (tab, mode) => screenshot(tab, mode),
    record: (tab) => record(tab),
  }
  const takeAgain = createTakeAgain(takeAgainDeps)

  /** "Record another": a new capture of the same kind on the tab the sent report came from. */
  const takeAnother = async (captureType: "screenshot" | "video", tabId: number, mode: ScreenshotMode): Promise<CaptureResult> => {
    const tab = toActiveTab(await browser.tabs.get(tabId).catch(() => undefined))
    if (!tab) return { ok: false, error: "The page this came from was closed." }
    await takeAgainDeps.hideReview(tab.id)
    return captureType === "screenshot" ? screenshot(tab, mode) : record(tab)
  }

  // Session storage: a ticket outlives a sleeping worker, never the browser session.
  const readTickets = async () =>
    ((await browser.storage.session.get(PROMPT_TICKETS_KEY))[PROMPT_TICKETS_KEY] ?? {}) as Record<string, PromptTicket>
  const promptTickets: PromptTickets = {
    get: async (token) => (await readTickets())[token] ?? null,
    put: async (token, ticket) => {
      const now = Date.now()
      const kept = Object.fromEntries(Object.entries(await readTickets()).filter(([, entry]) => entry.expiresAt > now))
      await browser.storage.session.set({ [PROMPT_TICKETS_KEY]: { ...kept, [token]: ticket } })
    },
    delete: async (token) => {
      const { [token]: _gone, ...rest } = await readTickets()
      await browser.storage.session.set({ [PROMPT_TICKETS_KEY]: rest })
    },
  }
  const openPrompt = createPromptOpener({
    tickets: promptTickets,
    newToken: () => crypto.randomUUID(),
    now: Date.now,
    sendToTab: (tabId, message) => toPageLayer(tabId, message as PageUiMessage),
    openTab: async (url) => void (await browser.tabs.create({ url })),
    pageUrl: (page) => browser.runtime.getURL(`/${page}.html` as Parameters<typeof browser.runtime.getURL>[0]),
    // Firefox can't tell an embedded prompt whether the page covers it, so its prompts get a tab.
    overPage: !import.meta.env.FIREFOX,
  })
  const openConfirm = (origin: string, tabId: number | null) => openPrompt({ page: "confirm-server", server: origin }, tabId)

  const bridge = createBridge({
    isBugBerryServer: (origin) => isBugBerryServer(origin),
    currentServer: async () => (await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN))?.serverUrl ?? null,
    openConfirm,
    openPopup: () => browser.action.openPopup(),
    version: () => browser.runtime.getManifest().version,
  })

  /** What the bar and the drawing layer ask for, once the sender is known to be the recorded tab. */
  const barAction = (message: Exclude<BarRequest, { type: "bugberry:me-name" }>): Promise<unknown> => {
    switch (message.type) {
      case "bugberry:bar-status":
        return recordings.barStatus()
      case "bugberry:record-pause":
        return recordings.pause()
      case "bugberry:record-resume":
        return recordings.resume()
      case "bugberry:record-mic":
        return recordings.setMic(message.on)
      case "bugberry:record-restart":
        return recordings.restart()
      case "bugberry:record-discard":
        return recordings.discard()
      case "bugberry:record-note":
        return recordings.addNote(message.text)
      case "bugberry:bar-stop":
        return stopRecording()
    }
  }

  /** The popup's view of a running recording, and the bar's controls from there. */
  const popupAction = (action: PopupRecordingAction): Promise<unknown> => {
    switch (action) {
      case "status":
        return recordings.popupStatus()
      case "pause":
        return recordings.pause()
      case "resume":
        return recordings.resume()
      case "restart":
        return restartFromPopup()
      case "discard":
        return recordings.discard()
      case "stop":
        return stopRecording()
    }
  }

  /** The popup closes as the new take counts down, so a failed Restart goes on the badge. */
  const restartFromPopup = async (): Promise<CaptureResult> => {
    const status = await recordings.status()
    const result = await recordings.restart()
    return status.recording ? flagFailure(status.tabId, result) : result
  }

  // Firefox: the reporter closed the recorder window. Before a source was picked the open is cancelled (the
  // host answers it); mid-recording the take is gone, and the recorded tab says so.
  if (windowHost) {
    browser.windows.onRemoved.addListener(async (windowId) => {
      if (!(await windowHost.windowRemoved(windowId))) return
      await onRecorderClosed({ status: () => recordings.status(), discard: () => recordings.discard(), flag: flagFailure })
    })
  }

  const extensionOrigin = browser.runtime.getURL("")

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const reply = (work: Promise<unknown>) => {
      work.then(sendResponse, (error: unknown) => sendResponse({ ok: false, error: String(error) }))
      return true // keeps the channel open for the async response
    }
    // Firefox's review over a page gets no sign-in cookie of its own; its API requests come here.
    if (isApiFetchRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(
        loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN).then((settings) => handleApiFetch(message, settings?.serverUrl ?? null, fetch)),
      )
    }
    // Write with AI on the reporter's own key: only the extension's pages may use it, never a web page.
    if (isAiWriteRequest(message) || isAiTestRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(isAiWriteRequest(message) ? handleAiWrite(message, browserAiKeyStorage, fetch) : handleAiTest(message, fetch))
    }
    if (isRecorderReadyNotice(message)) {
      if (fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) windowHost?.ready()
      return undefined
    }
    if (isBridgeHelloRequest(message) || isBridgeUseServerRequest(message) || isBridgeOpenPopupRequest(message)) {
      const origin = bridgeSenderOrigin(sender, browser.runtime.id)
      if (!origin) return undefined
      if (isBridgeOpenPopupRequest(message)) return reply(bridge.openPopup(origin))
      return reply(isBridgeHelloRequest(message) ? bridge.hello(origin) : bridge.useServer(origin, sender.tab?.id ?? null))
    }
    if (isScreenshotRequest(message)) {
      return reply(browser.tabs.get(message.tabId).then((tab) => screenshot(toActiveTab(tab), message.mode ?? "visible")))
    }
    // The agent recorder's own build only, and only from its own pages: a web page or the store build never gets here.
    const fromRecorder = RECORDER_BUILD && fromExtensionPage(sender, browser.runtime.id, extensionOrigin)
    if (isRecordStartRequest(message)) {
      const caps = fromRecorder ? message.caps : undefined
      return reply(browser.tabs.get(message.tabId).then((tab) => record(toActiveTab(tab), message.options, caps)))
    }
    if (RECORDER_BUILD && isAutomationStopRequest(message)) {
      if (!fromRecorder) return undefined
      return reply(recordings.stop(undefined, { review: false }))
    }
    // The page layer asks on every page load whether its tab is being recorded.
    if (isUiStateRequest(message)) {
      return reply(
        Promise.all([browserRecordingState.get(), cameraGrants.forTab(sender.tab?.id)]).then(([state, camera]) => uiStateReply(state, camera, sender.tab?.id)),
      )
    }
    // The camera bubble, by its grant's token: only from inside the granted tab (sites can embed the page).
    if (isCameraTicketRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(cameraTicketReply(cameraGrants, message, sender.tab?.id))
    }
    // Only the extension's own pages drive a recording: the review from anywhere, the bar and the drawing
    // layer only from inside the recorded tab (another site can embed those pages, but not in that tab).
    if (isReviewAgainRequest(message)) {
      return fromExtensionPage(sender, browser.runtime.id, extensionOrigin) ? reply(takeAgain(message.draftId)) : undefined
    }
    if (isReviewAnotherRequest(message)) {
      return fromExtensionPage(sender, browser.runtime.id, extensionOrigin)
        ? reply(takeAnother(message.captureType, message.tabId, message.mode ?? "visible"))
        : undefined
    }
    // The popup can't show the browser's microphone prompt, and a draft opened from it belongs over the page too.
    if (isPopupPromptRequest(message)) {
      return fromPopup(sender, browser.runtime.id, extensionOrigin) ? reply(openPrompt({ page: message.page }, message.tabId).then(() => ({ ok: true }))) : undefined
    }
    if (isOpenDraftRequest(message)) {
      if (!fromPopup(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(
        message.tabId === null
          ? browser.tabs.create({ url: `${browser.runtime.getURL(REVIEW_PAGE)}?draft=${encodeURIComponent(message.draftId)}` }).then(() => ({ ok: true }))
          : openReview(message.draftId, message.tabId).then(() => ({ ok: true })),
      )
    }
    if (isPromptTicketRequest(message)) {
      if (!fromExtensionPage(sender, browser.runtime.id, extensionOrigin)) return undefined
      return reply(
        ticketFor(promptTickets, message.token, sender.tab?.id, Date.now()).then(async (ticket) => {
          if (!ticket || message.action === "read") return ticket ? { page: ticket.page, server: ticket.server ?? null } : null
          await promptTickets.delete(message.token)
          if (message.action === "tab") {
            await openPrompt({ page: ticket.page, ...(ticket.server ? { server: ticket.server } : {}) }, null)
            return { ok: true }
          }
          // Back where they asked from: the popup shows the microphone (or camera) on.
          if (ticket.page === "microphone" || ticket.page === "camera") await browser.action.openPopup().catch(() => {})
          return { ok: true }
        }),
      )
    }
    if (isBarRequest(message)) {
      if (message.type === "bugberry:me-name") return fromExtensionPage(sender, browser.runtime.id, extensionOrigin) ? reply(author()) : undefined
      return reply(
        browserRecordingState.get().then((state) =>
          ofThisRecording(sender, browser.runtime.id, extensionOrigin, state, message.session) ? barAction(message) : { ok: false, error: "Not the recorded tab" },
        ),
      )
    }
    if (isPopupRecordingRequest(message)) {
      return fromPopup(sender, browser.runtime.id, extensionOrigin) ? reply(popupAction(message.action)) : undefined
    }
    if (isRecordStatusRequest(message)) return reply(recordings.status())
    // Only the recorded tab counts; flush scripts in other tabs also see that a recording runs.
    if (isPageStart(message)) {
      if (sender.tab?.id !== undefined) void recordings.noteNavigation(sender.tab.id)
      return undefined
    }
    if (isPageFlush(message)) {
      if (sender.tab?.id !== undefined) void recordings.notePageFlush(sender.tab.id, message)
      return undefined
    }
    // The offscreen recorder stopped by itself (time limit, tab closed, error).
    if (isRecordingEndedNotice(message)) void stopRecording(message.reason)
    return undefined
  })

  // A screen or window recording shows whatever tab the reporter goes to, so those tabs' logs go in too.
  browser.tabs.onActivated.addListener(({ tabId }) => void recordings.noteActiveTab(tabId))
  browser.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) return
    const [tab] = await browser.tabs.query({ active: true, windowId }).catch(() => [])
    if (tab?.id !== undefined) void recordings.noteActiveTab(tab.id)
  })

  browser.commands.onCommand.addListener(async (command, tab) => {
    const active = toActiveTab(tab ?? (await browser.tabs.query({ active: true, currentWindow: true }))[0])
    if (command === "take-screenshot") await screenshot(active)
    else if (command === "start-recording") await record(active)
    else if (command === "stop-recording") await stopRecording()
  })

  // The icon always opens the popup, also during a recording (it shows the recording's controls). Older
  // versions took the popup away while recording; this gives it back to a browser they left without one.
  void browser.action.setPopup({ popup: "popup.html" }).catch(() => {})

  // Older versions kept a token next to the server; the dashboard's sign-in replaces it.
  browser.runtime.onInstalled.addListener(() => void browserSettingsStorage.removeLegacyToken())

  // Last, so a browser without it (Firefox) still registers every listener above.
  openSessionToContentScripts(browser.storage.session as Parameters<typeof openSessionToContentScripts>[0])
})
