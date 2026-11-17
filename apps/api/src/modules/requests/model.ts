import { REQUEST_EXPIRY_DAYS, REQUEST_USES } from "@bugberry/shared"
import { t } from "elysia"

export const createRequestBody = t.Object({
  /** Omitted: the caller's current workspace. */
  workspaceId: t.Optional(t.String({ minLength: 1 })),
  projectId: t.Optional(t.Nullable(t.String({ minLength: 1 }))),
  note: t.Optional(t.String({ maxLength: 500 })),
  /** The page the recording is about, shown to the sender and kept on the report when they give none. */
  pageUrl: t.Optional(t.String({ maxLength: 2048 })),
  expiresInDays: t.UnionEnum(REQUEST_EXPIRY_DAYS),
  maxUses: t.UnionEnum(REQUEST_USES),
})

export const listRequestsQuery = t.Object({ workspaceId: t.Optional(t.String({ minLength: 1 })) })
