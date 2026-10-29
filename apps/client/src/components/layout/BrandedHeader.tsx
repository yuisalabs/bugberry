import type { ReactNode } from "react"
import { BugBerryLogo } from "./BugBerryLogo"

/** A page's opening as All reports has it: the logo, a line, the title with one line under it, and an action on the right. */
export function BrandedHeader({ title, description, action }: { title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
      <div className="flex min-w-0 items-center gap-5">
        <span className="hidden shrink-0 border-r border-border pr-5 md:inline-flex">
          <BugBerryLogo className="h-9" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-heading text-xl font-bold tracking-tight text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {action}
    </header>
  )
}
