import type { AppDeps } from "../../deps"
import { createEmailSender } from "../../lib/email/sender"
import { reportUrl } from "../../mcp/format"
import { findArrival, insertReceivedNotification } from "./repository"
import { receivedEmail } from "./received-email"

/** Tells the member who made the link that a recording came through it: in the bell, and by email when one is set up. */
export async function notifyRequester(deps: AppDeps, reportId: string): Promise<void> {
  const arrival = await findArrival(deps.db, reportId)
  if (!arrival?.senderName) return
  await insertReceivedNotification(deps.db, { userId: arrival.makerId, reportId })
  const sender = deps.email ?? (deps.config.email ? createEmailSender(deps.config.email) : null)
  if (!sender) return
  const email = receivedEmail({
    senderName: arrival.senderName,
    reportNumber: arrival.number,
    reportTitle: arrival.title,
    reportUrl: reportUrl(deps.config.appUrl, reportId),
    workspaceName: arrival.workspaceName,
  })
  await sender.send({ to: arrival.makerEmail, ...email })
}
