import type { Material, TemplateText } from "@bugberry/ai-write"
import type { AiReply, AiWriteRequest } from "./ai-relay"
import { type AiSetup, ApiError, type BugberryApi } from "../server/api"

/** Which key writes: the reporter's own (called from this browser), the workspace's (called by the server), or none. */
export type AiPath = "personal" | "team" | null

export function aiPath(hasPersonalKey: boolean, setup: AiSetup | null): AiPath {
  if (hasPersonalKey) return "personal"
  return setup?.team.configured ? "team" : null
}

/** The material a server from before @bugberry/sdk accepts: no "sdk" lines and no state. */
function withoutSdk(material: Material): Material {
  const { state: _state, ...rest } = material
  const lines = material.lines.filter((line) => line.kind !== "sdk")
  return { ...rest, lines, omitted: material.omitted + material.lines.length - lines.length }
}

/** A title and description from the recording. Throws an Error whose message is the text to show. */
export async function writeWithAi(
  deps: {
    path: Exclude<AiPath, null>
    api: Pick<BugberryApi, "aiWrite">
    sendMessage(request: AiWriteRequest): Promise<unknown>
    workspaceId: string
  },
  input: {
    material: Material
    template: { id: string } & TemplateText
    hint: { title: string; description: string }
    includeResponseBodies: boolean
  },
): Promise<{ title: string; description: string }> {
  const { material, template, hint } = input
  if (deps.path === "team") {
    const write = (sent: Material) => deps.api.aiWrite(deps.workspaceId, { templateId: template.id, material: sent, hint })
    try {
      return await write(material)
    } catch (error) {
      const hasSdk = material.state !== undefined || material.lines.some((line) => line.kind === "sdk")
      if (!(error instanceof ApiError && error.status === 422 && hasSdk)) throw error
      return write(withoutSdk(material))
    }
  }
  const reply = (await deps.sendMessage({
    type: "bugberry:ai-write",
    material,
    template: { skeleton: template.skeleton, instructions: template.instructions },
    hint,
    includeResponseBodies: input.includeResponseBodies,
  })) as AiReply | undefined
  if (!reply) throw new Error("The extension didn't answer. Try again.")
  if (!reply.ok) throw new Error(reply.error)
  return { title: reply.title, description: reply.description }
}
