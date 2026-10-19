import { z } from "zod"
import { MAX_LIMIT } from "../format"

/** Every report tool takes the same way of naming a report. */
export const reportArgs = {
  report: z
    .string()
    .min(1)
    .max(500)
    .describe("The report: a BugBerry link (…/app/r/… or …/s/…), a number like BB-123, or a report id."),
  workspace: z
    .string()
    .max(200)
    .optional()
    .describe("Workspace id or slug, only needed for BB-numbers outside your current workspace (see listWorkspaces)."),
}

export const pageArgs = {
  limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many items to return (default 50, max ${MAX_LIMIT}).`),
  cursor: z.string().max(100).optional().describe("The cursor from the previous page."),
}
