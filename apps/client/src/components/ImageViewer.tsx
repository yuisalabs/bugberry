import { RiCloseLine, RiDownload2Line, RiZoomInLine, RiZoomOutLine } from "@remixicon/react"
import { useState } from "react"
import { Dialog, Heading } from "react-aria-components"
import { Modal, ModalOverlay } from "react-aria-components/Modal"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { Link } from "@bugberry/ui/link"
import { Toggle } from "@bugberry/ui/toggle"

/** Light controls on the dark viewer; their hover tint follows the white text. */
const onDark = "text-white hover:bg-current/10 pressed:bg-current/15 *:[svg]:text-white"

/**
 * A screenshot on its own, over a dark backdrop: it fits the window, or shows at its actual size to scroll
 * around. Escape, the close button or a click beside the picture closes it.
 */
export function ImageViewer({
  src,
  alt,
  title = "Screenshot",
  isOpen,
  onOpenChange,
}: {
  src: string
  alt: string
  title?: string
  isOpen: boolean
  onOpenChange(isOpen: boolean): void
}) {
  const [actualSize, setActualSize] = useState(false)
  const openChange = (open: boolean) => {
    if (!open) setActualSize(false)
    onOpenChange(open)
  }

  return (
    <ModalOverlay
      isOpen={isOpen}
      onOpenChange={openChange}
      isDismissable
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm entering:animate-in entering:fade-in entering:duration-200 exiting:animate-out exiting:fade-out exiting:duration-150"
    >
      <Modal className="size-full">
        <Dialog aria-label={`${title} viewer`} className="flex size-full flex-col outline-hidden">
          {({ close }) => (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3">
                <Heading slot="title" className="text-sm font-medium text-white">
                  {title}
                </Heading>
                <div className="flex items-center gap-1">
                  <Toggle
                    size="sq-sm"
                    aria-label={actualSize ? "Fit to screen" : "Actual size"}
                    isSelected={actualSize}
                    onChange={setActualSize}
                    className={`${onDark} selected:bg-current/15`}
                  >
                    {actualSize ? <RiZoomOutLine aria-hidden /> : <RiZoomInLine aria-hidden />}
                  </Toggle>
                  <Link
                    href={src}
                    download
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Download ${title.toLowerCase()}`}
                    className={`${buttonStyles({ intent: "plain", size: "sq-sm" })} ${onDark}`}
                  >
                    <RiDownload2Line aria-hidden />
                  </Link>
                  <Button intent="plain" size="sq-sm" aria-label="Close" onPress={close} className={onDark}>
                    <RiCloseLine aria-hidden />
                  </Button>
                </div>
              </div>
              {/* A click on the dark area beside the picture closes the viewer; a click on the picture does not. */}
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: Escape and the Close button do the same from the keyboard */}
              <div
                onClick={(event) => {
                  if (event.target === event.currentTarget) close()
                }}
                className={`min-h-0 flex-1 px-4 pb-4 ${actualSize ? "overflow-auto" : "grid place-items-center overflow-hidden"}`}
              >
                <img
                  src={src}
                  alt={alt}
                  className={actualSize ? "max-w-none rounded-lg" : "max-h-full max-w-full rounded-lg object-contain shadow-2xl"}
                />
              </div>
            </>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
