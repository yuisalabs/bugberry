import { DOCS_URL } from "../../lib/docs-url"

/** Docs pages the public site links to; each one exists in apps/docs/content/docs. */
export const QUICK_START = `${DOCS_URL}/quick-start`
export const MCP_GUIDE = `${DOCS_URL}/guide/ai-agents`
export const INTEGRATION_DOCS = `${DOCS_URL}/self-host/integrations`
export const WEBHOOK_DOCS = `${DOCS_URL}/self-host/integrations#webhook`
export const WORKSPACE_DOCS = `${DOCS_URL}/guide/workspaces-and-access`
export const SELF_HOST_DOCS = `${DOCS_URL}/self-host`
export const CHANGELOG = `${DOCS_URL}/changelog`

/** BugBerry's extension on the Chrome Web Store. */
export const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/bugberry/cccfgmgmmejlciecjipkcbabhdljhihi"

/** Where "Add to Chrome" goes: the server's own install link (EXTENSION_INSTALL_URL), or BugBerry's store page. */
export function installHref(installUrl: string | null): string {
  return installUrl ?? CHROME_WEB_STORE_URL
}

/** The public pages' width: the designs are 1440 px wide with 160 px either side. */
export const siteContainer = "mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-0"
