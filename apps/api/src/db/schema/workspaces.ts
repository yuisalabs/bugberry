import { type AnyPgColumn, boolean, index, integer, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { createdAt, updatedAt } from "./columns"
import { workspaceRoleEnum } from "./enums"
import { user } from "./auth"
import { project } from "./projects"
import { report } from "./reports"
import { reportTemplate } from "./ai"

/** A team: its members see its reports, projects and integrations; nobody else does. */
export const workspace = pgTable(
  "workspace",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** Short URL ("javan-qa"), unique per server. Only shown for now; pages stay at /app. */
    slug: text("slug"),
    /** The uploaded logo's public link; null shows the first letter instead. */
    logoUrl: text("logo_url"),
    /** The shared invite link's code ("7KX-29QF"); null while the link is off. */
    shareCode: text("share_code").unique(),
    /** People with this email domain may join (directly or by asking); null turns it off. */
    joinDomain: text("join_domain"),
    joinMode: text("join_mode").$type<"direct" | "approval">(),
    /** The number the next report gets; reports are BB-1, BB-2, … within a workspace. */
    nextReportNumber: integer("next_report_number").notNull().default(1),
    /** Who created it: an admin who can't be demoted or removed. Their member row stays "admin". */
    ownerId: text("owner_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    /** Whether failed requests' response bodies go to the AI; only admins turn it on. */
    aiSendResponseBodies: boolean("ai_send_response_bodies").notNull().default(false),
    /** The template a project without its own uses for Write with AI. */
    aiDefaultTemplateId: text("ai_default_template_id").references((): AnyPgColumn => reportTemplate.id, { onDelete: "set null" }),
    /** When the built-in templates were copied in; set once, so deleting them all doesn't bring them back. */
    aiTemplatesSeededAt: timestamp("ai_templates_seeded_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("workspace_slug_idx").on(table.slug)],
)

export const workspaceMember = pgTable(
  "workspace_member",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull().default("member"),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] }), index("workspace_member_user_idx").on(table.userId)],
)

/** An emailed invitation; only the SHA-256 of its token is stored. */
export const workspaceInvitation = pgTable(
  "workspace_invitation",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** SHA-256 of the short code in the email ("7KX-29QF"); null for invitations from before codes. */
    codeHash: text("code_hash").unique(),
    invitedById: text("invited_by_id").references(() => user.id, { onDelete: "set null" }),
    /** The role the person joins with when they accept. */
    role: workspaceRoleEnum("role").notNull().default("member"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("workspace_invitation_workspace_idx").on(table.workspaceId),
    index("workspace_invitation_email_idx").on(table.email),
    index("workspace_invitation_invited_by_idx").on(table.invitedById),
  ],
)

/** Someone asked to join a workspace through its email domain; an admin approves or declines. */
export const joinRequest = pgTable(
  "join_request",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
)
