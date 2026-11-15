import type { AccountLimits } from "../../config"
import { type Db, withSavepoint } from "../../db/client"
import { conflict, unprocessable } from "../../lib/errors"
import { isWorkspaceLimited } from "./limits"
import { insertWorkspace, listInvitingWorkspaces, startOnboarding as startOnboardingRow } from "./repository"
import { freeSlug, isUniqueViolation, slugProblem } from "./slug"

/** A suggested slug can lose a race with another new workspace; it is picked again this many times. */
const SLUG_ATTEMPTS = 5

/** "Budi's workspace": the first word of the name, else the address's local part. */
export function defaultWorkspaceName(userName: string, email: string): string {
  const first = userName.trim().split(/\s+/)[0] || email.split("@")[0] || "My"
  return `${first}'s workspace`
}

/**
 * A new workspace owned by its creator, who is also its admin; it becomes their current workspace.
 * Without a typed slug, a free one is picked from the name.
 */
export async function createWorkspace(
  db: Db,
  ownerId: string,
  name: string,
  typedSlug?: string,
): Promise<{ id: string; name: string; slug: string }> {
  if (typedSlug !== undefined && slugProblem(typedSlug)) throw unprocessable("invalid_slug", "Use 3–40 lowercase letters, numbers or dashes")
  for (let attempt = 1; ; attempt++) {
    const slug = typedSlug ?? (await freeSlug(db, name))
    try {
      // A savepoint, so a slug lost to a race inside the caller's transaction can be retried.
      return await withSavepoint(db, async () => ({ ...(await insertWorkspace(db, { name, slug, ownerId })), slug }))
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      if (typedSlug !== undefined) throw conflict("slug_taken", "This URL is taken")
      if (attempt >= SLUG_ATTEMPTS) throw error
    }
  }
}

/** Gives a new account the Getting started checklist; an account that already has one keeps it. */
export async function startOnboarding(db: Db, userId: string): Promise<void> {
  await startOnboardingRow(db, userId)
}

/**
 * Runs once for every new account. Someone who was invited joins through the invitation instead,
 * so they get no workspace of their own; everyone else starts with one. An invitation into a workspace
 * under ACCOUNT_LIMITS doesn't count: accepting it would be refused.
 */
export async function provisionNewUser(
  db: Db,
  person: { id: string; name: string; email: string },
  limits: AccountLimits | null,
): Promise<void> {
  await startOnboarding(db, person.id)
  for (const workspaceId of await listInvitingWorkspaces(db, person.email.trim().toLowerCase())) {
    if (!(await isWorkspaceLimited(db, limits, workspaceId))) return
  }
  await createWorkspace(db, person.id, defaultWorkspaceName(person.name, person.email))
}
