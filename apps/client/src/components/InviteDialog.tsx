import { useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { TextField } from "@bugberry/ui/text-field"
import { Textarea } from "@bugberry/ui/textarea"
import type { InviteResult } from "../lib/api"
import { api } from "../lib/client"

export const RESULT_LABELS: Record<InviteResult["status"], string> = {
  sent: "Invited",
  member: "Already a member",
  pending: "Already invited",
  not_allowed: "Not allowed on this server",
  invalid: "Not an email address",
}

/** Addresses typed with commas, spaces or new lines between them. */
export function parseEmails(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** "Invite by email": several addresses at once, with what happened to each. */
export function InviteForm({ onInvite }: { onInvite(emails: string[]): Promise<InviteResult[]> }) {
  const [text, setText] = useState("")
  const [results, setResults] = useState<InviteResult[]>([])
  const [sending, setSending] = useState(false)

  const send = async (event: FormEvent) => {
    event.preventDefault()
    const emails = parseEmails(text)
    if (emails.length === 0) return
    setSending(true)
    try {
      setResults(await onInvite(emails))
      setText("")
    } finally {
      setSending(false)
    }
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-4">
      <TextField value={text} onChange={setText}>
        <Label>Invite by email</Label>
        <Textarea rows={2} placeholder="sari@company.com, andi@gmail.com" />
      </TextField>
      <Button size="sm" type="submit" className="self-start" isDisabled={sending || parseEmails(text).length === 0}>
        Send invites
      </Button>
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
