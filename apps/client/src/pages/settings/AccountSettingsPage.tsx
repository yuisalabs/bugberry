import { RiDeleteBinLine, RiLockLine, RiMailLine, RiUploadLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useEffect, useId, useState } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import { FileTrigger } from "@bugberry/ui/file-trigger"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { GithubIcon, GitlabIcon, GoogleIcon } from "../../components/LoginView"
import { Badge, ErrorState } from "../../components/ui"
import {
  SettingRow,
  SettingsCardHeader,
  SettingsPageHeader,
  SettingsSaveBar,
  settingsCard,
  settingsPadding,
} from "../../components/SettingsCard"
import { SettingsPageSkeleton } from "../../components/Skeletons"
import { errorMessage, type SignInMethod } from "../../lib/api"
import { api } from "../../lib/client"
import { initialsOf } from "../../lib/people"
import { queries } from "../../lib/queries"

const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const PHOTO_TYPES = ["image/png", "image/jpeg"]
const PHOTO_RULE = "PNG or JPG, up to 2 MB"
const METHOD_LABELS: Record<SignInMethod, string> = { google: "Google", github: "GitHub", gitlab: "GitLab", email: "Email code" }

/** Each sign-in method's mark, what it is for this person, and how its badge reads. */
function methodDetails(method: SignInMethod, email: string): { icon: ReactNode; detail: string; state: "Connected" | "Enabled" } {
  if (method === "email") return { icon: <RiMailLine className="size-5" />, detail: `A one-time code sent to ${email}`, state: "Enabled" }
  const icon = method === "google" ? <GoogleIcon /> : method === "github" ? <GithubIcon /> : <GitlabIcon />
  return { icon, detail: `Sign in with your ${METHOD_LABELS[method]} account`, state: "Connected" }
}

export function AccountSettingsView({
  me,
  methods,
  busy,
  saved = false,
  onSaveName,
  onUpload,
  onRemovePhoto,
}: {
  me: { id: string; name: string; email: string; image: string | null }
  methods: readonly SignInMethod[]
  busy: boolean
  /** The last name change went through, so the save bar can say so. */
  saved?: boolean
  onSaveName(name: string): void
  onUpload(file: File): Promise<unknown>
  onRemovePhoto(): void
}) {
  const nameLabel = useId()
  const emailLabel = useId()
  const methodsLabel = useId()
  const [name, setName] = useState(me.name)
  useEffect(() => setName(me.name), [me.name])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const trimmed = name.trim()
  const dirty = trimmed !== me.name

  const choose = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) return setPhotoError(PHOTO_RULE)
    setPhotoError(null)
    void onUpload(file)
  }

  return (
    <section className="flex flex-col gap-8">
      <SettingsPageHeader title="Account settings" description="Your personal profile, used across every workspace you're in." />

      <div className="flex max-w-5xl flex-col gap-6">
        <form
          className={settingsCard}
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed && dirty) onSaveName(trimmed)
          }}
        >
          <SettingsCardHeader title="Profile" />

          {/* The photo saves at once; the save bar is for the name. */}
          <SettingRow title="Photo" description={`${PHOTO_RULE}.`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Avatar
                src={me.image}
                initials={initialsOf(me.name)}
                alt=""
                size="xl"
                className={`[--avatar-size:--spacing(16)] text-xl ${me.image ? "" : "bg-primary text-primary-foreground"}`}
              />
              <span className="flex flex-wrap gap-2">
                <FileTrigger acceptedFileTypes={PHOTO_TYPES} onSelect={choose} isDisabled={busy} size="sm" icon={<RiUploadLine aria-hidden />}>
                  Upload photo
                </FileTrigger>
                {me.image && (
                  <Button size="sm" intent="plain" isDisabled={busy} onPress={onRemovePhoto} className="text-danger hover:bg-danger-subtle">
                    <RiDeleteBinLine aria-hidden />
                    Remove
                  </Button>
                )}
              </span>
            </div>
            {photoError && (
              <p role="alert" className="text-sm text-danger-subtle-foreground">
                {photoError}
              </p>
            )}
          </SettingRow>

          <SettingRow id={nameLabel} title="Display name" description="How teammates see you on reports and comments.">
            <TextField aria-labelledby={nameLabel} value={name} maxLength={80} onChange={setName}>
              <Input />
            </TextField>
          </SettingRow>

          <SettingRow id={emailLabel} title="Email" description="Comes from how you sign in, so it can't be changed here.">
            <TextField aria-labelledby={emailLabel} value={me.email} isReadOnly className="relative">
              <Input className="bg-muted pr-10 text-muted-foreground" />
              <RiLockLine aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
            </TextField>
          </SettingRow>

          <SettingsSaveBar dirty={dirty} saved={saved} canSave={!busy && Boolean(trimmed) && dirty} />
        </form>

        <section className={settingsCard}>
          <div className={`flex flex-col gap-1 py-5 ${settingsPadding}`}>
            <h2 id={methodsLabel} className="font-heading text-lg font-semibold text-foreground">
              Sign-in methods
            </h2>
            <p className="text-sm text-muted-foreground">Ways you can get into your BugBerry account.</p>
          </div>
          <ul aria-labelledby={methodsLabel} className="divide-y divide-border border-t border-border">
            {methods.map((method) => {
              const { icon, detail, state } = methodDetails(method, me.email)
              return (
                <li key={method} className={`flex flex-wrap items-center gap-4 py-4 ${settingsPadding}`}>
                  <span aria-hidden className="grid size-11 shrink-0 place-content-center rounded-xl border border-border bg-background text-foreground">
                    {icon}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium text-foreground">{METHOD_LABELS[method]}</span>
                    <span className="truncate text-sm text-muted-foreground">{detail}</span>
                  </span>
                  <Badge className="bg-success-subtle text-success-subtle-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    {state}
                  </Badge>
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </section>
  )
}

/** Anyone signed in: their display name, photo and how they sign in. */
export function AccountSettingsPage() {
  const queryClient = useQueryClient()
  const me = useQuery(queries.me())
  const methods = useQuery({ queryKey: ["sign-in-methods"], queryFn: () => api.signInMethods() })
  // Names and photos show in the menu, members, comments and cards.
  const refresh = () =>
    queryClient.invalidateQueries({
      predicate: (query) => ["me", "members", "workspaces", "reports", "comments"].includes(String(query.queryKey[0])),
    })
  const saveName = useMutation({ mutationFn: (name: string) => api.updateName(name), onSuccess: refresh })
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { upload: target, avatarId } = await api.avatarUploadTarget(file.type as "image/png" | "image/jpeg", file.size)
      const response = await fetch(target.url, { method: target.method, headers: target.headers, body: file })
      if (!response.ok) throw new Error("The photo didn't upload. Try again.")
      return api.confirmAvatar(avatarId)
    },
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: () => api.removeAvatar(), onSuccess: refresh })

  if (me.isPending) return <SettingsPageSkeleton />
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />
  const error = saveName.error ?? upload.error ?? remove.error
  return (
    <>
      <AccountSettingsView
        me={me.data}
        methods={methods.data?.methods ?? []}
        busy={saveName.isPending || upload.isPending || remove.isPending}
        saved={saveName.isSuccess}
        onSaveName={(name) => saveName.mutate(name)}
        onUpload={(file) => upload.mutateAsync(file).catch(() => {})}
        onRemovePhoto={() => remove.mutate()}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}
    </>
  )
}
