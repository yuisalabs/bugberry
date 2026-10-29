import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { BrandedHeader } from "../../components/BrandedHeader"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { CopyButton, ErrorState } from "../../components/ui"
import { useNow } from "../../hooks/useNow"
import { invitesAllowed } from "./usage"
import { useCurrentWorkspace } from "./workspace"
import { errorMessage } from "../../lib/query/unwrap"
import { accountQueries } from "../account/queries"
import {
  invite,
  refreshMembers,
  removeMember,
  useApproveJoinRequest,
  useDeclineJoinRequest,
  useResendInvitation,
  useRevokeInvitation,
  useSetMemberRole,
  workspaceQueries,
} from "./queries"
import { membersSummary } from "./members-text"
import { MembersView } from "./MembersView"

export function MembersPage() {
  const queryClient = useQueryClient()
  const now = useNow()
  const me = useQuery(accountQueries.me())
  const { workspace } = useCurrentWorkspace()
  const workspaceId = workspace?.id ?? ""
  const isAdmin = workspace?.role === "admin"
  const members = useQuery({ ...workspaceQueries.members(workspaceId), enabled: Boolean(workspace) })
  const invitations = useQuery({ ...workspaceQueries.invitations(workspaceId), enabled: isAdmin })
  const requests = useQuery({ ...workspaceQueries.joinRequests(workspaceId), enabled: isAdmin })
  const limits = useQuery({ ...workspaceQueries.workspaceLimits(workspaceId), enabled: Boolean(workspace) })
  // The workspace's join link, when an admin has turned it on in Settings.
  const access = useQuery({ ...workspaceQueries.workspaceAccess(workspaceId), enabled: isAdmin })
  const approve = useApproveJoinRequest(workspaceId)
  const decline = useDeclineJoinRequest(workspaceId)
  const setRole = useSetMemberRole(workspaceId)
  const remove = useMutation({
    mutationFn: (userId: string) => removeMember(workspaceId, userId),
    onSuccess: async (_data, userId) => {
      // Leaving moves the person to another workspace (or to none).
      if (userId === me.data?.id) await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth-methods" })
      else await refreshMembers(queryClient, workspaceId)
    },
  })
  const revoke = useRevokeInvitation(workspaceId)
  const resend = useResendInvitation(workspaceId)

  const error = setRole.error ?? remove.error ?? revoke.error ?? resend.error ?? approve.error ?? decline.error
  const shareCode = access.data?.shareCode
  return (
    <section className="flex flex-col gap-8">
      <BrandedHeader
        title="Members"
        description={workspace && members.data ? membersSummary(members.data.length, workspace.name, invitations.data?.length ?? 0) : " "}
        action={shareCode && <CopyButton text={`${window.location.origin}/join/${shareCode}`} label="Copy invite link" className="bg-background" />}
      />
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}
      {members.isPending || me.isPending || limits.isPending ? (
        <SettingsRowsSkeleton />
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
          workspaceName={workspace?.name}
          now={now}
          onApprove={(userId) => approve.mutate(userId)}
          onDecline={(userId) => decline.mutate(userId)}
          onInvite={async (emails, role) => {
            const results = await invite(workspaceId, emails, role)
            await refreshMembers(queryClient, workspaceId)
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
