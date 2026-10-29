import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"

export interface ProjectInput {
  name: string
  slug: string
  urlPatterns: string[]
}

export const projects = (workspaceId: string) => unwrap(eden.api.projects.get({ query: { workspaceId } }))
export const createProject = (workspaceId: string, body: ProjectInput) => unwrap(eden.api.projects.post({ workspaceId, ...body }))
export const updateProject = (id: string, body: ProjectInput) => unwrap(eden.api.projects({ id }).patch(body))
export const deleteProject = (id: string) => unwrap(eden.api.projects({ id }).delete())
export const projectLogoUploadTarget = (projectId: string, contentType: "image/png" | "image/jpeg", size: number) =>
  unwrap(eden.api.projects({ id: projectId }).logo.post({ contentType, size }))
export const confirmProjectLogo = (projectId: string, logoId: string) =>
  unwrap(eden.api.projects({ id: projectId }).logo({ logoId }).post())
export const removeProjectLogo = (projectId: string) => unwrap(eden.api.projects({ id: projectId }).logo.delete())
export const projectsOverview = (workspaceId: string) => unwrap(eden.api.projects.overview.get({ query: { workspaceId } }))

export type Project = Awaited<ReturnType<typeof projects>>[number]

export const projectQueries = {
  projects: (workspaceId: string) => queryOptions({ queryKey: qk.projects.of(workspaceId), queryFn: () => projects(workspaceId) }),
  /** Admins: each project's report counts and the pages no URL pattern catches. Refreshed with the projects. */
  projectsOverview: (workspaceId: string) =>
    queryOptions({ queryKey: qk.projects.overview(workspaceId), queryFn: () => projectsOverview(workspaceId) }),
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProject(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.projects.all }),
  })
}
