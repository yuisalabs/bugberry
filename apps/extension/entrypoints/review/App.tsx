import type { RecordingNote } from "@bugberry/capture"
import { VideoPlayer } from "@bugberry/player/video-player"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { browser } from "wxt/browser"
import { createBugberryApi, type Project, type Workspace } from "../../lib/api"
import { relayFetcher } from "../../lib/api-relay"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage, includeCityStorage, lastWorkspaceStorage } from "../../lib/browser-settings"
import { createIndexedDbDraftStore, saveAnnotations } from "../../lib/draft-store"
import { type EditorDeps, loadEditor, loadProjects } from "../../lib/editor-load"
import { limitsFor } from "../../lib/limits"
import { currentCoordinates, locationForSend, toggleCity } from "../../lib/location"
import type { ReviewAgainRequest } from "../../lib/messages"
import { isSignedOut } from "../../lib/popup"
import { reviewMarkers } from "../../lib/review-data"
import { draftKept, draftWithNotes } from "../../lib/review-draft"
import { createReviewLimits, type LimitNote, NO_LIMIT_NOTE, openDashboardFor } from "../../lib/review-limits"
import { signInUrl } from "../../lib/session"
import { loadSettings, type Settings } from "../../lib/settings"
import { makeThumbnail } from "../../lib/thumbnail"
import { browserThumbnailDeps } from "../../lib/thumbnail-browser"
import type { ReportDraft } from "../../lib/types"
import { LOCKED, putFile, type ReportForm, submitDraft } from "../../lib/upload"
import { AnnotationCanvas, type AnnotationCanvasHandle } from "./AnnotationCanvas"
import { ReviewView, type ReviewStatus } from "./ReviewView"

const store = createIndexedDbDraftStore()
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
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
}

/** The review: over the recorded page (embedded in the page layer's iframe) or in a tab of its own. */
export function App({ draftId, embedded }: { draftId: string; embedded: boolean }) {
  const canvas = useRef<AnnotationCanvasHandle>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ReviewStatus>("ready")
  const [projects, setProjects] = useState<Project[]>([])
  const [includeCity, setIncludeCity] = useState(false)
  const [cityNote, setCityNote] = useState<string | null>(null)
  // The selected workspace under ACCOUNT_LIMITS: its usage for this kind, and whether "Create report" waits.
  const [limitNote, setLimitNote] = useState<LimitNote>(NO_LIMIT_NOTE)

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
        setProjects(state.projects)
        if (state.draft.status === "failed") setStatus({ failed: state.draft.error ?? "Upload failed" })
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    void includeCityStorage.get().then(setIncludeCity)
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [draftId])

  // Edits are kept in the draft as they happen (debounced), so closing the tab or the page loses nothing.
  // Not while sending: the upload writes the draft then.
  const saving = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = status === "sending" || (typeof status === "object" && "sent" in status)
  const keepEdits = useCallback(
    (form: ReportForm, notes: RecordingNote[]) => {
      if (saving.current) clearTimeout(saving.current)
      if (busy) return
      saving.current = setTimeout(async () => {
        const current = await store.get(draftId)
        if (current && current.status !== "uploading") await store.put(draftKept(current, form, notes))
      }, 400)
    },
    [draftId, busy],
  )

  const limits = useMemo(
    () =>
      loaded &&
      createReviewLimits(
        {
          kind: loaded.draft.captureType,
          workspaces: loaded.workspaces,
          fetchLimits: async (workspaceId) => {
            const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
            return settings ? limitsFor(apiOf(settings), workspaceId) : null
          },
          currentDraft: () => store.get(draftId),
          onChange: setLimitNote,
        },
        loaded.workspaceId,
      ),
    [draftId, loaded],
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
  }

  const changeIncludeCity = async (on: boolean) => {
    const result = await toggleCity(on, () => currentCoordinates(navigator.geolocation))
    setIncludeCity(result.includeCity)
    setCityNote(result.note)
    await includeCityStorage.set(result.includeCity)
  }

  const send = async (form: ReportForm, notes: RecordingNote[]) => {
    const settings = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    if (!settings || !loaded) return
    setStatus("sending")
    try {
      const current = (await store.get(draftId)) ?? loaded.draft
      await store.put(draftWithNotes(current, notes))
      let media: Blob | null = current.captureType === "video" ? current.video : null
      if (current.captureType === "screenshot" && canvas.current) {
        // Saved first, so a draft reopened after a failure still carries its blur.
        await saveAnnotations(store, draftId, canvas.current.getShapes())
        media = await canvas.current.exportPng()
      }
      if (!media) throw new Error("The report's media isn't available")
      const thumbnail = await makeThumbnail(
        media,
        { captureType: current.captureType, durationMs: current.captureType === "video" ? current.durationMs : null },
        browserThumbnailDeps,
      )
      // Over someone else's page the city can't be asked for, so only the tab version sends one.
      const asked = embedded ? { includeCity, location: null, note: null } : await locationForSend(includeCity, () => currentCoordinates(navigator.geolocation))
      const result = await submitDraft(
        draftId,
        form,
        media,
        { api: apiOf(settings), store, putFile: (target, body) => putFile(target, body), sleep, lock, serverUrl: settings.serverUrl },
        thumbnail,
        { location: asked.location },
      )
      if (form.workspaceId) await lastWorkspaceStorage.set(form.workspaceId)
      setStatus({ sent: result })
    } catch (cause) {
      if (isSignedOut(cause)) setStatus({ signedOut: signInUrl(settings.serverUrl) })
      else setStatus({ failed: cause instanceof Error ? cause.message : String(cause) })
      refreshLimits()
    }
  }

  if (error) return <p className="p-6 text-danger-subtle-foreground">{error}</p>
  if (!loaded) return embedded ? null : <p className="p-6">Loading…</p>
  const { draft } = loaded
  const startedAt = draft.captureType === "video" ? (draft.recordingStartedAt ?? draft.debuggerPayload?.recordingStartedAt ?? 0) : 0

  return (
    <ReviewView
      embedded={embedded}
      draft={draft}
      media={
        draft.captureType === "video" && loaded.videoUrl ? (
          <VideoPlayer
            src={loaded.videoUrl}
            durationMs={draft.durationMs}
            markers={reviewMarkers(draft.debuggerPayload?.events ?? [], startedAt)}
            className="w-full"
          />
        ) : loaded.image ? (
          <AnnotationCanvas ref={canvas} image={loaded.image} initialShapes={draft.captureType === "screenshot" ? draft.annotations : []} />
        ) : null
      }
      workspaces={loaded.workspaces}
      workspaceId={loaded.workspaceId}
      projects={projects}
      email={loaded.email}
      name={loaded.name}
      status={status}
      includeCity={includeCity}
      cityNote={cityNote}
      onSend={(form, notes) => void send(form, notes)}
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
          const current = await store.get(draftId)
          if (current) await store.put(draftKept(current, kept.form, kept.notes))
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
    />
  )
}
