import { DEMO_TEAM_SIZES, DEMO_TRACKERS } from "@bugberry/shared"
import { Elysia, t } from "elysia"
import type { AppDeps } from "../../app"
import { demoRequest } from "../../db/schema"
import { demoRequestEmail } from "../../email/demo-request-email"
import { createEmailSender, type EmailSender } from "../../email/sender"
import { notFound, tooManyRequests } from "../../lib/errors"
import { newId } from "../../lib/ids"
import { createRateLimiter } from "../../lib/rate-limit"
import { oneOf } from "../../lib/schema"
import { clientIp } from "../share"

/** Enough for someone who mistyped and sent again; not enough to fill the table. */
const REQUESTS_PER_IP_PER_HOUR = 5

/** Needs at least one character that isn't a space. */
const filled = (maxLength: number) => t.String({ minLength: 1, maxLength, pattern: "\\S" })

/** Public: "Book your demo" on the public site. Stored, then emailed to DEMO_REQUEST_EMAIL when it is set. */
export function demoRequestsModule(deps: AppDeps) {
  const { db, config } = deps
  const limiter = createRateLimiter({ limit: REQUESTS_PER_IP_PER_HOUR, windowMs: 60 * 60 * 1000 })
  const sender: EmailSender | null = deps.email ?? (config.email ? createEmailSender(config.email) : null)

  return new Elysia().post(
    "/demo-requests",
    async ({ body, request, server }) => {
      if (!config.publicSite) throw notFound()
      if (!limiter.consume(clientIp(request, server, config.proxyHops))) throw tooManyRequests()
      // Bots fill in every field; people never see this one. They are thanked all the same.
      if (body.website) return { ok: true as const }

      const input = {
        firstName: body.firstName.trim(),
        lastName: body.lastName.trim(),
        email: body.email.trim(),
        company: body.company.trim(),
        tracker: body.tracker,
        teamSize: body.teamSize,
        message: (body.message ?? "").trim(),
        selfHosting: body.selfHosting,
      }
      const receivedAt = new Date()
      await db.insert(demoRequest).values({ id: newId(), ...input, createdAt: receivedAt })

      const to = config.demoRequestEmail
      if (to && sender) {
        // The request is kept whatever the mail service does; a failure only reaches the log.
        const task = sender
          .send({ to, ...demoRequestEmail({ ...input, receivedAt }) })
          .catch((error: unknown) => console.error(`Demo request email failed: ${error instanceof Error ? error.message : String(error)}`))
        deps.background?.(task)
      }
      return { ok: true as const }
    },
    {
      body: t.Object({
        firstName: filled(80),
        lastName: filled(80),
        email: t.String({ format: "email", maxLength: 254 }),
        company: filled(120),
        tracker: oneOf(DEMO_TRACKERS),
        teamSize: oneOf(DEMO_TEAM_SIZES),
        message: t.Optional(t.String({ maxLength: 2000 })),
        selfHosting: t.Boolean(),
        website: t.Optional(t.String({ maxLength: 500 })),
      }),
    },
  )
}
