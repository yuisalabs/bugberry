import {
  RiBracesLine,
  RiComputerLine,
  RiHourglassLine,
  RiKey2Line,
  RiLockLine,
  RiPaintLine,
  RiScissorsCutLine,
  RiServerLine,
  RiTimeLine,
  RiToolsLine,
} from "@remixicon/react"
import type { ReactNode } from "react"
import type { StatusKind } from "../../lib/status"
import { HandArrow, HandNote, StatusActions, StatusArt, StatusBadge, StatusCode, StatusFrame } from "./StatusFrame"

/** One line of a marked-up request: plain `text`, then the refused part (`mark`) and a note on why. */
export interface MarkedLine {
  text: string
  mark?: string
  note?: string
}

export interface MarkedRequest {
  method?: string
  path?: string
  lines: MarkedLine[]
}

/** What the 401 page's ticket shows. Anything not known is left off rather than made up. */
export interface Ticket {
  holder: string | null
  account: string | null
  gate: string
  ended: Date | null
}

export type StatusPageProps =
  | { kind: "400"; description?: string; request?: MarkedRequest | null }
  | { kind: "401"; signInHref: string; ticket: Ticket }
  | { kind: "403" | "404"; description?: string }
  | { kind: "500" | "503"; onRetry?: () => void }
  | { kind: "504"; onRetry?: () => void; waitedMs?: number | null; at?: Date }
  | { kind: "maintenance"; message?: string | null; until?: Date | null }

/** The browser tab's name for each page. */
const TAB_TITLES: Record<StatusKind, string> = {
  "400": "Bad request",
  "401": "Signed out",
  "403": "No access",
  "404": "Page not found",
  "500": "Something went wrong",
  "503": "BugBerry can't be reached",
  "504": "Timed out",
  maintenance: "Maintenance",
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
const pad = (value: number) => String(value).padStart(2, "0")
const clock = (date: Date, seconds = false) =>
  `${pad(date.getHours())}:${pad(date.getMinutes())}${seconds ? `:${pad(date.getSeconds())}` : ""}`
const day = (date: Date) => `${date.getDate()} ${MONTHS[date.getMonth()]}`

const title = "font-heading font-bold text-[#1C1022]"
const body = "text-[15px]/[23px] text-[#635A6B] sm:text-[16px]/[24px]"

export function StatusPage(props: StatusPageProps) {
  return <StatusFrame title={TAB_TITLES[props.kind]}>{content(props)}</StatusFrame>
}

function content(props: StatusPageProps): ReactNode {
  switch (props.kind) {
    case "400":
      return <BadRequest description={props.description} request={props.request ?? null} />
    case "401":
      return <Unauthorized signInHref={props.signInHref} ticket={props.ticket} />
    case "403":
      return <Forbidden description={props.description} />
    case "404":
      return <NotFound description={props.description} />
    case "500":
      return <ServerError onRetry={props.onRetry} />
    case "503":
      return <Unavailable onRetry={props.onRetry} />
    case "504":
      return <TimedOut onRetry={props.onRetry} waitedMs={props.waitedMs ?? null} at={props.at ?? null} />
    case "maintenance":
      return <Maintenance message={props.message ?? null} until={props.until ?? null} />
  }
}

function NotFound({ description }: { description?: string }) {
  return (
    <div className="flex flex-col items-center gap-3.5 text-center">
      <div data-testid="status-code" data-code="404" aria-hidden className="relative flex items-center gap-1">
        <p className="font-sketch text-[96px] leading-none font-bold text-[#D61F69] sm:text-[200px] lg:text-[300px]">4</p>
        <div className="w-[150px] sm:w-[260px] lg:w-[380px]">
          <StatusArt name="404" width={380} height={332} />
        </div>
        <p className="font-sketch text-[96px] leading-none font-bold text-[#D61F69] sm:text-[200px] lg:text-[300px]">4</p>
        <HandNote className="-top-20 left-[81%] -rotate-6 text-[28px]">I looked everywhere!</HandNote>
        <HandArrow path="M64 4c-12 18-24 40-54 62m-2-16l2 17 17-1" width={70} height={80} className="-top-6 left-[77%]" />
      </div>
      <div className="flex max-w-[680px] flex-col items-center gap-3">
        <h1 className={`${title} text-[28px]/[34px] sm:text-[36px]/[44px] lg:text-[44px]/[52px]`}>This page rolled off the vine.</h1>
        <p className={body}>
          {description ??
            "The link may be broken, or the page was moved somewhere new. Nothing's lost. We just can't find the path you took."}
        </p>
      </div>
      <StatusActions />
    </div>
  )
}

function BadRequest({ description, request }: { description?: string; request: MarkedRequest | null }) {
  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:gap-12 lg:pr-5">
      <div className="relative w-full max-w-[360px] lg:max-w-[644px] lg:flex-1">
        <HandNote className="top-[-14px] left-[9%] rotate-[4deg] text-[28px]">what does this even say?</HandNote>
        <StatusArt name="400" width={644} height={500} />
      </div>
      <div className="flex w-full max-w-[600px] flex-col items-start gap-[18px]">
        <div className="flex items-center gap-4">
          <StatusCode code="400" className="text-[76px] sm:text-[100px] lg:text-[120px]" />
          <StatusBadge tone="pink" icon={<RiBracesLine aria-hidden />}>
            Bad request
          </StatusBadge>
        </div>
        <h1 className={`${title} text-[30px]/[36px] sm:text-[38px]/[44px] lg:text-[46px]/[50px]`}>
          That request came out <br className="hidden sm:inline" />
          a little scrambled.
        </h1>
        <p className={body}>
          {description ??
            (request
              ? "Something in what we received didn't quite add up. We marked it up for you, so fix the bits in pink and send it again."
              : "Something in this link or request didn't quite add up, so BugBerry couldn't open it.")}
        </p>
        {request && <MarkedUp request={request} />}
        <StatusActions className="pt-1" />
      </div>
    </div>
  )
}

