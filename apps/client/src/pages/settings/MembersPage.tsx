import type { WorkspaceRole } from "@bugberry/shared"
import {
  RiCloseLine,
  RiLogoutBoxRLine,
  RiMailLine,
  RiRefreshLine,
  RiShieldUserLine,
  RiUserLine,
  RiUserMinusLine,
  RiVipCrown2Line,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { InviteForm } from "../../components/InviteDialog"
import { SettingsRowsSkeleton } from "../../components/Skeletons"
import { Badge, CopyButton, dangerText, ErrorState } from "../../components/ui"
import { errorMessage, type InviteResult, type JoinRequest, type Member, type PendingInvitation } from "../../lib/api"
import { api } from "../../lib/client"
import { formatDate, formatDateTime } from "../../lib/format"
import { initialsOf } from "../../lib/people"
import { queries } from "../../lib/queries"
import { invitesAllowed } from "../../lib/usage"
import { roleLabel, useCurrentWorkspace, workspaceColor } from "../../lib/workspace"

const card = "rounded-2xl border border-border bg-background shadow-xs"
// Member, role, joined, actions; on phones the cells wrap instead.
const memberColumns = "sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_8rem_8rem] sm:items-center sm:gap-4"
const ROLES = [
  { id: "member", name: "Member" },
  { id: "admin", name: "Admin" },
] as const

/** "3 people in Cuy Workspaces · 1 pending invite". */
export function membersSummary(people: number, workspaceName: string, pendingInvites: number): string {
  const head = `${people} ${people === 1 ? "person" : "people"} in ${workspaceName}`
  return pendingInvites > 0 ? `${head} · ${pendingInvites} pending ${pendingInvites === 1 ? "invite" : "invites"}` : head
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      <span className="rounded-full bg-secondary px-2 text-xs/5 font-medium text-secondary-foreground">{count}</span>
    </div>
  )
}

function Person({ person, you = false }: { person: { id: string; name: string; email: string; image: string | null }; you?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar
        src={person.image}
        initials={initialsOf(person.name)}
        alt=""
        size="lg"
        className={`shrink-0 ${person.image ? "" : `${workspaceColor(person.id)} text-white`}`}
      />
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium text-foreground">{person.name}</span>
          {you && <span className="rounded-md bg-secondary px-1.5 text-xs/5 text-muted-foreground">You</span>}
        </span>
        <span className="truncate text-sm text-muted-foreground">{person.email}</span>
      </div>
    </div>
  )
}

function RoleBadge({ member }: { member: { role: WorkspaceRole; owner: boolean } }) {
  const label = roleLabel(member)
  const [Icon, colours] =
    label === "Owner"
      ? [RiVipCrown2Line, "bg-warning-subtle text-warning-subtle-foreground"]
      : label === "Admin"
        ? [RiShieldUserLine, "bg-primary-subtle text-primary"]
        : [RiUserLine, "bg-secondary text-secondary-foreground"]
  return (
    <Badge className={`self-start px-2.5 py-0.5 text-sm ${colours}`}>
      <Icon aria-hidden className="size-3.5" />
      {label}
    </Badge>
  )
}

