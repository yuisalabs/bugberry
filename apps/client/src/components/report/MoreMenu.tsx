import { RiAddLine, RiDeleteBinLine, RiFolderLine, RiMoreLine, RiRobot2Line, RiSettings3Line } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@bugberry/ui/button"
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
import { copyForAiText, type TrackerItem, trackerItems } from "../../lib/more-menu"
import { queries } from "../../lib/queries"
import { backTarget } from "../../lib/report-page"
import { toast } from "../../lib/toast"
import { trackersRefetchInterval } from "../../lib/tracker-links"
import { roleIn } from "../../lib/workspace"

const NO_PROJECT = "none"
const NEW_PROJECT = "new"

/** The ⋯ menu as it looks; MoreMenu wires it to the server. */
export function MoreMenuView({
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
}: {
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
}) {
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
            key={item.integrationId}
            textValue={item.label}
            isDisabled={item.action === "none" || (item.action === "open" && !item.href)}
            href={item.action === "open" && item.href ? item.href : undefined}
            target={item.action === "open" ? "_blank" : undefined}
            rel={item.action === "open" ? "noreferrer" : undefined}
            onAction={item.action === "send" || item.action === "retry" ? () => onSend(item.integrationId) : undefined}
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

/** Copy for AI, move to project, send to trackers, and (admins) delete the report. */
export function MoreMenu({ report }: { report: ReportDetail }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
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
  const send = useMutation({
    mutationFn: (integrationId: string) => api.sendToTracker(report.id, integrationId),
    onError: failed,
    onSettled: () => queryClient.invalidateQueries({ queryKey: trackersKey }),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteReport(report.id),
    onSuccess: async () => {
      await navigate(backTarget(report, projects.data ?? []))
      queryClient.removeQueries({ queryKey: reportKey })
      void queryClient.invalidateQueries({ queryKey: ["reports"] })
      // A deleted report frees a slot under ACCOUNT_LIMITS.
      void queryClient.invalidateQueries({ queryKey: ["workspace-limits"] })
    },
    onError: failed,
  })

  return (
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
      onDelete={() => {
        if (window.confirm("Delete this report and its files? This can't be undone.")) remove.mutate()
      }}
    />
  )
}
