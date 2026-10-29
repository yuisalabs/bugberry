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
import { ProviderMark } from "./IntegrationForm"
import { integrationCard, StatusChip } from "./IntegrationsLayout"
import { Badge } from "../../components/ui/badge"
import { dangerText } from "../../components/ui/danger-text"
import { useNow } from "../../hooks/useNow"
import { formatRelative } from "../../lib/format"
import type { TestResult } from "./integrations-ui"
import type { Integration } from "./queries"

/** The connection's name, and where this use sends when that says more. */
export const titleOf = (integration: Integration) =>
  integration.label === integration.connection.name ? integration.connection.name : `${integration.connection.name} → ${integration.label}`

/** A project's use of a connection: where it sends, how, its last message, and its actions. */
export function IntegrationRow({
  integration,
  testResult,
  testing,
  removing,
  onTest,
  onEdit,
  onRemove,
}: {
  integration: Integration
  testResult: TestResult | null
  testing: boolean
  removing: boolean
  onTest(): void
  onEdit(): void
  onRemove(): void
}) {
  const now = useNow()
  const notifier = !isTrackerProvider(integration.provider)
  const title = titleOf(integration)
  const labels = "labels" in integration.target ? (integration.target.labels as string[]) : []
  return (
    <li className={`flex flex-col gap-4 p-6 ${integrationCard}`}>
      <div className="flex items-start justify-between gap-3">
        <ProviderMark provider={integration.provider} className="size-11" />
        <span className="flex flex-wrap justify-end gap-2">
          <StatusChip failing={notifier && Boolean(integration.lastError)} />
          {integration.autoSend && <Badge className="bg-primary-subtle text-primary">Sends every report</Badge>}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="break-words font-heading font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">
          {PROVIDER_LABELS[integration.provider]} · {notifier ? "Posts new reports" : labels.length ? `Labels: ${labels.join(", ")}` : "Creates issues"}
        </p>
        {notifier && integration.lastError && (
          <p className="flex items-center gap-1.5 text-sm text-danger-subtle-foreground">
            <RiCloseCircleLine aria-hidden className="size-4 shrink-0" />
            Last message failed: {integration.lastError}
          </p>
        )}
        {notifier && !integration.lastError && integration.lastDeliveredAt && (
          <p className="text-sm text-muted-foreground">Last message {formatRelative(integration.lastDeliveredAt, now)}</p>
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
          {notifier ? <RiSendPlaneLine aria-hidden /> : <RiPulseLine aria-hidden />}
          {notifier ? "Send test message" : "Test connection"}
        </Button>
        {!notifier && (
          <Button size="sm" intent="outline" onPress={onEdit} aria-label={`Edit ${title}`}>
            <RiPencilLine aria-hidden />
            Edit
          </Button>
        )}
        <Button size="sm" intent="plain" isDisabled={removing} onPress={onRemove} aria-label={`Remove ${title}`} className={dangerText}>
          <RiDeleteBinLine aria-hidden />
          Remove
        </Button>
      </span>
    </li>
  )
}
