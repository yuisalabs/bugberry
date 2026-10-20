import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Radio, RadioField, RadioGroup } from "@bugberry/ui/radio"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { TextField } from "@bugberry/ui/text-field"
import { LogoPicker } from "../../components/LogoPicker"
import { PageHeader } from "../../components/ui"
import { errorMessage, type WorkspaceAccess } from "../../lib/api"
import { api } from "../../lib/client"
import { queries } from "../../lib/queries"
import { toast } from "../../lib/toast"
import { useCurrentWorkspace } from "../../lib/workspace"
import { type SlugAnswer, useSlugCheck } from "../../lib/workspace-slug"

type Settings = { id: string; name: string; slug: string; logoUrl: string | null }

/** Name, short URL and logo of the current workspace. Saving sends only what changed. */
export function WorkspaceSettingsView({
  workspace,
  origin,
  busy,
  onSave,
  onLogo,
  onRemoveLogo,
  check,
  measure,
}: {
  workspace: Settings
  origin: string
  busy: boolean
  onSave(patch: { name?: string; slug?: string }): void
  onLogo(file: File): void
  onRemoveLogo(): void
  check?: (query: { name?: string; slug?: string; except?: string }) => Promise<SlugAnswer>
  measure?: (file: File) => Promise<{ width: number; height: number }>
}) {
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  useEffect(() => setName(workspace.name), [workspace.name])
  useEffect(() => setSlug(workspace.slug), [workspace.slug])
  const url = useSlugCheck({ name: workspace.name, slug, edited: true, except: workspace.id }, check)
  const nameChanged = name.trim() !== workspace.name
  const slugChanged = slug !== workspace.slug
  const slugOk = !slugChanged || url.status === "available"
  const canSave = !busy && Boolean(name.trim()) && (nameChanged || slugChanged) && slugOk

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    onSave({ ...(nameChanged ? { name: name.trim() } : {}), ...(slugChanged ? { slug } : {}) })
  }

  const status =
    !slugChanged || url.status === "checking"
      ? null
      : url.status === "available"
        ? "Available"
        : url.status === "taken"
          ? "Taken"
          : url.status === "reserved"
            ? "This URL is reserved"
            : "Use 3–40 lowercase letters, numbers or dashes"

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={save} className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
        <TextField value={name} onChange={setName} maxLength={80}>
          <Label>Name</Label>
          <Input />
        </TextField>
        <TextField value={slug} maxLength={40} onChange={(value) => setSlug(value.toLowerCase())}>
          <Label>Workspace URL</Label>
          {/* The host stays in front of the slug, inside the same box. */}
          <span
            data-slot="control"
            className="flex items-center gap-2 rounded-lg border border-input px-3 focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20"
          >
            <span className="shrink-0 font-mono text-xs text-muted-foreground">{`${new URL(origin).host}/`}</span>
            <Input className="border-0 px-0 font-mono focus:ring-0 sm:px-0" />
            {status && (
              <span
                className={`shrink-0 text-xs font-medium ${status === "Available" ? "text-success-subtle-foreground" : "text-danger-subtle-foreground"}`}
              >
                {status}
              </span>
            )}
          </span>
        </TextField>
        <Button size="sm" type="submit" className="self-start" isDisabled={!canSave}>
          Save
        </Button>
      </form>

      <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
        <span className="text-sm font-medium">Logo</span>
        <LogoPicker file={null} current={workspace.logoUrl} name={workspace.name} onChange={onLogo} measure={measure} />
        {workspace.logoUrl && (
          <Button size="sm" intent="outline" className="self-start" isDisabled={busy} onPress={onRemoveLogo}>
            Remove logo
          </Button>
        )}
      </div>
    </div>
  )
}

const MODES = [
  { id: "direct", label: "Join directly" },
  { id: "approval", label: "Ask an admin" },
] as const

