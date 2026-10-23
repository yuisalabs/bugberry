import { RiLoader4Line } from "@remixicon/react"
import { useEffect, useState } from "react"
import { browser } from "wxt/browser"
import { createBugberryApi } from "../../lib/api"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage, capturePrefsStorage, lastSessionStorage, lastWorkspaceStorage } from "../../lib/browser-settings"
import { capturable } from "../../lib/capture-flow"
import { hasTabRecorder } from "../../lib/browser-support"
import { type CapturePrefs, DEFAULT_CAPTURE_PREFS, recordOptionsFor } from "../../lib/capture-prefs"
import { createIndexedDbDraftStore } from "../../lib/draft-store"
import { fullWarning, limitsFor, usageLine } from "../../lib/limits"
import type {
  OpenDraftRequest,
  PopupPromptRequest,
  PopupRecordingAction,
  PopupRecordingRequest,
  RecordStartRequest,
  RecordStatusRequest,
  ScreenshotRequest,
} from "../../lib/messages"
import { type MicAccess, micAccess, micChoiceAfterCheck, micDevices } from "../../lib/microphone"
import { controlError, recordStartNote, replyResult, uncapturableNote } from "../../lib/popup"
import { pickEditorWorkspace } from "../../lib/report-form"
import type { PopupRecordingStatus, RecordingStatus } from "../../lib/recording-flow"
import { checkSession, type SessionState, serverLabel, signInUrl } from "../../lib/session"
import { loadSettings, type Settings } from "../../lib/settings"
import { type MicList, meteredMicId, micMeterOn, PopupView } from "./PopupView"
import { useMicLevel } from "./use-mic-level"
import { useConfirm } from "@bugberry/ui/confirm-dialog"

const store = createIndexedDbDraftStore()
const MIC_BLOCKED = "Microphone is blocked. Allow it for BugBerry in Chrome's site settings."

/** Wires the popup to Chrome: settings, session, drafts, the recording and the background's actions. */
const tabRecorder = hasTabRecorder(browser)
const ALL_SITES = { origins: ["<all_urls>"] }

const queryMicAccess = () => micAccess((name) => navigator.permissions.query({ name: name as PermissionName }))

const SESSION_WAIT_MS = 1500

/** The popup while it asks the server who is signed in. */
function PopupLoading() {
  return (
    <main aria-busy className="flex flex-col bg-background text-foreground">
      <header className="flex items-center px-3.5 pt-3 pb-2">
        <img src="/assets/bugberry_logo_small.webp" alt="BugBerry" className="h-7 w-auto" />
      </header>
      <p role="status" className="flex items-center gap-2 px-4 pt-2 pb-6 text-sm text-muted-foreground">
        <RiLoader4Line size={16} aria-hidden className="animate-spin" />
        Loading…
      </p>
    </main>
  )
}

