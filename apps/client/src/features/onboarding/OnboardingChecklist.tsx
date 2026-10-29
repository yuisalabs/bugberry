import type { OnboardingItemId } from "@bugberry/shared"
import { RiArrowDownSLine, RiCheckLine, RiRecordCircleLine } from "@remixicon/react"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { type ReactNode, useEffect, useState } from "react"
import { Button, buttonStyles } from "@bugberry/ui/button"
import { useMediaQuery } from "../../hooks/useMediaQuery"
import { doneCount, nextStep, ONBOARDING_COPY } from "./onboarding"
import { useCurrentWorkspace } from "../workspaces/workspace"
import { installHref } from "../../pages/landing/site-links"
import { InviteDialog } from "../workspaces/InviteDialog"
import { InstallExtensionButton, NewReportButton } from "../../components/NewReportButton"
import { useOnboarding } from "./OnboardingProvider"
import { authQueries } from "../auth/queries"
import type { OnboardingProgress } from "./queries"

/** How long the panel takes to fold into the pill (styles.css, onboarding-out). */
const CLOSE_MS = 180

const reducedMotion = () => typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches

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

function Step({ id, done, current, action }: { id: OnboardingItemId; done: boolean; current: boolean; action: ReactNode }) {
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
            {action && <div className="mt-1">{action}</div>}
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

/** The checklist as a floating panel, or as a pill while collapsed. */
export function OnboardingChecklistView({
  progress,
  actions,
  onCollapse,
  onCelebrated,
  collapsed = progress.collapsed,
}: {
  progress: OnboardingProgress
  /** The next item's button. */
  actions: Partial<Record<OnboardingItemId, ReactNode>>
  onCollapse(collapsed: boolean): void
  onCelebrated(): void
  /** Overrides the saved state (pages other than All reports, and phones, start as the pill). */
  collapsed?: boolean
}) {
  const { done, total } = doneCount(progress)
  const next = nextStep(progress)
  const bonus = progress.phase === "bonus"
  // Hiding plays the panel's closing animation first, then it becomes the pill.
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    if (!leaving) return
    const timer = setTimeout(() => {
      setLeaving(false)
      onCollapse(true)
    }, CLOSE_MS)
    return () => clearTimeout(timer)
  }, [leaving])
  const hide = () => (reducedMotion() ? onCollapse(true) : setLeaving(true))

  if (collapsed) {
    return (
      <section aria-label="Getting started" data-onboarding-pill>
        <Button size="sm" onPress={() => onCollapse(false)} className="rounded-full px-4 shadow-lg shadow-primary/30">
          <RiRecordCircleLine aria-hidden />
          {`${bonus ? "Missions" : "Getting started"} ${done}/${total}`}
        </Button>
      </section>
    )
  }

  return (
    <section
      aria-label="Getting started"
      data-onboarding-panel
      {...(leaving ? { "data-leaving": "" } : {})}
      className="w-72 rounded-xl border border-border bg-background p-3 shadow-xl"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="font-heading text-sm font-bold text-foreground">{bonus ? "Bonus missions" : "Get to know BugBerry"}</h2>
          <p className="text-xs text-muted-foreground">{`${done} of ${total} done`}</p>
        </div>
        <Button intent="plain" size="sq-sm" aria-label="Hide checklist" isDisabled={leaving} onPress={hide}>
          <RiArrowDownSLine aria-hidden />
        </Button>
      </div>
      <div className="my-3">
        <ProgressBar done={done} total={total} />
      </div>
      {progress.phase === "celebrate" ? (
        <Celebration onCelebrated={onCelebrated} />
      ) : (
        <ol className="flex flex-col gap-0.5">
          {progress.steps.map((step) => (
            <Step key={step.id} id={step.id} done={step.done} current={step.id === next} action={actions[step.id]} />
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
  const config = useQuery(authQueries.clientConfig())
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

function Connected({ collapsed }: { collapsed: boolean }) {
  const onboarding = useOnboarding()
  const { workspace } = useCurrentWorkspace()
  const [inviting, setInviting] = useState(false)
  const actions = useActions(onboarding?.progress ?? null, () => setInviting(true))
  if (!onboarding) return null
  return (
    <>
      <OnboardingChecklistView
        progress={onboarding.progress}
        actions={actions}
        collapsed={collapsed}
        onCollapse={onboarding.setCollapsed}
        onCelebrated={() => onboarding.record("celebrated")}
      />
      {workspace && <InviteDialog workspaceId={workspace.id} isOpen={inviting} onOpenChange={setInviting} />}
    </>
  )
}

/**
 * The checklist floating in the bottom left corner of every page (the New report button is on the right). Open on
 * All reports; with `startAsPill` (every other page), and on phones, it starts as the pill until opened on this page.
 */
export function OnboardingWidget({
  startAsPill = false,
  aboveBottomBar = false,
}: {
  startAsPill?: boolean
  /** The report page's phone layout has Copy link in a bar along the bottom: the widget sits above it. */
  aboveBottomBar?: boolean
}) {
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
        className={`fixed left-4 z-30 ${aboveBottomBar ? "bottom-20 md:bottom-4" : "bottom-4"}`}
        onClickCapture={(event) => {
          if (pill && (event.target as HTMLElement).closest("button")) setOpened(true)
        }}
      >
        <Connected collapsed={collapsed} />
      </div>
    </>
  )
}
