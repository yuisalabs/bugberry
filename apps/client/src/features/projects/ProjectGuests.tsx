import { RiUserUnfollowLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { qk } from "../../lib/query/keys"
import { errorMessage } from "../../lib/query/unwrap"
import { EmailChips } from "../workspaces/EmailChips"
import { type GuestInviteResult, inviteGuests, type Project, projectGuests, type ProjectGuestList, removeGuest } from "./queries"

/** What happened to one address, in a sentence. */
export function inviteOutcomeText(result: GuestInviteResult): string {
  switch (result.status) {
    case "sent":
      return `Invitation sent to ${result.email}.`
    case "member":
      return `${result.email} is already a member of this workspace.`
    case "guest":
      return `${result.email} is already a guest of this project.`
    case "pending":
      return `${result.email} already has an invitation waiting.`
    case "not_allowed":
      return `This server doesn't let ${result.email} sign in. Add their domain to ALLOWED_EMAIL_DOMAINS first.`
    default:
      return `${result.email} isn't an email address.`
  }
}

/** A project's guests and pending guest invitations, with a field to invite more by email. */
export function ProjectGuestsView({
  projectName,
  guests,
  pending,
  results,
  inviting,
  error,
  onInvite,
  onRemove,
}: {
  projectName: string
  guests: ProjectGuestList["guests"]
  pending: ProjectGuestList["pending"]
  results: GuestInviteResult[] | null
  inviting: boolean
  error: string | null
  onInvite(emails: string[]): void
  onRemove(userId: string): void
}) {
  const { confirm, dialog } = useConfirm()
  const [emails, setEmails] = useState<string[]>([])
  const remove = async (guest: ProjectGuestList["guests"][number]) => {
    const yes = await confirm({
      title: `Remove ${guest.name} from ${projectName}?`,
      description: "They lose access to its reports at once.",
      confirmLabel: "Remove guest",
    })
    if (yes) onRemove(guest.id)
  }
  return (
    <div className="flex flex-col gap-4">
      {dialog}
      <p className="text-sm text-muted-foreground">
        A guest reads this project's reports and comments on them, and sees nothing else in the workspace. Every comment on
        these reports is visible to its guests.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (emails.length > 0) onInvite(emails)
          setEmails([])
        }}
        className="flex flex-col gap-2"
      >
        <EmailChips emails={emails} onChange={setEmails} label="Invite guests" placeholder="client@company.com" />
        <Button type="submit" isDisabled={inviting || emails.length === 0} className="self-start">
          {inviting ? "Sending…" : "Invite as guests"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
      {results && (
        <ul className="flex flex-col gap-1 text-sm text-foreground">
          {results.map((result) => (
            <li key={result.email}>{inviteOutcomeText(result)}</li>
          ))}
        </ul>
      )}
      {(guests.length > 0 || pending.length > 0) && (
        <ul className="flex flex-col divide-y divide-border">
          {guests.map((guest) => (
            <li key={guest.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{guest.name}</span>
                <span className="truncate text-xs text-muted-foreground">{guest.email}</span>
              </span>
              <Button intent="plain" size="sq-sm" aria-label={`Remove ${guest.name}`} onPress={() => void remove(guest)} className="text-danger-subtle-foreground">
                <RiUserUnfollowLine aria-hidden />
              </Button>
            </li>
          ))}
          {pending.map((invitation) => (
            <li key={invitation.invitationId} className="flex items-center justify-between gap-3 py-2.5">
              <span className="truncate text-sm text-foreground">{invitation.email}</span>
              <span className="shrink-0 text-xs text-muted-foreground">Invited</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** The guests dialog of one project, for admins. */
export function ProjectGuestsDialog({ project, onClose }: { project: Project | null; onClose(): void }) {
  const queryClient = useQueryClient()
  const projectId = project?.id ?? ""
  const list = useQuery({ queryKey: qk.projectGuests(projectId), queryFn: () => projectGuests(projectId), enabled: Boolean(project) })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: qk.projectGuests(projectId) })
    void queryClient.invalidateQueries({ queryKey: qk.projects.all })
  }
  const invite = useMutation({ mutationFn: (emails: string[]) => inviteGuests(projectId, emails), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (userId: string) => removeGuest(projectId, userId), onSuccess: refresh })
  const failure = invite.error ?? remove.error ?? list.error
  return (
    <Dialog isOpen={project !== null} onOpenChange={(open) => !open && onClose()} aria-label="Guests" size="lg">
      <DialogHeader>
        <DialogTitle>Guests of {project?.name}</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <ProjectGuestsView
          projectName={project?.name ?? ""}
          guests={list.data?.guests ?? []}
          pending={list.data?.pending ?? []}
          results={invite.data ?? null}
          inviting={invite.isPending}
          error={failure ? errorMessage(failure) : null}
          onInvite={(emails) => invite.mutate(emails)}
          onRemove={(userId) => remove.mutate(userId)}
        />
      </DialogBody>
    </Dialog>
  )
}
