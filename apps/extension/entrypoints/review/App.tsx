import type { RecordingNote } from "@bugberry/capture"
import type { Visibility } from "@bugberry/shared"
import { VideoPlayer } from "@bugberry/player/video-player"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { browser } from "wxt/browser"
import { createBugberryApi, type Project, type Workspace } from "../../lib/api"
import { relayFetcher } from "../../lib/api-relay"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage, includeCityStorage, lastWorkspaceStorage } from "../../lib/browser-settings"
import { createIndexedDbDraftStore, saveAnnotations } from "../../lib/draft-store"
import { createDraftWriter } from "../../lib/draft-writer"
import { createSeeker } from "../../lib/seeker"
import { type EditorDeps, loadDestination, loadEditor, loadProjects } from "../../lib/editor-load"
import { limitsFor } from "../../lib/limits"
import { currentCoordinates, locationForSend, toggleCity } from "../../lib/location"
import type { ReviewAgainRequest, ReviewAnotherRequest } from "../../lib/messages"
import { isSignedOut } from "../../lib/popup"
import { reviewMarkers, type TrimRange, trimPayload } from "../../lib/review-data"
import { draftKept, draftWithNotes, draftWithTrim, trimLocked } from "../../lib/review-draft"
import { createReviewLimits, type LimitNote, NO_LIMIT_NOTE, openDashboardFor } from "../../lib/review-limits"
import { signInUrl } from "../../lib/session"
import { loadSettings, type Settings } from "../../lib/settings"
import { makeThumbnail } from "../../lib/thumbnail"
import { browserThumbnailDeps } from "../../lib/thumbnail-browser"
import { type PreparedMedia, prepareVideo } from "../../lib/trim-send"
import type { trimVideo as TrimVideo } from "../../lib/trim-video"
import type { ReportDraft } from "../../lib/types"
import { LOCKED, putFile, type ReportForm, submitDraft, type UploadProgress } from "../../lib/upload"
import { videoFrames } from "../../lib/video-frames"
import { AnnotationCanvas, type AnnotationCanvasHandle } from "./AnnotationCanvas"
import { type Assignable, ReviewView, type ReviewStatus, type SentDetails, type TrackerChoice } from "./ReviewView"

const store = createIndexedDbDraftStore()
const writeDraft = createDraftWriter(store)
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** The encoder (mediabunny) loads only when a trimmed recording is sent: most reviews never need it. */
const trimVideo: typeof TrimVideo = async (...args) => (await import("../../lib/trim-video")).trimVideo(...args)
/** Web Locks are shared by every extension page and released when a page closes. */
function lock<T>(name: string, work: () => Promise<T>): Promise<T | typeof LOCKED> {
  // request() resolves with the callback's settled value; the DOM types do not unwrap the promise.
  return navigator.locks.request(name, { ifAvailable: true }, async (held) => (held ? await work() : LOCKED)) as unknown as Promise<
    T | typeof LOCKED
  >
}
/**
 * Over a page, Firefox sends this frame's requests without the sign-in cookie (they count as cross-site), so
 * they go through the background there. Chrome and Opera, and the review in a tab of its own, fetch directly.
 */
const relayed = import.meta.env.FIREFOX && new URLSearchParams(location.search).get("embedded") === "1"
const apiOf = (settings: Settings) =>
  createBugberryApi(settings, relayed ? relayFetcher((request) => browser.runtime.sendMessage(request)) : fetch)

const editorDeps: Omit<EditorDeps, "createObjectURL"> = {
  loadSettings: () => loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN),
  getDraft: (id) => store.get(id),
  listWorkspaces: (settings) => apiOf(settings).listWorkspaces(),
  me: (settings) => apiOf(settings).me(),
  lastWorkspaceId: () => lastWorkspaceStorage.get(),
  listProjects: (settings, workspaceId) => apiOf(settings).listProjects(workspaceId),
  createImageBitmap: (blob) => createImageBitmap(blob),
}

type Loaded = {
  draft: ReportDraft
  videoUrl: string | null
  image: ImageBitmap | null
  workspaces: Workspace[]
  workspaceId: string | null
  email: string | null
  name: string | null
  projects: Project[]
  signedOut: boolean
}

