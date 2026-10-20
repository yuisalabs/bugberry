import { RiArrowRightLine } from "@remixicon/react"
import type { ReactNode } from "react"
import { Link } from "@bugberry/ui/link"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { HeroMockup } from "./HeroMockup"
import { Reveal } from "./Reveal"

const container = "mx-auto w-full max-w-[1280px] px-6 lg:px-10"
const sectionLabel = "font-mono text-xs font-semibold tracking-[0.12em] text-primary uppercase"
const sectionTitle = "font-heading text-4xl font-bold tracking-[-1.2px] text-foreground md:text-[52px] md:leading-[55px] md:tracking-[-1.8px]"

function PrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-leaf px-4 py-2 whitespace-nowrap sm:px-5 sm:py-2.5 text-sm font-semibold text-white transition hover:bg-leaf/90"
    >
      {children}
    </Link>
  )
}

const STEPS = [
  {
    number: "01",
    title: "Capture",
    body: "Click the extension or press Alt+Shift+C for a screenshot, Alt+Shift+R to record the tab.",
  },
  {
    number: "02",
    title: "Annotate",
    body: "Draw boxes and arrows, and blur anything sensitive before it leaves the browser.",
  },
  {
    number: "03",
    title: "Ship",
    body: "Send it to GitHub or ActiveCollab, or share a link, with console, network and device data attached.",
  },
]

const NETWORK = [
  { method: "GET", path: "/api/cart", status: 200, time: "42 ms" },
  { method: "GET", path: "/api/user/me", status: 200, time: "88 ms" },
  { method: "POST", path: "/api/payment-intent", status: 200, time: "310 ms" },
  { method: "POST", path: "/api/orders", status: 500, time: "1240 ms" },
]

const ACTIONS = ["Open /checkout with 1 item in cart", "Type in “Card number” (•••)", "Click “Pay $194.40”", "POST /api/orders → 500"]

