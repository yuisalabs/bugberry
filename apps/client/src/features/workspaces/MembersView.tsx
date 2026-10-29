import type { WorkspaceRole } from "@bugberry/shared"
import {
  RiCloseLine,
  RiLogoutBoxRLine,
  RiMailLine,
  RiMoreLine,
  RiRefreshLine,
  RiSearchLine,
  RiShieldUserLine,
  RiUserLine,
  RiUserMinusLine,
} from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import { Input, InputGroup } from "@bugberry/ui/input"
import { Menu, MenuItem, MenuLabel, MenuTrigger } from "@bugberry/ui/menu"
import { SearchField } from "@bugberry/ui/search-field"
import { InviteForm, type InviteRole } from "./InviteDialog"
import { dangerText } from "../../components/ui/danger-text"
import { formatAgo, formatDate } from "../../lib/format"
import { initialsOf } from "../../lib/people"
import { roleLabel, workspaceColor } from "./workspace"
import type { InviteResult, JoinRequest, Member, PendingInvitation } from "./queries"
import { inviteMeta, ROLE_RIGHTS } from "./members-text"
import { RoleBadge } from "./RoleBadge"

const card = "rounded-3xl border border-border bg-background"
const cardTitle = "font-heading text-xl font-semibold text-foreground"
// Member, role, joined, actions; on phones the cells wrap instead.
const columns = "sm:grid sm:grid-cols-[minmax(0,1fr)_9rem_9rem_7rem] sm:items-center sm:gap-4"
const rowPadding = "px-4"

const matches = (query: string, ...texts: string[]) => texts.some((text) => text.toLowerCase().includes(query))

function CountBadge({ count }: { count: number }) {
  return <span className="rounded-full bg-secondary px-2 text-xs/5 font-medium text-secondary-foreground">{count}</span>
}

