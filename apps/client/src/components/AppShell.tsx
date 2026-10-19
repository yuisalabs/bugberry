import {
  RiAddLine,
  RiCloseLine,
  RiFolderFill,
  RiFolderLine,
  RiGroupFill,
  RiGroupLine,
  RiHashtag,
  RiLayoutGridFill,
  RiLayoutGridLine,
  RiMenuLine,
  RiSettings3Fill,
  RiSettings3Line,
} from "@remixicon/react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Sheet } from "@bugberry/ui/sheet"
import { APP_MAIN_ID } from "../lib/app-scroll"
import { signOut } from "../lib/auth"
import { queries } from "../lib/queries"
import { toast } from "../lib/toast"
import { useCurrentWorkspace } from "../lib/workspace"
import { WorkspaceHome } from "../pages/WorkspaceHome"
import { ActiveIcon } from "./ActiveIcon"
import { BugBerryLogo } from "./BugBerryLogo"
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog"
import { ExtensionCard } from "./ExtensionCard"
import { JoinWorkspaceDialog } from "./JoinWorkspaceDialog"
import { NotificationBell } from "./NotificationBell"
import { Loading } from "./ui"
import { WorkspaceMenu } from "./WorkspaceMenu"

const sectionTitle = "flex items-center justify-between px-2 pb-1 text-xs font-medium text-muted-foreground"
const navLink = "flex items-center gap-2 truncate rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground hover:bg-sidebar-accent"
const navLinkActive = "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
const navIcon = "size-4 shrink-0 text-muted-foreground"

