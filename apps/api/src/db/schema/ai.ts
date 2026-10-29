import { index, pgTable, primaryKey, text } from "drizzle-orm/pg-core"
import { createdAt, updatedAt } from "./columns"
import { user } from "./auth"
import { workspace } from "./workspaces"

/** The workspace's own AI key (BYOK) for Write with AI; the server calls the provider, members never see the key. */
export const workspaceAiProvider = pgTable("workspace_ai_provider", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspace.id, { onDelete: "cascade" }),
  preset: text("preset").$type<"openai" | "custom">().notNull(),
  baseUrl: text("base_url").notNull(),
  model: text("model").notNull(),
  /** AES-256-GCM ciphertext from SecretBox; never returned by the API. */
  keyEncrypted: text("key_encrypted").notNull(),
  /** "sk-…a1b2": enough for admins to tell keys apart. */
  keyHint: text("key_hint").notNull(),
  updatedBy: text("updated_by").references(() => user.id, { onDelete: "set null" }),
  updatedAt: updatedAt(),
})

/** A shared Write with AI template: the description's sections and extra instructions. Any member edits them. */
export const reportTemplate = pgTable(
  "report_template",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    skeleton: text("skeleton").notNull().default(""),
    instructions: text("instructions").notNull().default(""),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("report_template_workspace_idx").on(table.workspaceId)],
)
