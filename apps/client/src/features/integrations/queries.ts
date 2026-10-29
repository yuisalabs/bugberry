import type { ConnectionSettings, IntegrationProvider, UseTarget } from "@bugberry/shared"
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"

/** A workspace connection as an admin saves it; the secret is sealed on the server and never comes back. */
export interface ConnectionInput {
  provider: IntegrationProvider
  name: string
  settings: ConnectionSettings
  secret?: string
}

export interface ConnectionPatch {
  name?: string
  settings?: ConnectionSettings
  /** Empty keeps the current secret. */
  secret?: string
}

/** What a connection can list for a project to pick from. */
export type OptionList = "targets" | "labels" | "issueTypes" | "taskLists"

/** A project's use of a connection; its target is picked from the connection's lists. */
export interface IntegrationInput {
  connectionId: string
  target: UseTarget
  autoSend?: boolean
}

/** Only labels and auto-send change; a different target is a new use. */
export interface IntegrationPatch {
  labels?: string[]
  autoSend?: boolean
}

export const connections = (workspaceId: string) => unwrap(eden.api.workspaces({ id: workspaceId }).connections.get())
export const createConnection = (workspaceId: string, body: ConnectionInput) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).connections.post(body as never))
export const updateConnection = (workspaceId: string, id: string, body: ConnectionPatch) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).connections({ connectionId: id }).patch(body))
export const deleteConnection = (workspaceId: string, id: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).connections({ connectionId: id }).delete())
export const testConnection = (workspaceId: string, id: string) =>
  unwrap(eden.api.workspaces({ id: workspaceId }).connections({ connectionId: id }).test.post())
export const connectionOptions = (workspaceId: string, id: string, list: OptionList, opts: { q?: string; parent?: string } = {}) =>
  unwrap(
    eden.api
      .workspaces({ id: workspaceId })
      .connections({ connectionId: id })
      .options.get({ query: { list, ...(opts.q ? { q: opts.q } : {}), ...(opts.parent ? { parent: opts.parent } : {}) } }),
  )
export const integrations = (projectId: string) => unwrap(eden.api.projects({ id: projectId }).integrations.get())
export const addIntegration = (projectId: string, body: IntegrationInput) =>
  unwrap(eden.api.projects({ id: projectId }).integrations.post(body as never))
export const updateIntegration = (projectId: string, id: string, body: IntegrationPatch) =>
  unwrap(eden.api.projects({ id: projectId }).integrations({ integrationId: id }).patch(body))
export const removeIntegration = (projectId: string, id: string) =>
  unwrap(eden.api.projects({ id: projectId }).integrations({ integrationId: id }).delete())
export const testIntegration = (projectId: string, id: string) =>
  unwrap(eden.api.projects({ id: projectId }).integrations({ integrationId: id }).test.post())

export type Integration = Awaited<ReturnType<typeof integrations>>[number]
/** A workspace connection; admins also get its settings and the projects that use it. */
export type Connection = Awaited<ReturnType<typeof connections>>[number] & {
  settings?: ConnectionSettings
  usedBy?: Array<{ projectId: string; projectName: string }>
}

export const integrationQueries = {
  integrations: (projectId: string) =>
    queryOptions({ queryKey: qk.integrations(projectId), queryFn: () => integrations(projectId) }),
  connections: (workspaceId: string) =>
    queryOptions({ queryKey: qk.connections(workspaceId), queryFn: () => connections(workspaceId) }),
  connectionOptions: (workspaceId: string, id: string, list: OptionList, q = "", parent = "") =>
    queryOptions({
      queryKey: qk.connectionOptions(workspaceId, id, list, q, parent),
      queryFn: () => connectionOptions(workspaceId, id, list, { q, parent }),
      // A provider's list rarely changes while a dialog is open; a failure shows its reason instead of retrying.
      staleTime: 60_000,
      retry: false,
    }),
}

export function useDeleteConnection(workspaceId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteConnection(workspaceId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.connections(workspaceId) }),
  })
}

export function useRemoveIntegration(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => removeIntegration(projectId, id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.integrations(projectId) }),
  })
}
