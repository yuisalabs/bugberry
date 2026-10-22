import {
  CAPTURE_TYPES,
  type ConnectionSettings,
  type DebuggerSummary,
  type DeviceInfo,
  PRIORITIES,
  REPORT_STATUSES,
  INTEGRATION_PROVIDERS,
  UPLOAD_STATUSES,
  type UseTarget,
  VISIBILITIES,
  WORKSPACE_ROLES,
} from "@bugberry/shared"
import { sql } from "drizzle-orm"
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core"

const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()

export const reportStatusEnum = pgEnum("report_status", REPORT_STATUSES)
export const priorityEnum = pgEnum("priority", PRIORITIES)
export const visibilityEnum = pgEnum("visibility", VISIBILITIES)
export const captureTypeEnum = pgEnum("capture_type", CAPTURE_TYPES)
export const uploadStatusEnum = pgEnum("upload_status", UPLOAD_STATUSES)
/** Every integration provider; the SQL name stays from when only trackers existed. */
export const integrationProviderEnum = pgEnum("tracker_provider", INTEGRATION_PROVIDERS)
export const workspaceRoleEnum = pgEnum("workspace_role", WORKSPACE_ROLES)
/** "full" works on every route (CLI tokens); "mcp" only on /api/mcp (made in the dashboard for AI agents). */
export const apiTokenKindEnum = pgEnum("api_token_kind", ["full", "mcp"])
/** Why someone has a bell notification: mentioned, or a reply in a thread they started or joined. */
export const notificationKindEnum = pgEnum("notification_kind", ["mention", "reply_to_you", "reply_in_thread"])
/** What a report activity line records; "created" comes from the report itself and has no row. */
export const ACTIVITY_KINDS = ["status", "priority", "assignee", "title", "tracker", "agent_read"] as const
export type ActivityKind = (typeof ACTIVITY_KINDS)[number]
export const activityKindEnum = pgEnum("activity_kind", ACTIVITY_KINDS)

// --- Better Auth tables: property names must match Better Auth's model fields. ---

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

// --- BugBerry tables ---

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
  (table) => [index("workspace_invitation_workspace_idx").on(table.workspaceId), index("workspace_invitation_email_idx").on(table.email)],
)

export const apiToken = pgTable(
  "api_token",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    kind: apiTokenKindEnum("kind").notNull().default("full"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("api_token_user_id_idx").on(table.userId)],
)

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    /** Unique within its workspace. */
    slug: text("slug").notNull(),
    urlPatterns: text("url_patterns")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** The uploaded logo's public link; null shows the name's first letter instead. */
    logoUrl: text("logo_url"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("project_workspace_slug_idx").on(table.workspaceId, table.slug)],
)

export const report = pgTable(
  "report",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspace.id, { onDelete: "restrict" }),
    projectId: text("project_id").references(() => project.id, { onDelete: "restrict" }),
    reporterId: text("reporter_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    /** Counts up within the workspace, shown as BB-{number}. */
    number: integer("number").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: reportStatusEnum("status").notNull().default("open"),
    priority: priorityEnum("priority").notNull().default("none"),
    visibility: visibilityEnum("visibility").notNull().default("workspace"),
    /** The reporter's email domain when the report was made; "internal" shares with this domain. */
    reporterDomain: text("reporter_domain"),
    shareSlug: text("share_slug").notNull().unique(),
    captureType: captureTypeEnum("capture_type").notNull(),
    pageUrl: text("page_url").notNull(),
    pageTitle: text("page_title").notNull().default(""),
    device: jsonb("device").$type<DeviceInfo>().notNull(),
    durationMs: integer("duration_ms"),
    mediaKey: text("media_key").notNull(),
    mediaType: text("media_type").notNull(),
    /** Size in bytes declared by the client when the upload session was created. */
    mediaSize: integer("media_size").notNull(),
    debuggerKey: text("debugger_key"),
    debuggerSize: integer("debugger_size"),
    /** Null when the report has no preview: older reports, or a thumbnail that failed to upload. */
    thumbnailKey: text("thumbnail_key"),
    thumbnailSize: integer("thumbnail_size"),
    debuggerSummary: jsonb("debugger_summary").$type<DebuggerSummary>().notNull(),
    uploadStatus: uploadStatusEnum("upload_status").notNull().default("uploading"),
    uploadError: text("upload_error"),
    /** "City, Country" from the reporter's location, when they chose to include it. Never coordinates. */
    location: text("location"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("report_project_created_idx").on(table.projectId, table.createdAt),
    index("report_workspace_created_idx").on(table.workspaceId, table.createdAt),
    index("report_status_idx").on(table.status),
    index("report_upload_status_created_idx").on(table.uploadStatus, table.createdAt),
    uniqueIndex("report_workspace_number_idx").on(table.workspaceId, table.number),
  ],
)