function ContextCard({ title, body, children }: { title: string; body: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-5 rounded-[20px] border border-[#3D2B46] bg-[#2A1B31] p-6">
      <div className="min-h-[150px] rounded-xl bg-[#1C1022] p-4">{children}</div>
      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-2xl font-bold tracking-[-0.5px] text-white">{title}</h3>
        <p className="text-[15px] leading-[23px] text-[#B6A7BE]">{body}</p>
      </div>
    </div>
  )
}

/**
 * The public BugBerry landing page. Plain links (no router) so it renders anywhere; a signed-in
 * visitor gets "Open dashboard" instead of the sign-up buttons.
 */
export function LandingView({ signedIn }: { signedIn: boolean }) {
  const start = signedIn ? (
    <PrimaryLink href="/app">Open dashboard</PrimaryLink>
  ) : (
    <PrimaryLink href="/login">Get started free</PrimaryLink>
  )

  return (
    <div className="min-h-screen bg-muted text-foreground">
      <Reveal as="header" variant="down" immediate className={`${container} flex items-center justify-between py-6`}>
        <Link href="/" aria-label="BugBerry home">
          <BugBerryLogo />
        </Link>
        <nav aria-label="Main" className="flex items-center gap-4 text-sm font-medium sm:gap-6">
          <Link href="#how-it-works" className="hidden whitespace-nowrap text-muted-foreground hover:text-foreground md:inline">
            How it works
          </Link>
          <Link href="#features" className="hidden whitespace-nowrap text-muted-foreground hover:text-foreground md:inline">
            Features
          </Link>
          {!signedIn && (
            <Link href="/login" className="hidden whitespace-nowrap text-foreground hover:text-primary sm:inline">
              Sign in
            </Link>
          )}
          {start}
        </nav>
      </Reveal>

      <main>
        <section className={`${container} flex flex-col gap-16 pt-12 lg:pt-[72px]`}>
          <div className="flex flex-col justify-between gap-10 lg:flex-row lg:items-end">
            <div className="flex max-w-[820px] flex-col gap-7">
              <h1 className="font-heading text-5xl leading-[1.02] font-bold tracking-[-2px] text-foreground md:text-7xl lg:text-[84px] lg:leading-[82px] lg:tracking-[-3px]">
                <Reveal as="span" variant="blur" delay={80} immediate className="inline-block">
                  Stop describing bugs.
                </Reveal>{" "}
                <Reveal as="span" variant="blur" delay={220} immediate className="inline-block text-primary">
                  Show them.
                </Reveal>
              </h1>
              <Reveal as="p" delay={340} immediate className="max-w-[620px] text-lg leading-[30px] text-muted-foreground md:text-xl">
                One click captures the screen, console logs, network requests and device details, so engineers get a
                reproducible report instead of “it’s broken on my machine.”
              </Reveal>
            </div>
            <div className="flex w-full flex-col gap-4 lg:w-[340px] lg:pb-2">
              <Reveal
                as="a"
                delay={440}
                immediate
                href={signedIn ? "/app" : "/login"}
                className="flex items-center justify-between rounded-[14px] bg-leaf px-6 py-5 text-[17px] font-semibold text-white transition hover:bg-leaf/90"
              >
                {signedIn ? "Open dashboard" : "Get started free"}
                <RiArrowRightLine aria-hidden className="size-5" />
              </Reveal>
              <Reveal
                as="a"
                delay={520}
                immediate
                href="#how-it-works"
                className="flex items-center justify-between rounded-[14px] px-6 py-[18px] text-base font-semibold text-foreground outline-[1.5px] outline-foreground outline-solid transition hover:bg-background"
              >
                See how it works
                <RiArrowRightLine aria-hidden className="size-5 rotate-90" />
              </Reveal>
              <Reveal as="p" variant="fade" delay={600} immediate className="text-center font-mono text-xs text-muted-foreground">
                Free to start · No credit card
              </Reveal>
            </div>
          </div>
          <Reveal variant="rise" delay={680} immediate className="hidden lg:block">
            <HeroMockup />
          </Reveal>
        </section>

        <section id="how-it-works" className="scroll-mt-6 bg-background py-24 lg:py-32">
          <div className={`${container} flex flex-col gap-16`}>
            <Reveal className="flex max-w-[900px] flex-col gap-5">
              <p className={sectionLabel}>How it works</p>
              <h2 className={sectionTitle}>From “something’s off” to a ticket an engineer can fix in 20 seconds.</h2>
              <p className="max-w-[640px] text-lg text-muted-foreground">
                No more long chat threads asking which browser you were on. BugBerry attaches the evidence before anyone
                has to ask.
              </p>
            </Reveal>
            <ol className="grid gap-6 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <Reveal as="li" key={step.number} delay={index * 120} className="flex flex-col gap-4 border-t-2 border-foreground pt-6">
                  <span className="font-mono text-sm font-semibold text-muted-foreground">{step.number}</span>
                  <h3 className="font-heading text-3xl font-bold tracking-[-0.8px] text-foreground">{step.title}</h3>
                  <p className="text-base leading-[26px] text-muted-foreground">{step.body}</p>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" className="scroll-mt-6 bg-[#1C1022] py-24 lg:py-32">
          <div className={`${container} flex flex-col gap-14`}>
            <Reveal className="flex max-w-[900px] flex-col gap-5">
              <p className={sectionLabel}>The context, automatically</p>
              <h2 className={sectionTitle.replace("text-foreground", "text-white")}>
                Every question an engineer would ask, answered before they ask it.
              </h2>
            </Reveal>
            <div className="grid gap-6 md:grid-cols-2">
              <Reveal delay={0}>
                <ContextCard
                  title="Network requests, with payloads"
                  body="Requests, status codes, headers and response bodies, so the 500 is the first thing they see, not the last."
                >
                  <ul className="flex flex-col gap-2 font-mono text-xs">
                    {NETWORK.map((request) => (
                      <li key={request.path} className="flex items-center gap-3 text-[#D9D2DF]">
                        <span className="w-10 text-[#B6A7BE]">{request.method}</span>
                        <span className="flex-1 truncate">{request.path}</span>
                        <span className={request.status >= 500 ? "font-bold text-[#E5484D]" : "text-[#5FCB93]"}>
                          {request.status}
                        </span>
                        <span className="w-16 text-right text-[#B6A7BE]">{request.time}</span>
                      </li>
                    ))}
                  </ul>
                </ContextCard>
              </Reveal>
              <Reveal delay={100}>
                <ContextCard
                  title="Every click and input, in order"
                  body="Clicks, inputs and page changes are recorded as numbered steps an engineer can follow."
                >
                  <ol className="flex flex-col gap-2 text-sm text-[#D9D2DF]">
                    {ACTIONS.map((action, index) => (
                      <li key={action} className="flex items-center gap-3">
                        <span className="grid size-6 shrink-0 place-content-center rounded-full bg-[#3D2B46] font-mono text-xs text-white">
                          {index + 1}
                        </span>
                        {action}
                      </li>
                    ))}
                  </ol>
                </ContextCard>
              </Reveal>
              <Reveal delay={200}>
                <ContextCard
                  title="Device & environment"
                  body="Browser, operating system, viewport, and device details are automatically captured with every report, giving engineers the context they need to reproduce issues."
                >
                  <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 font-mono text-xs">
                    {[
                      ["Browser", "Chrome 131"],
                      ["OS", "macOS"],
                      ["Viewport", "1440 × 900"],
                    ].map(([term, value]) => (
                      <div key={term} className="contents">
                        <dt className="text-[#B6A7BE]">{term}</dt>
                        <dd className="text-[#D9D2DF]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </ContextCard>
              </Reveal>
              <Reveal delay={300}>
                <ContextCard
                  title="Private by default"
                  body="Typed values are masked in the recorded steps, password fields and anything marked private are left out, and sensitive headers are redacted. Blur anything sensitive in a screenshot before you send it."
                >
                  <div className="flex flex-col gap-2 font-mono text-xs text-[#D9D2DF]">
                    <span>Type in “Email” (•••)</span>
                    <span className="text-[#B6A7BE]">authorization: [redacted]</span>
                    <span className="text-[#B6A7BE]">x-api-key: [redacted]</span>
                  </div>
                </ContextCard>
              </Reveal>
            </div>
          </div>
        </section>

        <section className={`${container} py-24`}>
          <Reveal variant="rise" className="flex flex-col items-start gap-8 rounded-[24px] bg-primary px-8 py-14 text-primary-foreground md:flex-row md:items-end md:justify-between md:px-14">
            <div className="flex flex-col gap-4">
              <h2 className="font-heading text-4xl font-bold tracking-[-1.2px] md:text-[56px] md:leading-[58px]">
                The next bug report you get could be useful.
              </h2>
              <p className="text-lg text-white/85">Install in two minutes. Free to start.</p>
            </div>
            <Link
              href={signedIn ? "/app" : "/login"}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-background px-6 py-3 font-semibold text-primary transition hover:bg-background/90"
            >
              {signedIn ? "Open dashboard" : "Get started free"}
              <RiArrowRightLine aria-hidden className="size-4" />
            </Link>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-border bg-background">
        <Reveal variant="fade" className={`${container} flex flex-col justify-between gap-8 py-12 md:flex-row md:items-center`}>
          <div className="flex flex-col gap-2">
            <BugBerryLogo />
            <p className="text-sm text-muted-foreground">Bug reports engineers actually want to read.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-6 text-sm text-muted-foreground">
            <Link href="#how-it-works" className="hover:text-foreground">
              How it works
            </Link>
            <Link href="#features" className="hover:text-foreground">
              Features
            </Link>
            <Link href={signedIn ? "/app" : "/login"} className="hover:text-foreground">
              {signedIn ? "Dashboard" : "Sign in"}
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy Policy
            </Link>
          </nav>
        </Reveal>
        <p className={`${container} pb-8 text-xs text-muted-foreground`}>© 2026 BugBerry</p>
      </footer>
    </div>
  )
}
