import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { SettingsPageSkeleton } from "../../components/layout/Skeletons"
import { ErrorState } from "../../components/ui/error-state"
import { aiQueries, createMcpToken, refreshMcpAccess, useRevokeMcpToken, useRevokeOAuthApp } from "./queries"
import { errorMessage } from "../../lib/query/unwrap"
import { AiAgentsView } from "./AiAgentsView"

/** Connect AI apps to the MCP server, see which are connected, and manage personal tokens. */
export function McpAgents() {
  const queryClient = useQueryClient()
  const tokens = useQuery(aiQueries.mcpTokens())
  const apps = useQuery(aiQueries.oauthApps())
  const [newToken, setNewToken] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: (label: string) => createMcpToken(label),
    onSuccess: async (created) => {
      setNewToken(created.token)
      await refreshMcpAccess(queryClient)
    },
  })
  const revokeToken = useRevokeMcpToken()
  const revokeApp = useRevokeOAuthApp()

  if (tokens.isPending || apps.isPending) return <SettingsPageSkeleton />
  if (tokens.isError || apps.isError) {
    return (
      <ErrorState
        error={tokens.error ?? apps.error}
        onRetry={() => {
          void tokens.refetch()
          void apps.refetch()
        }}
      />
    )
  }
  const failed = create.error ?? revokeToken.error ?? revokeApp.error
  return (
    <AiAgentsView
      origin={window.location.origin}
      tokens={tokens.data}
      apps={apps.data}
      newToken={newToken}
      busy={create.isPending || revokeToken.isPending || revokeApp.isPending}
      error={failed ? errorMessage(failed) : null}
      onCreateToken={(label) => create.mutate(label)}
      onRevokeToken={(id) => revokeToken.mutate(id)}
      onRevokeApp={(clientId) => revokeApp.mutate(clientId)}
      onDismissToken={() => setNewToken(null)}
      header={false}
    />
  )
}