/** Who can join without a personal invite: the shared invite link, and people with the admin's email domain. */
export function WorkspaceAccessView({
  access,
  origin,
  busy,
  onShareLink,
  onDomain,
  membersAllowed = true,
}: {
  access: WorkspaceAccess
  origin: string
  busy: boolean
  onShareLink(action: "on" | "off" | "reset"): void
  onDomain(patch: { joinDomain?: string | null; joinMode?: "direct" | "approval" }): void
  /** False under ACCOUNT_LIMITS: nothing can be turned on, but a way in already open can be closed. */
  membersAllowed?: boolean
}) {
  if (!membersAllowed) {
    return (
      <section className="flex flex-col items-start gap-2 rounded-lg border border-border bg-background p-4">
        <p className="text-sm text-muted-foreground">Inviting teammates isn't available on this account.</p>
        {access.shareCode && (
          <Button size="sm" intent="outline" isDisabled={busy} onPress={() => onShareLink("off")}>
            Turn off invite link
          </Button>
        )}
        {access.joinDomain && (
          <Button size="sm" intent="outline" isDisabled={busy} onPress={() => onDomain({ joinDomain: null })}>
            Turn off joining by email domain
          </Button>
        )}
      </section>
    )
  }
  // The stored domain when there is one (it may be another admin's), else the domain I could turn on.
  const domain = access.joinDomain ?? access.ownDomain
  const link = access.shareCode ? `${new URL(origin).host}/join/${access.shareCode}` : null
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/join/${access.shareCode}`)
      toast({ title: "Link copied" })
    } catch {
      toast({ title: "Couldn't copy the link", tone: "error" })
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Invite link</h2>
          <SwitchField aria-label="Invite link" isSelected={Boolean(link)} isDisabled={busy} onChange={() => onShareLink(link ? "off" : "on")}>
            <Switch />
          </SwitchField>
        </div>
        <p className="text-xs text-muted-foreground">Anyone signed in with the link or code joins as a Member.</p>
        {link && (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-xs">{link}</code>
            <Button size="sm" intent="outline" isDisabled={busy} onPress={() => void copy()}>
              Copy
            </Button>
            <Button size="sm" intent="plain" isDisabled={busy} onPress={() => onShareLink("reset")}>
              Reset
            </Button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-background p-4">
        <h2 className="text-sm font-medium">Join by email domain</h2>
        {domain ? (
          <>
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{`Let people with @${domain} join`}</span>
              <SwitchField
                aria-label={`Let people with @${domain} join`}
                isSelected={access.joinDomain !== null}
                isDisabled={busy}
                onChange={() => onDomain(access.joinDomain !== null ? { joinDomain: null } : { joinDomain: domain, joinMode: "approval" })}
              >
                <Switch />
              </SwitchField>
            </div>
            {access.joinDomain !== null && (
              <RadioGroup
                aria-label="How they join"
                orientation="horizontal"
                value={access.joinMode}
                isDisabled={busy}
                onChange={(value) => onDomain({ joinMode: value === "direct" ? "direct" : "approval" })}
                className="flex flex-wrap gap-4 space-y-0"
              >
                {MODES.map((mode) => (
                  <RadioField key={mode.id} value={mode.id}>
                    <Radio>{mode.label}</Radio>
                  </RadioField>
                ))}
              </RadioGroup>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Your email domain can't be used for this</p>
        )}
      </section>
    </div>
  )
}

/** The access settings wired to the API. */
function WorkspaceAccessSection({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const access = useQuery(queries.workspaceAccess(workspaceId))
  const limits = useQuery(queries.workspaceLimits(workspaceId))
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof api.updateWorkspaceAccess>[1]) => api.updateWorkspaceAccess(workspaceId, patch),
    onSuccess: (next) => queryClient.setQueryData(queries.workspaceAccess(workspaceId).queryKey, next),
  })
  // Nothing until both are known, so a limited workspace never flashes controls that would be refused.
  if (!access.data || !limits.data) return null
  return (
    <>
      <WorkspaceAccessView
        access={access.data}
        origin={window.location.origin}
        busy={update.isPending}
        onShareLink={(action) => update.mutate({ shareLink: action })}
        onDomain={(patch) => update.mutate(patch)}
        membersAllowed={!limits.data.limited}
      />
      {update.error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(update.error)}
        </p>
      )}
    </>
  )
}

/** Admins only (the route checks). */
export function WorkspaceSettingsPage() {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["workspaces"] })
  const id = workspace?.id ?? ""
  const save = useMutation({ mutationFn: (patch: { name?: string; slug?: string }) => api.updateWorkspace(id, patch), onSuccess: refresh })
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { upload: target, logoId } = await api.logoUploadTarget(id, file.type as "image/png" | "image/jpeg", file.size)
      const response = await fetch(target.url, { method: target.method, headers: target.headers, body: file })
      if (!response.ok) throw new Error("The logo didn't upload. Try again.")
      return api.confirmLogo(id, logoId)
    },
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: () => api.removeLogo(id), onSuccess: refresh })

  if (!workspace) return null
  const error = save.error ?? upload.error ?? remove.error
  return (
    <section className="flex max-w-xl flex-col gap-4">
      <PageHeader title="Workspace" />
      <WorkspaceSettingsView
        workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug, logoUrl: workspace.logoUrl ?? null }}
        origin={window.location.origin}
        busy={save.isPending || upload.isPending || remove.isPending}
        onSave={(patch) => save.mutate(patch)}
        onLogo={(file) => upload.mutate(file)}
        onRemoveLogo={() => remove.mutate()}
      />
      <WorkspaceAccessSection workspaceId={workspace.id} />
      {save.isSuccess && (
        <p role="status" className="text-sm text-muted-foreground">
          Saved
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}
    </section>
  )
}
