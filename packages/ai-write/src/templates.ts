/** A template: the description's sections the AI fills in, and extra instructions for it. */
export interface TemplateText {
  skeleton: string
  instructions: string
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
