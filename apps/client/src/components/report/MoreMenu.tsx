import { PROVIDER_LABELS } from "@bugberry/shared"
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiCheckLine,
  RiDeleteBinLine,
  RiFolderLine,
  RiMoreLine,
  RiRobot2Line,
  RiSettings3Line,
  RiShareForwardLine,
} from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { useConfirm } from "@bugberry/ui/confirm-dialog"
import { Sheet } from "@bugberry/ui/sheet"
import { PHONE_QUERY, useMediaQuery } from "../../hooks/useMediaQuery"
import {
  Menu,
  MenuDescription,
  MenuItem,
  MenuLabel,
  MenuSection,
  MenuSeparator,
  MenuSubMenu,
  MenuTrigger,
} from "@bugberry/ui/menu"
import { errorMessage, type ReportDetail } from "../../lib/api"
import { api } from "../../lib/client"
import { copyForAiText, sendOutcome, type TrackerItem, trackerItems } from "../../lib/more-menu"
import { queries } from "../../lib/queries"
import { backTarget } from "../../lib/report-page"
import { toast } from "../../lib/toast"
import { trackersRefetchInterval } from "../../lib/tracker-links"
import { roleIn } from "../../lib/workspace"

const NO_PROJECT = "none"
const NEW_PROJECT = "new"

interface MoreMenuProps {
  projectId: string | null
  projects: ReadonlyArray<{ id: string; name: string }>
  trackers: TrackerItem[]
  needsProject: boolean
  canDelete: boolean
  onCopyForAi(): void
  onSetUpAi(): void
  onMove(projectId: string | null): void
  onNewProject(): void
  onSend(integrationId: string): void
  onDelete(): void
}

/**
 * The ⋯ menu as it looks; MoreMenu wires it to the server. On phones it is a sheet from the bottom, with
 * Move to project as a second step inside it: a submenu beside the menu would open off the screen.
 */
export function MoreMenuView(props: MoreMenuProps) {
  const phone = useMediaQuery(PHONE_QUERY)
  return phone ? <MoreSheet {...props} /> : <MoreDropdown {...props} />
}

function MoreDropdown({
  projectId,
  projects,
  trackers,
  needsProject,
  canDelete,
  onCopyForAi,
  onSetUpAi,
  onMove,
  onNewProject,
  onSend,
  onDelete,
}: MoreMenuProps) {
  return (
    <MenuTrigger>
      <Button intent="outline" size="sq-sm" aria-label="More actions">
        <RiMoreLine aria-hidden />
      </Button>
      <Menu placement="bottom end" className="min-w-64">
        <MenuItem onAction={onCopyForAi} textValue="Copy for AI">
          <RiRobot2Line aria-hidden />
          <MenuLabel>Copy for AI</MenuLabel>
          <MenuDescription>A prompt for your agent to debug it</MenuDescription>
        </MenuItem>
        <MenuItem onAction={onSetUpAi} textValue="Set up AI agents">
          <RiSettings3Line aria-hidden />
          <MenuLabel>Set up AI agents</MenuLabel>
        </MenuItem>
        <MenuSeparator />
        <MenuSubMenu>
          <MenuItem textValue="Move to project">
            <RiFolderLine aria-hidden />
            <MenuLabel>Move to project</MenuLabel>
          </MenuItem>
          <Menu className="min-w-56">
            <MenuSection
              aria-label="Projects"
              selectionMode="single"
              selectedKeys={[projectId ?? NO_PROJECT]}
            >
              {projects.map((project) => (
                <MenuItem key={project.id} id={project.id} onAction={() => project.id !== projectId && onMove(project.id)}>
                  {project.name}
                </MenuItem>
              ))}
              <MenuItem id={NO_PROJECT} onAction={() => projectId !== null && onMove(null)}>
                No project
              </MenuItem>
            </MenuSection>
            <MenuSeparator />
            <MenuItem id={NEW_PROJECT} onAction={onNewProject} textValue="New project">
              <RiAddLine aria-hidden />
              <MenuLabel>New project</MenuLabel>
            </MenuItem>
          </Menu>
        </MenuSubMenu>
        <MenuSeparator />
        {trackers.map((item) => (
          <MenuItem
            key={item.integrationId ?? `earlier-${item.label}`}
            textValue={item.label}
            isDisabled={item.action === "none" || (item.action === "open" && !item.href)}
            href={item.action === "open" && item.href ? item.href : undefined}
            target={item.action === "open" ? "_blank" : undefined}
            rel={item.action === "open" ? "noreferrer" : undefined}
            onAction={(item.action === "send" || item.action === "retry") && item.integrationId ? () => onSend(item.integrationId as string) : undefined}
          >
            <MenuLabel>{item.label}</MenuLabel>
            {item.note && <MenuDescription>{item.note}</MenuDescription>}
          </MenuItem>
        ))}
        {needsProject && trackers.length === 0 && (
          <MenuItem isDisabled textValue="Send to a tracker">
            <MenuLabel>Send to a tracker</MenuLabel>
            <MenuDescription>Move the report to a project first</MenuDescription>
          </MenuItem>
        )}
        {canDelete && (
          <>
            <MenuSeparator />
            <MenuItem intent="danger" onAction={onDelete} textValue="Delete report">
              <RiDeleteBinLine aria-hidden />
              <MenuLabel>Delete report</MenuLabel>
            </MenuItem>
          </>
        )}
      </Menu>
    </MenuTrigger>
  )
}

