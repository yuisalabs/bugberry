import type { OnboardingItemId } from "@bugberry/shared"
import { type AnyPgColumn, boolean, index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core"
import { createdAt, ts, updatedAt } from "./columns"
import { workspace } from "./workspaces"

// Better Auth tables: property names must match Better Auth's model fields.

/** When each checklist item was first done (ISO time), and how the checklist shows. */
export interface OnboardingState {
  steps?: Partial<Record<OnboardingItemId, string>>
  celebratedAt?: string
  collapsed?: boolean
  completedAt?: string
}

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  /** The workspace the dashboard opens; null until the person has one. */
  lastWorkspaceId: text("last_workspace_id").references((): AnyPgColumn => workspace.id, { onDelete: "set null" }),
  /** Exempt from ACCOUNT_LIMITS; set only from the server's CLI (bun run account:unlimited). */
  unlimited: boolean("unlimited").default(false).notNull(),
  /** The Getting started checklist; null for accounts made before it existed, which never see it. */
  onboarding: jsonb("onboarding").$type<OnboardingState>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
)

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
)

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
)

/** Keys that sign OAuth access tokens; the public half is served at /api/auth/jwks. */
export const jwks = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: ts("created_at").notNull(),
  expiresAt: ts("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
})
