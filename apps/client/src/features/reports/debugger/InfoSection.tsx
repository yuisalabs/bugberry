import type { ReactNode } from "react"

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        {title}
        {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground">{count}</span>}
      </h3>
      {children}
    </section>
  )
}
