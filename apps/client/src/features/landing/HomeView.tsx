import {
  RiArrowRightLine,
  RiAttachment2,
  RiChromeFill,
  RiEyeOffLine,
  RiHashtag,
  RiLayoutGridLine,
  RiPlayFill,
  RiPlugLine,
  RiPulseLine,
  RiPuzzleLine,
  RiRobot2Line,
  RiShieldCheckLine,
  RiSparkling2Fill,
  RiTeamLine,
  RiTerminalBoxLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import type { ReactNode } from "react"
import { Link } from "@bugberry/ui/link"
import { FinalCta } from "./FinalCta"
import { IntegrationLogo, NOTIFIERS, TRACKERS } from "./integrations-data"
import { Reveal } from "./Reveal"
import { SiteChrome } from "./SiteChrome"
import { installHref, MCP_GUIDE, siteContainer, WEBHOOK_DOCS } from "./site-links"
import { WebhookSample } from "./WebhookSample"

const eyebrow = "text-[12px] font-medium tracking-[1.2px] uppercase"
const sectionTitle = "font-heading text-[34px]/[38px] font-semibold tracking-[-1px] md:text-[44px]/[48px] md:tracking-[-1.4px]"

function Hero({ installUrl }: { installUrl: string | null }) {
  return (
    <section id="capture" className="scroll-mt-4 bg-[#1C1022] px-4 pt-14 pb-14 sm:px-6 md:pt-[88px] md:pb-[72px]">
      <div className="mx-auto flex max-w-[1000px] flex-col items-center gap-[22px] text-center">
        <Reveal immediate variant="down">
          <Link
            href="/ai-agents"
            className="glow-ring inline-flex max-w-full items-center gap-2.5 rounded-full py-[3px] pr-3.5 pl-[3px] text-[13px] font-semibold"
          >
            <span className="shine inline-flex items-center gap-1 rounded-full bg-[linear-gradient(90deg,#D61F69_0%,#FF4F8B_100%)] px-2.5 py-1 text-[12px] font-bold text-white">
              <RiSparkling2Fill className="size-3" aria-hidden />
              New
            </span>
            <span className="hidden text-white sm:inline">Let Claude &amp; Cursor fix your bugs</span>
            <span className="hidden size-[3px] rounded-full bg-[#FFFFFF]/35 sm:inline" aria-hidden />
            <span className="truncate text-[#FF8AB8]">Connect your AI agent in 2 minutes</span>
            <RiArrowRightLine className="size-3.5 shrink-0 text-white" aria-hidden />
          </Link>
        </Reveal>
        <Reveal as="h1" immediate variant="blur" delay={80} className="font-heading text-[40px]/[44px] font-semibold tracking-[-1.4px] text-white sm:text-[52px]/[56px] md:text-[68px]/[69px] md:tracking-[-2.4px]">
          Bug reporting for teams, and the agents that fix them
        </Reveal>
        <Reveal as="p" immediate variant="up" delay={160} className="max-w-[640px] text-[16px]/[26px] text-[#B6A7BE] md:text-[18px]/[28px]">
          One click captures the video, console, network and steps. BugBerry turns it into a ready-to-fix report for your tracker, your
          channel and your AI agents.
        </Reveal>
        <Reveal immediate variant="up" delay={220} className="flex w-full flex-col items-stretch gap-3 pt-2.5 sm:w-auto sm:flex-row sm:items-center">
          <Link
            href={installHref(installUrl)}
            className="inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-[#D61F69] px-5 text-[15px] font-semibold text-white transition hover:bg-[#C01A5E]"
          >
            <RiChromeFill className="size-[18px]" aria-hidden />
            Add to Chrome, it’s free
          </Link>
          <Link
            href="/demo"
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#2A1B31] px-5 text-[15px] font-semibold text-white outline outline-1 -outline-offset-1 outline-[#3D2B46] transition hover:bg-[#3D2B46]"
          >
            Talk to a human
            <RiArrowRightLine className="size-4" aria-hidden />
          </Link>
        </Reveal>
      </div>
      <Reveal immediate variant="rise" delay={280} className="mx-auto mt-12 max-w-[1280px] overflow-hidden rounded-[16px] md:rounded-[24px]">
        <img
          src="/assets/site/home-hero.webp"
          width={1280}
          height={680}
          alt="The BugBerry dashboard: every report with its recording, reporter, status and priority"
          className="h-auto w-full max-md:w-[720px] max-md:max-w-none"
        />
      </Reveal>
    </section>
  )
}

const AI_FEATURES: Array<{ title: string; body: string }> = [
  {
    title: "Ask about any report",
    body: "“Which bugs hit checkout this week?” Agents search reports across your projects and open the ones that matter, replay and logs included.",
  },
  {
    title: "Agents that do the fix",
    body: "Paste a report link into Claude or Cursor. They read the replay, logs and code lines that failed, then comment here and mark it Resolved.",
  },
  {
    title: "Lives where you work",
    body: "Use it from Cursor, VS Code, Windsurf, Claude Code, Claude.ai or ChatGPT. One MCP server for every AI client you already run.",
  },
]

function AiAgents({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="ai-agents" className="scroll-mt-4 bg-[#2A1B31] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10`}>
        <Reveal variant="up" className="flex flex-col gap-6 md:flex-row md:justify-between md:gap-16">
          <h2 className="flex-1 font-heading text-[34px]/[38px] font-semibold tracking-[-1px] text-white md:text-[48px]/[50px] md:tracking-[-1.6px]">
            AI that fixes bugs because it watched them happen
          </h2>
          <div className="flex flex-col gap-[18px] md:w-[480px]">
            <p className="text-[16px]/[26px] text-[#B6A7BE] md:text-[17px]">
              Most agents guess from a one-line ticket. BugBerry hands them the recording, console, network and repro steps through MCP, so
              Claude, Cursor or Copilot start with the full story.
            </p>
            <div className="flex flex-wrap gap-2.5 pt-1">
              <Link
                href={signedIn ? "/app/settings/ai" : "/login"}
                className="inline-flex h-[42px] items-center rounded-[11px] bg-[#FFFFFF] px-4 text-[14px] font-semibold text-[#1C1022] transition hover:bg-[#FFFFFF]/90"
              >
                Connect an agent
              </Link>
              <Link
                href={MCP_GUIDE}
                className="inline-flex h-[42px] items-center gap-1.5 rounded-[11px] bg-[#FFFFFF]/[0.06] px-4 text-[14px] font-semibold text-white outline outline-1 -outline-offset-1 outline-white/20 transition hover:bg-[#FFFFFF]/10"
              >
                Read the MCP docs
                <RiArrowRightLine className="size-[15px]" aria-hidden />
              </Link>
            </div>
          </div>
        </Reveal>
        <Reveal id="debug" variant="rise" className="scroll-mt-4 overflow-hidden rounded-[16px] md:rounded-[22px]">
          <img
            src="/assets/site/home-report.webp"
            width={1120}
            height={500}
            alt="A report in BugBerry: the recording with the failed checkout marked, and the network requests beside it"
            className="h-auto w-full max-md:w-[720px] max-md:max-w-none"
          />
        </Reveal>
        <div className="grid gap-6 md:grid-cols-3 md:gap-8">
          {AI_FEATURES.map((feature) => (
            <div key={feature.title} className="flex flex-col gap-2 border-t border-[#3D2B46] pt-5">
              <p className="text-[16px] font-semibold text-white">{feature.title}</p>
              <p className="text-[14px]/[22px] text-[#B6A7BE]">{feature.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Illustration({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex h-[190px] w-full shrink-0 items-center justify-center rounded-[14px] bg-[#F7F6FA] outline outline-1 -outline-offset-1 outline-[#E6E1EC] sm:w-[330px] ${className}`}
    >
      {children}
    </div>
  )
}

const BARS = [6, 10, 7, 14, 9, 5, 12, 18, 9, 6, 11, 16, 22, 9, 7, 5, 8, 12, 6, 9]

function PlayerIllustration() {
  return (
    <Illustration>
      <div className="flex w-[250px] flex-col gap-2.5 rounded-xl bg-[#FFFFFF] p-3.5 shadow-[0_8px_20px_#1C102214] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
        <div className="flex h-20 items-center justify-center rounded-lg bg-[#1C1022]">
          <span className="flex size-[30px] items-center justify-center rounded-full bg-[#D61F69]">
            <RiPlayFill className="size-[13px] text-white" aria-hidden />
          </span>
        </div>
        <div className="flex h-[22px] items-end gap-0.5" aria-hidden>
          {BARS.map((height, index) => (
            <span
              key={index}
              className={`flex-1 rounded-[1px] ${index === 12 ? "bg-[#E5484D]" : index < 9 ? "bg-[#D61F69]" : "bg-[#E6E1EC]"}`}
              style={{ height }}
            />
          ))}
        </div>
        <div className="flex gap-1.5 text-[10px]">
          <span className="rounded-[5px] bg-[#F7F6FA] px-1.5 py-0.5">click</span>
          <span className="rounded-[5px] bg-[#FDE7E8] px-1.5 py-0.5 text-[#C2353A]">500</span>
          <span className="rounded-[5px] bg-[#FDE7E8] px-1.5 py-0.5 text-[#C2353A]">TypeError</span>
        </div>
      </div>
    </Illustration>
  )
}

function DestinationsIllustration() {
  const destinations: Array<[string, ReactNode]> = [
    ["Jira", <IntegrationLogo key="jira" name="Jira" size={16} />],
    ["Linear", <IntegrationLogo key="linear" name="Linear" size={16} />],
    ["Slack", <IntegrationLogo key="slack" name="Slack" size={16} />],
    [
      "AI agent",
      <span key="bot" className="flex size-4 items-center justify-center rounded-[4px] bg-[#1C1022]">
        <RiRobot2Line className="size-2.5 text-white" aria-hidden />
      </span>,
    ],
  ]
  return (
    <Illustration className="gap-3 px-4">
      <div className="flex w-[132px] flex-col gap-2 rounded-xl bg-[#FFFFFF] p-3 shadow-[0_4px_12px_#1C102214] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
        <span className="text-[10px] font-semibold text-[#635A6B]">BB-142</span>
        <span className="text-[12px] font-semibold">Checkout hangs on “Pay”</span>
        {[
          [RiPlayFill, "Replay 0:42"],
          [RiTerminalBoxLine, "Console"],
          [RiPulseLine, "Network"],
        ].map(([Icon, label]) => {
          const Glyph = Icon as RemixiconComponentType
          return (
            <span key={label as string} className="flex items-center gap-1.5 text-[11px] text-[#4A4152]">
              <Glyph className="size-[11px]" aria-hidden />
              {label as string}
            </span>
          )
        })}
      </div>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#D61F69]">
        <RiArrowRightLine className="size-3.5 text-white" aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        {destinations.map(([label, logo]) => (
          <span
            key={label}
            className="flex h-[30px] w-[112px] items-center gap-[7px] rounded-lg bg-[#FFFFFF] px-[9px] text-[12px] font-medium outline outline-1 -outline-offset-1 outline-[#E6E1EC]"
          >
            {logo}
            {label}
            <RiAttachment2 className="ml-auto size-[11px] text-[#8C7C95]" aria-hidden />
          </span>
        ))}
      </div>
    </Illustration>
  )
}

function MaskedIllustration() {
  const masked = (value: string) => (
    <div className="flex h-[30px] items-center gap-1.5 rounded-[7px] bg-[#F7F6F9] px-2 outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
      <span className="flex-1 truncate text-[11px] text-[#635A6B]">{value}</span>
      <span className="flex items-center gap-[3px] rounded-full bg-[#E3F4EA] px-1.5 py-px text-[9px] font-bold text-[#1F7A50]">
        <RiEyeOffLine className="size-[9px]" aria-hidden />
        Masked
      </span>
    </div>
  )
  return (
    <Illustration>
      <div className="flex w-[250px] flex-col gap-2 rounded-xl bg-[#FFFFFF] p-3.5 shadow-[0_4px_12px_#1C102214] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
        <div className="flex h-[30px] items-center rounded-[7px] px-2 text-[11px] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">dina@company.com</div>
        {masked("••••••••••")}
        {masked("Authorization: [redacted]")}
        <span className="flex items-center gap-[5px] pt-0.5 text-[10px] font-semibold text-[#1F7A50]">
          <RiShieldCheckLine className="size-3" aria-hidden />
          Kept out of the report, before upload
        </span>
      </div>
    </Illustration>
  )
}

const IDEAS: Array<{ number: string; label: string; title: string; body: ReactNode; art: ReactNode }> = [
  {
    number: "01",
    label: "Show, don’t describe",
    title: "A bug report is a recording",
    body: "Words drift. A replay with the console and network beside it doesn’t. Every report starts from what actually happened on screen.",
    art: <PlayerIllustration />,
  },
  {
    number: "02",
    label: "Context travels",
    title: "Evidence goes where the bug goes",
    body: "Jira, Linear, Slack or an AI agent: the recording, logs and steps ride along. Nobody has to ask “which browser?” ever again.",
    art: <DestinationsIllustration />,
  },
  {
    number: "03",
    label: "Private by default",
    title: "Capture everything, expose nothing",
    body: "Password fields, tokens, cookies and authorization headers are kept out of the logs and steps before upload, and you can blur anything on a screenshot. Only your workspace sees a report until you share its link.",
    art: <MaskedIllustration />,
  },
]

function Philosophy() {
  return (
    <section className="border-t border-[#E6E1EC] bg-[#FFFFFF] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10 lg:flex-row lg:gap-16`}>
        <Reveal variant="up" className="flex flex-col gap-3.5 lg:sticky lg:top-24 lg:w-[400px] lg:shrink-0 lg:self-start">
          <p className="text-[11px] font-semibold tracking-[1.1px] text-[#D61F69] uppercase">The BugBerry operating manual</p>
          <h2 className="font-heading text-[30px]/[36px] font-semibold tracking-[-1px] md:text-[36px]/[40px]">Three ideas behind every report</h2>
          <p className="text-[15px]/[23px] text-[#635A6B]">
            They keep reports honest, keep context attached at every step, and keep your team fixing bugs instead of discussing them.
          </p>
        </Reveal>
        <div className="flex flex-1 flex-col">
          {IDEAS.map((idea, index) => (
            <Reveal
              key={idea.number}
              variant="up"
              delay={index * 80}
              className={`flex flex-col gap-5 border-t border-[#E6E1EC] py-8 sm:flex-row sm:gap-7 ${index === IDEAS.length - 1 ? "border-b" : ""}`}
            >
              <span className="font-heading text-[15px] font-semibold text-[#D61F69]">{idea.number}</span>
              <div className="flex flex-1 flex-col gap-2">
                <p className="text-[11px] font-semibold tracking-[1.1px] text-[#635A6B] uppercase">{idea.label}</p>
                <h3 className="font-heading text-[20px]/[25px] font-semibold tracking-[-0.4px]">{idea.title}</h3>
                <p className="text-[14px]/[22px] text-[#635A6B]">{idea.body}</p>
              </div>
              {idea.art}
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const WORKSPACE_ITEMS: Array<{ icon: RemixiconComponentType; title: string; body: string }> = [
  { icon: RiHashtag, title: "Projects", body: "One per product or client. Each picks its trackers, channels and URL patterns." },
  { icon: RiLayoutGridLine, title: "All reports", body: "Every report across projects, with filters by type, status, reporter and project." },
  { icon: RiRobot2Line, title: "AI Agents (MCP)", body: "Give Claude, Cursor or Copilot read access to reports, scoped to what you can see." },
  { icon: RiPlugLine, title: "Integrations", body: "Connect Jira, Linear, GitHub or Slack once, reuse it in any project." },
  {
    icon: RiTeamLine,
    title: "Members and sharing",
    body: "Invite your team by email as admins or members, and share any report through a link, inside your company or public.",
  },
  { icon: RiPuzzleLine, title: "Browser extension", body: "Record from any tab. Reports land in the right project by URL." },
]

function Workspace() {
  return (
    <section className="bg-[#F7F6FA] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col items-center gap-12 lg:flex-row lg:gap-16`}>
        <Reveal variant="up" className="flex flex-1 flex-col gap-4">
          <p className={`${eyebrow} text-[#D61F69]`}>Where bugs live · Workspace</p>
          <h2 className={sectionTitle}>Everything in one workspace</h2>
          <p className="text-[16px]/[26px] text-[#635A6B] md:text-[17px]">
            Your team’s bug HQ. Every project, every reporter and every connected tool in one place, with the evidence a click away.
          </p>
          <div className="grid gap-7 pt-5 sm:grid-cols-2 sm:gap-x-8">
            {WORKSPACE_ITEMS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="flex flex-col gap-1.5">
                <p className="flex items-center gap-2 text-[15px] font-semibold">
                  <Icon className="size-4 text-[#D61F69]" aria-hidden />
                  {title}
                </p>
                <p className="text-[13px]/[20px] text-[#635A6B]">{body}</p>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal variant="rise" className="w-full max-w-[540px] shrink-0 overflow-hidden rounded-[24px]">
          <img
            src="/assets/site/home-workspace.webp"
            width={540}
            height={600}
            alt="A BugBerry workspace: projects, AI agents and every report in one place"
            className="h-auto w-full"
          />
        </Reveal>
      </div>
    </section>
  )
}

function Integrations() {
  return (
    <section id="integrations" className="scroll-mt-4 bg-[#1C1022] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col items-center gap-12`}>
        <Reveal variant="up" className="flex max-w-[860px] flex-col items-center gap-3.5 text-center">
          <p className={`${eyebrow} text-[#F37BAA]`}>Integrations</p>
          <h2 className={`${sectionTitle} text-white`}>Plug into the tools your team lives in</h2>
        </Reveal>
        <div className="grid w-full grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <Reveal variant="up" className="flex flex-col gap-2 rounded-[20px] bg-[#F7F6FA] p-6 md:p-8">
            <h3 className="text-[18px] font-semibold">Browse 10 integrations</h3>
            <p className="text-[14px]/[21px] text-[#635A6B]">
              GitHub, GitLab, Jira, Linear, ActiveCollab and Plane for issues. Slack, Discord, Telegram or a webhook for alerts.
            </p>
            <Link href="/integrations" className="inline-flex w-fit items-center gap-1.5 text-[14px] font-semibold text-[#D61F69]">
              See all integrations
              <RiArrowRightLine className="size-3.5" aria-hidden />
            </Link>
            <ul className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {[...TRACKERS, ...NOTIFIERS.filter((item) => item.name !== "Webhook")].map((item) => (
                <li key={item.name} className="flex flex-col gap-2 rounded-xl bg-[#FFFFFF] p-3.5 outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
                  <div className="flex items-start justify-between gap-2">
                    <IntegrationLogo name={item.name} />
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${item.kind === "Alerts" ? "bg-[#E7F5DF] text-[#3E7F1C]" : "bg-[#FDE8F0] text-[#B3175A]"}`}
                    >
                      {item.kind === "Tickets" ? "Issues" : item.kind}
                    </span>
                  </div>
                  <p className="text-[15px] font-semibold">{item.name}</p>
                  <p className="text-[12.5px]/[18px] text-[#635A6B]">{item.short}</p>
                </li>
              ))}
            </ul>
          </Reveal>
          <Reveal variant="up" delay={80} className="flex flex-col gap-2 rounded-[20px] bg-[#F7F6FA] p-6 md:p-8">
            <h3 className="text-[18px] font-semibold">Not on the list? Use a webhook</h3>
            <p className="text-[14px]/[21px] text-[#635A6B]">
              BugBerry sends every new report to your URL as JSON, with the report link and its error and failed-request counts. Wire it
              into an internal tool, a spreadsheet or your own bot.
            </p>
            <Link href={WEBHOOK_DOCS} className="inline-flex w-fit items-center gap-1.5 text-[14px] font-semibold text-[#D61F69]">
              See the webhook docs
              <RiArrowRightLine className="size-3.5" aria-hidden />
            </Link>
            <WebhookSample className="mt-5 flex-1" />
          </Reveal>
        </div>
        <Reveal
          id="collaborate"
          variant="up"
          className="flex w-full scroll-mt-4 flex-col gap-8 rounded-[20px] bg-[#2A1B31] p-6 outline outline-1 -outline-offset-1 outline-[#3D2B46] md:flex-row md:items-center md:gap-10 md:p-8"
        >
          <div className="flex flex-1 flex-col gap-2.5">
            <h3 className="text-[20px] font-semibold text-white">Talk it through right on the report</h3>
            <p className="text-[14px]/[22px] text-[#B6A7BE]">
              Comment on any report and @mention a teammate to pull them in. The replay, console and network sit right above the thread, so
              nobody has to ask which bug you mean.
            </p>
            <p className="text-[12px] text-[#8C7C95]">Replies stay with the report, not lost in a chat.</p>
          </div>
          <img
            src="/assets/site/home-thread.webp"
            width={520}
            height={232}
            alt="A comment thread on a report: a teammate is mentioned and a reply links to 0:31 in the recording"
            className="h-auto w-full rounded-[14px] md:w-[520px]"
          />
        </Reveal>
      </div>
    </section>
  )
}

/** `/` on BugBerry cloud: what BugBerry is, for whom, and how to start. */
export function HomeView({ signedIn, installUrl }: { signedIn: boolean; installUrl: string | null }) {
  return (
    <SiteChrome signedIn={signedIn} installUrl={installUrl}>
      <Hero installUrl={installUrl} />
      <AiAgents signedIn={signedIn} />
      <Philosophy />
      <Workspace />
      <Integrations />
      <FinalCta installUrl={installUrl} />
    </SiteChrome>
  )
}
