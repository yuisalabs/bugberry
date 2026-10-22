import { RiArrowDownSLine, RiFolderFill, RiFolderLine, RiSearchLine, RiSettings3Line } from "@remixicon/react"
import { useState } from "react"
import { Button as AriaButton, Dialog, DialogTrigger, useFilter } from "react-aria-components"
import { Autocomplete } from "react-aria-components/Autocomplete"
import { Menu as MenuPrimitive } from "react-aria-components/Menu"
import { Input, InputGroup } from "@bugberry/ui/input"
import { MenuItem, MenuLabel, MenuSection, MenuSeparator, menuStyles } from "@bugberry/ui/menu"
import { Popover } from "@bugberry/ui/popover"
import { SearchField } from "@bugberry/ui/search-field"
import { ActiveIcon } from "./ActiveIcon"
import { ProjectTile } from "./ProjectTile"

interface MenuProject {
  id: string
  name: string
  slug: string
  logoUrl?: string | null
}

interface PanelProps {
  /** Undefined while they load. */
  projects: readonly MenuProject[] | undefined
  /** The project whose page is open, ticked in the list. */
  currentSlug?: string
  /** Admins only: the page that creates and edits projects. */
  onManage?(): void
  onOpen(slug: string): void
}

/** What the Projects menu shows: find a project, open it, and for admins Manage projects. As the workspace menu does it. */
export function ProjectsMenuPanel({ projects, currentSlug, onManage, onOpen }: PanelProps) {
  const { contains } = useFilter({ sensitivity: "base" })
  const current = projects?.find((project) => project.slug === currentSlug)

  return (
    <div className="flex w-72 max-w-[calc(100vw-24px)] flex-col">
      <Autocomplete filter={contains}>
        <SearchField aria-label="Find a project" className="p-1.5 pb-0">
          <InputGroup>
            <RiSearchLine aria-hidden data-slot="icon" />
            <Input placeholder="Find a project" />
          </InputGroup>
        </SearchField>
        <p className="flex items-center justify-between px-3.5 pt-2 text-xs font-medium text-muted-foreground">
          <span>Projects</span>
          <span>{projects?.length ?? ""}</span>
        </p>
        <MenuPrimitive
          aria-label="Projects menu"
          className={menuStyles({ className: "max-h-96" })}
          renderEmptyState={() => (
            <p className="px-2.5 py-2 text-sm text-muted-foreground">
              {!projects ? "Loading…" : projects.length === 0 ? "No projects yet" : "No project has that name"}
            </p>
          )}
        >
          <MenuSection
            aria-label="Projects"
            selectionMode="single"
            selectedKeys={current ? [current.id] : []}
            items={projects ?? []}
            // About five rows show; the rest scroll, so a long list doesn't make the menu tall.
            className="max-h-50 overflow-y-auto"
          >
            {(project) => (
              <MenuItem id={project.id} textValue={project.name} onAction={() => onOpen(project.slug)}>
                <span className="col-start-2 flex min-w-0 items-center gap-2">
                  <ProjectTile project={project} />
                  <span className="truncate">{project.name}</span>
                </span>
              </MenuItem>
            )}
          </MenuSection>
          {onManage && <MenuSeparator />}
          {onManage && (
            <MenuSection aria-label="Manage">
              <MenuItem id="manage" textValue="Manage projects" onAction={onManage}>
                <RiSettings3Line aria-hidden />
                <MenuLabel>Manage projects</MenuLabel>
              </MenuItem>
            </MenuSection>
          )}
        </MenuPrimitive>
      </Autocomplete>
    </div>
  )
}

/** The top bar's Projects pill; its menu closes after any choice. */
export function ProjectsMenu({ active, className, ...props }: PanelProps & { active: boolean; className: string }) {
  const [open, setOpen] = useState(false)
  const close =
    <A extends unknown[]>(run: (...args: A) => void) =>
    (...args: A) => {
      setOpen(false)
      run(...args)
    }

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton className={className}>
        <ActiveIcon active={active} line={RiFolderLine} fill={RiFolderFill} className="size-[18px] shrink-0" />
        Projects
        <RiArrowDownSLine aria-hidden className={`size-4 opacity-60 transition-transform ${open ? "rotate-180" : ""}`} />
      </AriaButton>
      <Popover placement="bottom" className="max-w-none">
        <Dialog aria-label="Projects menu" className="outline-hidden">
          <ProjectsMenuPanel {...props} onOpen={close(props.onOpen)} onManage={props.onManage && close(props.onManage)} />
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
