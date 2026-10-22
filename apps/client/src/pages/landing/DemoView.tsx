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
import { type FormEvent, useId, useRef, useState } from "react"
import { Button } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { FieldError, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { Link } from "@bugberry/ui/link"
import { Select, SelectContent, SelectItem, SelectTrigger } from "@bugberry/ui/select"
import { TextField } from "@bugberry/ui/text-field"
import { Textarea } from "@bugberry/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
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

/** The same check as the API's (format: email): something, an @, something, a dot, something. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

type TextName = "firstName" | "lastName" | "email" | "company" | "message"

function DemoForm({ submit }: { submit: (input: DemoRequestInput) => Promise<unknown> }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" })
  const [values, setValues] = useState<Record<TextName, string>>({ firstName: "", lastName: "", email: "", company: "", message: "" })
  const [tracker, setTracker] = useState<string | null>(null)
  const [teamSize, setTeamSize] = useState<string | null>(null)
  const [selfHosting, setSelfHosting] = useState(false)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const honeypot = useRef<HTMLInputElement>(null)
  const id = useId()
  const sizeLabel = `${id}-size`
  const sizeProblem = `${id}-size-problem`

  /** Typing in or picking a field clears what was wrong with it. */
  const clear = (name: string) => problems[name] && setProblems(({ [name]: _, ...rest }) => rest)
  const text = (name: TextName) => ({
    name,
    value: values[name],
    onChange: (value: string) => {
      setValues((now) => ({ ...now, [name]: value }))
      clear(name)
    },
    isInvalid: Boolean(problems[name]),
  })

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
    if (status.kind === "sending") return
    const trimmed = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, value.trim()])) as Record<TextName, string>
    const found: Record<string, string> = {}
    for (const name of NEEDS_TEXT) if (!trimmed[name as TextName]) found[name] = `Enter your ${FIELD_NAMES[name]}.`
    if (!trimmed.email) found.email = "Enter your work email."
    else if (!EMAIL.test(trimmed.email)) found.email = "Enter a work email like you@company.com."
    if (!tracker) found.tracker = "Choose your issue tracker."
    if (!teamSize) found.teamSize = "Choose your team size."
    if (Object.keys(found).length > 0) {
      setProblems(found)
      event.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(found)[0]}"]`)?.focus()
      return
    }
    setStatus({ kind: "sending" })
    try {
      await submit({
        ...trimmed,
        tracker: tracker as DemoRequestInput["tracker"],
        teamSize: teamSize as DemoRequestInput["teamSize"],
        selfHosting,
        website: honeypot.current?.value.trim() ?? "",
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
    <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-heading text-[24px] font-semibold">Book your demo</h2>
        <p className="text-[14px] text-[#635A6B]">Tell us a bit about your team. We’ll reply within one business day.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField {...text("firstName")} maxLength={80} autoComplete="given-name">
          <Label>First name</Label>
          <Input placeholder="Hannan" />
          <FieldError>{problems.firstName}</FieldError>
        </TextField>
        <TextField {...text("lastName")} maxLength={80} autoComplete="family-name">
          <Label>Last name</Label>
          <Input placeholder="Rozen" />
          <FieldError>{problems.lastName}</FieldError>
        </TextField>
      </div>
      <TextField {...text("email")} type="email" maxLength={254} autoComplete="email">
        <Label>Work email</Label>
        <Input placeholder="you@company.com" />
        <FieldError>{problems.email}</FieldError>
      </TextField>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField {...text("company")} maxLength={120} autoComplete="organization">
          <Label>Company</Label>
          <Input placeholder="Northwind Commerce" />
          <FieldError>{problems.company}</FieldError>
        </TextField>
        <Select
          name="tracker"
          placeholder="Choose one"
          selectedKey={tracker}
          onSelectionChange={(key) => {
            setTracker(key === null ? null : String(key))
            clear("tracker")
          }}
          isInvalid={Boolean(problems.tracker)}
        >
          <Label>Issue tracker</Label>
          <SelectTrigger />
          <SelectContent items={DEMO_TRACKERS.map((name) => ({ id: name }))}>
            {(item) => (
              <SelectItem id={item.id} textValue={item.id}>
                {item.id}
              </SelectItem>
            )}
          </SelectContent>
          <FieldError>{problems.tracker}</FieldError>
        </Select>
      </div>
      <div className="flex flex-col gap-2">
        <Label id={sizeLabel}>Team size</Label>
        <ToggleGroup
          aria-labelledby={sizeLabel}
          aria-describedby={problems.teamSize ? sizeProblem : undefined}
          selectionMode="single"
          selectedKeys={teamSize ? [teamSize] : []}
          onSelectionChange={(keys) => {
            const [picked] = [...keys]
            setTeamSize(picked === undefined ? null : String(picked))
            clear("teamSize")
          }}
          className="grid w-full grid-cols-2 sm:grid-cols-4"
        >
          {DEMO_TEAM_SIZES.map((size) => (
            <ToggleGroupItem key={size} id={size} className="justify-center">
              {size}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {problems.teamSize && (
          <p id={sizeProblem} className="text-sm/6 text-danger-subtle-foreground">
            {problems.teamSize}
          </p>
        )}
      </div>
      <TextField {...text("message")} maxLength={2000}>
        <Label>What would you like to see?</Label>
        <Textarea rows={3} placeholder="Recording checkout bugs and sending them to Jira with the network logs…" />
      </TextField>
      {/* People never see this field; bots fill it in. */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={`${id}-website`}>Website</label>
        <input ref={honeypot} id={`${id}-website`} name="website" tabIndex={-1} autoComplete="off" />
      </div>
      <CheckboxField isSelected={selfHosting} onChange={setSelfHosting}>
        <Checkbox>I’m interested in self-hosting BugBerry</Checkbox>
      </CheckboxField>
      {status.kind === "failed" && (
        <p role="alert" className="rounded-lg bg-danger-subtle px-3.5 py-2.5 text-sm text-danger-subtle-foreground">
          {status.message}
        </p>
      )}
      <Button type="submit" intent="primary" size="lg" isDisabled={sending} className="w-full">
        {sending ? "Sending…" : "Book my demo"}
        {!sending && <RiArrowRightLine data-slot="icon" aria-hidden />}
      </Button>
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
