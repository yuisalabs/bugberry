import { RiLayoutRightFill, RiLayoutRightLine } from "@remixicon/react"
import { useEffect, useRef } from "react"
import { Toggle } from "@bugberry/ui/toggle"
import { Tooltip, TooltipTrigger } from "@bugberry/ui/tooltip"
import { startHorizontalDrag } from "../lib/drag"
import { ActiveIcon } from "./ActiveIcon"

const KEY_STEP = 32

/** The panel button at the end of the report's header: hides or shows DevTools, as in Jam. */
export function DevtoolsToggle({ open, onToggle }: { open: boolean; onToggle(open: boolean): void }) {
  const label = open ? "Hide DevTools" : "Show DevTools"
  return (
    <TooltipTrigger delay={300}>
      <Toggle
        intent="outline"
        size="sq-sm"
        aria-label={label}
        isSelected={open}
        onChange={onToggle}
        className="text-muted-foreground selected:text-foreground"
      >
        <ActiveIcon active={open} line={RiLayoutRightLine} fill={RiLayoutRightFill} className="size-4" />
      </Toggle>
      <Tooltip inverse>{label}</Tooltip>
    </TooltipTrigger>
  )
}

/**
 * The panel's left edge: it lights up on hover and drags to make DevTools wider or narrower. Arrow keys move
 * it in steps; a double click goes back to the default width.
 */
export function DevtoolsResizer({
  width,
  onResize,
  onReset,
}: {
  width: number
  onResize(width: number): void
  onReset(): void
}) {
  const stopDrag = useRef<() => void>(() => {})
  useEffect(() => () => stopDrag.current(), [])

  return (
    <div
      role="separator"
      aria-label="Resize DevTools"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      title="Drag to resize. Double-click for the default width."
      onPointerDown={(down) => {
        down.preventDefault()
        const startWidth = width
        // The panel is on the right: moving the edge left widens it.
        stopDrag.current = startHorizontalDrag(down.clientX, (deltaX) => onResize(startWidth - deltaX))
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(width + KEY_STEP)
        else if (event.key === "ArrowRight") onResize(width - KEY_STEP)
        else return
        event.preventDefault()
      }}
      onDoubleClick={onReset}
      className="group/edge absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize outline-hidden xl:block"
    >
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-transparent transition-colors group-hover/edge:bg-primary group-focus-visible/edge:bg-primary" />
    </div>
  )
}
