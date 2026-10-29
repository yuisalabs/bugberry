import { RiAccountCircleLine, RiArrowRightUpLine, RiLifebuoyLine, RiLogoutBoxRLine, RiPuzzle2Line } from "@remixicon/react"
import { useState } from "react"
import { Button as AriaButton, Dialog, DialogTrigger, Header } from "react-aria-components"
import { Menu as MenuPrimitive } from "react-aria-components/Menu"
import { Avatar } from "@bugberry/ui/avatar"
import { MenuItem, MenuLabel, MenuSection, MenuSeparator, menuStyles } from "@bugberry/ui/menu"
import { Popover } from "@bugberry/ui/popover"
import { DOCS_URL } from "../../lib/docs-url"
import type { ExtensionAnswer } from "../onboarding/extension-bridge"
import { initialsOf } from "../../lib/people"

interface PanelProps {
  me: { name: string; email: string; image: string | null }
  /** What the extension said; its version shows beside Browser extension once it is installed. */
  extension: ExtensionAnswer
  onAccount(): void
  /** Installs the extension, or points it at this server; left out when there is nothing to do. */
  onExtension?(): void
  onLogout(): void
}

/** The extension's state as a small chip: its version, "Off" for another server, or "Install". */
function ExtensionChip({ answer }: { answer: ExtensionAnswer }) {
  if (!answer.installed) return <span className="ml-auto text-xs font-semibold text-primary">Install</span>
  if (!answer.active) return <span className="ml-auto text-xs text-muted-foreground">Another server</span>
  return (
    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-medium text-success-subtle-foreground">
      <span aria-hidden className="size-1.5 rounded-full bg-success" />
      {answer.version ? `v${answer.version}` : "On"}
    </span>
  )
}

/** What the account menu shows: who is signed in, their settings, the docs, then the extension and Log out. */
export function AccountMenuPanel({ me, extension, onAccount, onExtension, onLogout }: PanelProps) {
  return (
    <div className="flex w-76 max-w-[calc(100vw-24px)] flex-col">
      <MenuPrimitive aria-label="Account menu" className={menuStyles()}>
        <MenuSection aria-label="Account">
          <Header className="col-span-full flex items-center gap-3 px-2.5 py-2">
            <Avatar src={me.image} initials={initialsOf(me.name)} alt="" size="lg" className="bg-primary text-primary-foreground" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">{me.name}</span>
              <span className="truncate text-xs text-muted-foreground">{me.email}</span>
            </span>
          </Header>
        </MenuSection>
        <MenuSeparator />
        <MenuSection aria-label="Settings and help">
          <MenuItem textValue="Account settings" onAction={onAccount}>
            <RiAccountCircleLine aria-hidden />
            <MenuLabel>Account settings</MenuLabel>
          </MenuItem>
          <MenuItem textValue="Help & docs" href={DOCS_URL} target="_blank" rel="noreferrer">
            <RiLifebuoyLine aria-hidden />
            <MenuLabel className="flex items-center gap-2">
              Help & docs
              <RiArrowRightUpLine aria-hidden className="ml-auto size-4 text-muted-foreground" />
            </MenuLabel>
          </MenuItem>
        </MenuSection>
        <MenuSeparator />
        {/* The extension's state sits just above Log out, apart from the links. */}
        <MenuSection aria-label="Session">
          <MenuItem textValue="Browser extension" onAction={onExtension} isDisabled={!onExtension} className="disabled:opacity-100">
            <RiPuzzle2Line aria-hidden />
            <MenuLabel className="flex items-center gap-2">
              Browser extension
              <ExtensionChip answer={extension} />
            </MenuLabel>
          </MenuItem>
          <MenuItem intent="danger" textValue="Log out" onAction={onLogout}>
            <RiLogoutBoxRLine aria-hidden />
            <MenuLabel>Log out</MenuLabel>
          </MenuItem>
        </MenuSection>
      </MenuPrimitive>
    </div>
  )
}

/** The avatar at the top right; its menu closes after any choice. */
export function AccountMenu(props: PanelProps) {
  const [open, setOpen] = useState(false)
  const close =
    (run?: () => void) =>
    run &&
    (() => {
      setOpen(false)
      run()
    })

  return (
    <DialogTrigger isOpen={open} onOpenChange={setOpen}>
      <AriaButton
        aria-label="Account menu"
        className="rounded-full outline-hidden ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Avatar
          src={props.me.image}
          initials={initialsOf(props.me.name)}
          alt=""
          size="lg"
          className="bg-primary text-primary-foreground"
        />
      </AriaButton>
      <Popover placement="bottom end" className="max-w-none">
        <Dialog aria-label="Account menu" className="outline-hidden">
          <AccountMenuPanel
            {...props}
            onAccount={close(props.onAccount)!}
            onExtension={close(props.onExtension)}
            onLogout={close(props.onLogout)!}
          />
        </Dialog>
      </Popover>
    </DialogTrigger>
  )
}
