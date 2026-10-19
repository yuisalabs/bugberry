import { matchProject, type ProjectWithPatterns } from "@bugberry/shared"
import type { ReportForm } from "./types"

/**
 * What still needs fixing before the report can be sent, or null. Mirrors the server's checks. The title may
 * stay empty: the server then calls the report "Bugshoot by …" or "Bugcord by …".
 */
export function formProblem(form: ReportForm): string | null {
  // Sent without one, the server would file it in whichever workspace the dashboard last showed.
  if (!form.workspaceId) return "Choose a workspace for this report"
  return null
}

/**
 * The project to show once the project list arrives (late, after a failed load): a choice already made
 * stays; otherwise the project matching the page, or "" for No project.
 */
export function projectAfterLoad(
  currentProjectId: string,
  projects: readonly ProjectWithPatterns[],
  pageUrl: string,
): string {
  return currentProjectId || (matchProject(projects, pageUrl)?.id ?? "")
}

/** The workspace a new report goes to: the one used last while still mine, else the first, else none. */
export function pickEditorWorkspace(workspaces: readonly { id: string }[], lastUsed: string | null): string | null {
  return workspaces.find((workspace) => workspace.id === lastUsed)?.id ?? workspaces[0]?.id ?? null
}
