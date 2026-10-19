import type { ReactNode } from "react"
import { Button as AriaButton } from "react-aria-components"
import type { ReportDetail } from "../../lib/api"
import type { DebuggerView } from "@bugberry/debugger-view"
import { formatOffset, formatTimestamp } from "../../lib/format"
import { environmentRows, maskedCount, visitedUrls } from "@bugberry/debugger-view"
import type { Playback } from "../../lib/timeline"
import { VisitedUrls } from "./VisitedUrls"

const INCOMPLETE_LABELS: Record<string, string> = {
  "not-injected":
    "The capture script wasn't installed in this tab (it was opened before the extension was active), so there is no console, network or action data.",
  "page-timeout": "The page didn't respond while the data was collected.",
  "page-access": "The extension can't read this page.",
  "not-web-page": "This wasn't a regular web page, so there is no console, network or action data.",
  navigated:
    "The tab navigated to another page during the recording, so console, network and action data from the earlier page is missing.",
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
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

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="min-w-0 break-words text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** About the report: the pages visited, the session, the browser and what was masked. */
export function InfoTab({
  report,
  view,
  playback = null,
}: {
  report: ReportDetail
  view: DebuggerView | null
  playback?: Playback | null
}) {
  const missing = [...new Set([...report.debuggerSummary.incomplete, ...(view?.incomplete ?? [])])]
  const visited = visitedUrls(view, report.pageUrl)
  const masked = maskedCount(view)
  const session: Array<[string, ReactNode]> = [
    ["Timestamp", formatTimestamp(report.createdAt)],
    ["Reporter", report.reporterEmail ? `${report.reporter.name}, ${report.reporterEmail}` : report.reporter.name],
  ]
  if (report.location) session.push(["Location", report.location])
  if (report.captureType === "video" && report.durationMs !== null) session.push(["Recording", formatOffset(report.durationMs)])

  return (
    <div className="flex flex-col gap-5 p-4 text-sm">
      {missing.length > 0 && (
        <div role="note" className="rounded-md border border-warning-subtle-foreground/20 bg-warning-subtle p-3 text-xs text-warning-subtle-foreground">
          <p className="font-medium">Some data wasn't recorded</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((name) => (
              <li key={name}>{INCOMPLETE_LABELS[name] ?? `The ${name} hook couldn't be installed on the page.`}</li>
            ))}
          </ul>
        </div>
      )}
      {view && view.notes.length > 0 && (
        <Section title="Notes" count={view.notes.length}>
          <ol className="flex flex-col gap-2 text-xs">
            {view.notes.map((note) => (
              <li key={note.n} className="flex flex-wrap items-baseline gap-2">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                  {note.n}
                </span>
                {playback ? (
                  <AriaButton onPress={() => playback.seek(note.atMs)} className="font-mono text-primary hover:underline">
                    {formatOffset(note.atMs)}
                  </AriaButton>
                ) : (
                  <span className="font-mono text-muted-foreground">{formatOffset(note.atMs)}</span>
                )}
                <span className="min-w-0 break-words text-foreground">{note.text}</span>
                {note.author && <span className="text-muted-foreground">{note.author}</span>}
              </li>
            ))}
          </ol>
        </Section>
      )}
      <VisitedUrls entries={visited} playback={playback} />
      <Section title="Session">
        <Facts rows={session} />
      </Section>
      <Section title="Environment">
        <Facts
          rows={environmentRows(view, report.device).map((row): [string, ReactNode] => [
            row.label,
            row.tag ? (
              <span className="flex flex-wrap items-center gap-2">
                {row.value}
                <span
                  className={`rounded-full px-1.5 text-[11px] font-medium ${row.tag === "Fast" ? "bg-success-subtle text-success-subtle-foreground" : "bg-warning-subtle text-warning-subtle-foreground"}`}
                >
                  {row.tag}
                </span>
              </span>
            ) : (
              row.value
            ),
          ])}
        />
      </Section>
      {masked > 0 && (
        <Section title="Privacy">
          <p className="text-xs text-foreground">
            {masked} {masked === 1 ? "field" : "fields"} masked before upload
          </p>
        </Section>
      )}
    </div>
  )
}
