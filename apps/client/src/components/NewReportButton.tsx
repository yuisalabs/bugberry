import { RiAddLine, RiChromeLine } from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Link } from "@bugberry/ui/link"
import { askExtension, type ExtensionAnswer, openExtensionPopup, useServerInExtension } from "../lib/extension-bridge"
import { useExtensionAnswer } from "./ExtensionCard"

/** How to start a report when the extension can't open its popup for this dashboard. */
export function NewReportGuide({
  answer,
  installUrl,
  onUseServer,
}: {
  answer: ExtensionAnswer
  installUrl: string | null
  onUseServer(): void
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-foreground">Open the page you want to report, then click the BugBerry icon in the toolbar.</p>
      {answer.installed ? (
        !answer.active && (
          <AriaButton onPress={onUseServer} className="self-start font-semibold text-primary hover:underline">
            Use the extension with this server
          </AriaButton>
        )
      ) : installUrl ? (
        <Link href={installUrl} target="_blank" rel="noreferrer" className="self-start font-semibold text-primary hover:underline">
          Install the extension
        </Link>
      ) : (
        <p className="text-muted-foreground">Ask your admin for the BugBerry extension</p>
      )}
    </div>
  )
}

const askThisPage = () => askExtension(window)

/**
 * "Add to Chrome": the store page, opened in a new tab, while this browser has no BugBerry extension. Nothing when
 * the extension answers, or when the server names no store page (EXTENSION_INSTALL_URL).
 */
export function InstallExtensionButton({
  installUrl,
  ask = askThisPage,
}: {
  installUrl: string | null
  ask?: () => Promise<ExtensionAnswer>
}) {
  const answer = useExtensionAnswer(ask)
  if (answer.installed || !installUrl) return null
  return (
    <a href={installUrl} target="_blank" rel="noreferrer" className={buttonStyles({ intent: "outline", className: "bg-background" })}>
      <RiChromeLine aria-hidden />
      Add to Chrome
    </a>
  )
}

const openThisPage = () => openExtensionPopup(window)

/**
 * "New report": asks the extension to open its popup. When it can't (not installed, another server, an
 * older Chrome), a short guide explains how to start a report instead. What the extension said when the
 * page loaded decides first, so a missing extension shows the guide at once instead of after a timeout.
 */
export function NewReportButton({
  installUrl,
  open = openThisPage,
  ask = askThisPage,
  label = "New report",
  icon = <RiAddLine aria-hidden />,
  prominent = false,
  className,
}: {
  installUrl: string | null
  open?: () => Promise<boolean>
  ask?: () => Promise<ExtensionAnswer>
  /** "Record a bug" on an empty report list. */
  label?: string
  icon?: ReactNode
  /** Full size with its label on every screen, instead of the header's small button. */
  prominent?: boolean
  className?: string
}) {
  const [guide, setGuide] = useState<ExtensionAnswer | null>(null)
  const known = useExtensionAnswer(ask)
  const start = async () => {
    if (!known.installed || !known.active) return setGuide(known)
    if (await open()) return
    setGuide(await ask())
  }

  return (
    <>
      <Button size={prominent ? "md" : "sm"} aria-label={label} onPress={() => void start()} className={className}>
        {icon}
        <span className={prominent ? undefined : "hidden sm:inline"}>{label}</span>
      </Button>
      <Dialog isOpen={guide !== null} onOpenChange={(isOpen) => !isOpen && setGuide(null)} aria-label="New report" size="sm">
        <DialogHeader>
          <DialogTitle>New report</DialogTitle>
        </DialogHeader>
        <DialogBody>
          {guide && <NewReportGuide answer={guide} installUrl={installUrl} onUseServer={() => useServerInExtension(window)} />}
        </DialogBody>
      </Dialog>
    </>
  )
}
