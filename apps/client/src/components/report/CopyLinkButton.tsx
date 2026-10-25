import type { Visibility } from "@bugberry/shared"
import { RiArrowDownSLine, RiLink, RiShareBoxLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogTrigger } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Popover } from "@bugberry/ui/popover"
import { errorMessage, type ReportDetail } from "../../lib/api"
import { api } from "../../lib/client"
import { queries } from "../../lib/queries"
import { copiedDescription, sharePopoverState } from "../../lib/share-access"
import { toast } from "../../lib/toast"
import { shareUrl } from "../../lib/urls"
import { roleIn } from "../../lib/workspace"
import { isUndone } from "../../lib/onboarding"
import { useOnboarding } from "../onboarding/OnboardingProvider"
import { SharePopoverView } from "./SharePopover"

/**
 * The one share link of a report. The main part copies it as it is; the arrow opens the Share popover,
 * where the reporter or an admin decides who can open it and resets a public link that went too far.
 */
export function CopyLinkButton({
  report,
  settings = true,
  bar = false,
}: {
  report: ReportDetail
  /** False on the share page: a viewer copies the link but cannot change who opens it. */
  settings?: boolean
  /** The phone's bottom bar: a full-width Copy link, and the share settings on their own button beside it. */
  bar?: boolean
}) {
  const queryClient = useQueryClient()
  const me = useQuery({ ...queries.me(), enabled: settings })
  const workspaces = useQuery({ ...queries.workspaces(), enabled: settings })
  const editable = roleIn(workspaces.data ?? [], report.workspaceId) === "admin" || me.data?.id === report.reporter.id
  const reportKey = queries.report(report.id).queryKey
  // Getting started: while "Share a report" is next, Copy link asks to be pressed.
  const onboarding = useOnboarding()
  const guide = settings && onboarding?.next === "shared"

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(report.shareSlug))
      toast({ title: "Link copied", description: copiedDescription(report.visibility, report.internalDomain) })
      if (settings && onboarding && isUndone(onboarding.progress, "shared")) onboarding.record("shared")
    } catch {
      toast({ title: "Couldn't copy the link", tone: "error" })
      throw new Error("copy failed")
    }
  }

  const access = useMutation({
    mutationFn: (visibility: Visibility) => api.updateReport(report.id, { visibility }),
    onSuccess: (detail) => {
      const retired = report.visibility === "public" && detail.visibility !== "public"
      queryClient.setQueryData(reportKey, detail)
      void queryClient.invalidateQueries({ queryKey: ["reports"] })
      if (retired) toast({ title: "Public link turned off. The old link no longer works.", tone: "info" })
    },
    onError: (error) => toast({ title: errorMessage(error), tone: "error" }),
  })
  const reset = useMutation({
    mutationFn: () => api.regenerateShare(report.id),
    onSuccess: ({ shareSlug }) => {
      queryClient.setQueryData(reportKey, (old: ReportDetail | undefined) => (old ? { ...old, shareSlug } : old))
      toast({ title: "New link created" })
    },
    onError: (error) => toast({ title: errorMessage(error), tone: "error" }),
  })
  const shown = sharePopoverState(report.visibility, {
    saving: access.isPending ? access.variables : undefined,
    resetting: reset.isPending,
  })

  return (
    <div className={bar ? "flex gap-3" : "inline-flex"}>
      <Button
        size={bar ? "lg" : "sm"}
        onPress={() => void copy().catch(() => {})}
        className={bar ? "flex-1" : settings ? "rounded-r-none" : undefined}
        {...(guide ? { "data-onboarding-pulse": "" } : {})}
      >
        <RiLink aria-hidden />
        Copy link
      </Button>
      {settings && (
        <DialogTrigger>
          {bar ? (
            <Button intent="outline" size="sq-lg" aria-label="Share settings" className="bg-background">
              <RiShareBoxLine aria-hidden />
            </Button>
          ) : (
            <Button size="sq-sm" aria-label="Share settings" className="rounded-l-none border-l-primary-foreground/25">
              <RiArrowDownSLine aria-hidden />
            </Button>
          )}
          <Popover placement={bar ? "top end" : "bottom end"} className="max-w-none">
            <Dialog aria-label="Share report" className="outline-hidden">
              <SharePopoverView
                number={report.number}
                visibility={shown.visibility}
                internalDomain={report.internalDomain}
                editable={editable}
                busy={shown.busy}
                onChange={(visibility) => access.mutate(visibility)}
                onCopy={() => copy()}
                onReset={async () => {
                  await reset.mutateAsync().catch(() => {})
                }}
              />
            </Dialog>
          </Popover>
        </DialogTrigger>
      )}
    </div>
  )
}
