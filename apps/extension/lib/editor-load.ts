import type { Project, Workspace } from "./api"
import { pickEditorWorkspace } from "./report-form"
import type { Settings } from "./settings"
import type { ReportDraft } from "./types"

export interface EditorDeps {
  loadSettings(): Promise<Settings | null>
  getDraft(id: string): Promise<ReportDraft | null>
  listWorkspaces(settings: Settings): Promise<Workspace[]>
  /** `lastWorkspaceId`: the workspace open in the dashboard. */
  me(settings: Settings): Promise<{ email: string; name?: string; lastWorkspaceId?: string | null }>
  /** The workspace the last report was sent to, remembered by the extension. */
  lastWorkspaceId(): Promise<string | null>
  listProjects(settings: Settings, workspaceId: string): Promise<Project[]>
  createObjectURL(blob: Blob): string
  createImageBitmap(blob: Blob): Promise<ImageBitmap>
}

export type EditorState =
  | { kind: "error"; message: string }
  | {
      kind: "loaded"
      draft: ReportDraft
      videoUrl: string | null
      image: ImageBitmap | null
      workspaces: Workspace[]
      /** Where the report goes; null when the person has no workspace (or the list did not load). */
      workspaceId: string | null
      /** The signed-in address, which decides whether "Internal" is offered; null if unknown. */
      email: string | null
      /** The signed-in person's name, for the title a report gets when none is typed; null if unknown. */
      name: string | null
      projects: Project[]
      /** Set when the server could not be reached; the draft is still shown and kept. */
      projectsError: string | null
      /** An editor was closed while this draft was uploading; sending again resumes the upload. */
      interrupted: boolean
    }

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Projects for the form, or the reason they could not be loaded. */
export async function loadProjects(
  deps: Pick<EditorDeps, "listProjects">,
  settings: Settings,
  workspaceId: string | null,
): Promise<{ projects: Project[]; error: string | null }> {
  if (!workspaceId) return { projects: [], error: null }
  try {
    return { projects: await deps.listProjects(settings, workspaceId), error: null }
  } catch (error) {
    return { projects: [], error: messageOf(error) }
  }
}

/**
 * Loads what the editor shows. Returns null once `isCancelled` says the page went away, before any
 * object URL is created, so a closed editor never leaves one behind.
 */
export async function loadEditor(draftId: string, deps: EditorDeps, isCancelled: () => boolean): Promise<EditorState | null> {
  const settings = await deps.loadSettings()
  if (!settings) return { kind: "error", message: "Choose your BugBerry server in the extension settings first." }
  const draft = await deps.getDraft(draftId)
  if (isCancelled()) return null
  if (!draft) return { kind: "error", message: "Report draft not found." }

  let videoUrl: string | null = null
  let image: ImageBitmap | null = null
  if (draft.captureType === "video") {
    if (!draft.video) {
      return {
        kind: "error",
        message:
          draft.status === "recording"
            ? "The recording is still running. Stop it from the BugBerry popup first."
            : "This recording's video wasn't saved. Delete the draft from the BugBerry popup.",
      }
    }
    videoUrl = deps.createObjectURL(draft.video)
  } else {
    image = await deps.createImageBitmap(draft.screenshot)
    if (isCancelled()) return null
  }

  let workspaces: Workspace[] = []
  let email: string | null = null
  let name: string | null = null
  let dashboardWorkspaceId: string | null = null
  let workspacesError: string | null = null
  try {
    let me: { email: string; name?: string; lastWorkspaceId?: string | null }
    ;[workspaces, me] = await Promise.all([deps.listWorkspaces(settings), deps.me(settings)])
    email = me.email
    name = me.name ?? null
    dashboardWorkspaceId = me.lastWorkspaceId ?? null
  } catch (error) {
    workspacesError = messageOf(error)
  }
  // A draft opened again keeps the workspace it was being sent to. A new one goes where the dashboard is open, so
  // someone who moved to another workspace there isn't sent back to their own (and maybe full) one; then to
  // the workspace the extension sent to last.
  const lastSent = await deps.lastWorkspaceId()
  const preferred = draft.form?.workspaceId ?? dashboardWorkspaceId ?? lastSent
  // Without the list, keep the remembered workspace rather than letting the server pick another one.
  const workspaceId =
    pickEditorWorkspace(workspaces, draft.form?.workspaceId, dashboardWorkspaceId, lastSent) ?? (workspacesError ? preferred : null)
  const { projects, error } = workspacesError ? { projects: [], error: workspacesError } : await loadProjects(deps, settings, workspaceId)
  return {
    kind: "loaded",
    draft,
    videoUrl,
    image,
    workspaces,
    workspaceId,
    email,
    name,
    projects,
    projectsError: error,
    interrupted: draft.status === "uploading",
  }
}
