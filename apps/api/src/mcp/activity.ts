import { type ReadPart, recordAgentRead } from "../modules/activity/service"
import { agentLabel, type McpContext } from "./context"
import type { ResolvedReport } from "./refs"

/**
 * Notes in the report's activity that the caller's AI agent read part of it. Only members' reads count (a share
 * viewer's agent sees nothing of the workspace), and a failure here never fails the tool.
 */
export async function noteAgentRead(ctx: McpContext, resolved: ResolvedReport, part: ReadPart): Promise<void> {
  if (resolved.access !== "member") return
  await recordAgentRead(ctx.deps.db, {
    reportId: resolved.id,
    actorId: ctx.caller.user.id,
    viaAgent: agentLabel(ctx.caller),
    part,
  }).catch((error) => console.error("agent read activity failed", error))
}
