import { PROVIDER_LABELS } from "@bugberry/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { errorMessage, type ReportDetail } from "../../lib/api"
import { api } from "../../lib/client"
import { sendOutcome, trackerItems } from "../../lib/more-menu"
import { queries } from "../../lib/queries"
import { toast } from "../../lib/toast"
import { trackersRefetchInterval } from "../../lib/tracker-links"

/**
 * A report's trackers as the green button's menu and the phone's ⋯ sheet show them, and the send to one of them.
 * The button or menu is gone once pressed, so a toast says whether the issue was made.
 */
export function useReportTrackers(report: ReportDetail) {
  const queryClient = useQueryClient()
  const trackers = useQuery({
    ...queries.reportTrackers(report.id),
    refetchInterval: (query) => trackersRefetchInterval(query.state.data, Date.now()),
  })
  const trackersKey = queries.reportTrackers(report.id).queryKey
  const send = useMutation({
    mutationFn: (integrationId: string) => api.sendToTracker(report.id, integrationId),
    onSuccess: (link) => {
      const outcome = sendOutcome(link)
      const href = outcome.href
      toast({
        title: outcome.title,
        description: outcome.description,
        tone: outcome.tone,
        action: href ? { label: "Open", onClick: () => window.open(href, "_blank", "noopener,noreferrer") } : undefined,
      })
    },
    onError: (error, integrationId) => {
      const provider = trackers.data?.integrations.find((item) => item.id === integrationId)?.provider
      toast({ title: `Couldn't send to ${provider ? PROVIDER_LABELS[provider] : "the tracker"}`, description: errorMessage(error), tone: "error" })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: trackersKey })
      void queryClient.invalidateQueries({ queryKey: ["activity", report.id] })
    },
  })

  return {
    items: trackers.data ? trackerItems(trackers.data, Date.now(), send.isPending ? (send.variables ?? null) : null) : [],
    needsProject: trackers.data?.needsProject ?? false,
    send: (integrationId: string) => send.mutate(integrationId),
  }
}
