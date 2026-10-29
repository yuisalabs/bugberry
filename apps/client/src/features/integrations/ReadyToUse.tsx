import { isTrackerProvider, PROVIDER_LABELS } from "@bugberry/shared"
import { RiAddLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Button } from "@bugberry/ui/button"
import { ProviderMark } from "./IntegrationForm"
import { GroupTitle, integrationCard, softButton } from "./IntegrationsLayout"
import { Badge } from "../../components/ui/badge"
import { usedUp } from "./UseConnectionDialog"
import type { Connection, Integration } from "./queries"

/**
 * The workspace's connections this project can still use, each with Use: every tracker and Telegram (another repo,
 * project or chat), and the channels it doesn't send to yet. `addConnection` is the admin's link to the workspace page
 * (a router link, so this renders without a router in tests).
 */
export function ReadyToUse({
  workspaceName,
  connections,
  used = [],
  addConnection,
  onUse,
}: {
  workspaceName: string
  /** Every connection in the workspace. */
  connections: readonly Connection[]
  /** What this project already uses. */
  used?: readonly Integration[]
  addConnection: ReactNode
  onUse(connectionId: string): void
}) {
  const ready = connections.filter((connection) => !usedUp(connection, used))
  const usedHere = (connection: Connection) => used.some((use) => use.connection.id === connection.id)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <GroupTitle title="Ready to use" count={ready.length} />
        <p className="text-sm text-muted-foreground">Connections in {workspaceName} you can use in this project.</p>
      </div>
      {ready.length === 0 ? (
        <div className={`flex flex-col gap-1 border-dashed px-6 py-5 ${integrationCard}`}>
          <p className="font-semibold text-foreground">
            {connections.length === 0 ? `No connections in ${workspaceName} yet` : `Every connection in ${workspaceName} is in use here`}
          </p>
          <p className="text-sm text-muted-foreground">Connections are added once, under Workspace › Integrations.</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {ready.map((connection) => (
            <li key={connection.id} className={`flex flex-col gap-4 p-6 ${integrationCard}`}>
              <div className="flex items-start justify-between gap-3">
                <ProviderMark provider={connection.provider} className="size-11" />
                <Badge className="bg-muted text-muted-foreground">{isTrackerProvider(connection.provider) ? "Issues" : "Messages"}</Badge>
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <h3 className="truncate font-heading font-semibold text-foreground">{connection.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {PROVIDER_LABELS[connection.provider]} ·{" "}
                  {connection.usedIn === 0 ? "Not used yet" : `Used by ${connection.usedIn} ${connection.usedIn === 1 ? "project" : "projects"}`}
                </p>
                {/* A tracker or Telegram already here can send to another repo, project or chat too. */}
                {usedHere(connection) && <p className="text-sm text-muted-foreground">In use here, can send somewhere else too</p>}
              </div>
              <Button intent="plain" aria-label={`Use ${connection.name}`} onPress={() => onUse(connection.id)} className={`w-full ${softButton}`}>
                <RiAddLine aria-hidden />
                Use
              </Button>
            </li>
          ))}
        </ul>
      )}
      {addConnection ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-primary">
          <RiAddLine aria-hidden className="size-4 shrink-0" />
          {addConnection}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Need another tool? Ask a workspace admin to add one in Workspace › Integrations.</p>
      )}
    </section>
  )
}
