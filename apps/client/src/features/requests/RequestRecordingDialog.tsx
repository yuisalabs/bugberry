import { RiLinksLine } from "@remixicon/react"
import { Button } from "@bugberry/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { TextField } from "@bugberry/ui/text-field"
import { Textarea } from "@bugberry/ui/textarea"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { CopyButton } from "../../components/ui/copy-button"
import { useNow } from "../../hooks/useNow"
import { qk } from "../../lib/query/keys"
import { errorMessage } from "../../lib/query/unwrap"
import { accountQueries } from "../account/queries"
import { projectQueries } from "../projects/queries"
import { RequestLinkListView } from "./RequestLinkList"
import { createRequest, type NewRequest, requestQueries, revokeRequest } from "./queries"

const NO_PROJECT = "none"
const DAYS = [
  { id: 1, name: "1 day" },
  { id: 7, name: "7 days" },
  { id: 30, name: "30 days" },
] as const
const USES = [
  { id: 1, name: "1 recording" },
  { id: 5, name: "5 recordings" },
  { id: 20, name: "20 recordings" },
] as const

/** What the link asks for: the project it files into, a note, the page, and how long and how often it works. */
export function RequestLinkForm({
  projects,
  defaultProjectId,
  busy,
  error,
  onCreate,
}: {
  projects: readonly { id: string; name: string }[]
  defaultProjectId: string | null
  busy: boolean
  error: string | null
  onCreate(input: Omit<NewRequest, "workspaceId">): void
}) {
  const [projectId, setProjectId] = useState<string | null>(defaultProjectId)
  const [note, setNote] = useState("")
  const [pageUrl, setPageUrl] = useState("")
  const [expiresInDays, setExpiresInDays] = useState<NewRequest["expiresInDays"]>(7)
  const [maxUses, setMaxUses] = useState<NewRequest["maxUses"]>(5)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onCreate({ projectId, note, pageUrl, expiresInDays, maxUses })
      }}
    >
      <p className="text-sm text-muted-foreground">
        Send this link to someone outside the team. They record their screen or take a screenshot in their browser, with no account and no
        extension, and it arrives here as a report. It isn't sent to trackers until someone on the team does it.
      </p>
      <Select selectedKey={projectId ?? NO_PROJECT} onSelectionChange={(key) => setProjectId(key === null || key === NO_PROJECT ? null : String(key))}>
        <Label>Project</Label>
        <SelectTrigger />
        <SelectContent items={[{ id: NO_PROJECT, name: "No project" }, ...projects]}>
          {(project) => <SelectItem id={project.id}>{project.name}</SelectItem>}
        </SelectContent>
      </Select>
      <TextField value={note} onChange={setNote} maxLength={500}>
        <Label>Note for them</Label>
        <Textarea rows={3} placeholder="The checkout button does nothing for you. Could you record it?" />
        <Description>They read it when they open the link.</Description>
      </TextField>
      <TextField value={pageUrl} onChange={setPageUrl} maxLength={2048} type="url">
        <Label>Page address</Label>
        <Input placeholder="https://" />
        <Description>Optional. The page you want them to record.</Description>
      </TextField>
      <div className="grid gap-4 sm:grid-cols-2">
        <Select selectedKey={expiresInDays} onSelectionChange={(key) => key !== null && setExpiresInDays(Number(key) as NewRequest["expiresInDays"])}>
          <Label>Works for</Label>
          <SelectTrigger />
          <SelectContent items={DAYS}>{(option) => <SelectItem id={option.id}>{option.name}</SelectItem>}</SelectContent>
        </Select>
        <Select selectedKey={maxUses} onSelectionChange={(key) => key !== null && setMaxUses(Number(key) as NewRequest["maxUses"])}>
          <Label>Takes</Label>
          <SelectTrigger />
          <SelectContent items={USES}>{(option) => <SelectItem id={option.id}>{option.name}</SelectItem>}</SelectContent>
        </Select>
      </div>
      <Button type="submit" className="self-start" isDisabled={busy}>
        {busy ? "Creating…" : "Create link"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
    </form>
  )
}

/** The new link, shown this once: the server keeps only its hash. */
export function MadeLink({ url, onDone }: { url: string; onDone(): void }) {
  return (
    <div className="flex flex-col gap-3">
      <TextField value={url} isReadOnly>
        <Label>Link</Label>
        <Input className="font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
      </TextField>
      <p className="text-sm text-foreground">Copy it now. For safety, BugBerry can't show this link again.</p>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={url} label="Copy" />
        <Button intent="plain" size="sm" onPress={onDone}>
          Done
        </Button>
      </div>
    </div>
  )
}

/** "Request a recording": make a link for someone without an account, and see the workspace's links. */
export function RequestRecordingDialog({
  workspaceId,
  projectId,
  isAdmin,
  isOpen,
  onOpenChange,
}: {
  workspaceId: string
  projectId: string | null
  isAdmin: boolean
  isOpen: boolean
  onOpenChange(open: boolean): void
}) {
  const now = useNow()
  const queryClient = useQueryClient()
  const me = useQuery(accountQueries.me())
  const projects = useQuery({ ...projectQueries.projects(workspaceId), enabled: isOpen })
  const links = useQuery({ ...requestQueries.list(workspaceId), enabled: isOpen })
  const [made, setMade] = useState<string | null>(null)
  const refresh = () => void queryClient.invalidateQueries({ queryKey: qk.recordingRequests(workspaceId) })
  const create = useMutation({
    mutationFn: (input: Omit<NewRequest, "workspaceId">) => createRequest({ ...input, workspaceId }),
    onSuccess: (answer) => {
      setMade(answer.url)
      refresh()
    },
  })
  const revoke = useMutation({ mutationFn: revokeRequest, onSettled: refresh })
  const close = (open: boolean) => {
    if (!open) {
      setMade(null)
      create.reset()
    }
    onOpenChange(open)
  }
  return (
    <Dialog isOpen={isOpen} onOpenChange={close} aria-label="Request a recording" size="lg">
      <DialogHeader>
        <DialogTitle>Request a recording</DialogTitle>
      </DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-6">
          {made ? (
            <MadeLink url={made} onDone={() => setMade(null)} />
          ) : (
            <RequestLinkForm
              projects={projects.data ?? []}
              defaultProjectId={projectId}
              busy={create.isPending}
              error={create.error ? errorMessage(create.error) : null}
              onCreate={(input) => create.mutate(input)}
            />
          )}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-foreground">Links in this workspace</h3>
            <RequestLinkListView
              items={links.data ?? []}
              projects={projects.data ?? []}
              now={now}
              me={me.data?.id ?? ""}
              isAdmin={isAdmin}
              onRevoke={(id) => revoke.mutate(id)}
            />
          </section>
        </div>
      </DialogBody>
    </Dialog>
  )
}

/** The button beside New report that opens the dialog. */
export function RequestRecordingButton(props: { workspaceId: string; projectId: string | null; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button intent="outline" size="sm" aria-label="Request a recording" onPress={() => setOpen(true)}>
        <RiLinksLine aria-hidden />
        <span className="hidden sm:inline">Request a recording</span>
      </Button>
      <RequestRecordingDialog {...props} isOpen={open} onOpenChange={setOpen} />
    </>
  )
}
