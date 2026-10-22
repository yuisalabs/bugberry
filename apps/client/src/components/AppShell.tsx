import {
  RiArrowDownSLine,
  RiCloseLine,
  RiFolderFill,
  RiFolderLine,
  RiGroupFill,
  RiGroupLine,
  RiHashtag,
  RiLayoutGridFill,
  RiLayoutGridLine,
  RiMenuLine,
  RiPlugFill,
  RiPlugLine,
  RiRobot2Fill,
  RiRobot2Line,
  RiSettings3Fill,
  RiSettings3Line,
  RiUserAddLine,
} from "@remixicon/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button as AriaButton, MenuTrigger } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Menu, MenuItem, MenuLabel, MenuSection, MenuSeparator } from "@bugberry/ui/menu"
import { Sheet } from "@bugberry/ui/sheet"
import { usePageDrawer } from "../hooks/usePageDrawer"
import { APP_MAIN_ID } from "../lib/app-scroll"
import { signOut } from "../lib/auth"
import { useServerInExtension } from "../lib/extension-bridge"
import { queries } from "../lib/queries"
import { toast } from "../lib/toast"
import { invitesAllowed } from "../lib/usage"
import { useCurrentWorkspace } from "../lib/workspace"
import { WorkspaceHome } from "../pages/WorkspaceHome"
import { AccountMenu } from "./AccountMenu"
import { ActiveIcon } from "./ActiveIcon"
import { BugBerryLogo } from "./BugBerryLogo"
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog"
import { useExtensionAnswer } from "./ExtensionCard"
import { InviteDialog } from "./InviteDialog"
import { JoinWorkspaceDialog } from "./JoinWorkspaceDialog"
import { NewReportButton } from "./NewReportButton"
import { NotificationBell } from "./NotificationBell"
import { ReportDetailSkeleton, ReportsPageSkeleton } from "./Skeletons"
import { WorkspaceMenu } from "./WorkspaceMenu"

const sectionTitle = "px-2 pb-1 text-xs font-medium text-muted-foreground"
// Colours live in the active and inactive styles only, so the open page's link never turns grey on hover.
// The top bar's links are pills; the phone drawer lists the same pages as rows.
const pill =
  "flex items-center gap-2 rounded-full px-3.5 py-2 text-[15px] whitespace-nowrap outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
const pillOn = "bg-sidebar-primary font-medium text-sidebar-primary-foreground [&_svg]:text-sidebar-primary-foreground"
const pillOff = "text-foreground/80 hover:bg-muted hover:text-foreground"
const topLink = { className: pill, activeProps: { className: pillOn }, inactiveProps: { className: pillOff } }
const drawerLink = {
  className: "flex items-center gap-2 truncate rounded-lg px-2 py-1.5 text-sm",
  activeProps: { className: "bg-sidebar-primary font-medium text-sidebar-primary-foreground [&_svg]:text-sidebar-primary-foreground" },
  inactiveProps: { className: "text-sidebar-foreground hover:bg-sidebar-accent" },
}
const navIcon = "size-4 shrink-0 text-muted-foreground"
const pillIcon = "size-[18px] shrink-0"

/** How many people wait to join, beside Members. */
function WaitingBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      aria-label={`${count} ${count === 1 ? "request" : "requests"} to join`}
      className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground"
    >
      {count}
    </span>
  )
}

