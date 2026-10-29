import type { ReactNode } from "react"

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center">
      <p className="font-medium text-foreground">{title}</p>
      {children && <div className="text-sm text-muted-foreground">{children}</div>}
    </div>
  )
}
