import type { ConnectionSettings, UseTarget } from "@bugberry/shared"
import { boolean, index, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core"
import { createdAt, updatedAt } from "./columns"
import { integrationProviderEnum } from "./enums"
import { workspace } from "./workspaces"
import { project } from "./projects"

/** An account or channel a workspace admin connected once; projects use it through `integration` rows. */
export const connection = pgTable(
  "connection",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    provider: integrationProviderEnum("provider").notNull(),
    name: text("name").notNull(),
    /** The account's address or login; shown to admins, never to members. */
    settings: jsonb("settings").$type<ConnectionSettings>().notNull().default({}),
    /** AES-256-GCM ciphertext from SecretBox; never returned by the API. */
    secretEncrypted: text("secret_encrypted").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("connection_workspace_idx").on(table.workspaceId)],
)

/** A project's use of a connection: where it sends (`config` holds only the target) and how. */
export const integration = pgTable(
  "integration",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connection.id, { onDelete: "cascade" }),
    /** Copied from the connection, so tracker and notifier filters need no join. */
    provider: integrationProviderEnum("provider").notNull(),
    config: jsonb("config").$type<UseTarget>().notNull(),
    /** targetKey() of the config; one use per (project, connection, key). */
    targetKey: text("target_key").notNull(),
    autoSend: boolean("auto_send").notNull().default(false),
    /** A notification channel's last failed delivery, cleared by the next one that works. */
    lastError: text("last_error"),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("integration_project_idx").on(table.projectId),
    uniqueIndex("integration_project_connection_target_idx").on(table.projectId, table.connectionId, table.targetKey),
  ],
)
