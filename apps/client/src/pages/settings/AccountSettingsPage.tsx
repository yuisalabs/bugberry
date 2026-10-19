import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import { Description, Label } from "@bugberry/ui/field"
import { FileTrigger } from "@bugberry/ui/file-trigger"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { ErrorState, Loading } from "../../components/ui"
import { errorMessage, type SignInMethod } from "../../lib/api"
import { api } from "../../lib/client"
import { initialsOf } from "../../lib/people"
import { queries } from "../../lib/queries"

const MAX_PHOTO_BYTES = 2 * 1024 * 1024
const PHOTO_TYPES = ["image/png", "image/jpeg"]
const PHOTO_RULE = "PNG or JPG, up to 2 MB"
const METHOD_LABELS: Record<SignInMethod, string> = { google: "Google", github: "GitHub", gitlab: "GitLab", email: "Email code" }

export function AccountSettingsView({
  me,
  methods,
  busy,
  onSaveName,
  onUpload,
  onRemovePhoto,
}: {
  me: { id: string; name: string; email: string; image: string | null }
  methods: readonly SignInMethod[]
  busy: boolean
  onSaveName(name: string): void
  onUpload(file: File): Promise<unknown>
  onRemovePhoto(): void
}) {
  const [name, setName] = useState(me.name)
  useEffect(() => setName(me.name), [me.name])
  const [photoError, setPhotoError] = useState<string | null>(null)
  const trimmed = name.trim()

  const choose = (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    if (!PHOTO_TYPES.includes(file.type) || file.size > MAX_PHOTO_BYTES) return setPhotoError(PHOTO_RULE)
    setPhotoError(null)
    void onUpload(file)
  }

  return (
    <section className="flex max-w-xl flex-col gap-6">
      <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground">Account settings</h1>

      <div className="flex flex-wrap items-center gap-3">
        <Avatar src={me.image} initials={initialsOf(me.name)} alt="" size="xl" className="bg-primary-subtle text-primary" />
        <FileTrigger acceptedFileTypes={PHOTO_TYPES} onSelect={choose} isDisabled={busy} size="sm">
          Upload photo
        </FileTrigger>
        {me.image && (
          <Button size="sm" intent="outline" isDisabled={busy} onPress={onRemovePhoto}>
            Remove
          </Button>
        )}
        <span className="text-xs text-muted-foreground">{PHOTO_RULE}</span>
        {photoError && (
          <p role="alert" className="w-full text-sm text-danger-subtle-foreground">
            {photoError}
          </p>
        )}
      </div>

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(event) => {
          event.preventDefault()
          if (trimmed) onSaveName(trimmed)
        }}
      >
        <TextField value={name} maxLength={80} onChange={setName}>
          <Label>Display name</Label>
          <div className="flex gap-2">
            <Input />
            <Button size="sm" type="submit" isDisabled={busy || !trimmed || trimmed === me.name}>
              Save
            </Button>
          </div>
        </TextField>
      </form>

      <TextField value={me.email} isReadOnly>
        <Label>Email</Label>
        <Input className="text-muted-foreground" />
        <Description className="text-xs">Your email comes from how you sign in and can't be changed here.</Description>
      </TextField>

      <div className="flex flex-col gap-1.5">
        <h2 id="sign-in-methods" className="text-sm font-medium text-foreground">
          Sign-in methods
        </h2>
        <ul aria-labelledby="sign-in-methods" className="divide-y divide-border rounded-lg border border-border bg-background">
          {methods.map((method) => (
            <li key={method} className="px-3 py-2 text-sm text-foreground">
              {METHOD_LABELS[method]}
            </li>
          ))}
        </ul>
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

  if (me.isPending) return <Loading />
  if (me.isError) return <ErrorState error={me.error} onRetry={() => void me.refetch()} />
  const error = saveName.error ?? upload.error ?? remove.error
  return (
    <>
      <AccountSettingsView
        me={me.data}
        methods={methods.data?.methods ?? []}
        busy={saveName.isPending || upload.isPending || remove.isPending}
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