export const comment = pgTable(
  "comment",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    /** The AI app that wrote it through MCP ("Claude Code", "AI agent"); null when written in BugBerry. */
    viaAgent: text("via_agent"),
    /** The comment this one replies to; always a thread's first comment, so threads are one level deep. */
    parentId: text("parent_id").references((): AnyPgColumn => comment.id, { onDelete: "cascade" }),
    /** Set when a comment with replies is deleted: its body is wiped and it stays as "This comment was deleted". */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("comment_report_created_idx").on(table.reportId, table.createdAt),
    index("comment_parent_idx").on(table.parentId),
  ],
)

/** One person's emoji on one comment; the same person can add several different emoji. */
export const commentReaction = pgTable(
  "comment_reaction",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    emoji: text("emoji").notNull(),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.commentId, table.userId, table.emoji] })],
)

/**
 * What happened to a report, for the comments feed: field changes, tracker sends and AI agents reading it.
 * `actorId` is the person (also when an agent acted for them, named in `viaAgent`); null for automatic sends.
 */
export const reportActivity = pgTable(
  "report_activity",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    viaAgent: text("via_agent"),
    kind: activityKindEnum("kind").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("report_activity_report_created_idx").on(table.reportId, table.createdAt)],
)

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

/**
 * One row per (report, integration). States: sent (external_id set), failed (error set),
 * or being sent (both empty) — the row doubles as the lock that prevents duplicate issues.
 */
export const reportExternalLink = pgTable(
  "report_external_link",
  {
    id: text("id").primaryKey(),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    /** Null once the use (or its connection) is gone; the link and its issue stay. */
    integrationId: text("integration_id").references(() => integration.id, { onDelete: "set null" }),
    /** Kept with the link so its issue still reads "GitHub #42" after the use is gone. */
    provider: integrationProviderEnum("provider"),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("report_external_link_report_integration_idx").on(table.reportId, table.integrationId)],
)

/** "Someone mentioned you": one row per person and comment, so edits never notify anyone twice. */
export const notification = pgTable(
  "notification",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    commentId: text("comment_id")
      .notNull()
      .references(() => comment.id, { onDelete: "cascade" }),
    reportId: text("report_id")
      .notNull()
      .references(() => report.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    kind: notificationKindEnum("kind").notNull().default("mention"),
    createdAt: createdAt(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("notification_user_comment_idx").on(table.userId, table.commentId),
    index("notification_user_created_idx").on(table.userId, table.createdAt),
  ],
)

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

// --- OAuth 2.1 provider for the MCP server (Better Auth's jwt() and mcp() plugins). Property names must
// match the plugins' model fields; the adapter maps each model by its key in createAuth's schema. ---

const ts = (name: string) => timestamp(name, { withTimezone: true })

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

/** An AI app that registered itself (dynamic client registration) or was added by hand. */
export const oauthClient = pgTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes")
      .array()
      .default(sql`'{}'::text[]`),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean("backchannel_logout_session_required"),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("oauth_client_user_id_idx").on(table.userId)],
)

/** The protected resources tokens can be issued for: here, only the MCP server. */
export const oauthResource = pgTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required").default(false),
  disabled: boolean("disabled").default(false),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
})

export const oauthClientResource = pgTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: "cascade" }),
    metadata: jsonb("metadata"),
    createdAt: ts("created_at"),
  },
  (table) => [
    index("oauth_client_resource_client_idx").on(table.clientId),
    index("oauth_client_resource_resource_idx").on(table.resourceId),
  ],
)

export const oauthRefreshToken = pgTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: ts("expires_at"),
    createdAt: ts("created_at"),
    revoked: ts("revoked"),
    rotatedAt: ts("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: ts("rotation_replay_expires_at"),
    authTime: ts("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_refresh_token_client_idx").on(table.clientId),
    index("oauth_refresh_token_session_idx").on(table.sessionId),
    index("oauth_refresh_token_user_idx").on(table.userId),
    index("oauth_refresh_token_code_idx").on(table.authorizationCodeId),
  ],
)

export const oauthAccessToken = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => session.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshToken.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at"),
    createdAt: ts("created_at"),
    revoked: ts("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauth_access_token_client_idx").on(table.clientId),
    index("oauth_access_token_session_idx").on(table.sessionId),
    index("oauth_access_token_user_idx").on(table.userId),
    index("oauth_access_token_code_idx").on(table.authorizationCodeId),
    index("oauth_access_token_refresh_idx").on(table.refreshId),
  ],
)

/** "Ana allowed Claude Code to use BugBerry": one row per person and app. */
export const oauthConsent = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: ts("created_at"),
    updatedAt: ts("updated_at"),
  },
  (table) => [index("oauth_consent_client_idx").on(table.clientId), index("oauth_consent_user_idx").on(table.userId)],
)

/** Client assertions already used, so a signed assertion cannot be replayed. */
export const oauthClientAssertion = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
})

/** Someone asked for a demo on the public site (PUBLIC_SITE); the team is emailed and replies. */
export const demoRequest = pgTable("demo_request", {
  id: text("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  company: text("company").notNull(),
  tracker: text("tracker").notNull(),
  teamSize: text("team_size").notNull(),
  message: text("message").default("").notNull(),
  selfHosting: boolean("self_hosting").default(false).notNull(),
  createdAt: createdAt(),
})
