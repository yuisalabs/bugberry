import { useQuery } from "@tanstack/react-query"
import { api } from "../lib/client"
import { queries } from "../lib/queries"
import { DemoView } from "./landing/DemoView"
import { usePageMeta } from "./landing/usePageMeta"

/** `/demo` on BugBerry cloud. */
export function DemoPage() {
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const config = useQuery(queries.clientConfig())
  usePageMeta("Request a demo", "Book 30 minutes with the BugBerry team: we record a real bug on your app, send it to your tracker and hand it to an AI agent, live.")
  return <DemoView signedIn={me.isSuccess} installUrl={config.data?.extensionInstallUrl ?? null} submit={api.requestDemo} />
}
