import { workspaceColor } from "../lib/workspace"

/**
 * A project's logo, or the first letter of its name on the project's own colour while it has none. `className`
 * sets the size, corners and letter size; by default it fits a menu row.
 */
export function ProjectTile({
  project,
  className = "size-5 rounded-md text-[11px]",
}: {
  project: { id: string; name: string; logoUrl?: string | null }
  className?: string
}) {
  if (project.logoUrl) {
    return <img src={project.logoUrl} alt="" className={`shrink-0 object-cover ring-1 ring-border ${className}`} />
  }
  return (
    <span aria-hidden className={`inline-flex shrink-0 items-center justify-center font-bold text-white ${workspaceColor(project.id)} ${className}`}>
      {project.name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  )
}
