import { queryOptions } from "@tanstack/react-query"
import { api } from "./client"

export const queries = {
  /** Teammates reply while the page sits in another tab, so coming back to it fetches the discussion again. */
  comments: (reportId: string) =>
    queryOptions({ queryKey: ["comments", reportId], queryFn: () => api.comments(reportId), refetchOnWindowFocus: true }),
  /** The report's activity lines; fetched only while "All activity" is on, and again on coming back to the page. */
  activity: (reportId: string) =>
    queryOptions({ queryKey: ["activity", reportId], queryFn: () => api.activity(reportId), refetchOnWindowFocus: true }),
}
