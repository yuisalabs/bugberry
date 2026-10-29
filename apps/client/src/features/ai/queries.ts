import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"

type AiRoutes = ReturnType<typeof eden.api.workspaces>["ai"]

/** An `apiKey` left out keeps the saved key. */
export type AiProviderInput = Parameters<AiRoutes["provider"]["put"]>[0]
/** `skeleton` is the description's sections, as Markdown headings. */
export type AiTemplateInput = Parameters<AiRoutes["templates"]["post"]>[0]
export type AiSettingsPatch = NonNullable<Parameters<AiRoutes["settings"]["patch"]>[0]>

export const mcpTokens = () => unwrap(eden.api.me.tokens.get())
export const createMcpToken = (label: string) => unwrap(eden.api.me.tokens.post({ label }))
export const revokeMcpToken = (id: string) => unwrap(eden.api.me.tokens({ id }).delete())
export const oauthApps = () => unwrap(eden.api.me["oauth-apps"].get())
export const revokeOAuthApp = (clientId: string) => unwrap(eden.api.me["oauth-apps"]({ clientId }).delete())
/** Write with AI: the team key (details for admins only), the switch, the defaults and the shared templates. */
export const aiSetup = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).ai.get())
export const saveAiProvider = (workspaceId: string, body: AiProviderInput) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).ai.provider.put(body))
export const removeAiProvider = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).ai.provider.delete())
export const updateAiSettings = (workspaceId: string, patch: AiSettingsPatch) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).ai.settings.patch(patch))
export const createAiTemplate = (workspaceId: string, body: AiTemplateInput) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).ai.templates.post(body))
export const updateAiTemplate = (workspaceId: string, id: string, body: Partial<AiTemplateInput>) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).ai.templates({ templateId: id }).patch(body))
export const deleteAiTemplate = (workspaceId: string, id: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).ai.templates({ templateId: id }).delete())

export type AiSetup = Awaited<ReturnType<typeof aiSetup>>

export const aiQueries = {
  ai: (workspaceId: string) => queryOptions({ queryKey: qk.ai(workspaceId), queryFn: () => aiSetup(workspaceId) }),
  mcpTokens: () => queryOptions({ queryKey: qk.mcpTokens, queryFn: () => mcpTokens() }),
  oauthApps: () => queryOptions({ queryKey: qk.oauthApps, queryFn: () => oauthApps() }),
}

export const refreshMcpAccess = (queryClient: QueryClient) =>
  Promise.all([queryClient.invalidateQueries({ queryKey: qk.mcpTokens }), queryClient.invalidateQueries({ queryKey: qk.oauthApps })])

export function useRevokeMcpToken() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (id: string) => revokeMcpToken(id), onSuccess: () => refreshMcpAccess(queryClient) })
}

export function useRevokeOAuthApp() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (clientId: string) => revokeOAuthApp(clientId), onSuccess: () => refreshMcpAccess(queryClient) })
}

export function useUpdateAiSettings(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (patch: AiSettingsPatch) => updateAiSettings(workspaceId, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: qk.ai(workspaceId) }),
  })
}
