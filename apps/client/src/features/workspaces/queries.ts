import type { WorkspaceRole } from "@bugberry/shared"
import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"
import { REPORT_LIST_REFRESH_MS } from "../reports/queries"

export type WorkspaceAccessPatch = NonNullable<Parameters<ReturnType<typeof eden.api.workspaces>["access"]["patch"]>[0]>

export const switchWorkspace = (workspaceId: string) => unwrap(eden.api.me.workspace.put({ workspaceId }))
export const workspaces = () => unwrap(eden.api.workspaces.get())
export const createWorkspace = (name: string, slug?: string) =>
  unwrap(eden.api.workspaces.post(slug === undefined ? { name } : { name, slug }))
export const updateWorkspace = (id: string, patch: { name?: string; slug?: string }) => unwrap(eden.api.workspaces({ id }).patch(patch))
export const slugCheck = (query: { name?: string; slug?: string; except?: string }) => unwrap(eden.api.workspaces.slug.get({ query }))
export const logoUploadTarget = (workspaceId: string, contentType: "image/png" | "image/jpeg", size: number) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).logo.post({ contentType, size }))
export const confirmLogo = (workspaceId: string, logoId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).logo({ logoId }).post())
export const removeLogo = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).logo.delete())
export const members = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).members.get())
export const setMemberRole = (workspaceId: string, userId: string, role: WorkspaceRole) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).members({ userId }).patch({ role }))
export const removeMember = (workspaceId: string, userId: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).members({ userId }).delete())
export const invitations = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).invitations.get())
export const invite = (workspaceId: string, emails: string[], role?: "member" | "admin") =>
  unwrap(eden.api.workspaces({ id: workspaceId }).invitations.post(role ? { emails, role } : { emails }))
export const revokeInvitation = (workspaceId: string, id: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).invitations({ invitationId: id }).delete())
export const resendInvitation = (workspaceId: string, id: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).invitations({ invitationId: id }).resend.post())
export const myInvitations = () => unwrap(eden.api.me.invitations.get())
export const acceptMyInvitation = (id: string) => unwrap(eden.api.me.invitations({ id }).accept.post())
export const invitation = (token: string) => unwrap(eden.api.invitations({ token }).get())
export const acceptInvitation = (token: string) => unwrap(eden.api.invitations({ token }).accept.post())
export const joinPreview = (value: string) => unwrap(eden.api.join.preview.post({ value }))
export const join = (value: string) => unwrap(eden.api.join.post({ value }))
export const sharedPreview = (code: string) => unwrap(eden.api.join.shared({ code }).get())
export const domainWorkspaces = () => unwrap(eden.api.join.domain.get())
export const joinByDomain = (workspaceId: string) => unwrap(eden.api.join.domain({ workspaceId }).post())
export const cancelJoinRequest = (workspaceId: string) => unwrap(eden.api.join.domain({ workspaceId }).request.delete())
export const workspaceAccess = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).access.get())
export const workspaceLimits = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).limits.get())
export const updateWorkspaceAccess = (workspaceId: string, patch: WorkspaceAccessPatch) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).access.patch(patch))
export const joinRequests = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId })["join-requests"].get())
export const approveJoinRequest = (workspaceId: string, userId: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId })["join-requests"]({ userId }).approve.post())
export const declineJoinRequest = (workspaceId: string, userId: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId })["join-requests"]({ userId }).delete())

export type Member = Awaited<ReturnType<typeof members>>[number]
export type Workspace = Awaited<ReturnType<typeof workspaces>>[number]
export type PendingInvitation = Awaited<ReturnType<typeof invitations>>[number]
export type MyInvitation = Awaited<ReturnType<typeof myInvitations>>[number]
export type JoinPreview = Awaited<ReturnType<typeof joinPreview>>
export type WorkspaceAccess = Awaited<ReturnType<typeof workspaceAccess>>
export type WorkspaceLimits = Awaited<ReturnType<typeof workspaceLimits>>
export type JoinRequest = Awaited<ReturnType<typeof joinRequests>>[number]
export type InviteResult = Awaited<ReturnType<typeof invite>>[number]
export type InvitationInfo = Awaited<ReturnType<typeof invitation>>

