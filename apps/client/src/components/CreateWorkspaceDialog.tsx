import { RiAddLine, RiCheckboxCircleLine } from "@remixicon/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useState } from "react"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import type { InviteResult } from "../lib/api"
import { api } from "../lib/client"
import { type SlugAnswer, type SlugStatus, useSlugCheck } from "../lib/workspace-slug"
import { EmailChips } from "./EmailChips"
import { RESULT_LABELS } from "./InviteDialog"
import { LogoPicker } from "./LogoPicker"
import { errorMessage } from "../lib/query/unwrap"
import { accountQueries } from "../features/account/queries"

export interface NewWorkspace {
  name: string
  slug: string
  /** False while the URL is still the one suggested from the name; then the server picks a free one. */
  slugEdited: boolean
  logo: File | null
  emails: string[]
}

const label = "text-sm font-medium text-foreground"
const optional = <span className="text-xs font-normal text-muted-foreground">Optional</span>

function SlugStatusText({ status }: { status: SlugStatus }) {
  if (status === "available") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-success-subtle-foreground">
        <RiCheckboxCircleLine aria-hidden className="size-3.5" />
        Available
      </span>
    )
  }
  const text = {
    checking: "Checking…",
    taken: "Taken",
    invalid: "Use 3–40 lowercase letters, numbers or dashes",
    reserved: "This URL is reserved",
  }[status]
  const tone = status === "checking" ? "text-muted-foreground" : "text-danger-subtle-foreground"
  return <span className={`shrink-0 text-xs font-medium ${tone}`}>{text}</span>
}

/**
 * What went wrong with the invites sent after creating a workspace: each address that was not sent and
 * why, or the server's reason when the whole request was refused. Null when every invite went out.
 */
export function inviteProblem(outcome: readonly InviteResult[] | unknown): string | null {
  if (Array.isArray(outcome)) {
    const failed = (outcome as InviteResult[]).filter((result) => result.status !== "sent")
    if (failed.length === 0) return null
    const details = failed.map((result) => `${result.email}: ${RESULT_LABELS[result.status]}`).join("; ")
    return `Workspace created, but some invites weren't sent: ${details}`
  }
  return `Workspace created, but the invites weren't sent: ${errorMessage(outcome)}`
}