function MarkedUp({ request }: { request: MarkedRequest }) {
  return (
    <div data-testid="marked-request" className="w-full overflow-hidden rounded-[14px] bg-[#FFFFFF] outline outline-1 -outline-offset-1 outline-[#E6E1EC]">
      {(request.method || request.path) && (
        <div className="flex items-center gap-2.5 border-b border-[#E6E1EC] bg-[#F7F6FA] px-4 py-2.5">
          {request.method && <span className="rounded-[6px] bg-[#FCE3EE] px-1.5 py-0.5 text-[11px] font-semibold text-[#A3164F]">{request.method}</span>}
          {request.path && <span className="min-w-0 truncate text-[12px]">{request.path}</span>}
        </div>
      )}
      <ol className="flex flex-col gap-1.5 px-4 pt-3 pb-3.5 text-[13px]">
        {request.lines.map((line, index) => (
          <li key={index} className="flex flex-wrap items-center gap-x-3.5">
            <span aria-hidden className="w-3 text-right text-[#B8AFC0]">
              {index + 1}
            </span>
            <span className="min-w-0 break-all">
              {line.text}
              {line.mark && <mark className="rounded-[4px] border-b-2 border-[#D61F69] bg-[#D61F6922] px-[3px] text-[#A3164F]">{line.mark}</mark>}
            </span>
            {line.note && <span className="ml-auto rotate-2 font-hand text-[20px] font-semibold text-[#D61F69]">{`← ${line.note}`}</span>}
          </li>
        ))}
      </ol>
    </div>
  )
}

/** The barcode's bars, in pixels; every fifth one is a little lighter. */
const BARS = [2, 1, 3, 1, 1, 4, 2, 1, 3, 2, 1, 1, 4, 1, 2, 3, 1, 2, 1, 4, 1, 1, 3, 2, 1, 2, 4, 1, 3, 1, 2, 1, 1, 3, 2, 4, 1, 2]

