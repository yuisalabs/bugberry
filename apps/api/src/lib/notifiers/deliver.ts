import { NOTIFIER_PROVIDERS, type NotifierConfig, type NotifierProvider } from "@bugberry/shared"
import { and, eq, inArray, sql } from "drizzle-orm"
import type { AppDeps } from "../../app"
import { integration, project, report, user } from "../../db/schema"
import { createHostGuard } from "../net/host-guard"
import { createSecretBox, SECRET_UNREADABLE } from "../secret-box"
import { DEFAULT_TIMEOUT_MS, TrackerError } from "../trackers/providers"
import { createNotifierFactory, type NotifierFactory } from "./channels"
import { buildNewReportMessage, type NewReportMessage } from "./message"

/** The app's notifier factory: the one a test gave, or the real one behind the private-network guard. */
export function notifierFactoryFor(deps: Pick<AppDeps, "notifiers" | "config">): NotifierFactory {
  return (
    deps.notifiers ??
    createNotifierFactory(fetch, DEFAULT_TIMEOUT_MS, createHostGuard({ allowPrivate: deps.config.allowPrivateIntegrationHosts }))
  )
}

/** Waits between the three tries: a channel that is briefly down gets the message within a minute. */
const RETRY_DELAYS_MS = [5_000, 30_000]
const MAX_ERROR_LENGTH = 300

export function deliveryFailure(error: unknown): string {
  return error instanceof TrackerError ? error.message : "The message could not be sent"
}

interface DeliveryOptions {
  sleep?: (ms: number) => Promise<void>
  delaysMs?: number[]
}

type Deps = Pick<AppDeps, "config" | "db" | "notifiers">

/** Posts a just-finalized report to every notification channel of its project. One failing channel never stops the others. */
export async function notifyNewReport(deps: Deps, reportId: string, opts: DeliveryOptions = {}): Promise<void> {
  const [row] = await deps.db
    .select({
      id: report.id,
      number: report.number,
      title: report.title,
      pageUrl: report.pageUrl,
      device: report.device,
      debuggerSummary: report.debuggerSummary,
      createdAt: report.createdAt,
      projectId: project.id,
      projectName: project.name,
      reporterName: user.name,
    })
    .from(report)
    .innerJoin(project, eq(project.id, report.projectId))
    .innerJoin(user, eq(user.id, report.reporterId))
    .where(and(eq(report.id, reportId), eq(report.uploadStatus, "ready")))
    .limit(1)
  if (!row) return
  const channels = await deps.db
    .select({ id: integration.id, provider: integration.provider, config: integration.config, secretEncrypted: integration.secretEncrypted })
    .from(integration)
    .where(and(eq(integration.projectId, row.projectId), inArray(integration.provider, [...NOTIFIER_PROVIDERS])))
  const message = buildNewReportMessage(row, row.projectName, row.reporterName, deps.config.appUrl)
  await Promise.all(
    channels.map((channel) =>
      deliver(deps, { ...channel, provider: channel.provider as NotifierProvider }, message, opts).catch((error) =>
        console.error("notification failed", { reportId, integrationId: channel.id, error }),
      ),
    ),
  )
}

interface Channel {
  id: string
  provider: NotifierProvider
  config: unknown
  secretEncrypted: string
}

async function deliver(deps: Deps, channel: Channel, message: NewReportMessage, opts: DeliveryOptions): Promise<void> {
  const sleep = opts.sleep ?? ((ms: number) => Bun.sleep(ms))
  const delays = opts.delaysMs ?? RETRY_DELAYS_MS
  const record = (values: { lastError: string | null; lastDeliveredAt?: ReturnType<typeof sql> }) =>
    deps.db
      .update(integration)
      .set({ ...values, lastError: values.lastError?.slice(0, MAX_ERROR_LENGTH) ?? null })
      .where(eq(integration.id, channel.id))

  let secret: string
  try {
    secret = createSecretBox(deps.config.encryptionKey).open(channel.secretEncrypted)
  } catch {
    await record({ lastError: SECRET_UNREADABLE })
    return
  }
  const client = notifierFactoryFor(deps)(channel.provider, channel.config as NotifierConfig, secret)
  for (let attempt = 0; ; attempt++) {
    try {
      await client.send(message)
      await record({ lastError: null, lastDeliveredAt: sql`now()` })
      return
    } catch (error) {
      const wait = delays[attempt]
      if (wait === undefined) {
        await record({ lastError: deliveryFailure(error) })
        return
      }
      await sleep(wait)
    }
  }
}