export const workspaceQueries = {
  workspaces: () => queryOptions({ queryKey: qk.workspaces, queryFn: () => workspaces(), staleTime: 60_000 }),
  members: (workspaceId: string) => queryOptions({ queryKey: qk.members(workspaceId), queryFn: () => members(workspaceId) }),
  invitations: (workspaceId: string) => queryOptions({ queryKey: qk.invitations(workspaceId), queryFn: () => invitations(workspaceId) }),
  myInvitations: () => queryOptions({ queryKey: qk.myInvitations, queryFn: () => myInvitations() }),
  domainWorkspaces: () => queryOptions({ queryKey: qk.domainWorkspaces, queryFn: () => domainWorkspaces() }),
  /** Under ACCOUNT_LIMITS: screenshots and recordings kept, and no inviting. Refreshed with the report list. */
  workspaceLimits: (workspaceId: string) =>
    queryOptions({
      queryKey: qk.workspaceLimits.of(workspaceId),
      queryFn: () => workspaceLimits(workspaceId),
      refetchInterval: REPORT_LIST_REFRESH_MS,
    }),
  workspaceAccess: (workspaceId: string) =>
    queryOptions({ queryKey: qk.workspaceAccess(workspaceId), queryFn: () => workspaceAccess(workspaceId) }),
  /** Admins see waiting requests as a count next to Members, so the list is refreshed every minute. */
  joinRequests: (workspaceId: string) =>
    queryOptions({ queryKey: qk.joinRequests(workspaceId), queryFn: () => joinRequests(workspaceId), refetchInterval: 60_000 }),
  invitation: (token: string) => queryOptions({ queryKey: qk.invitation(token), queryFn: () => invitation(token), retry: false }),
  sharedInvite: (code: string) => queryOptions({ queryKey: qk.sharedInvite(code), queryFn: () => sharedPreview(code), retry: false }),
}

export const refreshForNewWorkspace = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== qk.authMethods[0] })

export const refreshMembers = async (queryClient: QueryClient, workspaceId: string) => {
  await queryClient.invalidateQueries({ queryKey: qk.members(workspaceId) })
  await queryClient.invalidateQueries({ queryKey: qk.invitations(workspaceId) })
  await queryClient.invalidateQueries({ queryKey: qk.workspaces })
  await queryClient.invalidateQueries({ queryKey: qk.joinRequests(workspaceId) })
}

function useMembersMutation<T>(workspaceId: string, request: (workspaceId: string, input: T) => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (input: T) => request(workspaceId, input), onSuccess: () => refreshMembers(queryClient, workspaceId) })
}

export const useApproveJoinRequest = (workspaceId: string) => useMembersMutation(workspaceId, approveJoinRequest)
export const useDeclineJoinRequest = (workspaceId: string) => useMembersMutation(workspaceId, declineJoinRequest)
export const useRevokeInvitation = (workspaceId: string) => useMembersMutation(workspaceId, revokeInvitation)
export const useResendInvitation = (workspaceId: string) => useMembersMutation(workspaceId, resendInvitation)
export const useSetMemberRole = (workspaceId: string) =>
  useMembersMutation(workspaceId, (id, { userId, role }: { userId: string; role: WorkspaceRole }) => setMemberRole(id, userId, role))

/** The server answers with the new settings, so they replace the cached ones instead of a refetch. */
export function useUpdateWorkspaceAccess(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: WorkspaceAccessPatch) => updateWorkspaceAccess(workspaceId, patch),
    onSuccess: (next) => queryClient.setQueryData(qk.workspaceAccess(workspaceId), next),
  })
}

export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: { name?: string; slug?: string }) => updateWorkspace(workspaceId, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.workspaces }),
  })
}

export function useRemoveLogo(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: () => removeLogo(workspaceId), onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.workspaces }) })
}

export function useCancelJoinRequest() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (workspaceId: string) => cancelJoinRequest(workspaceId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.domainWorkspaces }),
  })
}
