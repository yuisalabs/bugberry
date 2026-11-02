import { type FixProvider, fixLinkLabel } from "@bugberry/shared"
import type { ReportFixRow } from "../../db/schema"

export interface FixView {
  id: string
  url: string
  label: string
  provider: FixProvider
  addedById: string | null
  viaAgent: string | null
  createdAt: Date
}

export function toFixViews(rows: ReportFixRow[]): FixView[] {
  return rows.map((row) => ({
    id: row.id,
    url: row.url,
    ...fixLinkLabel(row.url),
    addedById: row.addedBy,
    viaAgent: row.viaAgent,
    createdAt: row.createdAt,
  }))
}
