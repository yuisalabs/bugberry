import type { IntegrationProvider } from "@bugberry/shared"
import { RiAddLine } from "@remixicon/react"
import { Button } from "@bugberry/ui/button"
import { ProviderMark } from "./IntegrationForm"

/** The pieces the workspace's and a project's Integrations pages share. */

export const integrationCard = "rounded-3xl border border-border bg-background"
// The pages' add buttons: soft grey with a thin outline, so a row of them doesn't shout; a little darker on hover.
export const softButton = "border border-border bg-muted text-muted-foreground hover:border-muted-foreground/30 hover:bg-secondary hover:text-foreground"

/** A small uppercase title over a group of connections, with how many it holds. */
export function GroupTitle({ title, count }: { title: string; count: number }) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
      {title}
      <span className="font-medium">{count}</span>
    </h2>
  )
}

/** "Connected" in green, or "Failing" in red when the last messages didn't go through. */
export function StatusChip({ failing }: { failing: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
        failing ? "bg-danger-subtle text-danger-subtle-foreground" : "bg-success-subtle text-success-subtle-foreground"
      }`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${failing ? "bg-danger" : "bg-success"}`} />
      {failing ? "Failing" : "Connected"}
    </span>
  )
}

/** A group with nothing connected yet: its providers' marks, what it is for, and a way to add one. */
export function EmptyGroup({
  providers,
  title,
  text,
  action,
  onPick,
}: {
  providers: readonly IntegrationProvider[]
  title: string
  text: string
  action: string
  onPick(): void
}) {
  return (
    <div className={`flex flex-wrap items-center gap-4 border-dashed px-6 py-5 ${integrationCard}`}>
      <span aria-hidden className="flex -space-x-4.5">
        {providers.map((provider) => (
          <span key={provider} className="rounded-full bg-background p-0.5">
            <ProviderMark provider={provider} className="size-9 rounded-full" />
          </span>
        ))}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold text-foreground">{title}</span>
        <span className="text-sm text-muted-foreground">{text}</span>
      </div>
      <Button intent="plain" onPress={onPick} className={softButton}>
        <RiAddLine aria-hidden />
        {action}
      </Button>
    </div>
  )
}