/** One tap-sized row of the phone's sheet: an icon, the action and a line under it. */
function SheetRow({
  icon,
  label,
  note,
  onPress,
  href,
  disabled = false,
  danger = false,
  pressed,
  trailing,
}: {
  icon?: ReactNode
  label: string
  note?: string | null
  onPress?(): void
  /** Opens in a new tab instead of running an action (a tracker issue already sent). */
  href?: string | null
  disabled?: boolean
  danger?: boolean
  /** Set on the project list: whether this is the report's project. */
  pressed?: boolean
  trailing?: ReactNode
}) {
  const className = `flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-hidden transition focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
    danger ? "text-danger-subtle-foreground hover:bg-danger-subtle" : "text-foreground hover:bg-muted"
  } [&>svg]:size-5 [&>svg]:shrink-0 ${danger ? "" : "[&>svg]:text-muted-foreground"}`
  const content = (
    <>
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </span>
      {/* Wrapped, so the row's grey icon colour stays off it (the check of the current project is primary). */}
      {trailing && <span className="flex shrink-0">{trailing}</span>}
    </>
  )
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={className}>
        {content}
      </a>
    )
  }
  return (
    <button type="button" disabled={disabled} aria-pressed={pressed} onClick={onPress} className={className}>
      {content}
    </button>
  )
}

