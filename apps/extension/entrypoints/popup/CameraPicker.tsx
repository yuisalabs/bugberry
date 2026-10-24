import { RiCheckboxBlankCircleLine, RiRectangleLine, RiShieldCheckLine, RiVideoOffLine, RiVideoOnLine } from "@remixicon/react"
import { type ReactNode, type RefObject, useRef } from "react"
import { Button as AriaButton, Radio, RadioGroup } from "react-aria-components"
import type { CameraAccess, CameraDevice } from "../../lib/camera"
import type { CameraShape } from "../../lib/capture-prefs"
import { Row, usePickerDismiss } from "./MicPicker"

const NONE = "none"

/**
 * The cameras, and the bubble's shape, over the tiles above the Camera chip. Before Chrome lets BugBerry use
 * the camera it has no names to show: then the only choice besides "No camera" is to allow it.
 */
export function CameraPicker(props: {
  access: CameraAccess
  devices: CameraDevice[]
  /** The chosen camera; null is "No camera", "" is on with the system's default camera. */
  chosen: string | null
  shape: CameraShape
  /** The Camera chip: a press there toggles the picker, so it doesn't count as a click outside. */
  chipRef: RefObject<HTMLElement | null>
  onChoose(id: string | null): void
  onShape(shape: CameraShape): void
  onAllow(): void
  onClose(): void
}) {
  const panel = useRef<HTMLDivElement>(null)
  usePickerDismiss(panel, props.chipRef, props.onClose)
  const granted = props.access === "granted"

  return (
    <div
      ref={panel}
      role="dialog"
      aria-label="Camera"
      className="absolute bottom-full left-1/2 z-10 mb-2 w-[330px] -translate-x-1/2 rounded-2xl border border-border bg-background p-1.5 text-left shadow-[0_12px_32px_-8px_rgb(28_16_34/0.22)]"
    >
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Camera</span>
        {granted && <span className="text-xs text-muted-foreground">{`${props.devices.length} found`}</span>}
      </div>
      <RadioGroup aria-label="Camera" value={props.chosen ?? NONE} onChange={(value) => props.onChoose(value === NONE ? null : value)} className="flex flex-col gap-1">
        <Row id={NONE} name="No camera" detail="Record without your face" icon={<RiVideoOffLine size={18} aria-hidden />} />
        {granted && props.devices.map((device) => <Row key={device.id} id={device.id} name={device.name} detail="" icon={<RiVideoOnLine size={18} aria-hidden />} />)}
      </RadioGroup>
      {props.access === "prompt" && (
        <AriaButton
          onPress={props.onAllow}
          className="mt-1 flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-hidden hover:bg-muted focus-visible:bg-muted"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <RiVideoOnLine size={18} aria-hidden />
          </span>
          <span className="text-[15px] font-semibold text-primary">Allow camera access</span>
        </AriaButton>
      )}
      {props.access === "denied" && (
        <p className="mx-2.5 mt-1 rounded-lg bg-danger-subtle px-2.5 py-2 text-[13px] text-danger-subtle-foreground">
          Camera is blocked. Allow it for BugBerry in Chrome's site settings.
        </p>
      )}
      {props.chosen !== null && (
        <div className="mx-1 mt-1.5 flex items-center justify-between gap-3 border-t border-border px-1.5 pt-2.5 pb-1">
          <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Shape</span>
          <RadioGroup
            aria-label="Shape"
            orientation="horizontal"
            value={props.shape}
            onChange={(value) => props.onShape(value === "rectangle" ? "rectangle" : "circle")}
            className="flex gap-1.5"
          >
            <ShapeOption value="circle" label="Circle" icon={<RiCheckboxBlankCircleLine size={16} aria-hidden />} />
            <ShapeOption value="rectangle" label="Rectangle" icon={<RiRectangleLine size={16} aria-hidden />} />
          </RadioGroup>
        </div>
      )}
      <p className="mx-1 mt-1.5 flex gap-2 border-t border-border px-1.5 pt-2.5 pb-1.5 text-[13px] leading-snug text-muted-foreground">
        <RiShieldCheckLine size={15} aria-hidden className="mt-px shrink-0" />
        <span>Your camera shows in a bubble on the recorded tab, and is in the video.</span>
      </p>
    </div>
  )
}

function ShapeOption(props: { value: CameraShape; label: string; icon: ReactNode }) {
  return (
    <Radio
      value={props.value}
      className={({ isSelected, isFocusVisible }) =>
        `flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm font-semibold outline-hidden transition-colors ${
          isSelected ? "bg-primary-subtle text-primary" : "border border-border bg-background text-muted-foreground hover:bg-muted"
        } ${isFocusVisible ? "ring-2 ring-ring/40" : ""}`
      }
    >
      {props.icon}
      {props.label}
    </Radio>
  )
}
