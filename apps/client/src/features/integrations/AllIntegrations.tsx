import { type IntegrationProvider, PROVIDER_LABELS } from "@bugberry/shared"
import { RiAddLine } from "@remixicon/react"
import { Button } from "@bugberry/ui/button"
import { GroupTitle, integrationCard as card, softButton } from "./IntegrationsLayout"
import { ProviderMark } from "./IntegrationForm"
import { catalogueOrder, PROVIDER_INFO } from "./provider-info"

/**
 * Every provider as a card that opens the form with it chosen. A provider can be connected more than once (two GitHub
 * accounts, a Slack channel per team), so the ones in use stay here: they say how many are connected and offer another.
 */
export function AllIntegrations({
  providers,
  connected,
  onPick,
}: {
  providers: readonly IntegrationProvider[]
  /** How many connections each provider has; missing means none. */
  connected: Partial<Record<IntegrationProvider, number>>
  onPick(provider: IntegrationProvider): void
}) {
  return (
    <section className="flex flex-col gap-3">
      <GroupTitle title="All integrations" count={providers.length} />
      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {catalogueOrder(providers, connected).map((provider) => {
          const count = connected[provider] ?? 0
          const label = PROVIDER_LABELS[provider]
          return (
            <li key={provider} className={`flex flex-col gap-4 p-6 ${card}`}>
              <div className="flex items-start justify-between gap-3">
                <ProviderMark provider={provider} className="size-11" />
                {count > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-medium text-success-subtle-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-success" />
                    {count} connected
                  </span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <h3 className="font-heading font-semibold text-foreground">{label}</h3>
                <p className="text-sm text-muted-foreground">{PROVIDER_INFO[provider].category}</p>
                <p className="text-sm text-foreground">{PROVIDER_INFO[provider].text}</p>
              </div>
              <Button
                intent="plain"
                aria-label={count > 0 ? `Add another ${label} connection` : `Connect ${label}`}
                onPress={() => onPick(provider)}
                className={`w-full ${softButton}`}
              >
                <RiAddLine aria-hidden />
                {count > 0 ? "Add another" : "Connect"}
              </Button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
