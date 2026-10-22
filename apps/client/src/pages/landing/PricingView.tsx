import { RiAddLine, RiCheckLine, RiServerLine, RiSubtractLine } from "@remixicon/react"
import { type ReactNode, useId, useState } from "react"
import { Link } from "@bugberry/ui/link"
import { ComingSoon } from "./ComingSoon"
import { FinalCta } from "./FinalCta"
import { Reveal } from "./Reveal"
import { SiteChrome } from "./SiteChrome"
import { SELF_HOST_DOCS, siteContainer } from "./site-links"

interface Plan {
  name: string
  blurb: string
  price: string
  priceNote: string
  cta: { label: string; href: string }
  lead?: string
  features: string[]
  available: boolean
}

const PLANS: Plan[] = [
  {
    name: "Free",
    blurb: "Everything BugBerry does, for one person.",
    price: "$0",
    priceNote: "during early access",
    cta: { label: "Start free", href: "/login" },
    features: [
      "1 workspace",
      "5 screenshots",
      "5 video recordings",
      "Console, network & user steps",
      "Share links",
      "All 10 integrations + webhooks",
      "AI Agents (MCP)",
      "Unlimited projects",
    ],
    available: true,
  },
  {
    name: "Team",
    blurb: "For teams that record bugs every day and need more room to grow.",
    price: "Soon",
    priceNote: "Pricing announced before early access ends",
    cta: { label: "Notify me", href: "/demo" },
    lead: "Everything in Free, plus",
    features: ["Invite your team", "Unlimited screenshots", "Unlimited video recordings", "Longer recordings & history", "Priority email support"],
    available: false,
  },
  {
    name: "Business",
    blurb: "For companies with security and admin needs.",
    price: "Soon",
    priceNote: "Pricing announced before early access ends",
    cta: { label: "Notify me", href: "/demo" },
    lead: "Everything in Team, plus",
    features: ["SSO & SAML", "Roles & audit log", "Custom data masking rules", "Dedicated onboarding"],
    available: false,
  },
]

