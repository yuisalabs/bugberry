import type { WorkspaceRole } from "@bugberry/shared"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { Workspace } from "./api"
import { api } from "./client"
import { queries } from "./queries"

/** The workspace the dashboard shows: the last one used while still a member, else the first by name. */
export function pickWorkspace<T extends { id: string; name: string }>(workspaces: readonly T[], lastWorkspaceId: string | null): T | null {
  const last = workspaces.find((workspace) => workspace.id === lastWorkspaceId)
  if (last) return last
  return [...workspaces].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null
}

export function roleIn(workspaces: readonly { id: string; role: WorkspaceRole }[], workspaceId: string): WorkspaceRole | null {
  return workspaces.find((workspace) => workspace.id === workspaceId)?.role ?? null
}

const WORKSPACE_COLORS = ["bg-[#1C1022]", "bg-[#D61F69]", "bg-[#2563EB]", "bg-[#15803D]", "bg-[#D97706]", "bg-[#7C3AED]"]

/** The background of a workspace's letter tile: picked from its id, so it never changes. */
export function workspaceColor(id: string): string {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return WORKSPACE_COLORS[hash % WORKSPACE_COLORS.length] as string
}

/** How a person's place in a workspace reads on screen; the owner is an admin who can't be removed. */
export function roleLabel(workspace: { role: WorkspaceRole; owner: boolean }): "Owner" | "Admin" | "Member" {
  if (workspace.owner) return "Owner"
  return workspace.role === "admin" ? "Admin" : "Member"
}

/** The current workspace, every workspace of the person, and a way to switch. */
export function useCurrentWorkspace(): {
  workspace: Workspace | null
  workspaces: Workspace[]
  isPending: boolean
  switchTo(id: string): Promise<void>
} {
  const queryClient = useQueryClient()
  const me = useQuery(queries.me())
  const workspaces = useQuery(queries.workspaces())
  const list = workspaces.data ?? []
  return {
    workspace: pickWorkspace(list, me.data?.lastWorkspaceId ?? null),
    workspaces: list,
    isPending: me.isPending || workspaces.isPending,
    async switchTo(id) {
      if (id === me.data?.lastWorkspaceId) return
      await api.switchWorkspace(id)
      // Everything on screen belonged to the previous workspace.
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth-methods" })
    },
  }
}
