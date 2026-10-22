import type { RemixiconComponentType } from "@remixicon/react"
import { type ReactNode, useState } from "react"
import { Tab, TabList, TabPanel, Tabs } from "react-aria-components"

export interface SettingsSection {
  id: string
  label: string
  icon: RemixiconComponentType
  panel: ReactNode
}

/**
 * A settings page as vertical tabs: the parts listed on the left and only the chosen one beside them. On phones the
 * list becomes a row above. The address keeps the tab (#sign-in), so a reload or a shared link opens it again; the
 * first tab needs no hash.
 */
export function SettingsTabs({ label, sections }: { label: string; sections: readonly SettingsSection[] }) {
  const first = sections[0]?.id ?? ""
  const [tab, setTab] = useState(() => sections.find((section) => `#${section.id}` === window.location.hash)?.id ?? first)
  return (
    <Tabs
      orientation="vertical"
      selectedKey={tab}
      onSelectionChange={(key) => {
        const next = String(key)
        setTab(next)
        window.history.replaceState(window.history.state, "", next === first ? window.location.pathname : `#${next}`)
      }}
      className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10"
    >
      {/* The padding leaves room for the focus ring, which the phone row's scrolling would otherwise cut off. */}
      <TabList aria-label={label} className="-m-1 flex gap-1 overflow-x-auto p-1 lg:flex-col lg:overflow-visible">
        {sections.map(({ id, label: name, icon: Icon }) => (
          <Tab
            key={id}
            id={id}
            className="flex shrink-0 items-center gap-3 rounded-xl border border-transparent px-4 py-2.5 text-[15px] text-muted-foreground outline-hidden hover:bg-background/70 hover:text-foreground data-focus-visible:ring-2 data-focus-visible:ring-ring selected:border-border selected:bg-background selected:font-medium selected:text-foreground selected:[&_svg]:text-primary"
          >
            <Icon aria-hidden className="size-4.5 shrink-0" />
            {name}
          </Tab>
        ))}
      </TabList>
      {sections.map(({ id, panel }) => (
        <TabPanel key={id} id={id} className="flex min-w-0 flex-col gap-6 outline-hidden">
          {panel}
        </TabPanel>
      ))}
    </Tabs>
  )
}