function PlanCard({ plan }: { plan: Plan }) {
  const free = plan.available
  return (
    <section
      aria-label={`${plan.name} plan`}
      className={`flex flex-1 flex-col gap-6 rounded-[20px] p-7 md:p-8 ${
        free
          ? "bg-[#FFFFFF] text-[#1C1022] shadow-[0_24px_60px_#D61F6940] outline outline-2 -outline-offset-1 outline-[#D61F69]"
          : "bg-[#FFFFFF]/[0.03] text-white opacity-90 outline outline-1 -outline-offset-1 outline-white/[0.12]"
      }`}
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-[20px] font-semibold">
            {plan.name}
          </h2>
          {free ? (
            <span className="rounded-full bg-[#D61F69] px-2.5 py-1 text-[11px] font-bold text-white">Available now</span>
          ) : (
            <span className="rounded-full bg-[#FFFFFF]/[0.08] px-2.5 py-[3px] text-[11px] font-semibold text-[#E2D8E8] outline outline-1 -outline-offset-1 outline-white/15">
              Coming soon
            </span>
          )}
        </div>
        <p className={`text-[14px] ${free ? "text-[#635A6B]" : "text-[#B6A7BE]"}`}>{plan.blurb}</p>
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-heading text-[48px] font-semibold tracking-[-1.5px]">{plan.price}</p>
        <p className={`text-[13px] ${free ? "text-[#635A6B]" : "text-[#B6A7BE]"}`}>{plan.priceNote}</p>
      </div>
      <Link
        href={plan.cta.href}
        className={`inline-flex h-[46px] items-center justify-center rounded-xl text-[15px] font-semibold transition ${
          free
            ? "bg-[#D61F69] text-white hover:bg-[#C01A5E]"
            : "bg-[#FFFFFF]/[0.06] text-white outline outline-1 -outline-offset-1 outline-white/20 hover:bg-[#FFFFFF]/10"
        }`}
      >
        {plan.cta.label}
      </Link>
      <div className="flex flex-col gap-3 pt-1">
        {plan.lead && <p className="text-[14px] font-semibold">{plan.lead}</p>}
        <ul className="flex flex-col gap-3">
          {plan.features.map((feature) => (
            <li key={feature} className={`flex items-center gap-2.5 text-[14px] ${free ? "text-[#4A4152]" : "text-[#E2D8E8]"}`}>
              <RiCheckLine className={`size-[15px] shrink-0 ${free ? "text-[#D61F69]" : "text-[#FF8AB8]"}`} aria-hidden />
              {feature}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

function Hero() {
  return (
    <section className="bg-[#1C1022] bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,#3D1A3F_0%,#1C1022_70%)] pt-16 pb-20 md:pt-24 md:pb-24">
      <div className={`${siteContainer} flex flex-col items-center gap-14`}>
        <Reveal immediate variant="up" className="flex max-w-[820px] flex-col items-center gap-[18px] text-center">
          <p className="text-[12px] font-semibold tracking-[1.4px] text-[#FF8AB8] uppercase">Pricing · Early access</p>
          <h1 className="font-heading text-[38px]/[42px] font-semibold tracking-[-1.2px] text-white md:text-[52px]/[56px] md:tracking-[-1.8px]">
            BugBerry is free while we’re in early access.
          </h1>
          <p className="max-w-[640px] text-[16px]/[26px] text-[#B6A7BE] md:text-[17px]">
            Every feature is open to you. The only limits for now: 5 screenshots and 5 video recordings per workspace.
          </p>
          <p className="inline-flex items-center gap-2 rounded-full bg-[#7BD389]/[0.12] px-3.5 py-1.5 text-[13px] font-semibold text-[#B8F0C0] outline outline-1 -outline-offset-1 outline-[#7BD389]/30">
            <span className="size-2 rounded-full bg-[#7BD389]" aria-hidden />
            No credit card · Free during early access
          </p>
        </Reveal>
        <Reveal immediate variant="rise" delay={120} className="flex w-full flex-col gap-5 lg:flex-row">
          {PLANS.map((plan) => (
            <PlanCard key={plan.name} plan={plan} />
          ))}
        </Reveal>
        <Reveal
          variant="up"
          className="flex w-full flex-col gap-6 rounded-[20px] bg-[#FFFFFF]/[0.03] p-6 outline outline-1 -outline-offset-1 outline-white/[0.12] md:flex-row md:items-center md:px-8"
        >
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#FFFFFF]/[0.06] text-white">
            <RiServerLine className="size-6" aria-hidden />
          </span>
          <div className="flex flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-heading text-[20px] font-semibold text-white">Self-host BugBerry</h2>
              <span className="rounded-full bg-[#7BD389]/[0.12] px-2.5 py-[3px] text-[11px] font-semibold text-[#B8F0C0] outline outline-1 -outline-offset-1 outline-[#7BD389]/30">
                Available
              </span>
            </div>
            <p className="text-[14px]/[21px] text-[#B6A7BE]">
              Run it on your own servers. Recordings, logs and reports never leave your infrastructure, with no screenshot or video limits.
            </p>
            <div className="flex flex-wrap gap-2 pt-1.5">
              {["Docker image", "Your own storage", "No usage limits"].map((chip) => (
                <span key={chip} className="rounded-lg bg-[#FFFFFF]/[0.04] px-2.5 py-1 text-[12px] font-medium text-[#E2D8E8] outline outline-1 -outline-offset-1 outline-white/[0.12]">
                  {chip}
                </span>
              ))}
              <Link href={SELF_HOST_DOCS} className="px-1 py-1 text-[12px] font-semibold text-[#FF8AB8] hover:text-white">
                Self-host guide
              </Link>
            </div>
          </div>
          <Link
            href="/demo"
            className="inline-flex h-[46px] items-center justify-center rounded-xl bg-[#FFFFFF] px-5 text-[15px] font-semibold text-[#1C1022] transition hover:bg-[#FFFFFF]/90"
          >
            Talk to us about self-hosting
          </Link>
        </Reveal>
        <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-[13px] text-[#B6A7BE]">
          {["No credit card needed", "Your reports stay when paid plans launch"].map((note) => (
            <li key={note} className="flex items-center gap-2">
              <RiCheckLine className="size-3.5 text-[#7BD389]" aria-hidden />
              {note}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

const yes = (
  <>
    <RiCheckLine className="mx-auto size-[18px] text-[#D61F69]" aria-hidden />
    <span className="sr-only">Included</span>
  </>
)
const no = (
  <>
    <RiSubtractLine className="mx-auto size-[18px] text-[#C9BFD1]" aria-hidden />
    <span className="sr-only">Not included</span>
  </>
)
const soon = <ComingSoon />

const COMPARE: Array<{ group: string; rows: Array<[string, ReactNode, ReactNode, ReactNode]> }> = [
  {
    group: "Capture",
    rows: [
      ["Screenshots + video recordings", "5 + 5", "Unlimited", "Unlimited"],
      ["Annotate screenshots", yes, yes, yes],
      ["Voice narration", yes, yes, yes],
    ],
  },
  {
    group: "Debug",
    rows: [
      ["Console & network logs", yes, yes, yes],
      ["User steps", yes, yes, yes],
    ],
  },
  {
    group: "Collaborate",
    rows: [
      ["Projects", "Unlimited", "Unlimited", "Unlimited"],
      ["Comments & @mentions", yes, yes, yes],
      ["Share links", yes, yes, yes],
      ["Reporters & guests", no, soon, soon],
    ],
  },
  {
    group: "Integrations & AI",
    rows: [
      ["Issue trackers & chat", "All 10", "All 10", "All 10"],
      ["Webhooks", "Signed", "Signed", "Signed"],
      ["AI Agents (MCP)", yes, yes, yes],
    ],
  },
  {
    group: "Security & admin",
    rows: [
      ["Masking of passwords & tokens", yes, yes, yes],
      ["Custom masking rules", no, no, yes],
      ["SSO & SAML", no, no, yes],
      ["Roles & audit log", no, no, yes],
      ["Support", "Community", "Email", "Priority"],
    ],
  },
]

function Compare() {
  return (
    <section className="bg-[#FFFFFF] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10`}>
        <Reveal variant="up" className="flex flex-col items-center gap-3 text-center">
          <p className="text-[12px] font-semibold tracking-[1.4px] text-[#D61F69] uppercase">Compare plans</p>
          <h2 className="font-heading text-[32px]/[38px] font-semibold tracking-[-1px] md:text-[40px]/[46px]">What you get today, and what’s next</h2>
        </Reveal>
        <div className="relative overflow-x-auto rounded-2xl outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
          <table className="w-full min-w-[640px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="border-b border-[#E6E1EC] bg-[#FBFAFC]">
                <th scope="col" className="px-7 py-[18px] font-semibold text-[#635A6B]">
                  Features
                </th>
                {[
                  ["Free", "$0 · available now"],
                  ["Team", "Coming soon"],
                  ["Business", "Coming soon"],
                ].map(([name, note]) => (
                  <th key={name} scope="col" className="w-[22%] px-4 py-[18px] text-center">
                    <span className="block font-heading text-[16px] font-semibold">{name}</span>
                    <span className="block text-[12px] font-normal text-[#635A6B]">{note}</span>
                  </th>
                ))}
              </tr>
            </thead>
            {COMPARE.map(({ group, rows }) => (
              <tbody key={group}>
                <tr className="border-y border-[#E6E1EC] bg-[#FBFAFC]">
                  <th scope="colgroup" colSpan={4} className="px-7 pt-3.5 pb-2.5 text-[11px] font-semibold tracking-[1.1px] text-[#635A6B] uppercase">
                    {group}
                  </th>
                </tr>
                {rows.map(([feature, ...cells]) => (
                  <tr key={feature} className="border-b border-[#F0EDF3] last:border-b-0">
                    <th scope="row" className="px-7 py-3.5 font-normal text-[#1C1022]">
                      {feature}
                    </th>
                    {cells.map((cell, index) => (
                      <td key={index} className="px-4 py-3.5 text-center text-[#4A4152]">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </div>
    </section>
  )
}

const FAQS: Array<[string, string]> = [
  [
    "How long is BugBerry free?",
    "For the whole early access period. We’ll give at least 30 days’ notice before paid plans start, and early teams get a launch discount.",
  ],
  [
    "What counts toward the 5 + 5 limit?",
    "Each screenshot report and each video report sent to your workspace counts once. Drafts you discard in the extension don’t count.",
  ],
  [
    "What happens when I hit the limit?",
    "The extension tells you before you capture, and new reports of that kind wait. Everything you already sent stays readable, shareable and connected to your tools.",
  ],
  ["Do I need a credit card?", "No. Sign in and start recording; there is nothing to pay during early access."],
  [
    "What happens to my reports when paid plans launch?",
    "They stay. Nothing you recorded during early access is deleted or locked when paid plans start.",
  ],
  [
    "Can I get higher limits now?",
    "Self-host BugBerry for free with no usage limits, or tell us about your team through the demo form and we’ll talk.",
  ],
]

function Question({ question, answer, initiallyOpen }: { question: string; answer: string; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const answerId = useId()
  return (
    <div className="border-b border-[#E6E1EC] py-5">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={answerId}
          onClick={() => setOpen(!open)}
          className="flex w-full cursor-pointer items-center justify-between gap-6 text-left text-[16px] font-semibold"
        >
          {question}
          <RiAddLine className={`size-5 shrink-0 text-[#635A6B] transition ${open ? "rotate-45" : ""}`} aria-hidden />
        </button>
      </h3>
      <p id={answerId} hidden={!open} className="pt-2.5 pr-10 text-[14px]/[22px] text-[#635A6B]">
        {answer}
      </p>
    </div>
  )
}

function Faq() {
  return (
    <section className="border-t border-[#E6E1EC] bg-[#F7F6FA] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10 lg:flex-row lg:gap-16`}>
        <Reveal variant="up" className="flex flex-col gap-3 lg:w-[360px] lg:shrink-0">
          <p className="text-[12px] font-semibold tracking-[1.4px] text-[#D61F69] uppercase">FAQ</p>
          <h2 className="font-heading text-[32px]/[38px] font-semibold tracking-[-1px]">Questions about pricing</h2>
          <p className="text-[15px]/[23px] text-[#635A6B]">Can’t find your answer? Our team replies within a day.</p>
          <Link
            href="mailto:yuisalabs@gmail.com"
            className="mt-2 inline-flex h-10 w-fit items-center rounded-[10px] bg-[#FFFFFF] px-4 text-[14px] font-semibold text-[#1C1022] outline outline-1 -outline-offset-1 outline-[#E6E1EC] hover:bg-[#FBFAFC]"
          >
            Contact support
          </Link>
        </Reveal>
        <div className="flex-1 border-t border-[#E6E1EC]">
          {FAQS.map(([question, answer], index) => (
            <Question key={question} question={question} answer={answer} initiallyOpen={index === 0} />
          ))}
        </div>
      </div>
    </section>
  )
}

/** `/pricing`: free in early access, what's coming, and self-hosting. */
export function PricingView({ signedIn, installUrl }: { signedIn: boolean; installUrl: string | null }) {
  return (
    <SiteChrome signedIn={signedIn} installUrl={installUrl}>
      <Hero />
      <Compare />
      <Faq />
      <FinalCta installUrl={installUrl} />
    </SiteChrome>
  )
}
