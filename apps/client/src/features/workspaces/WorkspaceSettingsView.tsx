import { type FormEvent, useEffect, useId, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { LOGO_RULE, LogoPicker } from "./LogoPicker"
import { SettingRow, SettingsCardHeader, SettingsSaveBar, settingsCard } from "../../components/SettingsCard"
import { type SlugAnswer, useSlugCheck } from "./workspace-slug"

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
