import { pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { createdAt } from "./columns"
import { user } from "./auth"
import { workspace } from "./workspaces"
import { project } from "./projects"

/**
 * The photo a person asked to upload but has not confirmed yet. One per person: starting another upload
 * deletes this one, so abandoned uploads never pile up in storage.
 */
export const pendingAvatar = pgTable("pending_avatar", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  avatarId: text("avatar_id").notNull(),
  createdAt: createdAt(),
})

/** A logo upload not confirmed yet, one per workspace; starting another deletes it (as with avatars). */
export const pendingLogo = pgTable("pending_logo", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  logoId: text("logo_id").notNull(),
  createdAt: createdAt(),
})

/** A project logo upload not confirmed yet, one per project, as pendingLogo is for workspaces. */
export const pendingProjectLogo = pgTable("pending_project_logo", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => project.id, { onDelete: "cascade" }),
  logoId: text("logo_id").notNull(),
  createdAt: createdAt(),
})
