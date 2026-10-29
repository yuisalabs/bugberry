import { RiFileCopyLine, RiInformationLine, RiRefreshLine, RiSettings3Line, RiUserAddLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type FormEvent, useEffect, useId, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Input } from "@bugberry/ui/input"
import { Radio, RadioField, RadioGroup } from "@bugberry/ui/radio"
import { Switch, SwitchField } from "@bugberry/ui/switch"
import { TextField } from "@bugberry/ui/text-field"
import { BrandedHeader } from "../../components/BrandedHeader"
import { SettingsTabs } from "../../components/SettingsTabs"
import { LOGO_RULE, LogoPicker } from "../../components/LogoPicker"
import {
  SettingRow,
  SettingsCardHeader,
  SettingsSaveBar,
  settingsCard,
  settingsPadding,
} from "../../components/SettingsCard"
import type { WorkspaceAccess } from "../../lib/api"
import { api } from "../../lib/client"
import { queries } from "../../lib/queries"
import { toast } from "../../lib/toast"
import { useCurrentWorkspace } from "../../lib/workspace"
import { type SlugAnswer, useSlugCheck } from "../../lib/workspace-slug"
import { errorMessage } from "../../lib/query/unwrap"
import { accountQueries } from "../../features/account/queries"

type Settings = { id: string; name: string; slug: string; logoUrl: string | null }