/** A part of the members card (requests, pending invites) under a small uppercase title. */
function SubTitle({ title, count }: { title: string; count: number }) {
  return (
    // The line above it closes the member list, so the list's last row ends flush with the card when nothing follows.
    <h3 className={`flex items-center gap-2 border-t border-border pt-6 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase ${rowPadding}`}>
      {title}
      <span className="font-medium">{count}</span>
    </h3>
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

function IconAction({ label, danger = false, onPress, children }: { label: string; danger?: boolean; onPress(): void; children: ReactNode }) {
  return (
    <Button size="sq-sm" intent="outline" aria-label={label} onPress={onPress} className={danger ? dangerText : undefined}>
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
  now = Date.now(),
}: {
  meId: string
  isAdmin: boolean
  members: readonly Member[]
  invitations: readonly PendingInvitation[]
  onInvite(emails: string[], role: InviteRole): Promise<InviteResult[]>
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
  now?: number
}) {
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const shownMembers = q ? members.filter((member) => matches(q, member.name, member.email)) : members
  const shownRequests = q ? requests.filter((request) => matches(q, request.user.name, request.user.email)) : requests
  const shownInvites = q ? invitations.filter((invitation) => matches(q, invitation.email)) : invitations

  return (
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]">
      <section className={`${card} overflow-hidden`}>
        <div className={`flex flex-wrap items-center justify-between gap-3 py-4 ${rowPadding}`}>
          <h2 className={`flex items-center gap-2.5 ${cardTitle}`}>
            Members
            <CountBadge count={members.length} />
          </h2>
          <SearchField aria-label="Search members" value={query} onChange={setQuery} className="w-full sm:w-80">
            <InputGroup>
              <RiSearchLine aria-hidden data-slot="icon" />
              <Input placeholder="Search members" />
            </InputGroup>
          </SearchField>
        </div>
        <div
          aria-hidden
          className={`hidden border-y border-border bg-muted/60 py-3 text-xs font-medium tracking-wider text-muted-foreground uppercase ${rowPadding} ${columns}`}
        >
          <span>Member</span>
          <span>Role</span>
          <span>Joined</span>
        </div>
        <ul className="divide-y divide-border">
          {shownMembers.map((member) => {
            const isMe = member.id === meId
            // The owner can't be removed or demoted, and can't leave; nobody changes their own role.
            const canEdit = isAdmin && !member.owner && !isMe
            return (
              <li key={member.id} className={`flex flex-wrap items-center gap-x-4 gap-y-3 py-4 ${rowPadding} ${columns}`}>
                <div className="min-w-0 basis-full sm:basis-auto">
                  <Person person={member} you={isMe} />
                </div>
                <RoleBadge member={member} />
                <span className="text-sm text-foreground">
                  <span className="sr-only">Joined </span>
                  {formatDate(member.joinedAt)}
                </span>
                <span className="ml-auto flex justify-end sm:ml-0">
                  {member.owner ? null : isMe ? (
                    <Button size="sm" intent="outline" aria-label="Leave workspace" onPress={() => onRemove(member.id)}>
                      <RiLogoutBoxRLine aria-hidden />
                      Leave
                    </Button>
                  ) : (
                    canEdit && (
                      <MenuTrigger>
                        <Button size="sq-sm" intent="plain" aria-label={`More for ${member.name}`}>
                          <RiMoreLine aria-hidden />
                        </Button>
                        <Menu placement="bottom end" className="min-w-48">
                          <MenuItem
                            textValue={member.role === "admin" ? "Make member" : "Make admin"}
                            onAction={() => onSetRole(member.id, member.role === "admin" ? "member" : "admin")}
                          >
                            {member.role === "admin" ? <RiUserLine aria-hidden /> : <RiShieldUserLine aria-hidden />}
                            <MenuLabel>{member.role === "admin" ? "Make member" : "Make admin"}</MenuLabel>
                          </MenuItem>
                          <MenuItem intent="danger" textValue={`Remove ${member.name}`} onAction={() => onRemove(member.id)}>
                            <RiUserMinusLine aria-hidden />
                            <MenuLabel>Remove from workspace</MenuLabel>
                          </MenuItem>
                        </Menu>
                      </MenuTrigger>
                    )
                  )}
                </span>
              </li>
            )
          })}
          {shownMembers.length === 0 && <li className={`py-6 text-sm text-muted-foreground ${rowPadding}`}>Nobody matches “{query.trim()}”.</li>}
        </ul>

        {isAdmin && shownRequests.length > 0 && (
          <>
            <SubTitle title="Requests to join" count={shownRequests.length} />
            <ul className="pb-3">
              {shownRequests.map((request) => (
                <li key={request.user.id} className={`flex flex-wrap items-center justify-between gap-3 py-3 ${rowPadding}`}>
                  <div className="flex min-w-0 flex-col gap-1">
                    <Person person={request.user} />
                    <span className="pl-13 text-xs text-muted-foreground">Asked {formatAgo(request.createdAt, now)}</span>
                  </div>
                  <span className="flex gap-2">
                    {membersAllowed && (
                      <Button size="sm" aria-label={`Approve ${request.user.name}`} onPress={() => onApprove(request.user.id)}>
                        Approve
                      </Button>
                    )}
                    <Button size="sm" intent="outline" aria-label={`Decline ${request.user.name}`} onPress={() => onDecline(request.user.id)}>
                      Decline
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {isAdmin && shownInvites.length > 0 && (
          <>
            <SubTitle title="Pending invites" count={shownInvites.length} />
            <ul className="pb-3">
              {shownInvites.map((invitation) => (
                <li key={invitation.id} className={`flex flex-wrap items-center gap-x-4 gap-y-3 py-3 ${rowPadding} ${columns}`}>
                  <div className="flex min-w-0 basis-full items-center gap-3 sm:basis-auto">
                    <span aria-hidden className="grid size-10 shrink-0 place-content-center rounded-full border border-border text-muted-foreground">
                      <RiMailLine className="size-4.5" />
                    </span>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-medium text-foreground">{invitation.email}</span>
                      <span className="text-sm text-muted-foreground">{inviteMeta(invitation, now)}</span>
                    </div>
                  </div>
                  <RoleBadge member={{ role: invitation.role, owner: false }} />
                  <span aria-hidden className="hidden text-muted-foreground sm:inline">
                    –
                  </span>
                  <span className="ml-auto flex justify-end gap-2 sm:ml-0">
                    {membersAllowed && (
                      <IconAction label={`Resend ${invitation.email}`} onPress={() => onResend(invitation.id)}>
                        <RiRefreshLine aria-hidden />
                      </IconAction>
                    )}
                    <IconAction label={`Revoke ${invitation.email}`} danger onPress={() => onRevoke(invitation.id)}>
                      <RiCloseLine aria-hidden />
                    </IconAction>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <div className="flex flex-col gap-6">
        {isAdmin && (
          <section className={`${card} flex flex-col gap-4 p-4`}>
            <div className="flex flex-col gap-2">
              <h2 className={cardTitle}>Invite teammates</h2>
              <p className="text-sm text-muted-foreground">
                {membersAllowed
                  ? `Separate emails with commas. They'll get a link to join ${workspaceName}.`
                  : "Inviting teammates isn't available on this account."}
              </p>
            </div>
            {membersAllowed && <InviteForm onInvite={onInvite} />}
          </section>
        )}
        <section className={`${card} flex flex-col gap-4 p-4`}>
          <h2 className={cardTitle}>Who can do what</h2>
          <ul className="flex gap-4">
            {ROLE_RIGHTS.map(({ role, text }) => (
              <li key={roleLabel(role)} className="flex flex-col gap-1.5">
                <RoleBadge member={role} />
                <span className="text-sm text-foreground">{text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
