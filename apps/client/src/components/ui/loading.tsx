import { Loader } from "@bugberry/ui/loader"

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    // A <div>: Intent's Loader renders a <div> progress bar, which may not sit inside a <p>.
    <div role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader aria-label={label} />
      {label}
    </div>
  )
}

/** A page with nothing else to show yet (sign-in, a share link): the loading sits in the middle of the screen. */
export function PageLoading({ label = "Loading…" }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-dvh items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader aria-label={label} />
      {label}
    </div>
  )
}
