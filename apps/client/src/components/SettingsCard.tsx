import type { ReactNode } from "react"
import { Button } from "@bugberry/ui/button"

/** The settings pages' card: General, Joining, Profile, Sign-in methods. */
export const settingsCard = "flex flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xs"
export const settingsPadding = "px-6 sm:px-8"

/** A settings page's title over a line, as Workspace and Account settings open. */
export function SettingsPageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="flex flex-col gap-1 border-b border-border pb-6">
      <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">{title}</h1>
      <p className="text-muted-foreground text-sm">{description}</p>
    </header>
  )
}

export function SettingsCardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className={`flex flex-col gap-1 py-5 ${settingsPadding}`}>
      <h2 className="font-heading text-lg font-semibold text-foreground">{title}</h2>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}

/** One setting: what it is on the left, its control on the right (stacked on phones). `id` labels the control. */
export function SettingRow({ id, title, description, children }: { id?: string; title: string; description: string; children: ReactNode }) {
  return (
    <div className={`grid gap-4 border-t border-border py-6 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10 ${settingsPadding}`}>
      <div className="flex flex-col gap-1">
        <h3 id={id} className="font-medium text-foreground">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2">{children}</div>
    </div>
  )
}

/** The bottom of a settings form: whether anything is unsaved, and Save changes. */
export function SettingsSaveBar({ dirty, saved, canSave }: { dirty: boolean; saved: boolean; canSave: boolean }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/50 py-4 ${settingsPadding}`}>
      <span role="status" className="text-sm text-muted-foreground">
        {dirty ? "Unsaved changes" : saved ? "Saved" : "No unsaved changes"}
      </span>
      <Button type="submit" isDisabled={!canSave}>
        Save changes
      </Button>
    </div>
  )
}
