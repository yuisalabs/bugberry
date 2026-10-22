import {
  RiArrowRightLine,
  RiChat1Line,
  RiCheckLine,
  RiCursorLine,
  RiEyeOffLine,
  RiFlagLine,
  RiKey2Line,
  RiRobot2Line,
  RiShieldUserLine,
  RiTerminalBoxLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import type { ReactNode } from "react"
import { Link } from "@bugberry/ui/link"
import { FinalCta } from "./FinalCta"
import { Reveal } from "./Reveal"
import { SiteChrome } from "./SiteChrome"
import { MCP_GUIDE, siteContainer } from "./site-links"

const eyebrow = "text-[12px] font-semibold tracking-[1.4px] uppercase"
const heading = "font-heading text-[30px]/[36px] font-semibold tracking-[-1px] md:text-[36px]/[41px]"
/** The clients apps/docs/content/docs/guide/ai-agents.mdx walks through. */
const CLIENTS = ["Claude Code", "Claude.ai", "Cursor", "VS Code", "Windsurf", "ChatGPT"]

function connectHref(signedIn: boolean) {
  return signedIn ? "/app/settings/ai" : "/login"
}

function Hero({ signedIn }: { signedIn: boolean }) {
  return (
    <section className="overflow-hidden bg-[#1C1022] bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,#3D1A3F_0%,#1C1022_70%)] pt-16 md:pt-24">
      <div className={`${siteContainer} flex flex-col items-center gap-12`}>
        <Reveal immediate variant="up" className="flex max-w-[880px] flex-col items-center gap-[18px] text-center">
          <p className={`${eyebrow} text-[#FF8AB8]`}>AI Agents · MCP</p>
          <h1 className="font-heading text-[38px]/[42px] font-semibold tracking-[-1.2px] text-white md:text-[52px]/[56px] md:tracking-[-1.8px]">
            Your AI agent can fix the bug it watched happen
          </h1>
          <p className="max-w-[700px] text-[16px]/[26px] text-[#B6A7BE] md:text-[17px]">
            Most agents guess from a one-line ticket. BugBerry hands Claude, Cursor or Copilot the recording, console, network and repro
            steps through MCP, so they start with the full story.
          </p>
          <div className="flex flex-col items-stretch gap-2.5 pt-2.5 sm:flex-row">
            <Link
              href={connectHref(signedIn)}
              className="inline-flex h-[46px] items-center justify-center rounded-xl bg-[#D61F69] px-5 text-[15px] font-semibold text-white transition hover:bg-[#C01A5E]"
            >
              Connect an agent
            </Link>
            <Link
              href={MCP_GUIDE}
              className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl bg-[#FFFFFF]/[0.06] px-5 text-[15px] font-semibold text-white outline outline-1 -outline-offset-1 outline-white/20 transition hover:bg-[#FFFFFF]/10"
            >
              Read the MCP docs
              <RiArrowRightLine className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-[18px]">
            <span className="text-[13px] text-[#B6A7BE]">Works with</span>
            <ul aria-label="Works with" className="flex flex-wrap justify-center gap-2.5">
              {CLIENTS.map((client) => (
                <li
                  key={client}
                  className="rounded-full bg-[#FFFFFF]/5 px-3 py-[5px] text-[13px] font-medium text-[#E2D8E8] outline outline-1 -outline-offset-1 outline-white/[0.12]"
                >
                  {client}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
        <Reveal immediate variant="rise" delay={120} className="w-full overflow-hidden rounded-t-[16px] md:rounded-t-[22px]">
          <img
            src="/assets/site/agents-settings.webp"
            width={1120}
            height={640}
            alt="BugBerry's AI Agents settings: copy the MCP server URL, add it to Claude Code, Cursor or another AI app, and manage personal tokens"
            className="h-auto w-full max-md:w-[720px] max-md:max-w-none"
          />
        </Reveal>
      </div>
    </section>
  )
}

function Steps({ origin }: { origin: string }) {
  const server = `${origin}/api/mcp`
  const steps: Array<{ title: string; body: string; ui: ReactNode }> = [
    {
      title: "Copy the server URL",
      body: "Grab BugBerry’s MCP address from Settings → AI Agents.",
      ui: (
        <div className="flex h-24 flex-col justify-center gap-2 rounded-xl bg-[#FFFFFF] p-3.5 outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
          <div className="flex h-9 items-center gap-2 rounded-lg bg-[#F7F6F9] pr-1.5 pl-2.5 outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
            <span className="flex-1 truncate font-mono text-[12px]">{server}</span>
            <span className="rounded-md bg-[#FFFFFF] px-2 py-1 text-[11px] font-semibold outline outline-1 -outline-offset-1 outline-[#E6E1EC]">Copy</span>
          </div>
          <span className="text-[11px] text-[#635A6B]">Works with OAuth or a personal token</span>
        </div>
      ),
    },
    {
      title: "Add it to your agent",
      body: "One command in Claude Code, or a click in Cursor, VS Code and the rest.",
      ui: (
        <div className="flex h-24 flex-col justify-center gap-2 rounded-xl bg-[#1C1022] p-3.5 font-mono outline outline-1 -outline-offset-1 outline-[#2A1B31]">
          <p className="flex gap-1.5 text-[12px]/[18px] text-white">
            <span className="text-[#FF6FA5]">$</span>
            <span className="break-all">claude mcp add --transport http bugberry {server}</span>
          </p>
          <span className="flex items-center gap-1.5 text-[11px] text-[#B8F0C0]">
            <RiCheckLine className="size-3" aria-hidden />
            bugberry connected
          </span>
        </div>
      ),
    },
    {
      title: "Paste a report link",
      body: "Ask the agent to fix it. It reads the replay, logs and steps before touching code.",
      ui: (
        <div className="flex h-24 flex-col justify-center gap-2 rounded-xl bg-[#FFFFFF] p-3.5 outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
          <p className="flex gap-1.5 rounded-lg bg-[#F7F6F9] px-2.5 py-2 text-[12px] text-[#4A4152]">
            Fix this bug: <span className="font-semibold text-[#D61F69]">BB-148</span>
          </p>
          <p className="flex items-center gap-1.5 text-[11px] text-[#4A4152]">
            <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-[#1C1022]">
              <RiRobot2Line className="size-3 text-white" aria-hidden />
            </span>
            Found it: POST /api/orders 500 at 0:31
          </p>
        </div>
      ),
    },
  ]
  return (
    <section className="bg-[#FFFFFF] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-11`}>
        <Reveal variant="up" className="flex flex-col items-center gap-3 text-center">
          <p className={`${eyebrow} text-[#D61F69]`}>How it works</p>
          <h2 className={heading}>Three steps to your first AI fix</h2>
        </Reveal>
        <ol className="grid gap-5 lg:grid-cols-3">
          {steps.map((step, index) => (
            <Reveal
              as="li"
              key={step.title}
              variant="up"
              delay={index * 80}
              className="flex min-w-0 flex-col gap-3.5 rounded-[18px] bg-[#F7F6FA] p-6 outline outline-1 -outline-offset-1 outline-[#E6E1EC]"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-full bg-[#D61F69] text-[13px] font-bold text-white">{index + 1}</span>
                <h3 className="font-heading text-[17px] font-semibold">{step.title}</h3>
              </div>
              <p className="min-h-[44px] text-[14px]/[22px] text-[#635A6B]">{step.body}</p>
              {step.ui}
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}

const CAPABILITIES: Array<{ icon: RemixiconComponentType; title: string; body: string; example: string }> = [
  {
    icon: RiTerminalBoxLine,
    title: "Read console & network logs",
    body: "Errors, failed requests and stack traces, timestamped against the video.",
    example: "TypeError: Cannot read ‘total’ · POST /api/orders 500",
  },
  {
    icon: RiCursorLine,
    title: "Replay user steps",
    body: "Every click, input and navigation before the bug, in order.",
    example: "click “Pay” → wait 2.3s → spinner never stops",
  },
  {
    icon: RiChat1Line,
    title: "Comment on reports",
    body: "Post what it found and the fix it proposes, right in the thread.",
    example: "“Root cause: orders API returns 500 when cart is empty.”",
  },
  {
    icon: RiFlagLine,
    title: "Update status & priority",
    body: "Move a report to Resolved once the fix is in, or bump its priority.",
    example: "Open → Resolved · Priority: High",
  },
]

function Capabilities() {
  return (
    <section className="border-t border-[#E6E1EC] bg-[#F7F6FA] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10`}>
        <Reveal variant="up" className="flex flex-col gap-3">
          <p className={`${eyebrow} text-[#D61F69]`}>What agents can do</p>
          <h2 className={heading}>Everything a good teammate would check first</h2>
        </Reveal>
        <div className="grid gap-5 md:grid-cols-2">
          {CAPABILITIES.map(({ icon: Icon, title, body, example }, index) => (
            <Reveal
              key={title}
              variant="up"
              delay={(index % 2) * 80}
              className="flex gap-[18px] rounded-[18px] bg-[#FFFFFF] p-6 outline outline-1 -outline-offset-1 outline-[#E6E1EC] md:p-7"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-[13px] bg-[#FCE3EE] text-[#D61F69]">
                <Icon className="size-[22px]" aria-hidden />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <h3 className="font-heading text-[19px] font-semibold">{title}</h3>
                <p className="text-[14px]/[22px] text-[#635A6B]">{body}</p>
                <p className="rounded-lg bg-[#F7F6F9] px-3 py-2 font-mono text-[12px] text-[#4A4152]">{example}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const TRUST: Array<{ icon: RemixiconComponentType; title: string; body: string }> = [
  {
    icon: RiShieldUserLine,
    title: "Scoped to your access",
    body: "An agent signs in as you, so it only reads projects and reports you already have.",
  },
  { icon: RiKey2Line, title: "Personal tokens for CI", body: "Create a token per bot, name it, and revoke it any time." },
  {
    icon: RiEyeOffLine,
    title: "Secrets stay out of the report",
    body: "Password fields, tokens, cookies and authorization headers are kept out of the logs and steps before upload.",
  },
]

function Trust() {
  return (
    <section className="border-t border-[#E6E1EC] bg-[#FFFFFF] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col items-center gap-12 lg:flex-row lg:gap-16`}>
        <Reveal variant="up" className="flex flex-1 flex-col gap-[18px]">
          <p className={`${eyebrow} text-[#D61F69]`}>Safe by default</p>
          <h2 className={`${heading} max-w-[470px]`}>Agents see only what you can see</h2>
          {TRUST.map(({ icon: Icon, title, body }) => (
            <div key={title} className="flex gap-3.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#FCE3EE] text-[#D61F69]">
                <Icon className="size-[18px]" aria-hidden />
              </span>
              <div className="flex flex-col gap-[3px]">
                <h3 className="text-[15px] font-semibold">{title}</h3>
                <p className="text-[14px]/[21px] text-[#635A6B]">{body}</p>
              </div>
            </div>
          ))}
        </Reveal>
        <Reveal variant="rise" className="w-full max-w-[520px] shrink-0">
          <img
            src="/assets/site/agents-tokens.webp"
            width={520}
            height={498}
            alt="BugBerry's AI settings: connected apps, and personal tokens that work with the MCP server only"
            className="h-auto w-full"
          />
        </Reveal>
      </div>
    </section>
  )
}

/** `/ai-agents`: BugBerry's MCP server. `origin` is this server, for the address and the command. */
export function AiAgentsView({ signedIn, installUrl, origin }: { signedIn: boolean; installUrl: string | null; origin: string }) {
  return (
    <SiteChrome signedIn={signedIn} installUrl={installUrl}>
      <Hero signedIn={signedIn} />
      <Steps origin={origin} />
      <Capabilities />
      <Trust />
      <FinalCta installUrl={installUrl} />
    </SiteChrome>
  )
}
