import { RiCheckLine, RiFileCopyLine } from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Loader } from "@bugberry/ui/loader"
import { errorMessage } from "../lib/query/unwrap"

/**
 * A plain button for a destructive action (Remove, Revoke, Delete): red text and a red icon. Intent's button colours
 * its icon on its own (--btn-icon, and --btn-icon-active on hover), so the text colour alone left the icon grey.
 */
export const dangerText =
  "text-danger hover:bg-danger-subtle [--btn-icon:var(--color-danger)] [--btn-icon-active:var(--color-danger)]"

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-x-1.5 rounded-full px-2 py-px text-xs/5 font-medium ${className}`}>
      {children}
    </span>
  )
}

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

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-danger-subtle-foreground/20 bg-danger-subtle p-4 text-sm text-danger-subtle-foreground"
    >
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <Button intent="outline" size="sm" onPress={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

export function CopyButton({ text, label, className }: { text: string; label: string; className?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState("copied")
    } catch {
      setState("failed")
    }
    setTimeout(() => setState("idle"), 2000)
  }
  return (
    <Button intent="outline" size="sm" onPress={() => void copy()} className={className}>
      {state === "copied" ? <RiCheckLine aria-hidden /> : <RiFileCopyLine aria-hidden />}
      {state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : label}
    </Button>
  )
}
