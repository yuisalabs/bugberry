import type { WorkspaceRole } from "@bugberry/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@bugberry/ui/button"
import { InviteForm } from "../../components/InviteDialog"
import { ErrorState, Loading, PageHeader } from "../../components/ui"
import { errorMessage, type InviteResult, type JoinRequest, type Member, type PendingInvitation } from "../../lib/api"
import { api } from "../../lib/client"
import { formatDateTime } from "../../lib/format"
import { queries } from "../../lib/queries"
import { invitesAllowed } from "../../lib/usage"
import { roleLabel, useCurrentWorkspace } from "../../lib/workspace"

export function MembersView({
  meId,
  isAdmin,
  members,
  invitations,
  onInvite,
  onSetRole,
  onRemove,
  onRevoke,
  onResend,
  requests = [],
  onApprove = () => {},
  onDecline = () => {},
  membersAllowed = true,
}: {
  meId: string
  isAdmin: boolean
  members: readonly Member[]
  invitations: readonly PendingInvitation[]
  onInvite(emails: string[]): Promise<InviteResult[]>
  onSetRole(userId: string, role: WorkspaceRole): void
  onRemove(userId: string): void
  onRevoke(invitationId: string): void
  onResend(invitationId: string): void
  requests?: readonly JoinRequest[]
  onApprove?(userId: string): void
  onDecline?(userId: string): void
  /** False under ACCOUNT_LIMITS: nobody new can join, but what is pending can still be cleared. */
  membersAllowed?: boolean
}) {
  return (
    <div className="flex flex-col gap-6">
      {isAdmin &&
        (membersAllowed ? (
          <div className="rounded-lg border border-border bg-background p-4">
            <InviteForm onInvite={onInvite} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Inviting teammates isn't available on this account.</p>
        ))}

      {isAdmin && requests.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Requests to join</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background">
            {requests.map((request) => (
              <li key={request.user.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{request.user.name}</span>
                  <span className="ml-2 text-muted-foreground">{request.user.email}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(request.createdAt)}</span>
                </span>
                <span className="flex gap-2">
                  {membersAllowed && (
                    <Button size="sm" aria-label={`Approve ${request.user.name}`} onPress={() => onApprove(request.user.id)}>
                      Approve
                    </Button>
                  )}
                  <Button size="sm" intent="plain" aria-label={`Decline ${request.user.name}`} onPress={() => onDecline(request.user.id)}>
                    Decline
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {isAdmin && invitations.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Pending invitations</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {invitation.email}
                  <span className="ml-2 text-xs text-muted-foreground">until {formatDateTime(invitation.expiresAt)}</span>
                </span>
                <span className="flex gap-2">
                  {membersAllowed && (
                    <Button size="sm" intent="plain" aria-label={`Resend ${invitation.email}`} onPress={() => onResend(invitation.id)}>
                      Resend
                    </Button>
                  )}
                  <Button size="sm" intent="plain" aria-label={`Revoke ${invitation.email}`} onPress={() => onRevoke(invitation.id)}>
                    Revoke
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="divide-y divide-border rounded-lg border border-border bg-background">
        {members.map((member) => (
          <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0">
              <span className="font-medium">{member.name}</span>
              <span className="ml-2 text-muted-foreground">{member.email}</span>
              <span className="ml-2 text-xs text-muted-foreground">{roleLabel(member)}</span>
            </span>
            <span className="flex gap-2">
              {/* The owner can't be removed or demoted, and can't leave. */}
              {member.owner ? null : member.id === meId ? (
                <Button size="sm" intent="plain" onPress={() => onRemove(member.id)}>
                  Leave workspace
                </Button>
              ) : (
                isAdmin && (
                  <>
                    <Button size="sm"
                      intent="plain"
                      aria-label={`Make ${member.name} ${member.role === "admin" ? "member" : "admin"}`}
                      onPress={() => onSetRole(member.id, member.role === "admin" ? "member" : "admin")}
                    >
                      {member.role === "admin" ? "Make member" : "Make admin"}
                    </Button>
                    <Button size="sm" intent="plain" aria-label={`Remove ${member.name}`} onPress={() => onRemove(member.id)}>
                      Remove
                    </Button>
                  </>
                )
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function MembersPage() {
  const queryClient = useQueryClient()
  const me = useQuery(queries.me())
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const isAdmin = workspace?.role === "admin"
  const members = useQuery({ ...queries.members(workspaceId), enabled: Boolean(workspace) })
  const invitations = useQuery({ ...queries.invitations(workspaceId), enabled: isAdmin })
  const requests = useQuery({ ...queries.joinRequests(workspaceId), enabled: isAdmin })
  const limits = useQuery({ ...queries.workspaceLimits(workspaceId), enabled: Boolean(workspace) })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["members", workspaceId] })
    await queryClient.invalidateQueries({ queryKey: ["invitations", workspaceId] })
    await queryClient.invalidateQueries({ queryKey: ["workspaces"] })
    await queryClient.invalidateQueries({ queryKey: ["join-requests", workspaceId] })
  }
  const approve = useMutation({ mutationFn: (userId: string) => api.approveJoinRequest(workspaceId, userId), onSuccess: refresh })
  const decline = useMutation({ mutationFn: (userId: string) => api.declineJoinRequest(workspaceId, userId), onSuccess: refresh })
  const setRole = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) => api.setMemberRole(workspaceId, userId, role),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(workspaceId, userId),
    onSuccess: async (_data, userId) => {
      // Leaving moves the person to another workspace (or to none).
      if (userId === me.data?.id) await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth-methods" })
      else await refresh()
    },
  })
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeInvitation(workspaceId, id), onSuccess: refresh })
  const resend = useMutation({ mutationFn: (id: string) => api.resendInvitation(workspaceId, id), onSuccess: refresh })

  const error = setRole.error ?? remove.error ?? revoke.error ?? resend.error ?? approve.error ?? decline.error
  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <PageHeader title="Members" subtitle={workspace ? `People in ${workspace.name}` : undefined} />
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}
      {members.isPending || me.isPending || limits.isPending ? (
        <Loading />
      ) : members.isError ? (
        <ErrorState error={members.error} onRetry={() => void members.refetch()} />
      ) : (
        <MembersView
          meId={me.data?.id ?? ""}
          isAdmin={isAdmin}
          members={members.data}
          invitations={invitations.data ?? []}
          requests={requests.data ?? []}
          membersAllowed={invitesAllowed(limits.data)}
          onApprove={(userId) => approve.mutate(userId)}
          onDecline={(userId) => decline.mutate(userId)}
          onInvite={async (emails) => {
            const results = await api.invite(workspaceId, emails)
            await refresh()
            return results
          }}
          onSetRole={(userId, role) => setRole.mutate({ userId, role })}
          onRemove={(userId) => remove.mutate(userId)}
          onRevoke={(id) => revoke.mutate(id)}
          onResend={(id) => resend.mutate(id)}
        />
      )}
    </section>
  )
}
