import { RiAddLine, RiCloseLine, RiLinkM } from "@remixicon/react"
import { type FormEvent, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { GithubIcon, GitlabIcon } from "../../auth/LoginView"
import type { ReportFix } from "../queries"

function ProviderIcon({ provider }: { provider: ReportFix["provider"] }) {
  // The sign-in marks are drawn at size-5; the row's icons are a step smaller.
  const mark = provider === "github" ? <GithubIcon /> : provider === "gitlab" ? <GitlabIcon /> : null
  if (!mark) return <RiLinkM aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  return <span className="flex shrink-0 text-foreground [&_svg]:size-4">{mark}</span>
}

/**
 * The sidebar's "Fixed in" row: the PRs, merge requests and commits that fixed the report. Shows nothing when there
 * are no links and no way to add one (the share page).
 */
export function FixedInRow({
  fixes,
  onAdd,
  onRemove,
  adding: startAdding = false,
  saving = false,
  error = null,
}: {
  fixes: ReportFix[]
  /** Settles when the link is saved; a rejection keeps the field open with `error` under it. */
  onAdd?(url: string): Promise<unknown> | void
  onRemove?(fixId: string): void
  /** Open with the URL field showing. */
  adding?: boolean
  saving?: boolean
  error?: string | null
}) {
  const [adding, setAdding] = useState(startAdding)
  const [url, setUrl] = useState("")
  if (fixes.length === 0 && !onAdd) return null

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const value = url.trim()
    if (!value || !onAdd) return
    try {
      await onAdd(value)
      setUrl("")
      setAdding(false)
    } catch {
      // The page shows the server's message through `error`.
    }
  }

  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] items-start gap-3 text-sm">
      <span className="pt-1.5 text-muted-foreground">Fixed in</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        {fixes.map((fix) => (
          <div key={fix.id} className="group flex min-w-0 items-center gap-2">
            <ProviderIcon provider={fix.provider} />
            <a
              href={fix.url}
              target="_blank"
              rel="noopener noreferrer"
              title={fix.url}
              className="min-w-0 truncate py-1 font-medium text-foreground hover:underline"
            >
              {fix.label}
            </a>
            {onRemove && (
              <Button
                intent="plain"
                size="sq-xs"
                aria-label={`Remove ${fix.label}`}
                className="ml-auto shrink-0 text-muted-foreground"
                onPress={() => onRemove(fix.id)}
              >
                <RiCloseLine aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {onAdd &&
          (adding ? (
            <form onSubmit={(event) => void save(event)} className="flex flex-col gap-1.5">
              <TextField aria-label="Fix link URL" value={url} onChange={setUrl} autoFocus isDisabled={saving}>
                <Input placeholder="https://github.com/org/repo/pull/42" className="h-9" />
              </TextField>
              {error && (
                <p role="alert" className="text-xs text-danger-subtle-foreground">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" size="sm" isPending={saving} isDisabled={!url.trim()}>
                  Save
                </Button>
                <Button
                  intent="plain"
                  size="sm"
                  onPress={() => {
                    setAdding(false)
                    setUrl("")
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          ) : (
            <Button intent="plain" size="sm" aria-label="Add fix link" className="self-start text-muted-foreground" onPress={() => setAdding(true)}>
              <RiAddLine aria-hidden data-slot="icon" />
              Add link
            </Button>
          ))}
      </div>
    </div>
  )
}
