import { RiArrowRightLine, RiGroupLine, RiLinkM, RiSendPlaneLine } from "@remixicon/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type FormEvent, type ReactNode, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Dialog, DialogBody, DialogDescription, DialogTitle } from "@bugberry/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { useCurrentWorkspace } from "./workspace"
import { EmailChips } from "./EmailChips"
import { CopyButton } from "../../components/ui"
import { errorMessage } from "../../lib/query/unwrap"
import { invite, type InviteResult, useUpdateWorkspaceAccess, workspaceQueries } from "./queries"
import { qk } from "../../lib/query/keys"

export const RESULT_LABELS: Record<InviteResult["status"], string> = {
  sent: "Invited",
  member: "Already a member",
  pending: "Already invited",
  not_allowed: "Not allowed on this server",
  invalid: "Not an email address",
}

/** "Send 2 invites" once addresses are in; "Send invites" before. */
export function sendLabel(count: number): string {
  if (count === 1) return "Send invite"
  return count > 1 ? `Send ${count} invites` : "Send invites"
}

/** The addresses being typed, and sending them: shared by the Members page's card and the Invite dialog. */
function useInviteSender(onInvite: (emails: string[]) => Promise<InviteResult[]>) {
  const [emails, setEmails] = useState<string[]>([])
  const [results, setResults] = useState<InviteResult[]>([])
  const [sending, setSending] = useState(false)
  const send = async (event: FormEvent) => {
    event.preventDefault()
    if (emails.length === 0) return
    setSending(true)
    try {
      setResults(await onInvite(emails))
      setEmails([])
    } finally {
      setSending(false)
    }
  }
  return { emails, setEmails, results, sending, send }
}

/** What happened to each address that was sent. */
function InviteResults({ results }: { results: readonly InviteResult[] }) {
  if (results.length === 0) return null
  return (
    <ul role="status" className="flex flex-col gap-0.5 text-sm text-muted-foreground">
      {results.map((result) => (
        <li key={result.email}>{`${result.email}: ${RESULT_LABELS[result.status]}`}</li>
      ))}
    </ul>
  )
}

export type InviteRole = "member" | "admin"
const INVITE_ROLES = [
  { id: "member", name: "Member" },
  { id: "admin", name: "Admin" },
] as const

/** "Invite by email": several addresses at once as chips, the role they join with, and what happened to each. */
export function InviteForm({ onInvite }: { onInvite(emails: string[], role: InviteRole): Promise<InviteResult[]> }) {
  const [role, setRole] = useState<InviteRole>("member")
  const { emails, setEmails, results, sending, send } = useInviteSender((list) => onInvite(list, role))

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <EmailChips emails={emails} onChange={setEmails} label="Invite by email" placeholder="sari@company.com, andi@gmail.com" tall />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select
          aria-label="Invite as"
          selectedKey={role}
          onSelectionChange={(key) => (key === "member" || key === "admin") && setRole(key)}
          className="min-w-0 flex-1"
        >
          <SelectTrigger prefix="Invite as" className="h-full font-medium" />
          <SelectContent items={INVITE_ROLES}>{(item) => <SelectItem id={item.id}>{item.name}</SelectItem>}</SelectContent>
        </Select>
        <Button type="submit" className="shrink-0" isDisabled={sending || emails.length === 0}>
          <RiSendPlaneLine aria-hidden />
          {sendLabel(emails.length)}
        </Button>
      </div>
      <InviteResults results={results} />
    </form>
  )
}