function ActionButton({
  label,
  icon,
  danger = false,
  onPress,
  children,
}: {
  label: string
  icon: ReactNode
  danger?: boolean
  onPress(): void
  children: ReactNode
}) {
  return (
    <Button size="sm" intent="plain" aria-label={label} onPress={onPress} className={danger ? dangerText : undefined}>
      {icon}
      {children}
    </Button>
  )
}

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
  workspaceName = "this workspace",
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
  workspaceName?: string
}) {
  return (
    <div className="flex flex-col gap-8">
      {isAdmin && (
        <section className={`${card} flex flex-col gap-4 p-6`}>
          <div className="flex flex-col gap-1">
            <h2 className="font-heading text-lg font-semibold text-foreground">Invite teammates</h2>
            <p className="text-sm text-muted-foreground">
              {membersAllowed
                ? `Separate emails with commas. They'll get a link to join ${workspaceName}.`
                : "Inviting teammates isn't available on this account."}
            </p>
          </div>
          {membersAllowed && <InviteForm onInvite={onInvite} />}
        </section>
      )}

      {isAdmin && requests.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title="Requests to join" count={requests.length} />
          <ul className={`${card} divide-y divide-border`}>
            {requests.map((request) => (
              <li key={request.user.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <Person person={request.user} />
                  <span className="pl-13 text-xs text-muted-foreground">Asked {formatDateTime(request.createdAt)}</span>
                </div>
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

      <section className="flex flex-col gap-3">
        <SectionTitle title="Members" count={members.length} />
        <div className={`${card} overflow-hidden`}>
          <div
            aria-hidden
            className={`hidden border-b border-border bg-muted/60 px-5 py-3 text-xs font-medium tracking-wide text-muted-foreground uppercase ${memberColumns}`}
          >
            <span>Member</span>
            <span>Role</span>
            <span>Joined</span>
          </div>
          <ul className="divide-y divide-border">
            {members.map((member) => {
              const isMe = member.id === meId
              // The owner can't be removed or demoted, and can't leave; nobody changes their own role.
              const canEdit = isAdmin && !member.owner && !isMe
              return (
                <li key={member.id} className={`flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4 ${memberColumns}`}>
                  <div className="min-w-0 basis-full sm:basis-auto">
                    <Person person={member} you={isMe} />
                  </div>
                  <div>
                    {canEdit ? (
                      <Select
                        aria-label={`Role of ${member.name}`}
                        selectedKey={member.role}
                        onSelectionChange={(key) => {
                          if (key === "member" || key === "admin") {
                            if (key !== member.role) onSetRole(member.id, key)
                          }
                        }}
                        className="w-32"
                      >
                        <SelectTrigger />
                        <SelectContent items={ROLES}>{(role) => <SelectItem id={role.id}>{role.name}</SelectItem>}</SelectContent>
                      </Select>
                    ) : (
                      <RoleBadge member={member} />
                    )}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    <span className="sr-only">Joined </span>
                    {formatDate(member.joinedAt)}
                  </span>
                  <span className="ml-auto flex justify-end sm:ml-0">
                    {member.owner ? null : isMe ? (
                      <ActionButton label="Leave workspace" icon={<RiLogoutBoxRLine aria-hidden />} onPress={() => onRemove(member.id)}>
                        Leave
                      </ActionButton>
                    ) : (
                      isAdmin && (
                        <ActionButton
                          label={`Remove ${member.name}`}
                          icon={<RiUserMinusLine aria-hidden />}
                          danger
                          onPress={() => onRemove(member.id)}
                        >
                          Remove
                        </ActionButton>
                      )
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </section>

      {isAdmin && invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <SectionTitle title="Pending invitations" count={invitations.length} />
          <ul className={`${card} divide-y divide-border`}>
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className="grid size-10 shrink-0 place-content-center rounded-full border border-border bg-muted text-muted-foreground">
                    <RiMailLine className="size-4.5" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-foreground">{invitation.email}</span>
                      <Badge className="bg-warning-subtle text-warning-subtle-foreground">
                        <span aria-hidden className="size-1.5 rounded-full bg-warning" />
                        Pending
                      </Badge>
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {/* Invitations always join as a member; an admin promotes them afterwards. */}
                      Invited as Member{invitation.invitedBy ? ` by ${invitation.invitedBy}` : ""} · Expires {formatDateTime(invitation.expiresAt)}
                    </span>
                  </div>
                </div>
                <span className="ml-auto flex gap-1">
                  {membersAllowed && (
                    <ActionButton label={`Resend ${invitation.email}`} icon={<RiRefreshLine aria-hidden />} onPress={() => onResend(invitation.id)}>
                      Resend
                    </ActionButton>
                  )}
                  <ActionButton
                    label={`Revoke ${invitation.email}`}
                    icon={<RiCloseLine aria-hidden />}
                    danger
                    onPress={() => onRevoke(invitation.id)}
                  >
                    Revoke
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
  // The workspace's join link, when an admin has turned it on in Settings.
  const access = useQuery({ ...queries.workspaceAccess(workspaceId), enabled: isAdmin })
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
  const shareCode = access.data?.shareCode
  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
        <div className="flex flex-col gap-1">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">Members</h1>
          {workspace && members.data && (
            <p className="text-muted-foreground text-sm">{membersSummary(members.data.length, workspace.name, invitations.data?.length ?? 0)}</p>
          )}
        </div>
        {shareCode && <CopyButton text={`${window.location.origin}/join/${shareCode}`} label="Copy invite link" />}
      </header>
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
