import { browser } from "wxt/browser"
import { createFailureFlag } from "../../lib/platform/badge"
import { createBridge } from "../../lib/server/bridge"
import { browserRecordingState } from "../../lib/recording/browser-recording-state"
import { createBugberryApi } from "../../lib/server/api"
import { CAMERA_READY_MS, type CameraGrant, createCameraGrants } from "../../lib/devices/camera-grant"
import { hasTabRecorder } from "../../lib/platform/browser-support"
import { recordOptionsFor, type ScreenshotMode } from "../../lib/capture/capture-prefs"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage, capturePrefsStorage, lastSessionStorage, lastWorkspaceStorage } from "../../lib/server/browser-settings"
import { type ActiveTab, type CaptureFlowDeps, type CaptureResult, startScreenshotReport } from "../../lib/capture/capture-flow"
import { createIndexedDbDraftStore } from "../../lib/drafts/draft-store"
import type { BarRequest, PageUiMessage, PopupRecordingAction, RecordOptions } from "../../lib/shared/messages"
import { createRecordingController } from "../../lib/recording/recording-controller"
import type { RecordingFlowDeps } from "../../lib/recording/recording-flow"
import { createWindowRecorderHost, onRecorderClosed } from "../../lib/recording/recorder-window"
import { openSessionToContentScripts } from "../../lib/server/session-access"
import { createPromptOpener } from "../../lib/prompts/prompt-opener"
import { createReviewOpener } from "../../lib/review/review-opener"
import { createTakeAgain } from "../../lib/capture/take-again"
import { isBugBerryServer } from "../../lib/server/session"
import { cropBox, pickArea } from "../../lib/capture/select-area"
import { loadSettings } from "../../lib/server/settings"
import {
  clientConfigInTime,
  DEFAULT_MAX_UPLOAD_MB,
  expectedRecordingSeconds,
  recordingByteBudget,
  recordingLengthMs,
  signedOutForLength,
  uploadLimitMb,
  workspaceLimitsInTime,
} from "../../lib/server/upload-limit"
import { limitsFor } from "../../lib/server/limits"
import { isSignedOut } from "../../lib/drafts/popup"
import type { RecordingEndReason } from "../../lib/recording/recorder"
import { pickEditorWorkspace } from "../../lib/review/report-form"
import { createMessageListener, RECORDER_BUILD } from "./on-message"
import { promptTickets } from "./prompt-tickets"
import { readPageCapture, readPageEnvironment, toActiveTab } from "./tabs"

/** Casts keep these valid before WXT has generated the path types for the pages. */
const REVIEW_PAGE = "/review.html" as Parameters<typeof browser.runtime.getURL>[0]
const OFFSCREEN_PAGE = "/offscreen.html" as Parameters<typeof browser.runtime.getURL>[0]
/** Session storage key of Firefox's recorder window id. */
const RECORDER_WINDOW_KEY = "recorderWindow"
/** Session storage key of the camera grant; the page layer reads it to know a page load should ask for the bubble. */
const CAMERA_GRANT_KEY = "camera"
/** Where WXT puts recording-ui.content.ts. */
const PAGE_LAYER_SCRIPT = "/content-scripts/recording-ui.js"

export default defineBackground(() => {
  const store = createIndexedDbDraftStore()
  const newId = () => crypto.randomUUID()
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
  const reviewUrl = (draftId: string) => `${browser.runtime.getURL(REVIEW_PAGE)}?draft=${encodeURIComponent(draftId)}`
  const openReview = createReviewOpener({
    sendToTab: (tabId, message) => toPageLayer(tabId, message as PageUiMessage),
    openTab: async (url) => void (await browser.tabs.create({ url })),
    focusTab: async (tabId) => {
      const tab = await browser.tabs.update(tabId, { active: true })
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true })
    },
    reviewUrl,
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

  browser.runtime.onMessage.addListener(
    createMessageListener({
      bridge,
      recordings,
      windowHost,
      cameraGrants,
      promptTickets,
      openPrompt,
      openReview,
      reviewUrl,
      screenshot,
      record,
      takeAgain,
      takeAnother,
      author,
      barAction,
      popupAction,
      stopRecording,
      extensionOrigin,
    }),
  )

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
