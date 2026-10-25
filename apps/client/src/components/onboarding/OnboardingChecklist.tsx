import type { OnboardingItemId } from "@bugberry/shared"
import { RiArrowDownSLine, RiArrowUpSLine, RiCheckLine, RiRecordCircleLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useState } from "react"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import type { OnboardingProgress } from "../../lib/api"
import { doneCount, nextStep, ONBOARDING_COPY } from "../../lib/onboarding"
import { queries } from "../../lib/queries"
import { useCurrentWorkspace } from "../../lib/workspace"
import { installHref } from "../../pages/landing/site-links"
import { InviteDialog } from "../InviteDialog"
import { InstallExtensionButton, NewReportButton } from "../NewReportButton"
import { useOnboarding } from "./OnboardingProvider"

const CONFETTI = ["#D61F69", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#D61F69", "#f59e0b", "#10b981"]

function ProgressBar({ done, total }: { done: number; total: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Getting started progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      className="h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
    </div>
  )
}

function Step({ id, done, current, action, compact }: { id: OnboardingItemId; done: boolean; current: boolean; action: ReactNode; compact: boolean }) {
  const copy = ONBOARDING_COPY[id]
  return (
    <li className={`flex items-start gap-2.5 rounded-lg ${current ? "bg-primary-subtle p-2.5" : "px-2.5 py-1.5"}`}>
      <span
        aria-hidden
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${done ? "border-primary bg-primary text-primary-foreground" : current ? "border-primary" : "border-border"}`}
      >
        {done && <RiCheckLine className="size-3" />}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className={done ? "text-sm text-muted-foreground line-through" : `text-sm ${current ? "font-semibold text-foreground" : "text-foreground"}`}>
          {copy.title}
          <span className="sr-only">{done ? " (done)" : ""}</span>
        </span>
        {current && (
          <>
            <span className="text-xs text-muted-foreground">{copy.hint}</span>
            {action && <div className={compact ? "mt-1" : "mt-1.5"}>{action}</div>}
          </>
        )}
      </div>
    </li>
  )
}

function Celebration({ onCelebrated }: { onCelebrated(): void }) {
  return (
    <div className="relative flex flex-col items-center gap-2 overflow-hidden py-2 text-center">
      <div aria-hidden data-confetti className="pointer-events-none absolute inset-x-0 top-0 h-full">
        {CONFETTI.map((color, index) => (
          <span key={index} style={{ background: color, left: `${8 + index * 12}%`, animationDelay: `${index * 60}ms` }} />
        ))}
      </div>
      <span aria-hidden className="text-3xl">🎉</span>
      <p className="font-heading text-lg font-bold text-foreground">You're all set to catch bugs!</p>
      <p className="max-w-xs text-sm text-muted-foreground">Record, check the console and network, share. That's it.</p>
      <Button size="sm" onPress={onCelebrated} className="mt-1">
        On to bonus missions
      </Button>
    </div>
  )
}

/** The checklist as a card on All reports, or as the corner widget on other pages. */
export function OnboardingChecklistView({
  progress,
  variant,
  actions,
  onCollapse,
  onCelebrated,
  collapsed = progress.collapsed,
}: {
  progress: OnboardingProgress
  variant: "card" | "widget"
  /** The next item's button. */
  actions: Partial<Record<OnboardingItemId, ReactNode>>
  onCollapse(collapsed: boolean): void
  onCelebrated(): void
  /** Overrides the saved state (the phone's widget starts as the pill). */
  collapsed?: boolean
}) {
  const { done, total } = doneCount(progress)
  const next = nextStep(progress)
  const bonus = progress.phase === "bonus"
  const title = bonus ? "Bonus missions" : "Get to know BugBerry"
  const widget = variant === "widget"

  if (collapsed) {
    return (
      <section aria-label="Getting started">
        {widget ? (
          <Button size="sm" onPress={() => onCollapse(false)} className="rounded-full px-4 shadow-lg shadow-primary/30">
            <RiRecordCircleLine aria-hidden />
            {`${bonus ? "Missions" : "Getting started"} ${done}/${total}`}
          </Button>
        ) : (
          <div className="mb-4 flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-2.5 text-sm">
            <span className="font-medium text-foreground">Getting started</span>
            <span className="text-muted-foreground">{`${done} of ${total}`}</span>
            <Button intent="plain" size="sm" aria-label="Show checklist" onPress={() => onCollapse(false)} className="ml-auto">
              Show
              <RiArrowDownSLine aria-hidden />
            </Button>
          </div>
        )}
      </section>
    )
  }

  return (
    <section
      aria-label="Getting started"
      className={
        widget
          ? "w-72 rounded-xl border border-border bg-background p-3 shadow-xl"
          : "mb-4 rounded-xl border border-border bg-background p-4 sm:p-5"
      }
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className={`font-heading font-bold text-foreground ${widget ? "text-sm" : "text-lg"}`}>{title}</h2>
          <p className="text-xs text-muted-foreground">{`${done} of ${total} done`}</p>
        </div>
        <Button intent="plain" size="sq-sm" aria-label="Hide checklist" onPress={() => onCollapse(true)}>
          <RiArrowUpSLine aria-hidden />
        </Button>
      </div>
      <div className="my-3">
        <ProgressBar done={done} total={total} />
      </div>
      {progress.phase === "celebrate" ? (
        <Celebration onCelebrated={onCelebrated} />
      ) : (
        <ol className={`flex flex-col ${widget ? "gap-0.5" : "gap-1 sm:max-w-xl"}`}>
          {progress.steps.map((step) => (
            <Step key={step.id} id={step.id} done={step.done} current={step.id === next} action={actions[step.id]} compact={widget} />
          ))}
        </ol>
      )}
    </section>
  )
}

const MISSING_TARGET: Partial<Record<OnboardingItemId, string>> = {
  devtools: "Capture a report first",
  shared: "Capture a report first",
  comment: "Capture a report first",
  send: "No report in a project with a tracker yet",
}

/** The next item's button, wired to the dashboard; the hint says what's missing when there's nowhere to go. */
function useActions(progress: OnboardingProgress | null, onInvite: () => void): Partial<Record<OnboardingItemId, ReactNode>> {
  const config = useQuery(queries.clientConfig())
  const installUrl = installHref(config.data?.extensionInstallUrl ?? null)
  if (!progress) return {}
  const next = nextStep(progress)
  if (!next) return {}
  const label = ONBOARDING_COPY[next].action
  const link = (to: string) => (
    <Link to={to} className={buttonStyles({ size: "sm" })}>
      {label}
    </Link>
  )
  const report = (target: string | null) =>
    target ? (
      <Link to="/app/r/$reportId" params={{ reportId: target }} className={buttonStyles({ size: "sm" })}>
        {label}
      </Link>
    ) : (
      <span className="text-xs font-medium text-muted-foreground">{MISSING_TARGET[next]}</span>
    )
  const action: Record<OnboardingItemId, () => ReactNode> = {
    extension: () => <InstallExtensionButton installUrl={installUrl} />,
    screenshot: () => <NewReportButton installUrl={installUrl} label={label} prominent />,
    video: () => <NewReportButton installUrl={installUrl} label={label} icon={<RiRecordCircleLine aria-hidden />} prominent />,
    devtools: () => report(progress.reportTarget),
    shared: () => report(progress.reportTarget),
    comment: () => report(progress.reportTarget),
    send: () => report(progress.trackerTarget),
    invite: () => (
      <Button size="sm" onPress={onInvite}>
        {label}
      </Button>
    ),
    project: () => link("/app/settings/projects"),
    tracker: () => link("/app/settings/integrations"),
    agent: () => link("/app/settings/ai"),
  }
  return { [next]: action[next]() }
}

function Connected({ variant, collapsed }: { variant: "card" | "widget"; collapsed?: boolean }) {
  const onboarding = useOnboarding()
  const { workspace } = useCurrentWorkspace()
  const [inviting, setInviting] = useState(false)
  const actions = useActions(onboarding?.progress ?? null, () => setInviting(true))
  if (!onboarding) return null
  return (
    <>
      <OnboardingChecklistView
        progress={onboarding.progress}
        variant={variant}
        actions={actions}
        collapsed={collapsed}
        onCollapse={onboarding.setCollapsed}
        onCelebrated={() => onboarding.record("celebrated")}
      />
      {workspace && <InviteDialog workspaceId={workspace.id} isOpen={inviting} onOpenChange={setInviting} />}
    </>
  )
}

/** The checklist at the top of All reports. */
export function OnboardingCard() {
  return <Connected variant="card" />
}

/**
 * The checklist in a corner of every other page: bottom right, or bottom left on phones (the New report button is
 * right). On phones, and with `startAsPill` (the report page, where it would cover the DevTools panel), it starts as
 * the pill until opened on this page.
 */
export function OnboardingWidget({ startAsPill = false }: { startAsPill?: boolean }) {
  const onboarding = useOnboarding()
  const phone = useMediaQuery("(max-width: 767px)")
  const [opened, setOpened] = useState(false)
  if (!onboarding) return null
  const pill = (phone || startAsPill) && !opened
  const collapsed = pill ? true : onboarding.progress.collapsed
  return (
    <>
      {/* Phones scroll the window: room at the end of the page, so the pill never sits on its last button. */}
      <div aria-hidden className="h-16 md:hidden" />
      <div
        className="fixed bottom-4 left-4 z-30 md:right-4 md:left-auto"
        onClickCapture={(event) => {
          if (pill && (event.target as HTMLElement).closest("button")) setOpened(true)
        }}
      >
        <Connected variant="widget" collapsed={collapsed} />
      </div>
    </>
  )
}
