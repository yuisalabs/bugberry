import { QueryClientContext } from "@tanstack/react-query"
import { type ReactNode, useContext, useEffect } from "react"
import { queries } from "../../lib/queries"
import { BugBerryLogo } from "../BugBerryLogo"

/** The soft dots behind every status page: [size, left %, top %, colour], placed as in the designs. */
const SPOTS: Array<[number, number, number, string]> = [
  [200, 4.3, 15.2, "bg-[#D61F6910]"],
  [260, 80.7, 9.8, "bg-[#D61F690C]"],
  [170, 84.3, 69.6, "bg-[#D61F6912]"],
  [140, 5.7, 71.7, "bg-[#4CA62C14]"],
  [24, 17.9, 27.2, "bg-[#D61F6935]"],
  [18, 75.7, 35.9, "bg-[#D61F6945]"],
  [14, 12.9, 56.5, "bg-[#4CA62C50]"],
  [30, 82.1, 60.9, "bg-[#D61F6930]"],
  [20, 22.9, 87, "bg-[#D61F6930]"],
  [12, 62.9, 27.2, "bg-[#4CA62C55]"],
  [10, 92.1, 45.7, "bg-[#D61F6955]"],
]

/** Whether someone is signed in, from what the app already knows; a status page never asks the server. */
export function useSignedIn(): boolean {
  const client = useContext(QueryClientContext)
  return Boolean(client?.getQueryData(queries.me().queryKey))
}

/** Signed in: the dashboard. Otherwise the home page, which a self-hosted server sends on to sign-in. */
export function useHomeHref(): string {
  return useSignedIn() ? "/app" : "/"
}

/**
 * The pink card every status page sits on: logo, the page, and the footer. It covers the whole window, so a failure
 * inside the dashboard shows the same page as one at the top level.
 */
export function StatusFrame({ title, children }: { title: string; children: ReactNode }) {
  const home = useHomeHref()
  useEffect(() => {
    const previous = document.title
    document.title = `${title} · BugBerry`
    return () => {
      document.title = previous
    }
  }, [title])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-[#FFFFFF] p-2 font-sans text-[#1C1022] sm:p-5">
      <div className="relative flex min-h-full flex-col overflow-hidden rounded-[20px] bg-[#FDF4F8] px-5 py-5 outline outline-1 -outline-offset-1 outline-[#F9D3E2] sm:rounded-[28px] sm:px-11 sm:py-7">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {SPOTS.map(([size, left, top, colour]) => (
            <span
              key={`${left}-${top}`}
              className={`absolute rounded-full ${colour} ${size > 100 ? "max-sm:scale-50" : ""}`}
              style={{ width: size, height: size, left: `${left}%`, top: `${top}%` }}
            />
          ))}
        </div>
        <div className="relative z-10">
          <a href={home} className="inline-flex rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#D61F69]">
            <BugBerryLogo className="h-9 sm:h-11" />
          </a>
        </div>
        <div className="relative z-10 flex flex-1 flex-col justify-center py-10 lg:py-6">{children}</div>
        <p className="relative z-10 text-[12px] text-[#635A6B]">
          © {new Date().getFullYear()} BugBerry ·{" "}
          <a href="/privacy" className="underline-offset-2 hover:text-[#1C1022] hover:underline">
            Privacy
          </a>
        </p>
      </div>
    </div>
  )
}

const BUTTON =
  "inline-flex h-12 items-center justify-center gap-2 rounded-[12px] px-5 text-[15px] font-semibold whitespace-nowrap transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#D61F69]"

/** Home (or another way on), and Try again where asking once more can help. */
export function StatusActions({
  primary,
  onRetry,
  className = "",
}: {
  primary?: { href: string; label: string }
  onRetry?: () => void
  className?: string
}) {
  const home = useHomeHref()
  const target = primary ?? { href: home, label: "Home" }
  return (
    <div className={`flex flex-wrap gap-3 pt-3.5 ${className}`}>
      <a href={target.href} className={`${BUTTON} bg-[#D61F69] text-[#FFFFFF] hover:bg-[#C01A5E]`}>
        {target.label}
      </a>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={`${BUTTON} bg-[#FFFFFF] text-[#1C1022] outline outline-1 -outline-offset-1 outline-[#E6E1EC] hover:bg-[#FBF7FA]`}
        >
          Try again
        </button>
      )}
    </div>
  )
}

const BADGE_TONES = {
  pink: "bg-[#FCE3EE] text-[#A3164F]",
  amber: "bg-[#FBEFD9] text-[#8A5A0F]",
  green: "bg-[#E4F4DA] text-[#2F7A17]",
}

export function StatusBadge({ tone, icon, children }: { tone: keyof typeof BADGE_TONES; icon: ReactNode; children: ReactNode }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-[5px] text-[12px] font-semibold [&>svg]:size-3.5 ${BADGE_TONES[tone]}`}>
      {icon}
      {children}
    </span>
  )
}

/** The big sketched numerals. Read out by the title instead, so hidden from screen readers. */
export function StatusCode({ code, className }: { code: string; className: string }) {
  return (
    <p aria-hidden data-testid="status-code" data-code={code} className={`font-sketch leading-none font-bold whitespace-nowrap text-[#D61F69] ${className}`}>
      {code}
    </p>
  )
}

/** A hand-written aside beside the drawing (wide screens only). */
export function HandNote({ children, className }: { children: ReactNode; className: string }) {
  return (
    <p aria-hidden className={`pointer-events-none absolute hidden font-hand font-semibold whitespace-nowrap text-[#D61F69] lg:block ${className}`}>
      {children}
    </p>
  )
}

/** A hand-drawn arrow from a note to the drawing; `path` is drawn in a box of `width` × `height`. */
export function HandArrow({ path, width, height, className }: { path: string; width: number; height: number; className: string }) {
  return (
    <svg
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={`pointer-events-none absolute hidden overflow-visible lg:block ${className}`}
    >
      <path d={path} fill="none" stroke="#D61F69" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** The page's drawing, from public/assets/status. It only decorates: the title says what happened. */
export function StatusArt({ name, width, height, className = "" }: { name: string; width: number; height: number; className?: string }) {
  return <img src={`/assets/status/${name}.webp`} alt="" width={width} height={height} data-status-art className={`h-auto w-full select-none ${className}`} />
}
