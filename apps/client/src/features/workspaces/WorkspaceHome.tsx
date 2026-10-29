import type { ReactNode } from "react"
import { Button } from "@bugberry/ui/button"
import { JoinWorkspacePanel } from "./JoinWorkspaceDialog"

export function WorkspaceHomeView({ join, onCreate }: { join: ReactNode; onCreate(): void }) {
  return (
    <section className="mx-auto flex max-w-md flex-col gap-6 py-16">
      <h1 className="font-heading text-2xl font-bold text-foreground">You're not in a workspace yet</h1>
      {join}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button size="sm" intent="outline" className="self-start" onPress={() => onCreate()}>
        Create workspace
      </Button>
    </section>
  )
}

/**
 * Shown in place of the dashboard to someone who belongs to no workspace: every way to join one, or
 * create one. The shell owns the Create workspace modal: creating one replaces this page, and the modal
 * must stay to report a failed logo or invite.
 */
export function WorkspaceHome({ onCreateWorkspace }: { onCreateWorkspace(): void }) {
  return <WorkspaceHomeView join={<JoinWorkspacePanel onJoined={() => {}} />} onCreate={onCreateWorkspace} />
}
