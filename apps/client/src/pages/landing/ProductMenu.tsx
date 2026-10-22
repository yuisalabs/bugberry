import {
  RiArrowRightLine,
  RiChat1Line,
  RiChromeFill,
  RiCropLine,
  RiCursorLine,
  RiFolder3Line,
  RiLinksLine,
  RiMicLine,
  RiPlugLine,
  RiPuzzleLine,
  RiPulseLine,
  RiTerminalBoxLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { Link } from "@bugberry/ui/link"
import {
  COMMENTS_DOCS,
  installHref,
  PROJECTS_DOCS,
  RECORDING_DOCS,
  REPORT_PAGE_DOCS,
  SCREENSHOT_DOCS,
  SHARING_DOCS,
} from "./site-links"

export interface ProductItem {
  title: string
  body: string
  icon: RemixiconComponentType
  href: string
}

/** The Product menu's three columns, as drawn (spec: mega-menu.webp). Each item opens the docs section that explains it. */
export const PRODUCT_MENU: Array<{ label: string; items: ProductItem[] }> = [
  {
    label: "Capture",
    items: [
      { title: "Browser extension", body: "Record a tab, window or your whole screen", icon: RiPuzzleLine, href: RECORDING_DOCS },
      { title: "Screenshot & annotate", body: "Draw, blur and point at the bug right on the page", icon: RiCropLine, href: SCREENSHOT_DOCS },
      { title: "Voice narration", body: "Explain it out loud while you record", icon: RiMicLine, href: `${RECORDING_DOCS}#start-a-recording` },
    ],
  },
  {
    label: "Debug",
    items: [
      { title: "Console logs", body: "Errors and warnings with stack traces", icon: RiTerminalBoxLine, href: REPORT_PAGE_DOCS },
      { title: "Network requests", body: "Failed calls, status codes and timing", icon: RiPulseLine, href: REPORT_PAGE_DOCS },
      { title: "User steps", body: "Every click and keystroke before the bug", icon: RiCursorLine, href: REPORT_PAGE_DOCS },
    ],
  },
  {
    label: "Collaborate",
    items: [
      { title: "Comments & mentions", body: "Discuss the bug right on the report", icon: RiChat1Line, href: COMMENTS_DOCS },
      { title: "Share links", body: "Send a replay that opens at the right second", icon: RiLinksLine, href: SHARING_DOCS },
      { title: "Projects & URL patterns", body: "Reports land in the right project, matched by URL", icon: RiFolder3Line, href: PROJECTS_DOCS },
    ],
  },
]

function MenuItem({ item, onPick }: { item: ProductItem; onPick: () => void }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      onPress={onPick}
      className="group flex gap-3 rounded-xl px-2.5 py-3 transition hover:bg-[#FFFFFF]/[0.06] focus-visible:bg-[#FFFFFF]/[0.06]"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#FFFFFF]/[0.04] text-[#D9CFE0] outline outline-1 -outline-offset-1 outline-white/10 transition group-hover:bg-[#D61F69] group-hover:text-white group-hover:outline-transparent">
        <Icon className="size-[18px]" aria-hidden />
      </span>
      {/* Every item the same height (one-line title, two-line description), so the rows line up across columns. */}
      <span className="flex min-w-0 flex-col gap-1">
        <span data-menu-title className="text-[15px] font-semibold whitespace-nowrap text-white">
          {item.title}
        </span>
        <span data-menu-body className="line-clamp-2 h-[38px] text-[13px]/[19px] font-normal text-[#B6A7BE]">
          {item.body}
        </span>
      </span>
    </Link>
  )
}

/** The panel under Product: features by column, the Chrome card, and links to integrations and AI agents. */
export function ProductMenu({ id, installUrl, onPick }: { id: string; installUrl: string | null; onPick: () => void }) {
  return (
    <div
      id={id}
      className="overflow-hidden rounded-[20px] bg-[#241629] text-left shadow-[0_24px_64px_-16px_rgba(0,0,0,0.6)] outline outline-1 -outline-offset-1 outline-[#3D2B46]"
    >
      <div className="flex gap-5 p-5">
        <div className="grid flex-1 grid-cols-3 gap-x-3">
          {PRODUCT_MENU.map((column) => (
            <div key={column.label} className="flex flex-col gap-1">
              <p className="px-3 pt-2 pb-2 text-[12px] font-medium tracking-[1.4px] text-[#B6A7BE] uppercase">{column.label}</p>
              {column.items.map((item) => (
                <MenuItem key={item.title} item={item} onPick={onPick} />
              ))}
            </div>
          ))}
        </div>
        <div className="flex w-[264px] shrink-0 flex-col justify-between rounded-2xl bg-[url(/assets/site/cta-gradient.webp)] bg-cover bg-center p-7">
          <div className="flex flex-col gap-4">
            <span className="w-fit rounded-full bg-[#FFFFFF]/20 px-3 py-1 text-[13px] font-semibold text-white">Free to start</span>
            <p className="font-heading text-[22px]/[28px] font-semibold tracking-[-0.5px] text-white">Report your first bug in under a minute</p>
            <p className="text-[14px]/[22px] text-white/90">Install the extension, hit record, and BugBerry writes the report for you.</p>
          </div>
          <Link
            href={installHref(installUrl)}
            onPress={onPick}
            className="mt-8 inline-flex h-11 w-fit items-center gap-2 rounded-xl bg-[#FFFFFF] px-5 text-[15px] font-semibold text-[#1C1022] transition hover:bg-[#FFFFFF]/90"
          >
            <RiChromeFill className="size-[18px]" aria-hidden />
            Add to Chrome
          </Link>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 border-t border-[#3D2B46] px-8 py-4 text-[14px] text-[#D9CFE0]">
        <p className="flex items-center gap-2.5">
          <RiPlugLine className="size-4 text-[#B6A7BE]" aria-hidden />
          Works with GitHub, GitLab, Jira, Linear, Slack and more
          <Link href="/integrations" onPress={onPick} className="inline-flex items-center gap-1 font-semibold text-[#FF8AB8] hover:text-white">
            See all integrations
            <RiArrowRightLine className="size-3.5" aria-hidden />
          </Link>
        </p>
        <Link href="/ai-agents" onPress={onPick} className="inline-flex items-center gap-2.5 hover:text-white">
          <span className="rounded-full bg-[#D61F69] px-2 py-0.5 text-[12px] font-bold text-white">New</span>
          AI agents can now read your reports
          <RiArrowRightLine className="size-3.5" aria-hidden />
        </Link>
      </div>
    </div>
  )
}