function MoreSheet({
  projectId,
  projects,
  trackers,
  needsProject,
  canDelete,
  onCopyForAi,
  onSetUpAi,
  onMove,
  onNewProject,
  onSend,
  onDelete,
}: MoreMenuProps) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<"actions" | "projects">("actions")
  /** Runs an action and closes the sheet, as picking from a menu does. */
  const run = (action: () => void) => () => {
    setOpen(false)
    action()
  }
  const move = (target: string | null) =>
    run(() => {
      if (target !== projectId) onMove(target)
    })
  const current = projects.find((project) => project.id === projectId)?.name ?? "No project"

  return (
    <>
      <Button
        intent="outline"
        size="sq-sm"
        aria-label="More actions"
        onPress={() => {
          setStep("actions")
          setOpen(true)
        }}
      >
        <RiMoreLine aria-hidden />
      </Button>
      <Sheet isOpen={open} onOpenChange={setOpen} position="bottom" aria-label="More actions">
        <div className="flex max-h-[85dvh] flex-col overflow-y-auto px-2 pt-6 pb-4">
          {step === "actions" ? (
            <div className="flex flex-col gap-0.5">
              <SheetRow icon={<RiRobot2Line aria-hidden />} label="Copy for AI" note="A prompt for your agent to debug it" onPress={run(onCopyForAi)} />
              <SheetRow icon={<RiSettings3Line aria-hidden />} label="Set up AI agents" onPress={run(onSetUpAi)} />
              <div className="my-1 h-px bg-border" />
              <SheetRow
                icon={<RiFolderLine aria-hidden />}
                label="Move to project"
                note={current}
                onPress={() => setStep("projects")}
                trailing={<RiArrowRightSLine aria-hidden className="size-5 text-muted-foreground" />}
              />
              {(trackers.length > 0 || needsProject) && <div className="my-1 h-px bg-border" />}
              {trackers.map((item) => (
                <SheetRow
                  key={item.integrationId ?? `earlier-${item.label}`}
                  icon={<RiShareForwardLine aria-hidden />}
                  label={item.label}
                  note={item.note}
                  href={item.action === "open" ? item.href : null}
                  disabled={item.action === "none" || (item.action === "open" && !item.href)}
                  onPress={(item.action === "send" || item.action === "retry") && item.integrationId ? run(() => onSend(item.integrationId as string)) : undefined}
                />
              ))}
              {needsProject && trackers.length === 0 && (
                <SheetRow icon={<RiShareForwardLine aria-hidden />} label="Send to a tracker" note="Move the report to a project first" disabled />
              )}
              {canDelete && (
                <>
                  <div className="my-1 h-px bg-border" />
                  <SheetRow icon={<RiDeleteBinLine aria-hidden />} label="Delete report" danger onPress={run(onDelete)} />
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="mb-1 flex items-center gap-1">
                <Button intent="plain" size="sq-sm" aria-label="Back" onPress={() => setStep("actions")}>
                  <RiArrowLeftSLine aria-hidden />
                </Button>
                <h2 className="font-heading text-base font-semibold text-foreground">Move to project</h2>
              </div>
              {[...projects, { id: NO_PROJECT, name: "No project" }].map((project) => {
                const target = project.id === NO_PROJECT ? null : project.id
                const selected = target === projectId
                return (
                  <SheetRow
                    key={project.id}
                    icon={<RiFolderLine aria-hidden />}
                    label={project.name}
                    pressed={selected}
                    onPress={move(target)}
                    trailing={selected ? <RiCheckLine aria-hidden className="size-5 text-primary" /> : null}
                  />
                )
              })}
              <div className="my-1 h-px bg-border" />
              <SheetRow icon={<RiAddLine aria-hidden />} label="New project" onPress={run(onNewProject)} />
            </div>
          )}
        </div>
      </Sheet>
    </>
  )
}

/** Copy for AI, move to project, send to trackers, and (admins) delete the report. */
export function MoreMenu({ report }: { report: ReportDetail }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  // After a delete, back to the list the report was opened from.
  const reportsFrom = useLocation({ select: (location) => location.state.reportsFrom })
  const { confirm, dialog } = useConfirm()
  const workspaces = useQuery(queries.workspaces())
  const projects = useQuery(queries.projects(report.workspaceId))
  const trackers = useQuery({
    ...queries.reportTrackers(report.id),
    refetchInterval: (query) => trackersRefetchInterval(query.state.data, Date.now()),
  })
  const reportKey = queries.report(report.id).queryKey
  const trackersKey = queries.reportTrackers(report.id).queryKey
  const failed = (error: unknown) => toast({ title: errorMessage(error), tone: "error" })
  // The menu closes on the click, so a toast says whether the copy worked.
  const copyForAi = async () => {
    try {
      await navigator.clipboard.writeText(copyForAiText(window.location.origin, report.id))
      toast({ title: "Copied for AI" })
    } catch {
      toast({ title: "Couldn't copy", tone: "error" })
    }
  }

  const move = useMutation({
    mutationFn: (projectId: string | null) => api.updateReport(report.id, { projectId }),
    onSuccess: (detail) => {
      queryClient.setQueryData(reportKey, detail)
      void queryClient.invalidateQueries({ queryKey: ["reports"] })
      // Which trackers a report can go to depends on its project.
      void queryClient.invalidateQueries({ queryKey: trackersKey })
    },
    onError: failed,
  })
  // The menu closes on the click, so a toast says whether the issue was made.
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
  const remove = useMutation({
    mutationFn: () => api.deleteReport(report.id),
    onSuccess: async () => {
      await navigate(backTarget(report, projects.data ?? [], reportsFrom))
      queryClient.removeQueries({ queryKey: reportKey })
      void queryClient.invalidateQueries({ queryKey: ["reports"] })
      // A deleted report frees a slot under ACCOUNT_LIMITS.
      void queryClient.invalidateQueries({ queryKey: ["workspace-limits"] })
    },
    onError: failed,
  })

  return (
    <>
      {dialog}
      <MoreMenuView
        projectId={report.projectId}
        projects={projects.data ?? []}
        trackers={trackers.data ? trackerItems(trackers.data, Date.now(), send.isPending ? (send.variables ?? null) : null) : []}
        needsProject={trackers.data?.needsProject ?? false}
        canDelete={roleIn(workspaces.data ?? [], report.workspaceId) === "admin"}
        onCopyForAi={() => void copyForAi()}
        onSetUpAi={() => void navigate({ to: "/app/settings/ai" })}
        onMove={(projectId) => move.mutate(projectId)}
        onNewProject={() => void navigate({ to: "/app/settings/projects" })}
        onSend={(integrationId) => send.mutate(integrationId)}
        onDelete={async () => {
          const yes = await confirm({
            title: "Delete this report?",
            description: "Its screenshot or video and everything it captured are deleted. This can't be undone.",
            confirmLabel: "Delete report",
          })
          if (yes) remove.mutate()
        }}
      />
    </>
  )
}