function Unauthorized({ signInHref, ticket }: { signInHref: string; ticket: Ticket }) {
  const fields: Array<[string, string]> = []
  if (ticket.holder) fields.push(["HOLDER", ticket.holder])
  if (ticket.account) fields.push(["ACCOUNT", ticket.account])
  fields.push(["GATE", ticket.gate])
  if (ticket.ended) fields.push(["ENDED", `${day(ticket.ended)}, ${clock(ticket.ended)}`])
  return (
    <div className="flex flex-col items-center gap-7 text-center">
      <div className="flex flex-col items-center gap-2.5">
        <div className="flex items-center gap-3.5">
          <StatusCode code="401" className="text-[64px] lg:text-[84px]" />
          <StatusBadge tone="green" icon={<RiKey2Line aria-hidden />}>
            Unauthorized
          </StatusBadge>
        </div>
        <h1 className={`${title} text-[32px]/[40px] sm:text-[40px]/[48px] lg:text-[48px]/[58px]`}>Tickets, please!</h1>
        <p className={`${body} max-w-[560px]`}>
          This patch is for signed-in gardeners only. Your session has ended, so show us your pass again and we'll wave you right
          through.
        </p>
      </div>
      <div className="relative w-full max-w-[940px]">
        <div
          role="group"
          aria-label="Your pass has expired"
          className="relative flex flex-col rounded-[24px] bg-[#FFFFFF] text-left outline outline-1 -outline-offset-1 outline-[#E6E1EC] md:h-[360px] md:flex-row"
        >
          <div className="flex items-center justify-center rounded-t-[24px] bg-[#FBF7FA] p-5 md:flex-1 md:rounded-l-[24px] md:rounded-tr-none">
            <StatusArt name="401" width={572} height={360} className="max-w-[420px] md:max-w-none" />
          </div>
          <div aria-hidden className="relative hidden w-7 shrink-0 flex-col items-center justify-center gap-2.5 md:flex">
            <span className="absolute -top-3 size-6 rounded-full bg-[#FDF4F8] outline outline-1 -outline-offset-1 outline-[#E6E1EC] [clip-path:inset(50%_0_0_0)]" />
            {Array.from({ length: 14 }, (_, index) => (
              <span key={index} className="size-1.5 rounded-full bg-[#F1D4E1]" />
            ))}
            <span className="absolute -bottom-3 size-6 rounded-full bg-[#FDF4F8] outline outline-1 -outline-offset-1 outline-[#E6E1EC] [clip-path:inset(0_0_50%_0)]" />
          </div>
          <div className="relative flex flex-col justify-center gap-4 px-6 py-7 md:w-[340px] md:shrink-0 md:pr-8 md:pl-5">
            <p aria-hidden className="origin-top-left rotate-3 font-hand text-[26px] font-bold text-[#D61F69]">
              admit one gardener
            </p>
            <p className="font-heading text-[22px] font-semibold text-[#1C1022]">Your pass has expired</p>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-y border-[#E6E1EC] py-3.5">
              {fields.map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-[3px]">
                  <dt className="text-[10px] tracking-[0.8px] text-[#8A7F93]">{label}</dt>
                  <dd className="truncate text-[14px] font-semibold text-[#1C1022]" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            <div aria-hidden className="flex h-[34px] gap-[3px]">
              {BARS.map((width, index) => (
                <span key={index} className={`h-full shrink-0 ${index % 5 === 2 ? "bg-[#1C102299]" : "bg-[#1C1022]"}`} style={{ width }} />
              ))}
            </div>
            <p className="absolute right-6 bottom-8 -rotate-10 rounded-[8px] bg-[#FFFFFFCC] px-2.5 font-sketch text-[34px] font-bold tracking-[1px] text-[#D61F69] outline-[2.5px] -outline-offset-1 outline-[#D61F69] outline-solid">
              EXPIRED
            </p>
          </div>
        </div>
        <HandNote className="top-[94px] left-[calc(100%+26px)] rotate-6 text-[24px]/[30px] whitespace-pre xl:block max-xl:hidden">
          {"no pass,\nno berries!"}
        </HandNote>
        <HandArrow path="M40 4c2 26-10 42-32 48m10-12l-11 12 15 6" width={50} height={60} className="top-[164px] left-[calc(100%+2px)] max-xl:hidden" />
      </div>
      <StatusActions primary={{ href: signInHref, label: "Sign in" }} className="justify-center pt-0" />
    </div>
  )
}

function Forbidden({ description }: { description?: string }) {
  return (
    <div className="flex flex-col-reverse items-center gap-6 lg:flex-row lg:justify-center lg:pl-5">
      <div className="flex w-full max-w-[420px] flex-col items-start gap-[18px]">
        <StatusCode code="403" className="text-[96px] lg:text-[150px]/[143px]" />
        <StatusBadge tone="pink" icon={<RiLockLine aria-hidden />}>
          Forbidden
        </StatusBadge>
        <h1 className={`${title} text-[32px]/[38px] lg:text-[44px]/[48px]`}>
          This patch is <br className="hidden lg:inline" />
          fenced off.
        </h1>
        <p className={body}>
          {description ?? "You're signed in, but your role doesn't open this gate. Ask a workspace admin to let you in."}
        </p>
        <StatusActions />
      </div>
      <div className="relative w-full max-w-[340px] lg:max-w-[580px]">
        <HandNote className="-top-24 left-0 -rotate-4 text-[28px]">sorry friend, rules are rules</HandNote>
        <StatusArt name="403" width={580} height={460} />
      </div>
    </div>
  )
}

function ServerError({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3.5 text-center">
      <div className="relative flex h-[190px] w-full items-center justify-center sm:h-[280px] lg:h-[350px]">
        <StatusCode code="500" className="text-[170px] tracking-[-0.02em] !text-[#D61F6926] sm:text-[300px] lg:text-[400px]" />
        <div className="absolute top-0 left-1/2 h-full w-[304px] -translate-x-1/2 sm:w-[448px] lg:w-[560px]">
          <StatusArt name="500" width={560} height={350} />
        </div>
      </div>
      <div className="flex max-w-[760px] flex-col items-center gap-2.5">
        <h1 className={`${title} text-[28px]/[34px] sm:text-[36px]/[44px] lg:text-[46px]/[56px]`}>Oops, we spilled the berries.</h1>
        <p className={`${body} max-w-[600px]`}>Something broke on our side, not yours. Try again in a moment. If it keeps happening, let your BugBerry admin know.</p>
      </div>
      <StatusActions onRetry={onRetry} className="justify-center pt-2.5" />
    </div>
  )
}

function Unavailable({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:gap-10 lg:pl-5">
      <div className="flex w-full max-w-[540px] flex-col items-start gap-5">
        <div className="flex items-center gap-4">
          <StatusCode code="503" className="text-[76px] sm:text-[100px] lg:text-[120px]" />
          <StatusBadge tone="amber" icon={<RiToolsLine aria-hidden />}>
            Service unavailable
          </StatusBadge>
        </div>
        <h1 className={`${title} text-[32px]/[38px] sm:text-[40px]/[46px] lg:text-[48px]/[52px]`}>
          We're out tending <br className="hidden sm:inline" />
          the berry patch.
        </h1>
        <p className={body}>
          BugBerry can't be reached right now. Your recordings and reports are safe, so try again in a moment.
        </p>
        <StatusActions onRetry={onRetry} />
      </div>
      <div className="relative w-full max-w-[420px] lg:max-w-[712px] lg:flex-1">
        <HandNote className="-top-24 left-[61%] rotate-[5deg] text-[28px]">shh… back soon, promise!</HandNote>
        <HandArrow path="M50 4c4 24-10 44-38 56m2-16l-3 17 17 3" width={60} height={70} className="-top-[60px] left-[58%]" />
        <StatusArt name="503" width={712} height={480} />
      </div>
    </div>
  )
}

function Vine({ faded = false }: { faded?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 110 28" preserveAspectRatio="none" className="h-7 w-full flex-1 overflow-visible">
      <path d="M2 14c18-12 34-12 53 0s35 12 53 0" fill="none" stroke={faded ? "#4CA62C66" : "#4CA62C"} strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Station({ icon, tone, name, meta, dot }: { icon: ReactNode; tone: string; name: string; meta: string; dot: string }) {
  return (
    // Phones show only the gateway's drawing; the two stations and their vines need the width of a row.
    <div className="hidden w-[220px] shrink-0 flex-col gap-3 rounded-[16px] bg-[#FFFFFFF2] p-5 text-left outline outline-1 -outline-offset-1 outline-[#E6E1EC] md:flex">
      <span aria-hidden className={`flex size-10 items-center justify-center rounded-full [&>svg]:size-5 ${tone}`}>
        {icon}
      </span>
      <p className="font-heading text-[18px] font-semibold text-[#1C1022]">{name}</p>
      <p className="flex items-center gap-1.5 text-[12px] text-[#635A6B]">
        <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
        {meta}
      </p>
    </div>
  )
}

function TimedOut({ onRetry, waitedMs, at }: { onRetry?: () => void; waitedMs: number | null; at: Date | null }) {
  const sent = waitedMs !== null && at ? new Date(at.getTime() - waitedMs) : null
  return (
    <div className="flex w-full flex-col gap-9 lg:px-5">
      <div className="flex flex-col-reverse gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex max-w-[680px] flex-col items-start gap-3.5 lg:pb-[18px]">
          <StatusBadge tone="pink" icon={<RiHourglassLine aria-hidden />}>
            Gateway timeout
          </StatusBadge>
          <h1 className={`${title} text-[32px]/[38px] sm:text-[40px]/[46px] lg:text-[48px]/[52px]`}>We waited, and waited… the vine timed out.</h1>
          <p className={body}>
            Our gateway reached out to the server but didn't hear back in time. It's usually just a hiccup, so trying again in a
            moment tends to fix it.
          </p>
          <StatusActions onRetry={onRetry} className="pt-2" />
        </div>
        <StatusCode code="504" className="text-[100px] sm:text-[160px] lg:text-[220px]/[198px]" />
      </div>
      <div className="flex flex-col items-center gap-3 md:flex-row md:gap-2">
        <Station
          icon={<RiComputerLine aria-hidden />}
          tone="bg-[#E4F4DA] text-[#2F7A17]"
          name="Your browser"
          meta={sent ? `sent ${clock(sent, true)}` : "request sent"}
          dot="bg-[#1F7A50]"
        />
        <div aria-hidden className="hidden min-w-0 flex-1 flex-col items-center gap-1 md:flex">
          <span className="font-hand text-[20px] text-[#635A6B]">request ✓</span>
          <Vine />
        </div>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div className="w-[240px] lg:w-[340px]">
            <StatusArt name="504" width={340} height={264} />
          </div>
          <p className="flex items-center gap-2">
            <span className="font-heading text-[16px] font-semibold text-[#1C1022]">BugBerry gateway</span>
            {waitedMs !== null && <span className="text-[12px] text-[#D61F69]">{`waited ${(waitedMs / 1000).toFixed(1)}s`}</span>}
          </p>
        </div>
        <div aria-hidden className="hidden min-w-0 flex-1 flex-col items-center gap-1 md:flex">
          <span className="font-hand text-[20px] text-[#E5484D]">no reply…</span>
          <span className="flex w-full items-center gap-1">
            <Vine />
            <RiScissorsCutLine className="size-[18px] shrink-0 text-[#E5484D]" />
            <Vine faded />
          </span>
        </div>
        <Station icon={<RiServerLine aria-hidden />} tone="bg-[#FDE4E5] text-[#C2272D]" name="Origin server" meta="no reply" dot="bg-[#E5484D]" />
      </div>
    </div>
  )
}

function Maintenance({ message, until }: { message: string | null; until: Date | null }) {
  const back = until ? `Back around ${clock(until)}${until.toDateString() === new Date().toDateString() ? "" : ` on ${day(until)}`} (your time)` : null
  return (
    <div className="flex flex-col items-center gap-8 lg:flex-row lg:gap-10 lg:px-5">
      <div className="w-full max-w-[340px] lg:max-w-[500px] lg:shrink-0">
        <StatusArt name="maintenance" width={500} height={380} />
      </div>
      <div className="flex w-full max-w-[720px] flex-col items-start gap-[18px] lg:flex-1">
        <StatusBadge tone="amber" icon={<RiPaintLine aria-hidden />}>
          Scheduled maintenance
        </StatusBadge>
        <h1 className={`${title} text-[32px]/[38px] sm:text-[40px]/[46px] lg:text-[48px]/[52px]`}>
          Fresh paint is drying. <br className="hidden sm:inline" />
          Please don't touch the fence!
        </h1>
        <p className={`${body} max-w-[560px]`}>{message ?? "We're giving BugBerry a little care. Everything you've captured is safe."}</p>
        {back && (
          <p className="flex items-center gap-2 text-[13px] text-[#1C1022]">
            <RiTimeLine aria-hidden className="size-3.5" />
            {back}
          </p>
        )}
      </div>
    </div>
  )
}