/** The workspace's join link inside the Invite dialog: turn it on here, or copy it once it is. */
function InviteLinkPanel({ url, busy, error, onTurnOn }: { url: string | null; busy: boolean; error: string | null; onTurnOn(): void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-muted px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="grid size-9 shrink-0 place-content-center rounded-lg border border-border bg-background text-muted-foreground">
          <RiLinkM className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-sm font-medium text-foreground">{url ? "Invite link is on" : "Invite link is off"}</span>
          <span className="truncate text-sm text-muted-foreground">
            {url ? new URL(url).host + new URL(url).pathname : "Turn it on to share one link instead of emails."}
          </span>
        </div>
        {url ? (
          <CopyButton text={url} label="Copy link" className="bg-background" />
        ) : (
          <Button intent="plain" size="sm" className="[--btn-foreground:var(--color-primary)] [--btn-icon:var(--color-primary)]" isDisabled={busy} onPress={onTurnOn}>
            Turn on
            <RiArrowRightLine aria-hidden />
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
    </div>
  )
}

/** The Invite dialog's content, without queries or a router, so it renders in tests. */
export function InviteDialogView({
  workspaceName,
  inviteLink,
  linkBusy = false,
  linkError = null,
  onTurnOnLink,
  onInvite,
  onCancel,
  manageMembers,
}: {
  workspaceName: string
  /** The join link when it is on, else null. */
  inviteLink: string | null
  linkBusy?: boolean
  linkError?: string | null
  onTurnOnLink(): void
  onInvite(emails: string[]): Promise<InviteResult[]>
  onCancel(): void
  /** The link to the Members page (a router link in the app). */
  manageMembers: ReactNode
}) {
  const { emails, setEmails, results, sending, send } = useInviteSender(onInvite)

  return (
    <form onSubmit={send} className="flex min-h-0 flex-col">
      <div className="p-(--gutter) pb-4">
        <div className="flex min-w-0 flex-col gap-0.5 pr-8">
          <DialogTitle className="font-heading text-lg">Invite people to {workspaceName}</DialogTitle>
          <DialogDescription>They'll get an email with a link to join.</DialogDescription>
        </div>
      </div>

      <DialogBody className="gap-5 pb-6">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-foreground">Email addresses</span>
          <EmailChips emails={emails} onChange={setEmails} label="Email addresses" placeholder="sari@company.com, andi@gmail.com" />
          <span className="text-sm text-muted-foreground">Separate with commas or press Enter.</span>
        </div>
        <InviteResults results={results} />
        <InviteLinkPanel url={inviteLink} busy={linkBusy} error={linkError} onTurnOn={onTurnOnLink} />
      </DialogBody>

      <div className="flex flex-col-reverse gap-3 border-t border-border p-(--gutter) py-4 sm:flex-row sm:items-center sm:justify-between">
        {manageMembers}
        <div className="flex flex-col-reverse gap-3 sm:flex-row">
          <Button intent="outline" onPress={onCancel}>
            Cancel
          </Button>
          <Button type="submit" isDisabled={sending || emails.length === 0}>
            <RiSendPlaneLine aria-hidden />
            {sendLabel(emails.length)}
          </Button>
        </div>
      </div>
    </form>
  )
}

/** The header's Invite button opens this; admins only. */
export function InviteDialog({
  workspaceId,
  isOpen,
  onOpenChange,
}: {
  workspaceId: string
  isOpen: boolean
  onOpenChange(open: boolean): void
}) {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const access = useQuery({ ...workspaceQueries.workspaceAccess(workspaceId), enabled: isOpen })
  const turnOn = useUpdateWorkspaceAccess(workspaceId)
  const shareCode = access.data?.shareCode

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} aria-label="Invite people" size="lg">
      {isOpen && (
        <InviteDialogView
          workspaceName={workspace?.name ?? "this workspace"}
          inviteLink={shareCode ? `${window.location.origin}/join/${shareCode}` : null}
          linkBusy={turnOn.isPending || access.isPending}
          linkError={turnOn.error ? errorMessage(turnOn.error) : null}
          onTurnOnLink={() => turnOn.mutate({ shareLink: "on" })}
          onInvite={async (emails) => {
            const results = await invite(workspaceId, emails)
            await queryClient.invalidateQueries({ queryKey: qk.invitations(workspaceId) })
            return results
          }}
          onCancel={() => onOpenChange(false)}
          manageMembers={
            <Link
              to="/app/settings/members"
              onClick={() => onOpenChange(false)}
              className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <RiGroupLine aria-hidden className="size-4" />
              Manage members
            </Link>
          }
        />
      )}
    </Dialog>
  )
}
