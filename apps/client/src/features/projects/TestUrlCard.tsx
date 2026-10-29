import { RiCheckboxCircleLine, RiInformationLine, RiLinkM } from "@remixicon/react"
import { useState } from "react"
import { Input, InputGroup } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { card, cardTitle } from "./card-styles"
import { ProjectTile } from "./ProjectTile"
import type { Project } from "./queries"
import { testProjects } from "./url-patterns"

/** Paste an address, see which project the extension files it under and which pattern decides it. */
export function TestUrlCard({ projects }: { projects: readonly Project[] }) {
  const [input, setInput] = useState("")
  const result = testProjects(projects, input)
  return (
    <section className={`flex flex-col gap-5 p-4 ${card}`}>
      <div className="flex flex-col gap-1">
        <h2 className={cardTitle}>Test a URL</h2>
        <p className="text-sm text-muted-foreground">Paste any page address to see which project the extension will file it under.</p>
      </div>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        <TextField aria-label="Page address" value={input} onChange={setInput} className="flex-1">
          {/* The input is taller than usual, so the icon is centred on it instead of at the kit's fixed offset. */}
          <InputGroup className="h-full *:data-[slot=icon]:top-1/2 *:data-[slot=icon]:-translate-y-1/2 sm:*:data-[slot=icon]:top-1/2">
            <RiLinkM aria-hidden data-slot="icon" />
            <Input placeholder="https://app.example.com/checkout?step=pay" className="h-11" />
          </InputGroup>
        </TextField>
        {result.status !== "empty" && (
          <p
            role="status"
            className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-4 py-2.5 text-sm lg:max-w-[45%] ${
              result.status === "match" ? "bg-success-subtle text-success-subtle-foreground" : "bg-muted text-muted-foreground"
            }`}
          >
            {result.status === "match" ? (
              <>
                <RiCheckboxCircleLine aria-hidden className="size-4 shrink-0" />
                Matches
                <span className="flex items-center gap-1.5 font-semibold">
                  <ProjectTile project={result.project} className="size-4 rounded text-[9px]" />
                  {result.project.name}
                </span>
                <span className="text-xs">
                  via <code className="font-mono">{result.pattern}</code>
                </span>
              </>
            ) : result.status === "none" ? (
              "No project matches this URL"
            ) : (
              "That isn't a page address"
            )}
          </p>
        )}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <RiInformationLine aria-hidden className="size-4 shrink-0" />
        No match? Reports land in the project you picked last in the extension.
      </p>
    </section>
  )
}
