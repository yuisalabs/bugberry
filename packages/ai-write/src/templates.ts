/** A template: the description's sections the AI fills in, and extra instructions for it. */
export interface TemplateText {
  skeleton: string
  instructions: string
}

/** The workspace's template defaults, as `GET /workspaces/:id/ai` gives them. */
export interface TemplateDefaults {
  defaultTemplateId: string | null
  projectDefaults: ReadonlyArray<{ projectId: string; templateId: string | null }>
  templates: ReadonlyArray<{ id: string }>
}

/** The template a report in this project starts with: the project's own, else the workspace's, else the first. */
export function templateFor(setup: TemplateDefaults, projectId: string | null): string | null {
  const known = (id: string | null | undefined) => (id && setup.templates.some((template) => template.id === id) ? id : null)
  const own = projectId ? setup.projectDefaults.find((entry) => entry.projectId === projectId)?.templateId : null
  return known(own) ?? known(setup.defaultTemplateId) ?? setup.templates[0]?.id ?? null
}

/** Every workspace starts with these; they can be edited or deleted like any other. */
export const BUILT_IN_TEMPLATES: ReadonlyArray<{ name: string } & TemplateText> = [
  {
    name: "Steps to reproduce",
    skeleton: "## Steps to reproduce\n## Expected\n## Actual\n## Errors",
    instructions: "Number the steps. Under Errors, list the console errors and failed requests that matter; write None if there are none.",
  },
  {
    name: "Short",
    skeleton: "",
    instructions: "Write one short paragraph: what the reporter did, what went wrong, and the failing request if there is one.",
  },
]