/** The top bar's Projects: a menu of the workspace's projects, and for admins the page that manages them. */
function ProjectsMenu({
  projects,
  active,
  isAdmin,
  onOpen,
  onManage,
}: {
  projects: readonly { id: string; name: string; slug: string }[] | undefined
  active: boolean
  isAdmin: boolean
  onOpen(slug: string): void
  onManage(): void
}) {
  const [open, setOpen] = useState(false)
  return (
    <MenuTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton className={`${pill} ${active ? pillOn : pillOff}`}>
        <ActiveIcon active={active} line={RiFolderLine} fill={RiFolderFill} className={pillIcon} />
        Projects
        <RiArrowDownSLine aria-hidden className={`size-4 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </AriaButton>
      <Menu placement="bottom" popover={{ className: "min-w-56" }}>
        <MenuSection aria-label="Projects" className="max-h-72 overflow-y-auto">
          {projects && projects.length > 0 ? (
            projects.map((project) => (
              <MenuItem key={project.id} id={project.id} textValue={project.name} onAction={() => onOpen(project.slug)}>
                <RiHashtag aria-hidden />
                <MenuLabel className="truncate">{project.name}</MenuLabel>
              </MenuItem>
            ))
          ) : (
            <MenuItem id="none" isDisabled textValue="No projects yet">
              <MenuLabel>{projects ? "No projects yet" : "Loading…"}</MenuLabel>
            </MenuItem>
          )}
        </MenuSection>
        {isAdmin && <MenuSeparator />}
        {isAdmin && (
          <MenuSection aria-label="Manage">
            <MenuItem id="manage" textValue="Manage projects" onAction={onManage}>
              <RiSettings3Line aria-hidden />
              <MenuLabel>Manage projects</MenuLabel>
            </MenuItem>
          </MenuSection>
        )}
      </Menu>
    </MenuTrigger>
  )
}

export function AppShell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const me = useQuery(queries.me())
  const { workspace, workspaces, isPending, switchTo } = useCurrentWorkspace()
  // The report page takes the whole window; its "All reports" link leads back to the top bar.
  const fullWidth = Boolean(matchRoute({ to: "/app/r/$reportId" }))
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const waiting = useQuery({ ...queries.joinRequests(workspace?.id ?? ""), enabled: workspace?.role === "admin" })
  const waitingCount = waiting.data?.length ?? 0
  const myLimits = useQuery(queries.myLimits())
  const limits = useQuery({ ...queries.workspaceLimits(workspace?.id ?? ""), enabled: workspace?.role === "admin" })
  const config = useQuery(queries.clientConfig())
  const installUrl = config.data?.extensionInstallUrl ?? null
  const extension = useExtensionAnswer()
  const { open: drawer, setOpen: setDrawer } = usePageDrawer()
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)
  const [inviting, setInviting] = useState(false)

  const logout = async () => {
    try {
      await signOut()
    } catch {
      toast({ title: "Couldn't sign out. Try again.", tone: "error" })
      return
    }
    queryClient.clear()
    await navigate({ to: "/login", search: {} })
  }

  const switchWorkspace = async (id: string) => {
    await switchTo(id)
    await navigate({ to: "/app" })
  }

  const content = isPending ? (
    fullWidth ? <ReportDetailSkeleton /> : <ReportsPageSkeleton />
  ) : workspace ? <Outlet /> : <WorkspaceHome onCreateWorkspace={() => setCreating(true)} />
  if (fullWidth) return <div className="min-h-screen bg-background">{content}</div>
  const isAdmin = workspace?.role === "admin"
  const canInvite = isAdmin && invitesAllowed(limits.data)
  const projectsActive =
    Boolean(matchRoute({ to: "/app/p/$projectSlug", fuzzy: true })) || Boolean(matchRoute({ to: "/app/settings/projects", fuzzy: true }))
  // Browser extension in the account menu: install it, or point it at this server; once it works there's nothing to do.
  const onExtension = !extension.installed
    ? installUrl
      ? () => window.open(installUrl, "_blank", "noreferrer")
      : undefined
    : extension.active
      ? undefined
      : () => useServerInExtension(window)

  // Phones and small tablets: the same pages as rows in a drawer.
  const drawerNav = (
    <aside
      aria-label="Sidebar"
      // A link to another page closes the drawer once that page is drawn (usePageDrawer); a link to the page
      // already shown navigates nowhere, so it closes the drawer here.
      onClickCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a")
        if (link && link.href === window.location.href) setDrawer(false)
      }}
      className="flex h-dvh flex-col gap-5 overflow-y-auto p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <Link to="/app" className="px-2" aria-label="BugBerry">
          <BugBerryLogo />
        </Link>
        <Button intent="plain" size="sq-sm" aria-label="Close menu" onPress={() => setDrawer(false)} className="hover:bg-sidebar-accent">
          <RiCloseLine aria-hidden />
        </Button>
      </div>
      {workspace && (
        <>
          <nav aria-label="Main" className="flex flex-col gap-0.5">
            <Link to="/app" {...drawerLink} activeOptions={{ exact: true, includeSearch: false }}>
              {({ isActive }) => (
                <>
                  <ActiveIcon active={isActive} line={RiLayoutGridLine} fill={RiLayoutGridFill} className={navIcon} />
                  All reports
                </>
              )}
            </Link>
            <Link to="/app/settings/ai" {...drawerLink}>
              {({ isActive }) => (
                <>
                  <ActiveIcon active={isActive} line={RiRobot2Line} fill={RiRobot2Fill} className={navIcon} />
                  AI Agents
                </>
              )}
            </Link>
            <Link to="/app/settings/members" {...drawerLink}>
              {({ isActive }) => (
                <>
                  <ActiveIcon active={isActive} line={RiGroupLine} fill={RiGroupFill} className={navIcon} />
                  <span className="flex-1">Members</span>
                  <WaitingBadge count={waitingCount} />
                </>
              )}
            </Link>
            {isAdmin && (
              <>
                <Link to="/app/settings/integrations" {...drawerLink}>
                  {({ isActive }) => (
                    <>
                      <ActiveIcon active={isActive} line={RiPlugLine} fill={RiPlugFill} className={navIcon} />
                      Integrations
                    </>
                  )}
                </Link>
                <Link to="/app/settings/workspace" {...drawerLink}>
                  {({ isActive }) => (
                    <>
                      <ActiveIcon active={isActive} line={RiSettings3Line} fill={RiSettings3Fill} className={navIcon} />
                      Workspace settings
                    </>
                  )}
                </Link>
              </>
            )}
          </nav>
          <nav aria-label="Projects" className="flex flex-col gap-0.5">
            <p className={sectionTitle}>Projects</p>
            {projects.data?.map((project) => (
              <Link key={project.id} to="/app/p/$projectSlug" params={{ projectSlug: project.slug }} {...drawerLink}>
                <RiHashtag aria-hidden className={navIcon} />
                <span className="truncate">{project.name}</span>
              </Link>
            ))}
            {projects.data?.length === 0 && <p className="px-2 text-sm text-muted-foreground">No projects yet</p>}
            {isAdmin && (
              <Link to="/app/settings/projects" {...drawerLink}>
                <RiFolderLine aria-hidden className={navIcon} />
                Manage projects
              </Link>
            )}
          </nav>
        </>
      )}
    </aside>
  )

  return (
    // From tablet width up the window itself never scrolls: the top bar stays put and only the main panel moves.
    <div className="flex min-h-screen flex-col bg-background md:h-screen md:overflow-hidden">
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border bg-background px-3 md:h-[76px] md:border-b-0 md:px-6">
        <Button intent="plain" size="sq-sm" aria-label="Open menu" onPress={() => setDrawer(true)} className="hover:bg-sidebar-accent xl:hidden">
          <RiMenuLine aria-hidden />
        </Button>
        {me.data && (
          <WorkspaceMenu
            workspaces={workspaces}
            currentId={workspace?.id ?? ""}
            onSwitch={(id) => void switchWorkspace(id)}
            onCreate={myLimits.data?.canCreateWorkspace === false ? undefined : () => setCreating(true)}
            onJoin={() => setJoining(true)}
            onSettings={isAdmin ? () => void navigate({ to: "/app/settings/workspace" }) : undefined}
            onInvite={canInvite ? () => setInviting(true) : undefined}
          />
        )}
        <div className="flex min-w-0 flex-1 justify-center">
          {workspace && (
            <nav aria-label="Main" className="hidden items-center gap-1 xl:flex">
              <Link to="/app" {...topLink} activeOptions={{ exact: true, includeSearch: false }}>
                {({ isActive }) => (
                  <>
                    <ActiveIcon active={isActive} line={RiLayoutGridLine} fill={RiLayoutGridFill} className={pillIcon} />
                    All reports
                  </>
                )}
              </Link>
              <Link to="/app/settings/ai" {...topLink}>
                {({ isActive }) => (
                  <>
                    <ActiveIcon active={isActive} line={RiRobot2Line} fill={RiRobot2Fill} className={pillIcon} />
                    AI Agents
                  </>
                )}
              </Link>
              <ProjectsMenu
                projects={projects.data}
                active={projectsActive}
                isAdmin={isAdmin}
                onOpen={(projectSlug) => void navigate({ to: "/app/p/$projectSlug", params: { projectSlug } })}
                onManage={() => void navigate({ to: "/app/settings/projects" })}
              />
              <Link to="/app/settings/members" {...topLink}>
                {({ isActive }) => (
                  <>
                    <ActiveIcon active={isActive} line={RiGroupLine} fill={RiGroupFill} className={pillIcon} />
                    Members
                    <WaitingBadge count={waitingCount} />
                  </>
                )}
              </Link>
              {isAdmin && (
                <Link to="/app/settings/integrations" {...topLink}>
                  {({ isActive }) => (
                    <>
                      <ActiveIcon active={isActive} line={RiPlugLine} fill={RiPlugFill} className={pillIcon} />
                      Integrations
                    </>
                  )}
                </Link>
              )}
            </nav>
          )}
        </div>
        <div className="flex items-center gap-2 md:gap-3">
          <NotificationBell />
          <span aria-hidden className="hidden h-6 w-px bg-border sm:block" />
          {canInvite && (
            <Button intent="outline" size="md" onPress={() => setInviting(true)} className="hidden rounded-full bg-background px-4 md:inline-flex">
              <RiUserAddLine aria-hidden />
              Invite
            </Button>
          )}
          {workspace && (
            <span className="hidden sm:inline-flex">
              <NewReportButton installUrl={installUrl} prominent className="rounded-full px-5 shadow-lg shadow-primary/25" />
            </span>
          )}
          {me.data && (
            <AccountMenu
              me={me.data}
              extension={extension}
              onAccount={() => void navigate({ to: "/app/settings/account" })}
              onExtension={onExtension}
              onLogout={() => void logout()}
            />
          )}
        </div>
      </header>

      {/* Phones and small tablets: the pages slide in as an Intent Sheet. */}
      <Sheet isOpen={drawer} onOpenChange={setDrawer} position="left" className="w-64 border-sidebar-border bg-sidebar xl:hidden">
        {drawerNav}
      </Sheet>
      {/* The page sits on a soft panel under the top bar that runs to the window's bottom edge; from tablet width up
          the panel is what scrolls. */}
      <main
        id={APP_MAIN_ID}
        data-scroll-restoration-id={APP_MAIN_ID}
        className="min-w-0 flex-1 bg-sidebar px-4 py-5 md:mx-6 md:overflow-y-auto md:rounded-t-[28px] md:border md:border-b-0 md:border-sidebar-border md:px-8 md:py-6"
      >
        {content}
      </main>

      <CreateWorkspaceDialog isOpen={creating} onOpenChange={setCreating} />
      <JoinWorkspaceDialog isOpen={joining} onOpenChange={setJoining} />
      {workspace && <InviteDialog workspaceId={workspace.id} isOpen={inviting} onOpenChange={setInviting} />}
    </div>
  )
}
