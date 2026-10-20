import type { ReactNode } from "react"
import { Skeleton } from "@bugberry/ui/skeleton"
import type { ReportLayout } from "../lib/report-layout"

/** Announces the loading once for screen readers; the placeholders themselves are hidden from them. */
export function LoadingSkeleton({ label = "Loading…", className, children }: { label?: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

// Line widths vary, so a column of placeholders reads as text rather than a grid of bars.
const WIDTHS = ["w-3/4", "w-1/2", "w-2/3", "w-5/6", "w-2/5", "w-3/5"]

function ReportCardSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="aspect-[16/10] rounded-xl" />
      <div className="flex items-center justify-between gap-3 px-1">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-10" />
      </div>
    </div>
  )
}

/** Cards in the same grid as the report list. */
export function ReportGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <ul className="grid grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <ReportCardSkeleton />
        </li>
      ))}
    </ul>
  )
}

/** Rows shaped like the report table: preview, title, status and date. */
export function ReportRowsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
          <Skeleton className="hidden h-9 w-14 shrink-0 lg:block" />
          <Skeleton className={`h-4 ${WIDTHS[index % WIDTHS.length]} max-w-md flex-1`} />
          <Skeleton className="ml-auto h-5 w-16 shrink-0 rounded-full" />
          <Skeleton className="h-3 w-14 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function ReportListSkeleton({ layout, count }: { layout: ReportLayout; count?: number }) {
  return layout === "list" ? <ReportRowsSkeleton count={count} /> : <ReportGridSkeleton count={count} />
}

/** A whole reports page: title, search and buttons, filters, then the cards. */
export function ReportsPageSkeleton() {
  return (
    <LoadingSkeleton className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-8 w-40" />
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <Skeleton className="h-9 flex-1 sm:w-60 sm:flex-none" />
          <Skeleton className="h-9 w-28" />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {["w-16", "w-20", "w-24", "w-20"].map((width, index) => (
          <Skeleton key={index} className={`h-8 ${width}`} />
        ))}
      </div>
      <ReportGridSkeleton />
    </LoadingSkeleton>
  )
}

/** The report page: back link and actions, the media, then title and description. */
export function ReportDetailSkeleton() {
  return (
    <LoadingSkeleton label="Loading report…" className="flex flex-col gap-5 px-4 py-4 sm:px-6">
      <div className="flex items-center justify-between gap-2">
        <Skeleton className="h-8 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="size-8" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <Skeleton className="aspect-video rounded-xl" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    </LoadingSkeleton>
  )
}

/** Avatar and a few lines per row: comments and notifications. */
export function PeopleRowsSkeleton({ label, count = 2, className = "" }: { label: string; count?: number; className?: string }) {
  return (
    <LoadingSkeleton label={label} className={`flex flex-col gap-4 ${className}`}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className={`h-3 ${WIDTHS[index % WIDTHS.length]}`} />
          </div>
        </div>
      ))}
    </LoadingSkeleton>
  )
}

/** The debugger's event rows: a time and a line of text each. */
export function EventRowsSkeleton() {
  return (
    <LoadingSkeleton label="Loading debugger data…" className="flex flex-col gap-3 p-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton className="h-3 w-10 shrink-0" />
          <Skeleton className={`h-3 ${WIDTHS[index % WIDTHS.length]}`} />
        </div>
      ))}
    </LoadingSkeleton>
  )
}

/** Rows in a bordered box, as the settings lists show members, projects and integrations. */
export function SettingsRowsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <LoadingSkeleton className="flex flex-col overflow-hidden rounded-xl border border-border">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border p-4 last:border-b-0">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-52 max-w-full" />
          </div>
          <Skeleton className="h-8 w-20 shrink-0" />
        </div>
      ))}
    </LoadingSkeleton>
  )
}

/** A settings page whose header waits for the data too. */
export function SettingsPageSkeleton() {
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div aria-hidden className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <SettingsRowsSkeleton />
    </div>
  )
}