/** The review: over the recorded page (embedded in the page layer's iframe) or in a tab of its own. */
export function App({ draftId, embedded }: { draftId: string; embedded: boolean }) {
  const canvas = useRef<AnnotationCanvasHandle>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ReviewStatus>("ready")
  const [progress, setProgress] = useState<UploadProgress | null>(null)
  /** The whole percent last shown: the browser reports progress many times a second, the bar needs it once per percent. */
  const shownPercent = useRef(-1)
  const [projects, setProjects] = useState<Project[]>([])
  const [includeCity, setIncludeCity] = useState(false)
  const [cityNote, setCityNote] = useState<string | null>(null)
  // The selected workspace under ACCOUNT_LIMITS: its usage for this kind, and whether "Create report" waits.
  const [limitNote, setLimitNote] = useState<LimitNote>(NO_LIMIT_NOTE)
  const [members, setMembers] = useState<Assignable[]>([])
  /** Signed out: where to sign in before sending. The draft is kept meanwhile. */
  const [signInAt, setSignInAt] = useState<string | null>(null)
  // After sending: the report as the server has it, and the trackers it can go to.
  const [sentDetails, setSentDetails] = useState<SentDetails | null>(null)
  const [trackers, setTrackers] = useState<TrackerChoice[] | null>(null)
  const [trackerNote, setTrackerNote] = useState<string | null>(null)
  // Recordings: the part that is sent, the strip's frames, and how far the trimmed video's encoding is while
  // sending (null when it isn't encoding).
  const [trim, setTrim] = useState<TrimRange | null>(null)
  /** The trim waiting to be saved: a handle moves many times a second, and each save writes the whole video. */
  const trimSave = useRef<{ timer: ReturnType<typeof setTimeout>; range: TrimRange | null } | null>(null)
  // Where the player is and whether it plays, for the strip's playhead and play button.
  const [position, setPosition] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [frames, setFrames] = useState<string[] | null>(null)
  const [preparing, setPreparing] = useState<number | null>(null)
  const [locked, setLocked] = useState(false)
  const video = useRef<HTMLVideoElement>(null)

  /** The people of a workspace, for Assignee; none when the server can't say. */
  const loadMembers = useCallback(async (workspaceId: string | null) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings || !workspaceId) return setMembers([])
    const listed = await apiOf(settings)
      .listMembers(workspaceId)
      .catch(() => [])
    setMembers(listed.map((member) => ({ id: member.id, name: member.name ?? "", email: member.email })))
  }, [])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const deps: EditorDeps = {
      ...editorDeps,
      createObjectURL: (blob) => {
        objectUrl = URL.createObjectURL(blob)
        return objectUrl
      },
    }
    loadEditor(draftId, deps, () => cancelled)
      .then((state) => {
        if (!state || cancelled) return
        if (state.kind === "error") return setError(state.message)
        setLoaded(state)
        if (state.draft.captureType === "video") setTrim(state.draft.trim ?? null)
        setLocked(trimLocked(state.draft))
        setProjects(state.projects)
        void loadMembers(state.workspaceId)
        if (state.signedOut) void editorDeps.loadSettings().then((settings) => settings && !cancelled && setSignInAt(signInUrl(settings.serverUrl)))
        if (state.draft.status === "failed") setStatus({ failed: state.draft.error ?? "Upload failed" })
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    void includeCityStorage.get().then(setIncludeCity)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [draftId, loadMembers])

  // Edits are kept in the draft as they happen (debounced), so closing the tab or the page loses nothing.
  // Not while sending: the upload writes the draft then.
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = status === "sending" || (typeof status === "object" && "sent" in status)
  const keepEdits = useCallback(
    (form: ReportForm, notes: RecordingNote[]) => {
      if (saving.current) clearTimeout(saving.current)
      if (busy) return
      saving.current = setTimeout(() => {
        void writeDraft(draftId, (current) => (current.status !== "uploading" ? draftKept(current, form, notes) : null))
      }, 400)
    },
    [draftId, busy],
  )

  // Signed in from another tab: back here, the workspaces and Create report appear without reopening the draft.
  useEffect(() => {
    if (!loaded?.signedOut) return
    let cancelled = false
    const recheck = async () => {
      const settings = await editorDeps.loadSettings()
      const draft = await store.get(draftId)
      if (!settings || !draft || cancelled) return
      const destination = await loadDestination(settings, draft, editorDeps)
      if (destination.signedOut || cancelled) return
      setLoaded((current) => current && { ...current, ...destination })
      setProjects(destination.projects)
      setSignInAt(null)
      void loadMembers(destination.workspaceId)
    }
    const onFocus = () => void recheck()
    window.addEventListener("focus", onFocus)
    return () => {
      cancelled = true
      window.removeEventListener("focus", onFocus)
    }
  }, [loaded?.signedOut, draftId, loadMembers])

  const limits = useMemo(
    () =>
      loaded && !loaded.signedOut
        ? createReviewLimits(
            {
              kind: loaded.draft.captureType,
              // The part of the recording that is sent; the server checks the length again.
              durationMs:
                loaded.draft.captureType !== "video" ? 0 : trim ? trim.endMs - trim.startMs : (loaded.draft.durationMs ?? 0),
              workspaces: loaded.workspaces,
              fetchLimits: async (workspaceId) => {
                const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
                return settings ? limitsFor(apiOf(settings), workspaceId) : null
              },
              currentDraft: () => store.get(draftId),
              onChange: setLimitNote,
            },
            loaded.workspaceId,
          )
        : null,
    [draftId, loaded, trim],
  )
  const refreshLimits = useCallback(() => void limits?.refresh(), [limits])
  useEffect(refreshLimits, [refreshLimits])

  // Back from the dashboard after deleting a report: a slot may be free now.
  useEffect(() => {
    if (busy) return
    const again = () => {
      if (document.visibilityState === "visible") refreshLimits()
    }
    window.addEventListener("focus", again)
    document.addEventListener("visibilitychange", again)
    return () => {
      window.removeEventListener("focus", again)
      document.removeEventListener("visibilitychange", again)
    }
  }, [busy, refreshLimits])

  const openDashboard = async () => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    const workspaceId = limits?.selected()
    if (!settings || !workspaceId) return
    await openDashboardFor(workspaceId, settings.serverUrl, {
      setCurrentWorkspace: (id) => apiOf(settings).setCurrentWorkspace(id),
      openTab: (url) => browser.tabs.create({ url }),
    })
  }

  const close = () => {
    if (embedded) window.parent.postMessage({ bugberry: "review-close" }, "*")
    else window.close()
  }

  const changeWorkspace = async (id: string) => {
    void limits?.select(id)
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (settings) setProjects((await loadProjects(editorDeps, settings, id)).projects)
    void loadMembers(id)
  }

  /** What the created report looks like on the server, and where else it can go; the review works without either. */
  const loadSent = async (reportId: string) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return
    const api = apiOf(settings)
    const report = await api.getReport(reportId).catch(() => null)
    if (report) {
      setSentDetails({
        number: report.number,
        title: report.title,
        status: report.status,
        priority: report.priority,
        visibility: report.visibility,
        projectName: projects.find((project) => project.id === report.projectId)?.name ?? null,
        assigneeName: report.assignee?.name ?? null,
      })
    }
    const offered = await api.reportTrackers(reportId).catch(() => null)
    if (!offered) return
    const sentTo = new Map(offered.links.map((link) => [link.integrationId, link]))
    const choices = offered.integrations.map((integration): TrackerChoice => {
      const link = sentTo.get(integration.id)
      return { id: integration.id, provider: integration.provider, label: integration.label, state: link?.externalUrl ? { url: link.externalUrl } : "idle" }
    })
    setTrackers(choices)
    setTrackerNote(offered.needsProject ? "Pick a project next time to send reports to its trackers." : null)
  }

  const changeVisibility = async (reportId: string, visibility: Visibility) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return
    const before = sentDetails
    setSentDetails((current) => current && { ...current, visibility })
    // Back as it was when the server refuses: the link must not claim more (or less) than is true.
    await apiOf(settings)
      .updateReport(reportId, { visibility })
      .catch(() => setSentDetails(before))
  }

  const sendToTracker = async (reportId: string, integrationId: string) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings) return
    const mark = (state: TrackerChoice["state"]) =>
      setTrackers((current) => current?.map((tracker) => (tracker.id === integrationId ? { ...tracker, state } : tracker)) ?? null)
    mark("sending")
    try {
      const link = (await apiOf(settings).sendToTracker(reportId, integrationId)) as { externalUrl?: string | null; error?: string | null }
      mark(link.error ? { error: link.error } : { url: link.externalUrl ?? null })
    } catch (cause) {
      mark({ error: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  const changeIncludeCity = async (on: boolean) => {
    const result = await toggleCity(on, () => currentCoordinates(navigator.geolocation))
    setIncludeCity(result.includeCity)
    setCityNote(result.note)
    await includeCityStorage.set(result.includeCity)
  }

  // Leaving while the trimmed video is being made loses that work: the browser asks first.
  useEffect(() => {
    if (preparing === null) return
    const ask = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener("beforeunload", ask)
    return () => window.removeEventListener("beforeunload", ask)
  }, [preparing])

  /** Saves the trim waiting to be saved, now. */
  const saveTrim = async () => {
    const waiting = trimSave.current
    if (!waiting) return
    clearTimeout(waiting.timer)
    trimSave.current = null
    await writeDraft(draftId, (current) => draftWithTrim(current, waiting.range))
  }

  /** A moved handle applies at once (player, tiles, markers); the draft keeps it a moment later. */
  const changeTrim = (range: TrimRange | null) => {
    setTrim(range)
    if (trimSave.current) clearTimeout(trimSave.current.timer)
    trimSave.current = { range, timer: setTimeout(() => void saveTrim(), 400) }
  }

  /** Seeks for the strip one at a time, so a dragged handle or playhead doesn't pile them up (see createSeeker). */
  const seeker = useRef<{ element: HTMLVideoElement; seek(seconds: number): void } | null>(null)
  const seekTo = (ms: number) => {
    const element = video.current
    if (!element) return
    if (seeker.current?.element !== element) seeker.current = { element, ...createSeeker(element) }
    seeker.current.seek(ms / 1000)
  }

  /** The strip's play button: plays the part being kept (the player keeps inside it), or pauses. */
  const playTrim = () => {
    const player = video.current
    if (!player) return
    if (player.paused) {
      void player.play().then(() => setPlaying(true))
    } else {
      player.pause()
      setPlaying(false)
    }
  }

  // The strip's frames, made once the recording is loaded.
  useEffect(() => {
    if (loaded?.draft.captureType !== "video" || !loaded.draft.video) return
    let cancelled = false
    void videoFrames(loaded.draft.video, loaded.draft.durationMs ?? 0, 10).then((made) => !cancelled && setFrames(made))
    return () => {
      cancelled = true
    }
  }, [loaded])

  const send = async (form: ReportForm, notes: RecordingNote[], options: { fullVideo?: boolean } = {}) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings || !loaded) return
    // An autosave still waiting would land in the middle of the send; the send saves the notes itself.
    if (saving.current) clearTimeout(saving.current)
    setStatus("sending")
    // The strip's latest range is what is sent.
    await saveTrim()
    setProgress(null)
    shownPercent.current = -1
    const onProgress = (next: UploadProgress) => {
      const percent = next.total > 0 ? Math.floor((next.sent / next.total) * 100) : 100
      if (percent === shownPercent.current) return
      shownPercent.current = percent
      setProgress(next)
    }
    try {
      await writeDraft(draftId, (stored) => draftWithNotes(stored, notes))
      const current = (await store.get(draftId)) ?? draftWithNotes(loaded.draft, notes)
      // prepareVideo marks the draft as sending once its media is ready: from then on the trim stays as sent, as
      // part of the video may reach the server. A failed encode leaves the trim open to change.
      let prepared: PreparedMedia | null = null
      if (current.captureType === "video" && options.fullVideo) {
        prepared = await prepareVideo(current, { store, trimVideo }, undefined, { fullVideo: true })
        setTrim(null)
      } else if (current.captureType === "video") {
        setPreparing(0)
        try {
          prepared = await prepareVideo(current, { store, trimVideo }, setPreparing)
        } catch (cause) {
          setStatus({ trimFailed: cause instanceof Error ? cause.message : String(cause) })
          return
        } finally {
          setPreparing(null)
        }
      }
      if (prepared) setLocked(true)
      let media: Blob | null = prepared ? prepared.media : current.captureType === "video" ? current.video : null
      if (current.captureType === "screenshot" && canvas.current) {
        // Saved first, so a draft reopened after a failure still carries its blur.
        await saveAnnotations(store, draftId, canvas.current.getShapes())
        media = await canvas.current.exportPng()
      }
      if (!media) throw new Error("The report's media isn't available")
      const thumbnail = await makeThumbnail(
        media,
        { captureType: current.captureType, durationMs: prepared ? prepared.durationMs : current.captureType === "video" ? current.durationMs : null },
        browserThumbnailDeps,
      )
      // Over someone else's page the city can't be asked for, so only the tab version sends one.
      const asked = embedded ? { includeCity, location: null, note: null } : await locationForSend(includeCity, () => currentCoordinates(navigator.geolocation))
      const result = await submitDraft(
        draftId,
        form,
        media,
        { api: apiOf(settings), store, putFile: (target, body, onSent) => putFile(target, body, onSent), sleep, lock, serverUrl: settings.serverUrl },
        thumbnail,
        { location: asked.location, onProgress, ...(prepared ? { payload: prepared.payload, durationMs: prepared.durationMs } : {}) },
      )
      if (form.workspaceId) await lastWorkspaceStorage.set(form.workspaceId)
      // The report exists by now: a refused assignment leaves it unassigned rather than unsent.
      if (form.assigneeId) await apiOf(settings).updateReport(result.id, { assigneeId: form.assigneeId }).catch(() => undefined)
      setStatus({ sent: result })
      void loadSent(result.id)
    } catch (cause) {
      if (isSignedOut(cause)) setStatus({ signedOut: signInUrl(settings.serverUrl) })
      else setStatus({ failed: cause instanceof Error ? cause.message : String(cause) })
      refreshLimits()
    }
  }

  if (error) return <p className="p-6 text-danger-subtle-foreground">{error}</p>
  if (!loaded) return embedded ? null : <p className="p-6">Loading…</p>
  const { draft } = loaded
  const sent = typeof status === "object" && "sent" in status ? status.sent : null
  const startedAt = draft.captureType === "video" ? (draft.recordingStartedAt ?? draft.debuggerPayload?.recordingStartedAt ?? 0) : 0
  // Markers stay where they are in the uncut video; those in the parts cut off go.
  const payload = draft.debuggerPayload
  const markerEvents = payload && trim ? trimPayload(payload, startedAt, trim).events : (payload?.events ?? [])

  return (
    <ReviewView
      embedded={embedded}
      draft={draft}
      media={
        draft.captureType === "video" && loaded.videoUrl ? (
          <VideoPlayer
            src={loaded.videoUrl}
            durationMs={draft.durationMs}
            markers={reviewMarkers(markerEvents, startedAt)}
            videoRef={video}
            range={trim}
            onTime={(ms) => {
              setPosition(ms)
              setPlaying(Boolean(video.current && !video.current.paused))
            }}
            className="w-full"
          />
        ) : loaded.image ? (
          <AnnotationCanvas ref={canvas} image={loaded.image} initialShapes={draft.captureType === "screenshot" ? draft.annotations : []} />
        ) : null
      }
      workspaces={loaded.workspaces}
      workspaceId={loaded.workspaceId}
      signInUrl={signInAt}
      projects={projects}
      members={members}
      mediaSize={draft.captureType === "screenshot" && loaded.image ? { width: loaded.image.width, height: loaded.image.height } : null}
      email={loaded.email}
      name={loaded.name}
      status={status}
      uploadProgress={status === "sending" ? progress : null}
      trim={trim}
      trimLocked={locked}
      trimFrames={frames ?? []}
      onTrimSeek={seekTo}
      trimPosition={position}
      trimPlaying={playing}
      onTrimPlay={playTrim}
      onTrimChange={changeTrim}
      onTrimPreview={seekTo}
      preparing={preparing}
      includeCity={includeCity}
      cityNote={cityNote}
      onSend={(form, notes, options) => void send(form, notes, options)}
      onDiscard={async () => {
        await store.delete(draftId)
        close()
      }}
      onAgain={async () => {
        // Over a page the background takes the review off first; a review tab closes once it has answered.
        const again: ReviewAgainRequest = { type: "bugberry:review-again", draftId }
        const result = (await browser.runtime.sendMessage(again).catch(() => null)) as { ok?: unknown; error?: unknown } | null
        if (result?.ok === false && typeof result.error === "string" && result.error !== "Cancelled") setStatus({ failed: result.error })
        else if (!embedded) window.close()
      }}
      onClose={async (kept) => {
        if (kept) {
          await saveTrim()
          await writeDraft(draftId, (current) => draftKept(current, kept.form, kept.notes))
        }
        close()
      }}
      onChange={keepEdits}
      onWorkspaceChange={(id) => void changeWorkspace(id)}
      usage={limitNote.usage}
      limitWarning={limitNote.warning}
      sendBlocked={limitNote.blocked}
      onOpenDashboard={limitNote.admin ? () => void openDashboard() : undefined}
      onIncludeCityChange={(on) => void changeIncludeCity(on)}
      sentDetails={sentDetails}
      trackers={trackers}
      trackerNote={trackerNote}
      onVisibilityChange={sent ? (visibility) => void changeVisibility(sent.id, visibility) : undefined}
      onSendToTracker={sent ? (id) => void sendToTracker(sent.id, id) : undefined}
      onAnother={
        draft.tabId === undefined
          ? undefined
          : async () => {
              // The background takes the review off the page first, then takes the new capture there.
              const another: ReviewAnotherRequest = {
                type: "bugberry:review-another",
                captureType: draft.captureType,
                tabId: draft.tabId as number,
                ...(draft.captureType === "screenshot" && draft.screenshotMode ? { mode: draft.screenshotMode } : {}),
              }
              const result = (await browser.runtime.sendMessage(another).catch(() => null)) as { ok?: unknown } | null
              if (!embedded && result?.ok !== false) window.close()
            }
      }
    />
  )
}
