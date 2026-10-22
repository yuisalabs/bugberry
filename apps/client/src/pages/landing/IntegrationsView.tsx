import { RiArrowRightLine, RiChromeFill } from "@remixicon/react"
import type { ReactNode } from "react"
import { Link } from "@bugberry/ui/link"
import { ComingSoon } from "./ComingSoon"
import { FinalCta } from "./FinalCta"
import { IntegrationLogo, type IntegrationKind } from "./integrations-data"
import { Reveal } from "./Reveal"
import { SiteChrome } from "./SiteChrome"
import { INTEGRATION_DOCS, installHref, siteContainer, WEBHOOK_DOCS } from "./site-links"
import { WebhookSample } from "./WebhookSample"

const eyebrow = "text-[12px] font-semibold tracking-[1.4px] uppercase"
const heading = "font-heading text-[30px]/[36px] font-semibold tracking-[-1px] md:text-[36px]/[41px]"

const TRACKER_CARDS: Array<{ name: string; kind: IntegrationKind; body: ReactNode }> = [
  { name: "GitHub", kind: "Issues", body: "Open issues with the errors and the report link, labelled the way you choose." },
  {
    name: "GitLab",
    kind: "Issues",
    body: (
      <>
        Create issues with the report link, and link the merge request that fixes them. <ComingSoon className="ml-0.5" />
      </>
    ),
  },
  { name: "Jira", kind: "Tickets", body: "File tickets with the page, browser, console errors and failed requests." },
  {
    name: "Linear",
    kind: "Issues",
    body: (
      <>
        Send reports to the right team, with priority already set. <ComingSoon className="ml-0.5" />
      </>
    ),
  },
  { name: "ActiveCollab", kind: "Tasks", body: "Turn reports into tasks inside your client projects." },
  { name: "Plane", kind: "Work items", body: "File bugs as work items, with the replay one click away." },
]

const NOTIFIER_CARDS: Array<{ name: string; body: string }> = [
  { name: "Slack", body: "Post each new report to a channel with its title, reporter and error counts." },
  { name: "Discord", body: "Drop new bugs into your dev server for everyone." },
  { name: "Telegram", body: "Get a message in a group chat for every new report." },
  { name: "Webhook", body: "POST each report as JSON to any URL you own, signed." },
]

/** What every ticket carries (apps/api/src/lib/trackers/content.ts). */
const SENDS = ["Report link", "Console errors", "Failed requests", "Browser & OS"]

function connectHref(signedIn: boolean) {
  return signedIn ? "/app/settings/integrations" : "/login"
}

function Hero({ installUrl }: { installUrl: string | null }) {
  return (
    <section className="overflow-hidden bg-[#1C1022] bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,#3D1A3F_0%,#1C1022_70%)] pt-16 pb-20 md:pt-24 md:pb-[104px]">
      <div className={`${siteContainer} flex flex-col items-center gap-14`}>
        <Reveal immediate variant="up" className="flex max-w-[860px] flex-col items-center gap-[18px] text-center">
          <p className={`${eyebrow} text-[#FF8AB8]`}>Integrations</p>
          <h1 className="font-heading text-[38px]/[42px] font-semibold tracking-[-1.2px] text-white md:text-[52px]/[56px] md:tracking-[-1.8px]">
            Send every bug where your team already works
          </h1>
          <p className="max-w-[680px] text-[16px]/[26px] text-[#B6A7BE] md:text-[17px]">
            Connect an issue tracker or a chat channel once. Every project in your workspace can then file reports there, with the report
            link, errors and page details attached.
          </p>
          <div className="flex flex-col items-stretch gap-2.5 pt-2.5 sm:flex-row">
            <Link
              href={installHref(installUrl)}
              className="inline-flex h-[46px] items-center justify-center gap-2.5 rounded-xl bg-[#D61F69] px-5 text-[15px] font-semibold text-white transition hover:bg-[#C01A5E]"
            >
              <RiChromeFill className="size-[18px]" aria-hidden />
              Add to Chrome, it’s free
            </Link>
            <Link
              href={INTEGRATION_DOCS}
              className="inline-flex h-[46px] items-center justify-center gap-2 rounded-xl bg-[#FFFFFF]/[0.06] px-5 text-[15px] font-semibold text-white outline outline-1 -outline-offset-1 outline-white/20 transition hover:bg-[#FFFFFF]/10"
            >
              Read the docs
            </Link>
          </div>
        </Reveal>
        <Reveal immediate variant="rise" delay={120} className="w-full max-w-[880px]">
          <img
            src="/assets/site/integrations-hub.webp"
            width={880}
            height={420}
            alt="GitHub, GitLab, Jira, Linear, ActiveCollab, Plane, Slack, Discord, Telegram and webhooks, all connected to BugBerry"
            className="h-auto w-full"
          />
        </Reveal>
      </div>
    </section>
  )
}

