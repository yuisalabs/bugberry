import { RiTerminalBoxLine } from "@remixicon/react"
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components"
import { CopyButton } from "../../components/ui/copy-button"
import { connectSnippets } from "./snippets"

// A terminal look (the theme's ink as the background), so a command reads as something to paste.
// On phones Copy sits above the command (pt-14) so the command has the whole width; wider, it sits beside it.
const codeBlock = "relative rounded-xl bg-foreground p-4 pt-14 font-mono text-sm leading-6 text-background sm:pt-4 sm:pr-28"

/** One tab per AI app, each with where to paste its setup and a copy button. */
export function SnippetTabs({ label, snippets }: { label: string; snippets: ReturnType<typeof connectSnippets> }) {
  return (
    <Tabs defaultSelectedKey="claude-code" className="flex flex-col gap-3">
      <TabList aria-label={label} className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 sm:grid-cols-6">
        {snippets.map((item) => (
          <Tab
            key={item.id}
            id={item.id}
            className="rounded-lg px-2 py-2 text-center text-sm whitespace-nowrap text-muted-foreground outline-hidden transition hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring selected:bg-background selected:font-medium selected:text-foreground selected:shadow-xs"
          >
            {item.label}
          </Tab>
        ))}
      </TabList>
      {snippets.map((item) => (
        <TabPanel key={item.id} id={item.id} className="flex flex-col gap-3 outline-hidden">
          <p className="flex items-start gap-2 text-sm text-foreground">
            <RiTerminalBoxLine aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            {item.where}
          </p>
          <div className={codeBlock}>
            <pre className="overflow-x-auto break-words whitespace-pre-wrap">
              {item.id === "claude-code" && (
                <span aria-hidden className="mr-3 text-primary select-none">
                  $
                </span>
              )}
              <code>{item.code}</code>
            </pre>
            <CopyButton
              text={item.code}
              label="Copy"
              className="absolute top-3 right-3 border-background/15 bg-background/10 text-background hover:bg-background/20"
            />
          </div>
        </TabPanel>
      ))}
    </Tabs>
  )
}
