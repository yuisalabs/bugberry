import type { Visibility } from "@bugberry/shared"
import { RiArrowDownSLine, RiLink } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Dialog, DialogTrigger } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Popover } from "@bugberry/ui/popover"
import { errorMessage, type ReportDetail } from "../../lib/api"
import { api } from "../../lib/client"
import { queries } from "../../lib/queries"
import { copiedDescription } from "../../lib/share-access"
import { toast } from "../../lib/toast"
import { shareUrl } from "../../lib/urls"
import { roleIn } from "../../lib/workspace"
import { SharePopoverView } from "./SharePopover"

/**
 * The one share link of a report. The main part copies it as it is; the arrow opens the Share popover,
 * where the reporter or an admin decides who can open it and resets a public link that went too far.
 */
export function CopyLinkButton({
  report,
  settings = true,
}: {
  report: ReportDetail
  /** False on the share page: a viewer copies the link but cannot change who opens it. */
  settings?: boolean
}) {
  const queryClient = useQueryClient()
  const me = useQuery({ ...queries.me(), enabled: settings })
  const workspaces = useQuery({ ...queries.workspaces(), enabled: settings })
  const editable = roleIn(workspaces.data ?? [], report.workspaceId) === "admin" || me.data?.id === report.reporter.id
  const reportKey = queries.report(report.id).queryKey

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl(report.shareSlug))
      toast({ title: "Link copied", description: copiedDescription(report.visibility, report.internalDomain) })
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

  return (
    <div className="inline-flex">
      <Button size="sm" onPress={() => void copy().catch(() => {})} className={settings ? "rounded-r-none" : undefined}>
        <RiLink aria-hidden />
        Copy link
      </Button>
      {settings && (
        <DialogTrigger>
          <Button size="sq-sm" aria-label="Share settings" className="rounded-l-none border-l-primary-foreground/25">
            <RiArrowDownSLine aria-hidden />
          </Button>
          <Popover placement="bottom end" className="max-w-none">
            <Dialog aria-label="Share report" className="outline-hidden">
              <SharePopoverView
                number={report.number}
                visibility={report.visibility}
                internalDomain={report.internalDomain}
                editable={editable}
                busy={access.isPending || reset.isPending}
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
