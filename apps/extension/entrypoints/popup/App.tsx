import { useEffect, useState } from "react"
import { browser } from "wxt/browser"
import { createBugberryApi } from "../../lib/api"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage, capturePrefsStorage, lastWorkspaceStorage } from "../../lib/browser-settings"
import { capturable } from "../../lib/capture-flow"
import { hasTabRecorder } from "../../lib/browser-support"
import { type CapturePrefs, DEFAULT_CAPTURE_PREFS, recordOptionsFor } from "../../lib/capture-prefs"
import { createIndexedDbDraftStore } from "../../lib/draft-store"
import { fullWarning, limitsFor, usageLine } from "../../lib/limits"
import type { RecordStartRequest, RecordStatusRequest, ScreenshotRequest } from "../../lib/messages"
import { micAccess, micChoiceAfterCheck, micDeviceLabel } from "../../lib/microphone"
import { recordStartNote, replyResult, uncapturableNote } from "../../lib/popup"
import { pickEditorWorkspace } from "../../lib/report-form"
import type { RecordingStatus } from "../../lib/recording-flow"
import { checkSession, type SessionState, serverLabel, signInUrl } from "../../lib/session"
import { loadSettings, type Settings } from "../../lib/settings"
import { PopupView } from "./PopupView"
import { useConfirm } from "@bugberry/ui/confirm-dialog"

const store = createIndexedDbDraftStore()
const MIC_BLOCKED = "Microphone is blocked. Allow it for BugBerry in Chrome's site settings."
const MICROPHONE_PAGE = "/microphone.html" as Parameters<typeof browser.runtime.getURL>[0]

/** Wires the popup to Chrome: settings, session, drafts, the recording and the background's actions. */
const tabRecorder = hasTabRecorder(browser)
const ALL_SITES = { origins: ["<all_urls>"] }

export function App() {
  const { confirm, dialog } = useConfirm()
  const [settings, setSettings] = useState<Settings | null | undefined>(undefined)
  const [session, setSession] = useState<SessionState | undefined>(undefined)
  const [prefs, setPrefs] = useState<CapturePrefs>(DEFAULT_CAPTURE_PREFS)
  const [drafts, setDrafts] = useState<Awaited<ReturnType<typeof store.list>>>([])
  const [recording, setRecording] = useState<RecordingStatus | undefined>(undefined)
  const [activeTab, setActiveTab] = useState<{ id?: number; url?: string } | null>(null)
  const [micLabel, setMicLabel] = useState("Microphone")
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [limitNotes, setLimitNotes] = useState<{ usage: string | null; screenshot: string | null; record: string | null }>({
    usage: null,
    screenshot: null,
    record: null,
  })
  // Firefox lets the reporter take website access away; Chrome grants it with the install.
  const [hostAccess, setHostAccess] = useState(true)
  const readHostAccess = () =>
    void browser.permissions.contains(ALL_SITES).then(setHostAccess, () => setHostAccess(true))
  useEffect(readHostAccess, [])

  useEffect(() => {
    loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN).then((loaded) => {
      setSettings(loaded)
      void checkSession(loaded, () => createBugberryApi(loaded as Settings).me()).then(setSession)
    })
    // A permission revoked since the Mic was turned on shows as "Mic off" instead of recording silence.
    void Promise.all([capturePrefsStorage.get(), micAccess((name) => navigator.permissions.query({ name: name as PermissionName }))]).then(
      async ([stored, access]) =>
        setPrefs(stored.mic && !micChoiceAfterCheck(stored.mic, access) ? await capturePrefsStorage.set({ mic: false }) : stored),
    )
    store.list().then(setDrafts)
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => setActiveTab(tab ?? null))
    browser.commands.getAll().then((commands) => {
      setShortcut(commands.find((command) => command.name === "take-screenshot")?.shortcut || null)
    })
    // Chrome only names devices once the microphone may be used.
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => setMicLabel(micDeviceLabel(devices)))
      .catch(() => {})
    const status: RecordStatusRequest = { type: "bugberry:record-status" }
    browser.runtime
      .sendMessage(status)
      .then((value) => setRecording((value as RecordingStatus | undefined) ?? { recording: false }))
      .catch(() => setRecording({ recording: false }))
  }, [])

  // The default workspace's usage under ACCOUNT_LIMITS: the one the review will pre-select. Silent on any failure.
  useEffect(() => {
    if (!settings || session?.kind !== "signed-in") return
    const api = createBugberryApi(settings)
    void Promise.all([api.listWorkspaces(), lastWorkspaceStorage.get()])
      .then(async ([workspaces, lastUsed]) => {
        const workspace = workspaces.find((entry) => entry.id === pickEditorWorkspace(workspaces, lastUsed))
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

  const onMicToggle = async (on: boolean) => {
    setError(null)
    if (!on) return updatePrefs({ mic: false })
    const access = await micAccess((name) => navigator.permissions.query({ name: name as PermissionName }))
    if (access === "granted") return updatePrefs({ mic: true })
    if (access === "denied") return setError(MIC_BLOCKED)
    // The popup can't show Chrome's permission prompt; the page asks once and turns the microphone on.
    await browser.tabs.create({ url: browser.runtime.getURL(MICROPHONE_PAGE) })
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

  if (settings === undefined) return <p className="p-4">Loading…</p>
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
        micLabel={micLabel}
        screenshotShortcut={shortcut}
        recording={recording}
        drafts={drafts}
        logsAvailable={capturable(activeTab?.url)}
        tabRecorder={tabRecorder}
        hostAccess={hostAccess}
        error={error}
        busy={busy}
        onPrefs={(patch) => void updatePrefs(patch)}
        onMicToggle={(on) => void onMicToggle(on)}
        onScreenshot={onScreenshot}
        onRecord={onRecord}
        onSignIn={() => settings && void browser.tabs.create({ url: signInUrl(settings.serverUrl) })}
        onRetry={() => void retry()}
        onOpenSettings={() => void browser.runtime.openOptionsPage()}
        onOpenDashboard={() => settings && void browser.tabs.create({ url: `${settings.serverUrl}/app` })}
        onOpenDraft={(id) => void browser.tabs.create({ url: `${browser.runtime.getURL("/review.html")}?draft=${encodeURIComponent(id)}` })}
        onDeleteDraft={(id) => void remove(id)}
        onAllowHosts={() => void browser.permissions.request(ALL_SITES).finally(readHostAccess)}
        usage={limitNotes.usage}
        screenshotWarning={limitNotes.screenshot}
        recordWarning={limitNotes.record}
      />
    </>
  )
}
