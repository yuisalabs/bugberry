import { RiAccountCircleLine, RiAddLine, RiExpandUpDownLine, RiLoginBoxLine, RiLogoutBoxRLine, RiSearchLine } from "@remixicon/react"
import type { WorkspaceRole } from "@bugberry/shared"
import { useState } from "react"
import { Dialog, DialogTrigger, Header, useFilter } from "react-aria-components"
import { Autocomplete } from "react-aria-components/Autocomplete"
import { Menu as MenuPrimitive } from "react-aria-components/Menu"
import { Avatar } from "@bugberry/ui/avatar"
import { Button } from "@bugberry/ui/button"
import { Input, InputGroup } from "@bugberry/ui/input"
import { MenuItem, MenuLabel, MenuSection, MenuSeparator, menuStyles } from "@bugberry/ui/menu"
import { Popover } from "@bugberry/ui/popover"
import { SearchField } from "@bugberry/ui/search-field"
import { initialsOf } from "../lib/people"
import { roleLabel, workspaceColor } from "../lib/workspace"

export interface MenuWorkspace {
  id: string
  name: string
  role: WorkspaceRole
  owner: boolean
  logoUrl?: string | null
}

interface PanelProps {
  workspaces: readonly MenuWorkspace[]
  currentId: string
  me: { name: string; email: string; image: string | null }
  onSwitch(id: string): void
  onCreate(): void
  onJoin(): void
  onAccount(): void
  onLogout(): void
}

/** The workspace's logo, or its first letter on its own colour, as in the switcher and its trigger. */
export function WorkspaceTile({
  workspace,
  size = "size-6",
}: {
  workspace: { id: string; name: string; logoUrl?: string | null }
  size?: string
}) {
  if (workspace.logoUrl) {
    return <img src={workspace.logoUrl} alt="" className={`${size} shrink-0 rounded-md object-cover ring-1 ring-border`} />
  }
  return (
    <span
      aria-hidden
      className={`${size} ${workspaceColor(workspace.id)} inline-flex shrink-0 items-center justify-center rounded-md text-xs font-bold text-white`}
    >
      {workspace.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}

/** What the workspace menu shows: find and switch workspaces, create or join one, and the account. */
export function WorkspaceMenuPanel({ workspaces, currentId, me, onSwitch, onCreate, onJoin, onAccount, onLogout }: PanelProps) {
  const { contains } = useFilter({ sensitivity: "base" })

  return (
    <div className="flex w-72 max-w-[calc(100vw-24px)] flex-col">
      <Autocomplete filter={contains}>
        <SearchField aria-label="Find a workspace" className="p-1.5 pb-0">
          <InputGroup>
            <RiSearchLine aria-hidden data-slot="icon" />
            <Input placeholder="Find a workspace" />
          </InputGroup>
        </SearchField>
        <p className="flex items-center justify-between px-3.5 pt-2 text-xs font-medium text-muted-foreground">
          <span>Workspaces</span>
          <span>{workspaces.length}</span>
        </p>
        <MenuPrimitive aria-label="Workspace menu" className={menuStyles({ className: "max-h-96" })}>
          <MenuSection
            aria-label="Workspaces"
            selectionMode="single"
            selectedKeys={[currentId]}
            items={workspaces}
            className="max-h-64 overflow-y-auto"
          >
            {(workspace) => (
              <MenuItem id={workspace.id} textValue={workspace.name} onAction={() => onSwitch(workspace.id)}>
                <span className="col-start-2 flex min-w-0 items-center gap-2">
                  <WorkspaceTile workspace={workspace} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{workspace.name}</span>
                    <span className="text-xs text-muted-foreground">{roleLabel(workspace)}</span>
                  </span>
                </span>
              </MenuItem>
            )}
          </MenuSection>
          <MenuSeparator />
          <MenuSection aria-label="Workspace actions">
            <MenuItem textValue="Create workspace" onAction={onCreate}>
              <RiAddLine aria-hidden />
              <MenuLabel>Create workspace</MenuLabel>
            </MenuItem>
            <MenuItem textValue="Join workspace" onAction={onJoin}>
              <RiLoginBoxLine aria-hidden />
              <MenuLabel>Join workspace</MenuLabel>
            </MenuItem>
          </MenuSection>
          <MenuSeparator />
          <MenuSection aria-label="Account">
            <Header className="col-span-full flex items-center gap-2 px-2.5 py-1.5">
              <Avatar src={me.image} initials={initialsOf(me.name)} alt="" size="sm" className="bg-secondary text-secondary-foreground" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-foreground">{me.name}</span>
                <span className="truncate text-xs text-muted-foreground">{me.email}</span>
              </span>
            </Header>
            <MenuItem textValue="Account settings" onAction={onAccount}>
              <RiAccountCircleLine aria-hidden />
              <MenuLabel>Account settings</MenuLabel>
            </MenuItem>
            <MenuItem intent="danger" textValue="Log out" onAction={onLogout}>
              <RiLogoutBoxRLine aria-hidden />
              <MenuLabel>Log out</MenuLabel>
            </MenuItem>
          </MenuSection>
        </MenuPrimitive>
      </Autocomplete>
    </div>
  )
}

/** The sidebar's workspace button; its menu closes after any choice. */
export function WorkspaceMenu(props: PanelProps) {
  const [open, setOpen] = useState(false)
  const current = props.workspaces.find((workspace) => workspace.id === props.currentId)
  const close =
    <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A) => {
      setOpen(false)
      run(...args)
    }

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <Button intent="outline" size="sm" className="w-full justify-start bg-background">
        {current && <WorkspaceTile workspace={current} />}
        <span className="min-w-0 flex-1 truncate text-left">{current?.name ?? "Workspace"}</span>
        <RiExpandUpDownLine aria-hidden />
      </Button>
      <Popover placement="bottom start" className="max-w-none">
        <Dialog aria-label="Workspace menu" className="outline-hidden">
          <WorkspaceMenuPanel
            {...props}
            onSwitch={close(props.onSwitch)}
            onCreate={close(props.onCreate)}
            onJoin={close(props.onJoin)}
            onAccount={close(props.onAccount)}
            onLogout={close(props.onLogout)}
          />
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
