import { DOCS_URL } from "../../lib/docs-url"

/** Docs pages the public site links to; each one exists in apps/docs/content/docs. */
export const QUICK_START = `${DOCS_URL}/quick-start`
export const MCP_GUIDE = `${DOCS_URL}/guide/ai-agents`
export const INTEGRATION_DOCS = `${DOCS_URL}/self-host/integrations`
export const WEBHOOK_DOCS = `${DOCS_URL}/self-host/integrations#webhook`
export const WORKSPACE_DOCS = `${DOCS_URL}/guide/workspaces-and-access`
export const SELF_HOST_DOCS = `${DOCS_URL}/self-host`
export const CHANGELOG = `${DOCS_URL}/changelog`
/** The guide's sections behind each Product menu feature. */
export const RECORDING_DOCS = `${DOCS_URL}/guide/recordings`
export const SCREENSHOT_DOCS = `${DOCS_URL}/guide/screenshots#mark-it-up`
export const REPORT_PAGE_DOCS = `${DOCS_URL}/guide/dashboard#the-report-page`
export const COMMENTS_DOCS = `${DOCS_URL}/guide/dashboard#working-on-a-report`
export const SHARING_DOCS = `${WORKSPACE_DOCS}#who-can-see-a-report`
export const PROJECTS_DOCS = `${WORKSPACE_DOCS}#projects-and-url-patterns`
/** BugBerry's source. Still private: it opens for people with access until the repository is made public. */
export const SOURCE_URL = "https://github.com/yuisalabs/bugberry"

/** The pages the header lists after Product, on wide screens and in the phone menu. */
export const SITE_PAGES = [
  { label: "Integrations", href: "/integrations" },
  { label: "AI Agents", href: "/ai-agents" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: DOCS_URL },
]

/** BugBerry's extension on the Chrome Web Store. */
export const CHROME_WEB_STORE_URL = "https://chromewebstore.google.com/detail/bugberry/cccfgmgmmejlciecjipkcbabhdljhihi"

/** Where "Add to Chrome" goes: the server's own install link (EXTENSION_INSTALL_URL), or BugBerry's store page. */
export function installHref(installUrl: string | null): string {
  return installUrl ?? CHROME_WEB_STORE_URL
}

/** The public pages' width: the designs are 1440 px wide with 160 px either side. */
export const siteContainer = "mx-auto w-full max-w-[1120px] px-4 sm:px-6 lg:px-0"

/** The header's two buttons: sign-up (pink) and "Request a demo" (outlined). */
export const siteButton =
  "inline-flex h-9 items-center justify-center rounded-[10px] bg-[#D61F69] px-3.5 text-[14px] font-semibold whitespace-nowrap text-white transition hover:bg-[#C01A5E]"
export const siteOutlineButton =
  "inline-flex h-9 items-center justify-center rounded-[10px] bg-[#FFFFFF]/[0.06] px-3.5 text-[14px] font-semibold whitespace-nowrap text-white outline outline-1 -outline-offset-1 outline-white/20 transition hover:bg-[#FFFFFF]/10"
