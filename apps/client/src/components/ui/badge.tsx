import type { ReactNode } from "react"

export function Badge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-x-1.5 rounded-full px-2 py-px text-xs/5 font-medium ${className}`}>
      {children}
    </span>
  )
}
