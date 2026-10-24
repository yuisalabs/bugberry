import { RiHeadphoneLine, RiMicLine, RiMicOffLine, RiShieldCheckLine, RiUsbLine } from "@remixicon/react"
import { type ReactNode, type RefObject, useEffect, useRef } from "react"
import { Button as AriaButton, Radio, RadioGroup } from "react-aria-components"
import type { MicAccess, MicDevice, MicKind } from "../../lib/microphone"
import { LevelBars } from "./CapturePanel"
import type { LevelSource } from "./PopupView"

const NONE = "none"
const ICONS: Record<MicKind, ReactNode> = {
  "built-in": <RiMicLine size={18} aria-hidden />,
  other: <RiMicLine size={18} aria-hidden />,
  headset: <RiHeadphoneLine size={18} aria-hidden />,
  usb: <RiUsbLine size={18} aria-hidden />,
}

/**
 * The microphones, over the tiles above the Mic chip. Before Chrome lets BugBerry use the microphone it
 * has no names to show: then the only choice besides "No microphone" is to allow it.
 */
export function MicPicker(props: {
  access: MicAccess
  devices: MicDevice[]
  /** The chosen device; null is "No microphone". */
  chosen: string | null
  /** The device the level bars listen to. */
  metered: string | null
  level: LevelSource
  /** The Mic chip: a press there toggles the picker, so it doesn't count as a click outside. */
  chipRef: RefObject<HTMLElement | null>
  onChoose(id: string | null): void
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
      aria-label="Microphone"
      className="absolute bottom-full left-1/2 z-10 mb-2 w-[330px] -translate-x-1/2 rounded-2xl border border-border bg-background p-1.5 text-left shadow-[0_12px_32px_-8px_rgb(28_16_34/0.22)]"
    >
      <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
        <span className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">Microphone</span>
        {granted && <span className="text-xs text-muted-foreground">{`${props.devices.length} found`}</span>}
      </div>
      <RadioGroup
        aria-label="Microphone"
        value={props.chosen ?? NONE}
        onChange={(value) => props.onChoose(value === NONE ? null : value)}
        className="flex flex-col gap-1"
      >
        <Row id={NONE} name="No microphone" detail="Record without voice" icon={<RiMicOffLine size={18} aria-hidden />} />
        {granted &&
          props.devices.map((device) => (
            <Row
              key={device.id}
              id={device.id}
              name={device.name}
              detail={device.detail}
              icon={ICONS[device.kind]}
              level={device.id === props.metered ? props.level : null}
            />
          ))}
      </RadioGroup>
      {props.access === "prompt" && (
        <AriaButton
          onPress={props.onAllow}
          className="mt-1 flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-hidden hover:bg-muted focus-visible:bg-muted"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <RiMicLine size={18} aria-hidden />
          </span>
          <span className="text-[15px] font-semibold text-primary">Allow microphone access</span>
        </AriaButton>
      )}
      {props.access === "denied" && (
        <p className="mx-2.5 mt-1 rounded-lg bg-danger-subtle px-2.5 py-2 text-[13px] text-danger-subtle-foreground">
          Microphone is blocked. Allow it for BugBerry in Chrome's site settings.
        </p>
      )}
      <p className="mx-1 mt-1.5 flex gap-2 border-t border-border px-1.5 pt-2.5 pb-1.5 text-[13px] leading-snug text-muted-foreground">
        <RiShieldCheckLine size={15} aria-hidden className="mt-px shrink-0" />
        <span>Chrome asks for mic access the first time. Your choice is remembered.</span>
      </p>
    </div>
  )
}

export function Row(props: { id: string; name: string; detail: string; icon: ReactNode; level?: LevelSource | null }) {
  return (
    <Radio
      value={props.id}
      className={({ isSelected, isFocusVisible }) =>
        `flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 outline-hidden transition-colors ${
          isSelected ? "bg-primary-subtle" : "hover:bg-muted"
        } ${isFocusVisible ? "ring-2 ring-ring/40" : ""}`
      }
    >
      {({ isSelected }) => (
        <>
          <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${isSelected ? "bg-background text-primary" : "bg-muted text-foreground"}`}>
            {props.icon}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className={`truncate text-[15px] font-semibold ${isSelected ? "text-primary" : "text-foreground"}`}>{props.name}</span>
            {props.detail && <span className="truncate text-[13px] text-muted-foreground">{props.detail}</span>}
          </span>
          {props.level != null && <LevelBars level={props.level} />}
          <span
            aria-hidden
            className={`size-5 shrink-0 rounded-full ${isSelected ? "border-[5px] border-primary bg-background" : "border-2 border-border bg-background"}`}
          />
        </>
      )}
    </Radio>
  )
}

/** A picker over the chips closes on a press outside it (but not on its chip, which toggles it) and on Esc. */
export function usePickerDismiss(panel: RefObject<HTMLElement | null>, chipRef: RefObject<HTMLElement | null>, onClose: () => void) {
  // Capture phase: React Aria's buttons stop their presses from bubbling, and Esc must work wherever focus is.
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node
      if (!panel.current?.contains(target) && !chipRef.current?.contains(target)) onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.stopPropagation()
      onClose()
    }
    document.addEventListener("pointerdown", outside, true)
    document.addEventListener("keydown", escape, true)
    return () => {
      document.removeEventListener("pointerdown", outside, true)
      document.removeEventListener("keydown", escape, true)
    }
  }, [panel, onClose, chipRef])
}