function ConnectLink({ name, signedIn }: { name: string; signedIn: boolean }) {
  return (
    <Link href={connectHref(signedIn)} className="inline-flex w-fit items-center gap-[5px] pt-1 text-[14px] font-semibold text-[#D61F69] hover:text-[#B3175A]">
      {name ? `Connect ${name}` : "Connect"}
      <RiArrowRightLine className="size-3.5" aria-hidden />
    </Link>
  )
}

function Trackers({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="trackers" className="scroll-mt-4 bg-[#FFFFFF] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10`}>
        <Reveal variant="up" className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between md:gap-10">
          <div className="flex flex-col gap-3">
            <p className={`${eyebrow} text-[#D61F69]`}>Issue trackers</p>
            <h2 className={`${heading} max-w-[620px]`}>Reports become tickets your engineers can act on</h2>
          </div>
          <p className="max-w-[380px] text-[15px]/[23px] text-[#635A6B]">
            Each ticket links back to the full replay, so nobody has to ask for repro steps.
          </p>
        </Reveal>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TRACKER_CARDS.map((tracker, index) => (
            <Reveal
              as="article"
              key={tracker.name}
              aria-label={tracker.name}
              variant="up"
              delay={(index % 3) * 80}
              className="flex flex-col gap-4 rounded-[18px] bg-[#F7F6FA] p-7 outline outline-1 -outline-offset-1 outline-[#E6E1EC]"
            >
              <div className="flex items-start justify-between">
                <span className="flex size-[52px] items-center justify-center rounded-[14px] bg-[#FFFFFF] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
                  <IntegrationLogo name={tracker.name} size={30} />
                </span>
                <span className="rounded-full bg-[#FCEEF4] px-2.5 py-[3px] text-[11px] font-semibold text-[#B5175A]">{tracker.kind}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <h3 className="font-heading text-[19px] font-semibold">{tracker.name}</h3>
                <p className="min-h-[44px] text-[14px]/[22px] text-[#635A6B]">{tracker.body}</p>
              </div>
              <ul className="flex flex-wrap gap-1.5" aria-label="Each ticket carries">
                {SENDS.map((item) => (
                  <li key={item} className="rounded-md bg-[#FFFFFF] px-2 py-0.5 text-[11px] font-medium text-[#4A4152] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
                    {item}
                  </li>
                ))}
              </ul>
              <ConnectLink name={tracker.name} signedIn={signedIn} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

function Notifications({ signedIn }: { signedIn: boolean }) {
  return (
    <section id="notifications" className="scroll-mt-4 border-t border-[#E6E1EC] bg-[#F7F6FA] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10`}>
        <Reveal variant="up" className="flex flex-col gap-3">
          <p className={`${eyebrow} text-[#D61F69]`}>Notifications</p>
          <h2 className={`${heading} max-w-[640px]`}>Ping the right people the moment a bug lands</h2>
        </Reveal>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {NOTIFIER_CARDS.map((notifier, index) => (
            <Reveal
              as="article"
              key={notifier.name}
              aria-label={notifier.name}
              variant="up"
              delay={index * 60}
              className="flex flex-col gap-3.5 rounded-[18px] bg-[#FFFFFF] p-6 outline outline-1 -outline-offset-1 outline-[#E6E1EC]"
            >
              <span className="flex size-12 items-center justify-center rounded-[13px] bg-[#F7F6FA] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
                <IntegrationLogo name={notifier.name} size={28} />
              </span>
              <h3 className="font-heading text-[18px] font-semibold">{notifier.name}</h3>
              <p className="min-h-[44px] text-[14px]/[22px] text-[#635A6B]">{notifier.body}</p>
              <ConnectLink name="" signedIn={signedIn} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

const STEPS: Array<[string, string, string]> = [
  ["01", "Connect an account", "Add GitHub, Jira, Slack or any other tool once, at the workspace level. Tokens are entered a single time."],
  ["02", "Pick it per project", "Each project chooses which tracker and channel it uses, so client work never ends up in the wrong place."],
  ["03", "Reports flow on their own", "New bugs land as tickets and messages with the report link, errors and page details already attached."],
]

function HowItWorks() {
  return (
    <section className="border-t border-[#E6E1EC] bg-[#FFFFFF] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-11`}>
        <Reveal variant="up" className="flex flex-col items-center gap-3 text-center">
          <p className={`${eyebrow} text-[#D61F69]`}>How it works</p>
          <h2 className={heading}>Connect once, use it in every project</h2>
        </Reveal>
        <ol className="grid gap-5 md:grid-cols-3">
          {STEPS.map(([number, title, body], index) => (
            <Reveal
              as="li"
              key={number}
              variant="up"
              delay={index * 80}
              className="flex flex-col gap-3.5 rounded-[18px] bg-[#F7F6FA] p-7 outline outline-1 -outline-offset-1 outline-[#E6E1EC]"
            >
              <span className="font-heading text-[15px] font-semibold text-[#D61F69]">{number}</span>
              <h3 className="font-heading text-[19px] font-semibold">{title}</h3>
              <p className="text-[14px]/[22px] text-[#635A6B]">{body}</p>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  )
}

function Webhook() {
  return (
    <section id="webhook" className="scroll-mt-4 bg-[#1C1022] py-20 md:py-28">
      <div className={`${siteContainer} flex flex-col gap-10 lg:flex-row lg:items-center lg:gap-16`}>
        <Reveal variant="up" className="flex flex-col gap-4 lg:w-[440px] lg:shrink-0">
          <p className={`${eyebrow} text-[#FF8AB8]`}>Build your own</p>
          <h2 className={`${heading} text-white`}>Not on the list? Use a webhook</h2>
          <p className="text-[16px]/[26px] text-[#B6A7BE]">
            BugBerry sends every new report to your URL as JSON, with the report link and its error and failed-request counts. Wire it into
            an internal tool, a spreadsheet or your own bot.
          </p>
          <Link href={WEBHOOK_DOCS} className="inline-flex w-fit items-center gap-1.5 pt-1.5 text-[15px] font-semibold text-[#FF8AB8] hover:text-white">
            See the webhook docs
            <RiArrowRightLine className="size-4" aria-hidden />
          </Link>
        </Reveal>
        <Reveal variant="up" delay={80} className="min-w-0 flex-1">
          <WebhookSample surface="bg-[#2A1B31] outline outline-1 -outline-offset-1 outline-[#3D2B46]" />
        </Reveal>
      </div>
    </section>
  )
}

/** `/integrations`: the trackers and channels BugBerry sends reports to. */
export function IntegrationsView({ signedIn, installUrl }: { signedIn: boolean; installUrl: string | null }) {
  return (
    <SiteChrome signedIn={signedIn} installUrl={installUrl}>
      <Hero installUrl={installUrl} />
      <Trackers signedIn={signedIn} />
      <Notifications signedIn={signedIn} />
      <HowItWorks />
      <Webhook />
      <FinalCta installUrl={installUrl} />
    </SiteChrome>
  )
}