export function App() {
  const { confirm, dialog } = useConfirm()
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined)
  const [session, setSession] = useState<SessionState | undefined>(undefined)
  // With no known session yet (the first open), "Loading…" stays until the server answers, at most this long.
  const [waitedLong, setWaitedLong] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setWaitedLong(true), SESSION_WAIT_MS)
    return () => clearTimeout(timer)
  }, [])
  const [prefs, setPrefs] = useState<CapturePrefs>(DEFAULT_CAPTURE_PREFS)
  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof store.list>>>([])
  const [recording, setRecording] = useState<RecordingStatus | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<{ id?: number; url?: string } | null>(null)
  const [mic, setMic] = useState<MicList>({ access: "prompt", devices: [], defaultId: null })
  const [live, setLive] = useState<PopupRecordingStatus | undefined>(undefined)
  const [micPicker, setMicPicker] = useState(false)
  const level = useMicLevel(meteredMicId(prefs, mic), micMeterOn(prefs, mic, micPicker, live, tabRecorder))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [limitNotes, setLimitNotes] = useState<{ usage: string | null; screenshot: string | null; record: string | null }>({
    usage: null,
    screenshot: null,
    record: null,
  })
  /** Whether the microphone may be used, and the microphones Chrome names once it may. */
  const readMic = async () => {
    const access: MicAccess = await queryMicAccess()
    const listed = await navigator.mediaDevices?.enumerateDevices().catch(() => []) ?? []
    setMic((current) => ({ ...current, access, ...micDevices(listed) }))
  }
  // Firefox lets the reporter take website access away; Chrome grants it with the install.
  const [hostAccess, setHostAccess] = useState(true)
  const readHostAccess = () =>
    void browser.permissions.contains(ALL_SITES).then(setHostAccess, () => setHostAccess(true))
  useEffect(readHostAccess, [])

  useEffect(() => {
    void loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN).then(async (loaded) => {
      // Shown together with the last known session, so the popup opens at its real size while it asks again.
      const known = loaded ? await lastSessionStorage.get(loaded.serverUrl).catch(() => null) : null
      if (known) setSession(known)
      setSettings(loaded)
      const checked = await checkSession(loaded, () => createBugberryApi(loaded as Settings).me())
      setSession(checked)
      if (loaded) void lastSessionStorage.set(loaded.serverUrl, checked).catch(() => {})
    })
    // A permission revoked since the Mic was turned on shows as "Mic off" instead of recording silence.
    void Promise.all([capturePrefsStorage.get(), queryMicAccess()]).then(
      async ([stored, access]) =>
        setPrefs(stored.mic && !micChoiceAfterCheck(stored.mic, access) ? await capturePrefsStorage.set({ mic: false }) : stored),
    )
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTab(tab ?? null))
    void readMic()
    readDrafts()
  }, [])

  /** The unsent drafts, and the recording they are checked against; read again once a Discard removed one. */
  const readDrafts = () => {
    store.list().then(setDrafts)
    const status: RecordStatusRequest = { type: "bugberry:record-status" }
    browser.runtime
      .sendMessage(status)
      .then((value) => setRecording((value as RecordingStatus | undefined) ?? { recording: false }))
      .catch(() => setRecording({ recording: false }))
  }

  /** The running recording, asked again every second while the popup is open: its timer and counts move. */
  const askRecording = async (action: PopupRecordingAction) => {
    const request: PopupRecordingRequest = { type: "bugberry:popup-recording", action }
    return browser.runtime.sendMessage(request).catch(() => ({ ok: false, error: "The extension didn't respond. Try again." }))
  }
  const refreshLive = () =>
    void askRecording("status").then((value) =>
      setLive(typeof (value as { recording?: unknown } | undefined)?.recording === "boolean" ? (value as PopupRecordingStatus) : { recording: false }),
    )
  useEffect(() => {
    refreshLive()
    const timer = setInterval(refreshLive, 1000)
    return () => clearInterval(timer)
  }, [])

  /** Pause, Resume, Restart and Discard, as on the bar; the last two ask first, as the bar does. */
  const control = async (action: Exclude<PopupRecordingAction, "status" | "stop">) => {
    if (action === "restart" || action === "discard") {
      const yes = await confirm({
        title: action === "restart" ? "Delete this recording and start over?" : "Delete this recording?",
        confirmLabel: "Delete",
      })
      if (!yes) return
    }
    if (action === "restart") {
      // The new take counts down on the page, and an open popup would take its Esc (as when starting).
      // A Restart that fails goes on the badge.
      void askRecording("restart")
      return window.close()
    }
    setError(null)
    const failed = controlError(await askRecording(action))
    if (failed) setError(failed)
    refreshLive()
    if (action === "discard") readDrafts()
  }

  // The default workspace's usage under ACCOUNT_LIMITS: the one the review will pre-select. Silent on any failure.
  useEffect(() => {
    if (!settings || session?.kind !== "signed-in") return
    const api = createBugberryApi(settings)
    void Promise.all([api.listWorkspaces(), api.me(), lastWorkspaceStorage.get()])
      .then(async ([workspaces, me, lastUsed]) => {
        // The same pick as the review's, so the warning is about the workspace the report will really go to.
        const dashboard = (me as { lastWorkspaceId?: string | null }).lastWorkspaceId
        const workspace = workspaces.find((entry) => entry.id === pickEditorWorkspace(workspaces, dashboard, lastUsed))
        if (!workspace) return
        const limits = await limitsFor(api, workspace.id)
        const who = { isAdmin: workspace.role === "admin", hasOtherWorkspaces: workspaces.length > 1 }
        setLimitNotes({
          usage: usageLine(limits),
          screenshot: fullWarning(limits, "screenshot", "popup", who),
          record: fullWarning(limits, "video", "popup", who),
        })
      })
      .catch(() => {})
  }, [settings, session])

  /** Asks the background to act; the popup closes once it has, or once the reporter backed out. */
  const send = async (request: ScreenshotRequest | RecordStartRequest) => {
    setError(null)
    setBusy(true)
    try {
      const result = replyResult(await browser.runtime.sendMessage(request).catch(() => undefined))
      if (result.ok || result.code === "cancelled") window.close()
      else setError(result.error)
    } finally {
      setBusy(false)
    }
  }

  const updatePrefs = async (patch: Partial<CapturePrefs>) => setPrefs(await capturePrefsStorage.set(patch))

  // The popup can't show the browser's permission prompt: it is asked over the page (or in a tab), and the popup closes.
  const onMicAllow = () => {
    const ask: PopupPromptRequest = { type: "bugberry:popup-prompt", page: "microphone", tabId: activeTab?.id ?? null }
    void browser.runtime.sendMessage(ask).catch(() => {})
    window.close()
  }

  const onMicChoose = async (id: string | null) => {
    setError(null)
    if (id === null) return updatePrefs({ mic: false })
    const access = await queryMicAccess()
    if (access === "granted") return updatePrefs({ mic: true, micDeviceId: id })
    if (access === "denied") return setError(MIC_BLOCKED)
    onMicAllow()
  }

  const onScreenshot = () => {
    if (activeTab?.id === undefined) return setError("No active tab")
    const request: ScreenshotRequest = { type: "bugberry:screenshot", tabId: activeTab.id, mode: prefs.screenshotMode }
    if (prefs.screenshotMode === "area") {
      const note = uncapturableNote(activeTab.url)
      if (note) return setError(note)
      // The reporter drags on the page; the popup has to be out of the way first.
      void browser.runtime.sendMessage(request).catch(() => {})
      return window.close()
    }
    void send(request)
  }

  const onRecord = () => {
    if (activeTab?.id === undefined) return setError("No active tab")
    const options = recordOptionsFor(prefs, tabRecorder)
    const note = recordStartNote(options.source, activeTab.url)
    if (note) return setError(note)
    // The countdown runs on the page; an open popup would take its Esc. Later failures go on the badge.
    void browser.runtime.sendMessage({ type: "bugberry:record-start", tabId: activeTab.id, options }).catch(() => {})
    window.close()
  }

  const remove = async (id: string) => {
    const yes = await confirm({
      title: "Delete this draft?",
      description: "Its screenshot or video is deleted too.",
      confirmLabel: "Delete draft",
    })
    if (!yes) return
    await store.delete(id)
    setDrafts(await store.list())
  }

  // Until the session is known, so the popup doesn't open on the capture tiles and then jump to "Sign in".
  if (settings === undefined || (session === undefined && !waitedLong)) return <PopupLoading />
  const retry = async () => {
    setSession(undefined)
    setSession(await checkSession(settings, () => createBugberryApi(settings as Settings).me()))
  }

  return (
    <>
      {dialog}
      <PopupView
        session={session}
        serverHost={settings ? serverLabel(settings.serverUrl, BUILD_SERVER_ORIGIN) : ""}
        prefs={prefs}
        mic={{ ...mic, level }}
        recording={recording}
        live={live}
        activeTabId={activeTab?.id ?? null}
        drafts={drafts}
        logsAvailable={capturable(activeTab?.url)}
        tabRecorder={tabRecorder}
        hostAccess={hostAccess}
        error={error}
        busy={busy}
        onPrefs={(patch) => void updatePrefs(patch)}
        onMicChoose={(id) => void onMicChoose(id)}
        onMicAllow={onMicAllow}
        onMicPicker={(open) => {
          setMicPicker(open)
          if (open) void readMic()
        }}
        onPause={() => void control("pause")}
        onResume={() => void control("resume")}
        onRestart={() => void control("restart")}
        onDiscard={() => void control("discard")}
        onStop={() => {
          // The review opens on the recorded tab; the popup is in the way.
          void askRecording("stop")
          window.close()
        }}
        onScreenshot={onScreenshot}
        onRecord={onRecord}
        onSignIn={() => settings && void browser.tabs.create({ url: signInUrl(settings.serverUrl) })}
        onRetry={() => void retry()}
        onOpenSettings={() => {
          // Over the page the reporter is on (or in a tab where that page can't show it), like the other prompts.
          const ask: PopupPromptRequest = { type: "bugberry:popup-prompt", page: "options", tabId: activeTab?.id ?? null }
          void browser.runtime.sendMessage(ask).catch(() => {})
          window.close()
        }}
        onOpenDashboard={() => settings && void browser.tabs.create({ url: `${settings.serverUrl}/app` })}
        onOpenDraft={(id) => {
          // Over the page the reporter is on, like a new capture's review.
          const open: OpenDraftRequest = { type: "bugberry:open-draft", draftId: id, tabId: activeTab?.id ?? null }
          void browser.runtime.sendMessage(open).catch(() => {})
          window.close()
        }}
        onDeleteDraft={(id) => void remove(id)}
        onAllowHosts={() => void browser.permissions.request(ALL_SITES).finally(readHostAccess)}
        usage={limitNotes.usage}
        screenshotWarning={limitNotes.screenshot}
        recordWarning={limitNotes.record}
      />
    </>
  )
}
