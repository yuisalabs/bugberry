import {
  RiArrowRightLine,
  RiCalendarLine,
  RiCheckboxCircleFill,
  RiCloudLine,
  RiComputerLine,
  RiPlugLine,
  RiPlayCircleLine,
  RiRocketLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { DEMO_TEAM_SIZES, DEMO_TRACKERS, type DemoRequestInput } from "@bugberry/shared"
import { type FormEvent, useId, useState } from "react"
import { Link } from "@bugberry/ui/link"
import { ApiError, errorMessage } from "../../lib/api"
import { Reveal } from "./Reveal"
import { SiteChrome } from "./SiteChrome"
import { installHref, siteContainer } from "./site-links"

const POINTS: Array<{ icon: RemixiconComponentType; title: string; body: string }> = [
  {
    icon: RiPlayCircleLine,
    title: "A live walkthrough on your product",
    body: "From one click in the extension to a full report with replay, console and network.",
  },
  {
    icon: RiPlugLine,
    title: "Your tools, connected",
    body: "We’ll set up Jira, Linear, GitHub or Slack with you, so reports land where your team works.",
  },
  {
    icon: RiCloudLine,
    title: "Cloud or self-hosted",
    body: "Talk through security, data masking and running BugBerry on your own servers.",
  },
]

const label = "text-[13px] font-semibold text-[#2A2030]"
const field =
  "h-11 w-full rounded-[10px] bg-[#FFFFFF] px-3.5 text-[14px] text-[#1C1022] outline outline-1 -outline-offset-1 outline-[#E6E1EC] placeholder:text-[#9A90A3] focus:outline-2 focus:-outline-offset-1 focus:outline-[#D61F69] aria-invalid:outline-[#C2353A]"

type Status = { kind: "idle" } | { kind: "sending" } | { kind: "sent" } | { kind: "failed"; message: string }

/** The form's fields as people read them, for messages that name one. */
const FIELD_NAMES: Record<string, string> = {
  firstName: "first name",
  lastName: "last name",
  email: "work email",
  company: "company",
  tracker: "issue tracker",
  teamSize: "team size",
  message: "message",
}
/** One-line fields the browser lets through as spaces; checked here so the visitor learns which one. */
const NEEDS_TEXT = ["firstName", "lastName", "company"]

/** "first name", "first name and company", "first name, company and team size". */
const listed = (names: string[]) => (names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`)

/** The fields a 422 from the server turned down, by their path ("/company"). */
function refusedFields(error: unknown): string[] {
  if (!(error instanceof ApiError) || error.status !== 422 || !Array.isArray(error.body.details)) return []
  const paths = (error.body.details as Array<{ path?: unknown }>).map((detail) => String(detail.path ?? "").replace(/^\//, ""))
  return [...new Set(paths)].filter((name) => name in FIELD_NAMES)
}

function DemoForm({ submit }: { submit: (input: DemoRequestInput) => Promise<unknown> }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [problems, setProblems] = useState<Record<string, string>>({})
  const id = useId()
  const at = (name: string) => `${id}-${name}`
  /** Marks a field the visitor has to fix, and says why under it; typing in it clears the mark. */
  const checked = (name: string) => ({
    "aria-invalid": problems[name] ? true : undefined,
    "aria-describedby": problems[name] ? at(`${name}-problem`) : undefined,
    onChange: () => problems[name] && setProblems(({ [name]: _, ...rest }) => rest),
  })
  const problem = (name: string) =>
    problems[name] && (
      <p id={at(`${name}-problem`)} className="text-[12px] text-[#C2353A]">
        {problems[name]}
      </p>
    )

  if (status.kind === "sent") {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center" role="status">
        <RiCheckboxCircleFill className="size-12 text-[#1F7A50]" aria-hidden />
        <h2 className="font-heading text-[24px] font-semibold">Thanks, your request is in</h2>
        <p className="max-w-[360px] text-[14px]/[22px] text-[#635A6B]">We’ll reply within one business day.</p>
      </div>
    )
  }

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    if (status.kind === "sending") return
    const fields = form.elements
    const value = (name: string) => String((fields.namedItem(name) as HTMLInputElement | RadioNodeList | null)?.value ?? "").trim()
    const blank = NEEDS_TEXT.filter((name) => !value(name))
    if (blank.length > 0) {
      setProblems(Object.fromEntries(blank.map((name) => [name, `Enter your ${FIELD_NAMES[name]}.`])))
      ;(fields.namedItem(blank[0]!) as HTMLInputElement).focus()
      return
    }
    if (!form.checkValidity()) {
      form.reportValidity()
      return
    }
    setStatus({ kind: "sending" })
    try {
      await submit({
        firstName: value("firstName"),
        lastName: value("lastName"),
        email: value("email"),
        company: value("company"),
        tracker: value("tracker") as DemoRequestInput["tracker"],
        teamSize: value("teamSize") as DemoRequestInput["teamSize"],
        message: value("message"),
        selfHosting: (fields.namedItem("selfHosting") as HTMLInputElement).checked,
        website: value("website"),
      })
      setStatus({ kind: "sent" })
    } catch (error) {
      const refused = refusedFields(error)
      setProblems(Object.fromEntries(refused.map((name) => [name, `Check your ${FIELD_NAMES[name]}.`])))
      const message = refused.length > 0 ? `Check your ${listed(refused.map((name) => FIELD_NAMES[name]!))} and try again.` : errorMessage(error)
      setStatus({ kind: "failed", message })
    }
  }

  const sending = status.kind === "sending"
  return (
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-[18px]">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-[24px] font-semibold">Book your demo</h2>
        <p className="text-[14px] text-[#635A6B]">Tell us a bit about your team. We’ll reply within one business day.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={at("first")} className={label}>
            First name
          </label>
          <input id={at("first")} name="firstName" required maxLength={80} autoComplete="given-name" placeholder="Hannan" className={field} {...checked("firstName")} />
          {problem("firstName")}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={at("last")} className={label}>
            Last name
          </label>
          <input id={at("last")} name="lastName" required maxLength={80} autoComplete="family-name" placeholder="Rozen" className={field} {...checked("lastName")} />
          {problem("lastName")}
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={at("email")} className={label}>
          Work email
        </label>
        <input
          id={at("email")}
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder="you@company.com"
          className={field}
          {...checked("email")}
        />
        {problem("email")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={at("company")} className={label}>
            Company
          </label>
          <input
            id={at("company")}
            name="company"
            required
            maxLength={120}
            autoComplete="organization"
            placeholder="Northwind Commerce"
            className={field}
            {...checked("company")}
          />
          {problem("company")}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={at("tracker")} className={label}>
            Issue tracker
          </label>
          <select id={at("tracker")} name="tracker" required defaultValue="" className={`${field} cursor-pointer`}>
            <option value="" disabled>
              Choose one
            </option>
            {DEMO_TRACKERS.map((tracker) => (
              <option key={tracker} value={tracker}>
                {tracker}
              </option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className={`${label} pb-2`}>Team size</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {DEMO_TEAM_SIZES.map((size) => (
            <label key={size} className="cursor-pointer">
              <input type="radio" name="teamSize" value={size} required className="peer sr-only" />
              <span className="flex h-10 items-center justify-center rounded-[10px] text-[14px] font-medium text-[#4A4152] outline outline-1 -outline-offset-1 outline-[#E6E1EC] transition peer-checked:bg-[#FCE3EE] peer-checked:font-semibold peer-checked:text-[#D61F69] peer-checked:outline-[1.5px] peer-checked:outline-[#D61F69] peer-focus-visible:outline-2 peer-focus-visible:outline-[#D61F69]">
                {size}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={at("message")} className={label}>
          What would you like to see?
        </label>
        <textarea
          id={at("message")}
          name="message"
          rows={3}
          maxLength={2000}
          placeholder="Recording checkout bugs and sending them to Jira with the network logs…"
          className={`${field} h-[88px] resize-y py-3`}
        />
      </div>
      {/* People never see this field; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={at("website")}>Website</label>
        <input id={at("website")} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px] text-[#2A2030]">
        <input type="checkbox" name="selfHosting" className="size-[18px] cursor-pointer accent-[#D61F69]" />
        I’m interested in self-hosting BugBerry
      </label>
      {status.kind === "failed" && (
        <p role="alert" className="rounded-[10px] bg-[#FDE7E8] px-3.5 py-2.5 text-[13px] text-[#C2353A]">
          {status.message}
        </p>
      )}
      <button
        type="submit"
        disabled={sending}
        className="inline-flex h-[50px] cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#D61F69] text-[16px] font-semibold text-white transition hover:bg-[#C01A5E] disabled:cursor-default disabled:opacity-70"
      >
        {sending ? "Sending…" : "Book my demo"}
        {!sending && <RiArrowRightLine className="size-[18px]" aria-hidden />}
      </button>
      <p className="text-center text-[12px] text-[#635A6B]">No spam. We only use this to set up your demo.</p>
    </form>
  )
}

const NEXT: Array<{ icon: RemixiconComponentType; title: string; body: string }> = [
  { icon: RiCalendarLine, title: "1. Pick a time", body: "You’ll get a calendar link within one business day." },
  { icon: RiComputerLine, title: "2. 30-minute demo", body: "We record a bug on your app and send it to your tools, live." },
  { icon: RiRocketLine, title: "3. Try it yourself", body: "Your workspace stays open after the call, free during early access." },
]

/** `/demo`: "Request a demo" and "Talk to a human" land here. */
export function DemoView({
  signedIn,
  installUrl,
  submit,
}: {
  signedIn: boolean
  installUrl: string | null
  submit: (input: DemoRequestInput) => Promise<unknown>
}) {
  return (
    <SiteChrome signedIn={signedIn} installUrl={installUrl}>
      <section className="relative bg-[#1C1022] bg-[radial-gradient(ellipse_70%_60%_at_50%_0%,#3D1A3F_0%,#1C1022_70%)] pt-14 pb-20 md:pt-20 md:pb-28">
        <div className={`${siteContainer} flex flex-col gap-12 lg:flex-row lg:gap-[72px]`}>
          <Reveal immediate variant="up" className="flex flex-1 flex-col gap-7 lg:pt-6">
            <p className="text-[12px] font-semibold tracking-[1.4px] text-[#FF8AB8] uppercase">Request a demo</p>
            <h1 className="font-heading text-[38px]/[42px] font-semibold tracking-[-1.2px] text-white md:text-[52px]/[56px] md:tracking-[-1.8px]">
              See BugBerry on your own bugs
            </h1>
            <p className="text-[16px]/[26px] text-[#B6A7BE] md:text-[17px]/[27px]">
              Book 30 minutes with our team. We’ll record a real bug on your app, send it to your tracker and hand it to an AI agent, live.
            </p>
            <ul className="flex flex-col gap-[18px] pt-2">
              {POINTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-[#FFFFFF]/[0.06] text-[#FF8AB8] outline outline-1 -outline-offset-1 outline-white/[0.12]">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <div className="flex flex-col gap-1">
                    <p className="text-[16px] font-semibold text-white">{title}</p>
                    <p className="text-[14px]/[22px] text-[#B6A7BE]">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
            <figure className="flex flex-col gap-3.5 rounded-[18px] bg-[#FFFFFF]/[0.03] p-6 outline outline-1 -outline-offset-1 outline-white/10">
              <blockquote className="text-[16px]/[26px] text-[#F4E8EF]">
                “Our QA team stopped writing repro steps. Engineers open the replay, see the 500, and fix it the same day.”
              </blockquote>
              <figcaption className="flex items-center gap-2.5">
                <span className="flex size-8 items-center justify-center rounded-full bg-[#D61F69] text-[11px] font-bold text-white">HR</span>
                <span className="flex flex-col gap-px">
                  <span className="text-[13px] font-semibold text-white">Hannan Rozen</span>
                  <span className="text-[12px] text-[#B6A7BE]">QC (Quality Control) · IT Consultant Company</span>
                </span>
              </figcaption>
            </figure>
          </Reveal>
          <Reveal
            immediate
            variant="rise"
            delay={120}
            className="relative w-full self-start rounded-3xl bg-[#FFFFFF] p-6 text-[#1C1022] shadow-[0_30px_80px_#00000066] sm:p-9 lg:w-[560px] lg:shrink-0"
          >
            <DemoForm submit={submit} />
          </Reveal>
        </div>
      </section>
      <section className="bg-[#FFFFFF] py-20 md:py-[104px]">
        <div className={`${siteContainer} flex flex-col gap-11`}>
          <Reveal variant="up" className="flex flex-col items-center gap-3 text-center">
            <p className="text-[12px] font-semibold tracking-[1.4px] text-[#D61F69] uppercase">What happens next</p>
            <h2 className="font-heading text-[30px]/[36px] font-semibold tracking-[-1px] md:text-[36px]/[41px]">From form to first fixed bug in a week</h2>
          </Reveal>
          <ol className="grid gap-10 md:grid-cols-3 md:gap-0">
            {NEXT.map(({ icon: Icon, title, body }, index) => (
              <Reveal
                as="li"
                key={title}
                variant="up"
                delay={index * 80}
                className={`flex flex-col items-center gap-3.5 px-7 text-center ${index < NEXT.length - 1 ? "md:border-r md:border-[#E6E1EC]" : ""}`}
              >
                <span className="flex size-[52px] items-center justify-center rounded-full bg-[#FCE3EE] text-[#D61F69]">
                  <Icon className="size-6" aria-hidden />
                </span>
                <h3 className="font-heading text-[18px] font-semibold">{title}</h3>
                <p className="text-[14px]/[22px] text-[#635A6B]">{body}</p>
              </Reveal>
            ))}
          </ol>
          <p className="flex flex-wrap items-center justify-center gap-2 text-[15px] text-[#635A6B]">
            Rather try it yourself first?
            <Link href={installHref(installUrl)} className="inline-flex items-center gap-[5px] font-semibold text-[#D61F69] hover:text-[#B3175A]">
              Add BugBerry to Chrome, it’s free
              <RiArrowRightLine className="size-4" aria-hidden />
            </Link>
          </p>
        </div>
      </section>
    </SiteChrome>
  )
}
