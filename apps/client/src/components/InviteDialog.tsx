import { RiSendPlaneLine } from "@remixicon/react"
import { useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Button } from "@bugberry/ui/button"
import type { InviteResult } from "../lib/api"
import { api } from "../lib/client"
import { EmailChips } from "./EmailChips"

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

/** "Invite by email": several addresses at once as chips, with what happened to each. */
export function InviteForm({ onInvite }: { onInvite(emails: string[]): Promise<InviteResult[]> }) {
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

  return (
    <form onSubmit={send} className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <EmailChips emails={emails} onChange={setEmails} label="Invite by email" placeholder="sari@company.com, andi@gmail.com" />
        </div>
        <Button type="submit" className="shrink-0" isDisabled={sending || emails.length === 0}>
          <RiSendPlaneLine aria-hidden />
          {sendLabel(emails.length)}
        </Button>
      </div>
      {results.length > 0 && (
        <ul role="status" className="flex flex-col gap-0.5 text-sm text-muted-foreground">
          {results.map((result) => (
            <li key={result.email}>{`${result.email}: ${RESULT_LABELS[result.status]}`}</li>
          ))}
        </ul>
      )}
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
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} aria-label="Invite people" size="md">
      <DialogHeader>
        <DialogTitle>Invite people</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <InviteForm
          onInvite={async (emails) => {
            const results = await api.invite(workspaceId, emails)
            await queryClient.invalidateQueries({ queryKey: ["invitations", workspaceId] })
            return results
          }}
        />
      </DialogBody>
    </Dialog>
  )
}