/** Name, short URL and logo of the current workspace. Saving sends only what changed; the logo saves at once. */
export function WorkspaceSettingsView({
  workspace,
  origin,
  busy,
  saved = false,
  onSave,
  onLogo,
  onRemoveLogo,
  check,
  measure,
}: {
  workspace: Settings
  origin: string
  busy: boolean
  /** The last save went through, so the footer can say so until something changes again. */
  saved?: boolean
  onSave(patch: { name?: string; slug?: string }): void
  onLogo(file: File): void
  onRemoveLogo(): void
  check?: (query: { name?: string; slug?: string; except?: string }) => Promise<SlugAnswer>
  measure?: (file: File) => Promise<{ width: number; height: number }>
}) {
  const nameLabel = useId()
  const urlLabel = useId()
  const [name, setName] = useState(workspace.name)
  const [slug, setSlug] = useState(workspace.slug)
  useEffect(() => setName(workspace.name), [workspace.name])
  useEffect(() => setSlug(workspace.slug), [workspace.slug])
  const url = useSlugCheck({ name: workspace.name, slug, edited: true, except: workspace.id }, check)
  const nameChanged = name.trim() !== workspace.name
  const slugChanged = slug !== workspace.slug
  const slugOk = !slugChanged || url.status === "available"
  const dirty = nameChanged || slugChanged
  const canSave = !busy && Boolean(name.trim()) && dirty && slugOk

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
    <form onSubmit={save} className={settingsCard}>
      <SettingsCardHeader title="General" />

      <SettingRow title="Logo" description={`${LOGO_RULE}.`}>
        <LogoPicker
          file={null}
          current={workspace.logoUrl}
          name={workspace.name}
          onChange={onLogo}
          measure={measure}
          large
          hint={workspace.logoUrl ? "Upload another to replace it everywhere." : "Upload a logo to replace it everywhere."}
          actions={
            workspace.logoUrl && (
              <Button size="sm" intent="plain" isDisabled={busy} onPress={onRemoveLogo}>
                Remove logo
              </Button>
            )
          }
        />
      </SettingRow>

      <SettingRow id={nameLabel} title="Name" description="Shown in the top bar and on invites.">
        <TextField aria-labelledby={nameLabel} value={name} onChange={setName} maxLength={80}>
          <Input />
        </TextField>
      </SettingRow>

      <SettingRow id={urlLabel} title="Workspace URL" description="Changing it breaks old links to this workspace.">
        {/* On phones the address sits above the field, so the slug gets the whole box. */}
        <span className="text-xs text-muted-foreground sm:hidden">{`${new URL(origin).host}/`}</span>
        <TextField aria-labelledby={urlLabel} value={slug} maxLength={40} onChange={(value) => setSlug(value.toLowerCase())}>
          {/* The host sits in front of the slug as a fixed part of the same box. */}
          <span
            data-slot="control"
            className="flex items-stretch overflow-hidden rounded-lg border border-input focus-within:border-ring/70 focus-within:ring-3 focus-within:ring-ring/20"
          >
            <span className="hidden shrink-0 items-center border-r border-input bg-muted px-3 text-sm text-muted-foreground sm:flex">
              {`${new URL(origin).host}/`}
            </span>
            <Input className="rounded-none border-0 focus:ring-0" />
          </span>
        </TextField>
        {status && (
          <span className={`text-xs font-medium ${status === "Available" ? "text-success-subtle-foreground" : "text-danger-subtle-foreground"}`}>
            {status}
          </span>
        )}
      </SettingRow>

      <SettingsSaveBar dirty={dirty} saved={saved} canSave={canSave} />
    </form>
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
  emailDomain = null,
}: {
  access: WorkspaceAccess
  origin: string
  busy: boolean
  onShareLink(action: "on" | "off" | "reset"): void
  onDomain(patch: { joinDomain?: string | null; joinMode?: "direct" | "approval" }): void
  /** False under ACCOUNT_LIMITS: nothing can be turned on, but a way in already open can be closed. */
  membersAllowed?: boolean
  /** The domain of my own email, to name it when it can't be used (gmail.com). */
  emailDomain?: string | null
}) {
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
    <section className={settingsCard}>
      <SettingsCardHeader title="Joining" description="Choose how new people can get into this workspace." />

      {!membersAllowed && (
        <p className={`border-t border-border py-4 text-sm text-muted-foreground ${settingsPadding}`}>Inviting teammates isn't available on this account.</p>
      )}

      <SettingRow title="Invite link" description="Anyone signed in with the link or code joins as a Member.">
        {membersAllowed || link ? (
          <div className="flex items-center justify-between gap-4">
            <div className="flex flex-col">
              <span className="font-medium text-foreground">{link ? "On" : "Off"}</span>
              <span className="text-sm text-muted-foreground">
                {link ? "Share it with anyone who should join." : "Turn it on to get a shareable link."}
              </span>
            </div>
            {membersAllowed ? (
              <SwitchField aria-label="Invite link" isSelected={Boolean(link)} isDisabled={busy} onChange={() => onShareLink(link ? "off" : "on")}>
                <Switch />
              </SwitchField>
            ) : (
              <Button size="sm" intent="outline" isDisabled={busy} onPress={() => onShareLink("off")}>
                Turn off invite link
              </Button>
            )}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Off</span>
        )}
        {link && membersAllowed && (
          <div className="flex flex-wrap items-center gap-2">
            {/* A line of its own on phones, with Copy and Reset under it. */}
            <code className="w-full min-w-0 truncate rounded-lg border border-border bg-muted px-3 py-2 font-mono text-sm text-foreground sm:w-auto sm:flex-1">
              {link}
            </code>
            <Button size="sm" intent="outline" isDisabled={busy} onPress={() => void copy()}>
              <RiFileCopyLine aria-hidden />
              Copy
            </Button>
            <Button size="sm" intent="plain" isDisabled={busy} onPress={() => onShareLink("reset")}>
              <RiRefreshLine aria-hidden />
              Reset
            </Button>
          </div>
        )}
      </SettingRow>

      <SettingRow title="Join by email domain" description="People with a matching work email can join without an invite.">
        {!membersAllowed ? (
          access.joinDomain ? (
            <Button size="sm" intent="outline" className="self-start" isDisabled={busy} onPress={() => onDomain({ joinDomain: null })}>
              Turn off joining by email domain
            </Button>
          ) : (
            <span className="text-sm text-muted-foreground">Off</span>
          )
        ) : domain ? (
          <>
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col">
                <span className="font-medium text-foreground">@{domain}</span>
                <span className="text-sm text-muted-foreground">
                  {access.joinDomain !== null ? "On" : "Off"}
                </span>
              </div>
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
          <div className="flex items-start gap-3 rounded-xl bg-muted px-4 py-3">
            <RiInformationLine aria-hidden className="mt-0.5 size-4.5 shrink-0 text-muted-foreground" />
            <div className="flex flex-col">
              <span className="text-sm font-medium text-foreground">Not available for {emailDomain ?? "your email"}</span>
              <span className="text-sm text-muted-foreground">Public email domains can't be used. Sign in with a company email to turn this on.</span>
            </div>
          </div>
        )}
      </SettingRow>
    </section>
  )
}

/** The access settings wired to the API. */
function WorkspaceAccessSection({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const me = useQuery(accountQueries.me())
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
        emailDomain={me.data?.email.split("@")[1] ?? null}
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
    <section className="flex flex-col gap-8">
      <BrandedHeader title="Workspace settings" description={`Manage how ${workspace.name} looks and who can join.`} />
      <SettingsTabs
        label="Workspace settings"
        sections={[
          {
            id: "general",
            label: "General",
            icon: RiSettings3Line,
            panel: (
              <>
                {error && (
                  <p role="alert" className="text-sm text-danger-subtle-foreground">
                    {errorMessage(error)}
                  </p>
                )}
                <WorkspaceSettingsView
                  workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug, logoUrl: workspace.logoUrl ?? null }}
                  origin={window.location.origin}
                  busy={save.isPending || upload.isPending || remove.isPending}
                  saved={save.isSuccess}
                  onSave={(patch) => save.mutate(patch)}
                  onLogo={(file) => upload.mutate(file)}
                  onRemoveLogo={() => remove.mutate()}
                />
              </>
            ),
          },
          { id: "joining", label: "Joining", icon: RiUserAddLine, panel: <WorkspaceAccessSection workspaceId={workspace.id} /> },
        ]}
      />
    </section>
  )
}
