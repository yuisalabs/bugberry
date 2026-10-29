import { RiSettings3Line, RiUserAddLine } from "@remixicon/react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { BrandedHeader } from "../../components/layout/BrandedHeader"
import { SettingsTabs } from "../../components/layout/SettingsTabs"
import { useCurrentWorkspace } from "./workspace"
import { errorMessage } from "../../lib/query/unwrap"
import { confirmLogo, logoUploadTarget, useRemoveLogo, useUpdateWorkspace } from "./queries"
import { qk } from "../../lib/query/keys"
import { WorkspaceAccessSection } from "./WorkspaceAccessView"
import { WorkspaceSettingsView } from "./WorkspaceSettingsView"

/** Admins only (the route checks). */
export function WorkspaceSettingsPage() {
  const queryClient = useQueryClient()
  const { workspace } = useCurrentWorkspace()
  const refresh = () => queryClient.invalidateQueries({ queryKey: qk.workspaces })
  const id = workspace?.id ?? ""
  const save = useUpdateWorkspace(id)
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const { upload: target, logoId } = await logoUploadTarget(id, file.type as "image/png" | "image/jpeg", file.size)
      const response = await fetch(target.url, { method: target.method, headers: target.headers, body: file })
      if (!response.ok) throw new Error("The logo didn't upload. Try again.")
      return confirmLogo(id, logoId)
    },
    onSuccess: refresh,
  })
  const remove = useRemoveLogo(id)

  if (!workspace) return null
  const error = save.error ?? upload.error ?? remove.error
  return (
    <section className="flex flex-col gap-8">
      <BrandedHeader title="Workspace settings" description={`Manage how ${workspace.name} looks and who can join.`} />
      <SettingsTabs
        label="Workspace settings"
        sections={[
          {
            id: "general",
            label: "General",
            icon: RiSettings3Line,
            panel: (
              <>
                {error && (
                  <p role="alert" className="text-sm text-danger-subtle-foreground">
                    {errorMessage(error)}
                  </p>
                )}
                <WorkspaceSettingsView
                  workspace={{ id: workspace.id, name: workspace.name, slug: workspace.slug, logoUrl: workspace.logoUrl ?? null }}
                  origin={window.location.origin}
                  busy={save.isPending || upload.isPending || remove.isPending}
                  saved={save.isSuccess}
                  onSave={(patch) => save.mutate(patch)}
                  onLogo={(file) => upload.mutate(file)}
                  onRemoveLogo={() => remove.mutate()}
                />
              </>
            ),
          },
          { id: "joining", label: "Joining", icon: RiUserAddLine, panel: <WorkspaceAccessSection workspaceId={workspace.id} /> },
        ]}
      />
    </section>
  )
}
