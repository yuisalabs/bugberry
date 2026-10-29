import { isTrackerProvider, PROVIDER_LABELS } from "@bugberry/shared"
import {
  RiCheckboxCircleLine,
  RiCloseCircleLine,
  RiDeleteBinLine,
  RiPencilLine,
  RiPulseLine,
  RiSendPlaneLine,
} from "@remixicon/react"
import { Button } from "@bugberry/ui/button"
import { integrationCard as card, StatusChip } from "./IntegrationsLayout"
import { ProviderMark } from "./IntegrationForm"
import { dangerText } from "../../components/ui/danger-text"
import { useNow } from "../../hooks/useNow"
import { formatRelative } from "../../lib/format"
import type { TestResult } from "./integrations-ui"
import type { Connection } from "./queries"
import { projects, usageText } from "./provider-info"

/** A connection: what it is, whether it works, which projects use it, and its actions. */
export function ConnectionRow({
  connection,
  testResult,
  testing,
  removing,
  onTest,
  onEdit,
  onDelete,
}: {
  connection: Connection
  testResult: TestResult | null
  testing: boolean
  removing: boolean
  onTest(): void
  onEdit(): void
  onDelete(): void
}) {
  const now = useNow()
  const notifier = !isTrackerProvider(connection.provider)
  // Telegram's account test checks the bot; its messages go from a project, where the chat is.
  const sendsTest = notifier && connection.provider !== "telegram"
  const { status } = connection
  const failing = notifier && status.failing > 0
  return (
    <li className={`flex flex-col gap-4 p-6 ${card}`}>
      <div className="flex items-start justify-between gap-3">
        <ProviderMark provider={connection.provider} className="size-11" />
        <StatusChip failing={failing} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="font-heading font-semibold text-foreground">{PROVIDER_LABELS[connection.provider]}</h3>
        <p className="break-words text-sm text-muted-foreground">
          {connection.name} · {usageText(connection)}
        </p>
        {failing && (
          <p className="flex items-center gap-1.5 text-sm text-danger-subtle-foreground">
            <RiCloseCircleLine aria-hidden className="size-4 shrink-0" />
            Last message failed in {projects(status.failing)}: {status.lastError}
          </p>
        )}
        {notifier && status.failing === 0 && status.lastDeliveredAt && (
          <p className="text-sm text-muted-foreground">Last message {formatRelative(status.lastDeliveredAt, now)}</p>
        )}
        {testResult && (
          <p
            role="status"
            className={`flex items-center gap-1.5 text-sm ${testResult.ok ? "text-success-subtle-foreground" : "text-danger-subtle-foreground"}`}
          >
            {testResult.ok ? <RiCheckboxCircleLine aria-hidden className="size-4" /> : <RiCloseCircleLine aria-hidden className="size-4" />}
            {testResult.message}
          </p>
        )}
      </div>
      <span className="flex flex-wrap gap-2">
        <Button size="sm" intent="outline" isDisabled={testing} onPress={onTest}>
          {sendsTest ? <RiSendPlaneLine aria-hidden /> : <RiPulseLine aria-hidden />}
          {sendsTest ? "Send test message" : "Test connection"}
        </Button>
        <Button size="sm" intent="outline" onPress={onEdit} aria-label={`Edit ${connection.name}`}>
          <RiPencilLine aria-hidden />
          Edit
        </Button>
        <Button size="sm" intent="plain" isDisabled={removing} onPress={onDelete} aria-label={`Delete ${connection.name}`} className={dangerText}>
          <RiDeleteBinLine aria-hidden />
          Delete
        </Button>
      </span>
    </li>
  )
}
