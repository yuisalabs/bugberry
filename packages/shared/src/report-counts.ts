import type { ReportStatus } from "./constants"

/** How many reports a list holds, from its counts per status: those of the picked statuses, or all when none is picked. */
export function listedCount(counts: { total: number; byStatus: Record<ReportStatus, number> }, statuses?: readonly ReportStatus[]): number {
  if (!statuses?.length) return counts.total
  return [...new Set(statuses)].reduce((sum, status) => sum + counts.byStatus[status], 0)
}
