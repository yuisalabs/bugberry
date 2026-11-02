import { MAX_FIXES_PER_REPORT } from "@bugberry/shared"
import { RiAddLine } from "@remixicon/react"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Dialog, DialogBody, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { Textarea } from "@bugberry/ui/textarea"
import { errorMessage } from "../../../lib/query/unwrap"
import { toast } from "../../../lib/toast"
import { useResolveReport } from "../queries"

/** The dialog's form alone, so it renders in tests without a modal. */
export function ResolveWithLinkForm({
  saving,
  error,
  onSubmit,
  onCancel,
}: {
  saving: boolean
  error: string | null
  onSubmit(input: { links: string[]; note?: string }): void
  onCancel(): void
}) {
  const [links, setLinks] = useState([""])
  const [note, setNote] = useState("")
  const filled = links.map((link) => link.trim()).filter(Boolean)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (filled.length === 0) return
    onSubmit(note.trim() ? { links: filled, note: note.trim() } : { links: filled })
  }

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-col">
      <DialogHeader>
        <DialogTitle className="font-heading text-xl sm:text-xl">Resolve with a fix link</DialogTitle>
        <DialogDescription>The reporter gets a notification and an email with the link.</DialogDescription>
      </DialogHeader>
      <DialogBody className="gap-4 pb-6">
        <div className="flex flex-col gap-2">
          <Label>Pull request, merge request or commit</Label>
          {links.map((link, index) => (
            <TextField
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are only added, never reordered or removed
              key={index}
              aria-label={index === 0 ? "Fix link URL" : `Fix link URL ${index + 1}`}
              value={link}
              onChange={(value) => setLinks((current) => current.map((row, at) => (at === index ? value : row)))}
              autoFocus={index === links.length - 1}
            >
              <Input placeholder="https://github.com/org/repo/pull/42" />
            </TextField>
          ))}
          {links.length < MAX_FIXES_PER_REPORT && (
            <Button intent="plain" size="sm" className="self-start" onPress={() => setLinks((current) => [...current, ""])}>
              <RiAddLine aria-hidden data-slot="icon" />
              Add another link
            </Button>
          )}
        </div>
        <TextField value={note} onChange={setNote} maxLength={5000}>
          <Label>Note for the reporter</Label>
          <Textarea rows={3} placeholder="Optional. Posted as your comment." />
        </TextField>
        {error && (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        <Button intent="plain" onPress={onCancel}>
          Cancel
        </Button>
        <Button type="submit" isPending={saving} isDisabled={filled.length === 0}>
          Resolve
        </Button>
      </DialogFooter>
    </form>
  )
}

export function ResolveWithLinkDialog({ reportId, open, onClose }: { reportId: string; open: boolean; onClose(): void }) {
  const resolve = useResolveReport(reportId)
  const close = () => {
    resolve.reset()
    onClose()
  }
  return (
    <Dialog isOpen={open} onOpenChange={(isOpen) => !isOpen && close()} aria-label="Resolve with a fix link" size="lg">
      {open && (
        <ResolveWithLinkForm
          saving={resolve.isPending}
          error={resolve.error ? errorMessage(resolve.error) : null}
          onCancel={close}
          onSubmit={(input) =>
            resolve.mutate(input, {
              onSuccess: (result) => {
                toast({ title: result.notified ? "Resolved. The reporter has been told." : "Resolved." })
                close()
              },
            })
          }
        />
      )}
    </Dialog>
  )
}
