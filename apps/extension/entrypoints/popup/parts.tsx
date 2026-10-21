import { RiInformationLine, RiTerminalLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Button as AriaButton } from "react-aria-components"

/** The big round button: pink with a white dot or camera to start, red with a white square to stop. */
export function Dial(props: { label: string; tone: "primary" | "danger"; disabled?: boolean; onPress(): void; children: ReactNode }) {
  const tone =
    props.tone === "primary"
      ? "bg-primary text-primary-foreground shadow-[0_8px_24px_-6px_color-mix(in_oklab,var(--primary)_55%,transparent)]"
      : "bg-danger text-danger-foreground shadow-[0_8px_24px_-6px_color-mix(in_oklab,var(--danger)_55%,transparent)]"
  const halo = props.tone === "primary" ? "bg-primary/12" : "bg-danger/12"
  return (
    <span className={`grid place-items-center rounded-full p-3 ${halo}`}>
      <AriaButton
        aria-label={props.label}
        isDisabled={props.disabled}
        onPress={props.onPress}
        className={`grid size-[76px] cursor-pointer place-items-center rounded-full outline-hidden transition hover:brightness-105 pressed:scale-[0.97] focus-visible:ring-4 focus-visible:ring-ring/30 disabled:cursor-default disabled:opacity-60 ${tone}`}
      >
        {props.children}
      </AriaButton>
    </span>
  )
}

/** The white note under the controls. */
export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-xl bg-background px-3 py-2.5 text-[13px] leading-snug text-muted-foreground">
      <RiInformationLine size={15} aria-hidden className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/** Where the logs come from, and whether there are any: a marker, never a switch. */
export function Footer({ text, logsOn }: { text: string; logsOn: boolean }) {
  return (
    <footer className="flex items-center justify-between gap-3 border-t border-border px-3.5 py-2 text-[13px] text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        <RiTerminalLine size={15} aria-hidden className="shrink-0" />
        <span className="truncate">{text}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span aria-hidden className={`size-2 rounded-full ${logsOn ? "bg-success" : "bg-muted-foreground/40"}`} />
        {logsOn ? "Logs on" : "Logs off"}
      </span>
    </footer>
  )
}

/** A section's small capital label ("SCREENSHOT", "RECORD"). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{children}</span>
}
