import { RiAddLine } from "@remixicon/react"
import { Button as AriaButton } from "react-aria-components"

/** The last tile of the grid: a dashed card that starts a new project. */
export function NewProjectTile({ onPress }: { onPress(): void }) {
  return (
    <li className="flex">
      <AriaButton
        onPress={onPress}
        className="flex min-h-64 w-full flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-border bg-transparent p-6 text-center outline-hidden transition border-primary/40 hover:bg-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="mb-2 grid size-12 place-content-center rounded-full bg-primary-subtle text-primary">
          <RiAddLine className="size-6" />
        </span>
        <span className="font-heading text-lg font-semibold text-foreground">New project</span>
        <span className="text-sm text-muted-foreground">Group reports by site or app</span>
      </AriaButton>
    </li>
  )
}