/** The Create a workspace form: name, short URL, logo and invites. Network calls come in through props. */
export function CreateWorkspaceForm({
  origin,
  done,
  message,
  onSubmit,
  onClose,
  check,
  measure,
  canInvite = true,
}: {
  /** This server's address; its host is shown before the URL field. */
  origin: string
  /** True after the workspace exists but its logo or invites failed: the main button becomes Done. */
  done: boolean
  message: string | null
  onSubmit(workspace: NewWorkspace): Promise<void>
  onClose(): void
  check?: (query: { name?: string; slug?: string; except?: string }) => Promise<SlugAnswer>
  measure?: (file: File) => Promise<{ width: number; height: number }>
  /** False when this account's workspaces take no members (ACCOUNT_LIMITS). */
  canInvite?: boolean
}) {
  const [name, setName] = useState("")
  const [typed, setTyped] = useState("")
  const [edited, setEdited] = useState(false)
  const [logo, setLogo] = useState<File | null>(null)
  const [emails, setEmails] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const url = useSlugCheck({ name, slug: typed, edited }, check)
  const shown = edited ? typed : url.slug
  const ready = Boolean(name.trim()) && url.status === "available" && !busy

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (done) return onClose()
    if (!ready) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), slug: shown, slugEdited: edited, logo, emails })
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col">
      <DialogHeader className="flex flex-row items-start gap-3">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
          <RiAddLine className="size-4" />
        </span>
        <span className="flex flex-col gap-0.5">
          <DialogTitle>Create a workspace</DialogTitle>
          <span className="text-sm text-muted-foreground">Workspaces keep your reports, projects and teammates together.</span>
        </span>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        {/* biome-ignore lint/a11y/noAutofocus: the dialog opens to type a name */}
        <TextField value={name} maxLength={80} isDisabled={done} onChange={setName} autoFocus>
          <Label>Workspace name</Label>
          <Input />
        </TextField>

        <TextField
          value={shown}
          maxLength={40}
          isDisabled={done}
          onChange={(value) => {
            setEdited(true)
            setTyped(value.toLowerCase())
          }}
        >
          <Label>Workspace URL</Label>
          {/* The host stays in front of the slug, inside the same box. */}
          <span
            data-slot="control"
            className="flex items-center gap-2 rounded-lg border border-input px-3 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20"
          >
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{`${new URL(origin).host}/`}</span>
            <Input className="border-0 px-0 font-mono focus:ring-0 sm:px-0" />
            {!done && (name.trim() || edited) && <SlugStatusText status={url.status} />}
          </span>
        </TextField>

        <div className="flex flex-col gap-1.5">
          <span className={`${label} flex items-center justify-between`}>
            Logo
            {optional}
          </span>
          <LogoPicker file={logo} name={name} onChange={setLogo} measure={measure} />
        </div>

        {canInvite && (
          <div className="flex flex-col gap-1.5">
            <span className={`${label} flex items-center justify-between`}>
              Invite teammates
              {optional}
            </span>
            <EmailChips emails={emails} onChange={setEmails} />
            <span className="text-xs text-muted-foreground">They get an email invite and join as Members. You can change roles later.</span>
          </div>
        )}

        {(message ?? error) && (
          <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-subtle-foreground">
            {message ?? error}
          </p>
        )}
      </DialogBody>
      <DialogFooter>
        {!done && (
          <Button size="sm" intent="outline" onPress={onClose}>
            Cancel
          </Button>
        )}
        <Button size="sm" type="submit" isDisabled={!done && !ready}>
          {done ? "Done" : "Create workspace"}
        </Button>
      </DialogFooter>
    </form>
  )
}

/**
 * Creates the workspace first, so a failed logo upload or invite never loses it. Then the logo and the
 * invites follow; anything that failed is said in the dialog, which offers Done instead of a second Create.
 */
export function CreateWorkspaceDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange(open: boolean): void }) {
  const queryClient = useQueryClient()
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const myLimits = useQuery(accountQueries.myLimits())
  const close = () => {
    onOpenChange(false)
    setDone(false)
    setMessage(null)
  }

  const submit = async (input: NewWorkspace) => {
    const created = await api.createWorkspace(input.name, input.slugEdited ? input.slug : undefined)
    // The new workspace is now the current one: everything on screen changes.
    await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth-methods" })
    const problems: string[] = []
    if (input.logo) {
      try {
        const type = input.logo.type as "image/png" | "image/jpeg"
        const { upload, logoId } = await api.logoUploadTarget(created.id, type, input.logo.size)
        const response = await fetch(upload.url, { method: upload.method, headers: upload.headers, body: input.logo })
        if (!response.ok) throw new Error("upload failed")
        await api.confirmLogo(created.id, logoId)
        await queryClient.invalidateQueries({ queryKey: ["workspaces"] })
      } catch {
        problems.push("Workspace created, but the logo didn't upload")
      }
    }
    if (input.emails.length > 0) {
      const problem = await api.invite(created.id, input.emails).then(inviteProblem, inviteProblem)
      if (problem) problems.push(problem)
    }
    if (problems.length === 0) return close()
    setDone(true)
    setMessage(problems.join(". "))
  }

  return (
    <Dialog isOpen={isOpen} onOpenChange={(open) => (open ? onOpenChange(true) : close())} aria-label="Create a workspace" size="lg">
      <CreateWorkspaceForm
        origin={window.location.origin}
        done={done}
        message={message}
        onSubmit={submit}
        onClose={close}
        canInvite={myLimits.data?.canAddMembers === true}
      />
    </Dialog>
  )
}
