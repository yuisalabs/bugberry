import { RiChromeFill } from "@remixicon/react"
import { Link } from "@bugberry/ui/link"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { GithubIcon } from "../../components/LoginView"
import { DOCS_URL } from "../../lib/docs-url"
import {
  CHANGELOG,
  COMMENTS_DOCS,
  INTEGRATION_DOCS,
  installHref,
  MCP_GUIDE,
  QUICK_START,
  RECORDING_DOCS,
  REPORT_PAGE_DOCS,
  SCREENSHOT_DOCS,
  SOURCE_URL,
  siteContainer,
  WEBHOOK_DOCS,
} from "./site-links"

const COLUMNS: Array<{ label: string; links: Array<[string, string]> }> = [
  {
    label: "Product",
    // The features open the same docs sections as the Product menu.
    links: [
      ["Browser extension", RECORDING_DOCS],
      ["Screenshot & annotate", SCREENSHOT_DOCS],
      ["Console & network logs", REPORT_PAGE_DOCS],
      ["Comments & mentions", COMMENTS_DOCS],
      ["AI Agents (MCP)", "/ai-agents"],
      ["Pricing", "/pricing"],
      ["Integrations", "/integrations"],
    ],
  },
  {
    label: "Integrations",
    // Each one opens its own section of the integrations docs (heading ids from apps/docs).
    links: [
      ["GitHub", `${INTEGRATION_DOCS}#github-issues`],
      ["GitLab", `${INTEGRATION_DOCS}#gitlab`],
      ["Jira", `${INTEGRATION_DOCS}#jira-cloud`],
      ["Linear", `${INTEGRATION_DOCS}#linear`],
      ["Slack", `${INTEGRATION_DOCS}#slack`],
      ["All integrations", INTEGRATION_DOCS],
    ],
  },
  {
    label: "Resources",
    links: [
      ["Manual", QUICK_START],
      ["Docs", DOCS_URL],
      ["MCP setup guide", MCP_GUIDE],
      ["Webhooks", WEBHOOK_DOCS],
      ["Changelog", CHANGELOG],
    ],
  },
  {
    label: "Company",
    links: [
      ["Request a demo", "/demo"],
      ["Privacy", "/privacy"],
    ],
  },
]

const chip =
  "inline-flex h-9 items-center gap-2 rounded-[9px] bg-[#2A1B31] px-3 text-[13px] text-white outline outline-1 -outline-offset-1 outline-[#3D2B46] transition hover:bg-[#3D2B46]"

/**
 * The public site's footer. `minimal` (a self-hosted server, where the marketing pages are off) keeps only
 * what that server has: the docs and the privacy policy.
 */
export function SiteFooter({ installUrl, minimal = false }: { installUrl: string | null; minimal?: boolean }) {
  return (
    <footer className="bg-[#1C1022]">
      <nav aria-label="Footer" className={`${siteContainer} flex flex-col gap-12 pt-16 pb-12 md:flex-row md:gap-12 md:pt-20 md:pb-16`}>
        <div className="flex max-w-[280px] flex-col gap-3.5">
          <Link href="/" aria-label="BugBerry home" className="w-fit">
            <BugBerryLogo className="h-[34px]" />
          </Link>
          <p className="text-[14px]/[22px] text-[#B6A7BE]">Bug reports your engineers can play, and your agents can fix.</p>
        </div>
        {minimal ? (
          <div className="flex gap-8 text-[14px] text-white">
            <Link href={DOCS_URL} className="hover:text-[#FF8AB8]">
              Docs
            </Link>
            <Link href="/privacy" className="hover:text-[#FF8AB8]">
              Privacy
            </Link>
          </div>
        ) : (
          <div className="grid flex-1 grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-4">
            {COLUMNS.map((column) => (
              <div key={column.label} className="flex flex-col gap-[11px]">
                <p className="pb-0.5 text-[13px] text-[#8C7C95]">{column.label}</p>
                {column.links.map(([label, href]) => (
                  <Link key={label} href={href} className="w-fit text-[14px] font-normal text-white transition hover:text-[#FF8AB8]">
                    {label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        )}
      </nav>
      <div className="border-t border-[#3D2B46]">
        <div className={`${siteContainer} flex flex-col gap-4 py-6 sm:flex-row sm:items-center sm:justify-between`}>
          <p className="text-[13px] text-[#8C7C95]">© 2026 BugBerry</p>
          {!minimal && (
            <div className="flex gap-2">
              <Link href={installHref(installUrl)} className={chip}>
                <RiChromeFill className="size-[15px]" aria-hidden />
                Chrome Web Store
              </Link>
              <Link href={SOURCE_URL} aria-label="BugBerry on GitHub" className={`${chip} w-9 justify-center px-0 [&_svg]:size-[17px]`}>
                <GithubIcon />
              </Link>
            </div>
          )}
        </div>
      </div>
    </footer>
  )
}
