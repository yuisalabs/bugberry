import { Elysia, t } from "elysia"
import type { AppDeps } from "../../deps"
import { authPlugin } from "../../plugins/auth"
import { tooManyRequests } from "../../lib/errors"
import { createRateLimiter } from "../../lib/rate-limit"
import { requireMember } from "../workspaces/access"
import { providerBody, settingsBody, templateFields, writeBody } from "./model"
import { createAiService } from "./service"

/** Each write-up costs the workspace money at its provider. */
const WRITES_PER_MINUTE = 20

/** Write with AI: the workspace's own key (BYOK), its settings and its shared templates. */
export function aiModule(deps: AppDeps) {
  const { db } = deps
  const ai = createAiService(deps)
  const writes = createRateLimiter({ limit: WRITES_PER_MINUTE, windowMs: 60_000 })
  // Saving sends a test request: limited too, so it can't be used to probe addresses.
  const saves = createRateLimiter({ limit: 10, windowMs: 60_000 })

  return new Elysia()
    .use(authPlugin(deps))
    .get(
      "/workspaces/:id/ai",
      async ({ user, params }) => {
        const role = await requireMember(db, user.id, params.id)
        return ai.setup(params.id, role)
      },
      { auth: true },
    )
    .put(
      "/workspaces/:id/ai/provider",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id, "admin")
        if (!saves.consume(user.id)) throw tooManyRequests()
        return ai.saveProvider(params.id, user.id, body)
      },
      { auth: true, body: providerBody },
    )
    .delete(
      "/workspaces/:id/ai/provider",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id, "admin")
        return ai.removeProvider(params.id)
      },
      { auth: true },
    )
    .patch(
      "/workspaces/:id/ai/settings",
      async ({ user, params, body }) => {
        const role = await requireMember(db, user.id, params.id, "admin")
        return ai.saveSettings(params.id, role, body)
      },
      { auth: true, body: settingsBody },
    )
    .post(
      "/workspaces/:id/ai/templates",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        return ai.createTemplate(params.id, user.id, body)
      },
      { auth: true, body: t.Object(templateFields) },
    )
    .patch(
      "/workspaces/:id/ai/templates/:templateId",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        return ai.changeTemplate(params.id, params.templateId, body)
      },
      { auth: true, body: t.Partial(t.Object(templateFields)) },
    )
    .post(
      "/workspaces/:id/ai/write",
      async ({ user, params, body }) => {
        await requireMember(db, user.id, params.id)
        if (!writes.consume(user.id)) throw tooManyRequests()
        return ai.write(params.id, body)
      },
      { auth: true, body: writeBody },
    )
    .delete(
      "/workspaces/:id/ai/templates/:templateId",
      async ({ user, params }) => {
        await requireMember(db, user.id, params.id)
        return ai.removeTemplate(params.id, params.templateId)
      },
      { auth: true },
    )
}