export function AppShell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery(queries.me())
  const { workspace, workspaces, isPending, switchTo } = useCurrentWorkspace()
  // The report page takes the whole window; its "All reports" link leads back to the sidebar.
  const fullWidth = Boolean(useMatchRoute()({ to: "/app/r/$reportId" }))
  const projects = useQuery({ ...queries.projects(workspace?.id ?? ""), enabled: Boolean(workspace) })
  const waiting = useQuery({ ...queries.joinRequests(workspace?.id ?? ""), enabled: workspace?.role === "admin" })
  const waitingCount = waiting.data?.length ?? 0
  const [drawer, setDrawer] = useState(false)
  const [creating, setCreating] = useState(false)
  const [joining, setJoining] = useState(false)

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

  const content = isPending ? <Loading /> : workspace ? <Outlet /> : <WorkspaceHome onCreateWorkspace={() => setCreating(true)} />
  if (fullWidth) return <div className="min-h-screen bg-background">{content}</div>
  const isAdmin = workspace?.role === "admin"

  const sidebar = (inDrawer: boolean) => (
    <>
      <div className="flex items-center justify-between gap-2">
        <Link to="/app" className="px-2" aria-label="BugBerry">
          <BugBerryLogo />
        </Link>
        <div className="flex items-center gap-1">
          {/* On phones the top bar already has the bell. */}
          <span className="hidden md:inline-flex">
            <NotificationBell />
          </span>
          {inDrawer && (
            <Button
              intent="plain"
              size="sq-sm"
              aria-label="Close menu"
              onPress={() => setDrawer(false)}
              className="hover:bg-sidebar-accent md:hidden"
            >
              <RiCloseLine aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {me.data && (
        <WorkspaceMenu
          workspaces={workspaces}
          currentId={workspace?.id ?? ""}
          me={me.data}
          onSwitch={(id) => void switchWorkspace(id)}
          onCreate={() => setCreating(true)}
          onJoin={() => setJoining(true)}
          onAccount={() => void navigate({ to: "/app/settings/account" })}
          onAiAgents={() => void navigate({ to: "/app/settings/ai" })}
          onLogout={() => void logout()}
        />
      )}
      {workspace && (
        <>
          <nav aria-label="Reports" className="flex flex-col gap-0.5">
            <Link
              to="/app"
              className={navLink}
              activeOptions={{ exact: true, includeSearch: false }}
              activeProps={{ className: navLinkActive }}
            >
              {({ isActive }) => (
                <>
                  <ActiveIcon active={isActive} line={RiLayoutGridLine} fill={RiLayoutGridFill} className={navIcon} />
                  All reports
                </>
              )}
            </Link>
          </nav>
          <nav aria-label="Projects" className="flex flex-col gap-0.5">
            <p className={sectionTitle}>
              Projects
              {isAdmin && (
                <Link to="/app/settings/projects" aria-label="New project" className="rounded p-0.5 hover:bg-sidebar-accent">
                  <RiAddLine aria-hidden className="size-4" />
                </Link>
              )}
            </p>
            {projects.data?.map((project) => (
              <Link
                key={project.id}
                to="/app/p/$projectSlug"
                params={{ projectSlug: project.slug }}
                className={navLink}
                activeProps={{ className: navLinkActive }}
              >
                <RiHashtag aria-hidden className={navIcon} />
                <span className="truncate">{project.name}</span>
              </Link>
            ))}
            {projects.data?.length === 0 && <p className="px-2 text-sm text-muted-foreground">No projects yet</p>}
          </nav>
          <nav aria-label="Workspace" className="flex flex-col gap-0.5">
            <p className={sectionTitle}>Workspace</p>
            <Link to="/app/settings/members" className={navLink} activeProps={{ className: navLinkActive }}>
              {({ isActive }) => (
                <>
                  <ActiveIcon active={isActive} line={RiGroupLine} fill={RiGroupFill} className={navIcon} />
                  <span className="flex-1">Members</span>
                  {waitingCount > 0 && (
                    <span
                      aria-label={`${waitingCount} ${waitingCount === 1 ? "request" : "requests"} to join`}
                      className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground"
                    >
                      {waitingCount}
                    </span>
                  )}
                </>
              )}
            </Link>
            {isAdmin && (
              <>
                <Link to="/app/settings/projects" className={navLink} activeProps={{ className: navLinkActive }}>
                  {({ isActive }) => (
                    <>
                      <ActiveIcon active={isActive} line={RiFolderLine} fill={RiFolderFill} className={navIcon} />
                      Projects
                    </>
                  )}
                </Link>
                <Link to="/app/settings/workspace" className={navLink} activeProps={{ className: navLinkActive }}>
                  {({ isActive }) => (
                    <>
                      <ActiveIcon active={isActive} line={RiSettings3Line} fill={RiSettings3Fill} className={navIcon} />
                      Settings
                    </>
                  )}
                </Link>
              </>
            )}
          </nav>
        </>
      )}
      <div className="mt-auto">
        <ExtensionCard />
      </div>
    </>
  )

  return (
    // From tablet width up the window itself never scrolls: the sidebar stays put and only the main column moves.
    <div className="flex min-h-screen flex-col md:h-screen md:flex-row md:overflow-hidden">
      {/* Phones: a top bar opens the sidebar as a drawer, and stays at the top while the page scrolls. */}
      <div className="sticky top-0 z-30 flex items-center justify-between gap-2 border-b border-sidebar-border bg-sidebar px-4 py-2 md:hidden">
        <Button intent="plain" size="sq-sm" aria-label="Open menu" onPress={() => setDrawer(true)} className="hover:bg-sidebar-accent">
          <RiMenuLine aria-hidden />
        </Button>
        <Link to="/app" aria-label="BugBerry">
          <BugBerryLogo />
        </Link>
        <NotificationBell />
      </div>

      <aside
        aria-label="Sidebar"
        className="hidden w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-sidebar-border bg-sidebar p-4 md:flex"
      >
        {sidebar(false)}
      </aside>
      {/* Phones: the same sidebar slides in as an Intent Sheet. */}
      <Sheet isOpen={drawer} onOpenChange={setDrawer} position="left" className="w-64 border-sidebar-border bg-sidebar md:hidden">
        <aside
          aria-label="Sidebar"
          // Following a link closes the drawer.
          onClickCapture={(event) => {
            if ((event.target as HTMLElement).closest("a")) setDrawer(false)
          }}
          className="flex h-dvh flex-col gap-5 overflow-y-auto p-4"
        >
          {sidebar(true)}
        </aside>
      </Sheet>
      <main
        id={APP_MAIN_ID}
        data-scroll-restoration-id={APP_MAIN_ID}
        className="min-w-0 flex-1 px-4 py-5 md:overflow-y-auto md:px-8 md:py-6"
      >
        {content}
      </main>

      <CreateWorkspaceDialog isOpen={creating} onOpenChange={setCreating} />
      <JoinWorkspaceDialog isOpen={joining} onOpenChange={setJoining} />
    </div>
  )
}
