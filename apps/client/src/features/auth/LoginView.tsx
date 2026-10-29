import {
  RiArrowRightLine,
  RiGlobalLine,
  RiMailLine,
  RiRecordCircleLine,
  RiSeedlingLine,
  RiTerminalLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { type FormEvent, type ReactNode, useEffect, useState } from "react"
import { Button as AriaButton } from "react-aria-components"
import { Button } from "@bugberry/ui/button"
import { Link } from "@bugberry/ui/link"
import { Label } from "@bugberry/ui/field"
import { Input, InputGroup } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import type { AuthMethods } from "./queries"
import type { SocialProvider } from "./auth"
import { DOCS_URL } from "../../lib/docs-url"

const RESEND_AFTER_SECONDS = 30

// Filled, with each provider's own coloured logo, as before the redesign.
// Intent buttons, sized up for the sign-in card.
const providerButton = "w-full gap-2.5 rounded-xl border-transparent px-4 py-2.5 text-[15px] transition hover:bg-[#E2DCE8] sm:text-[15px]"
const continueButton = "h-12 w-full gap-2 rounded-xl text-[15px] font-semibold transition sm:text-[15px]"
// Intent fields, sized up for the sign-in card.
const field = "[&>[data-slot=label]+[data-slot=control]]:mt-2"
const input = "h-12 rounded-xl bg-background text-[15px] placeholder:text-muted-foreground/80 sm:text-[15px]"

/** The sign-in providers' own marks, also shown under Account → Sign-in methods. */
export function GithubIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  )
}

export function GitlabIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path fill="#E24329" d="m12 22.1 4.04-12.44H7.96L12 22.1Z" />
      <path fill="#FC6D26" d="M12 22.1 7.96 9.66H2.3L12 22.1Z" />
      <path fill="#FCA326" d="M2.3 9.66 1.08 13.44c-.11.34.01.72.3.93L12 22.1 2.3 9.66Z" />
      <path fill="#E24329" d="M2.3 9.66h5.66L5.53 2.17c-.13-.38-.67-.38-.8 0L2.3 9.66Z" />
      <path fill="#FC6D26" d="m12 22.1 4.04-12.44h5.66L12 22.1Z" />
      <path fill="#FCA326" d="m21.7 9.66 1.22 3.78c.11.34-.01.72-.3.93L12 22.1l9.7-12.44Z" />
      <path fill="#E24329" d="M21.7 9.66h-5.66l2.43-7.49c.13-.38.67-.38.8 0l2.43 7.49Z" />
    </svg>
  )
}

export function GoogleIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5">
      <path fill="#4285F4" d="M23.5 12.27c0-.82-.07-1.6-.2-2.36H12v4.47h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.73Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.07 7.93-2.9l-3.87-3a7.2 7.2 0 0 1-10.7-3.78H1.36v3.1A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.36 14.32a7.2 7.2 0 0 1 0-4.64v-3.1H1.36a12 12 0 0 0 0 10.84l4-3.1Z" />
      <path fill="#EA4335" d="M12 4.75c1.76 0 3.34.6 4.58 1.8l3.43-3.43A12 12 0 0 0 1.36 6.58l4 3.1A7.17 7.17 0 0 1 12 4.75Z" />
    </svg>
  )
}

const PROVIDERS: Array<{ id: SocialProvider; label: string; icon: ReactNode }> = [
  { id: "github", label: "GitHub", icon: <GithubIcon /> },
  { id: "gitlab", label: "GitLab", icon: <GitlabIcon /> },
  { id: "google", label: "Google", icon: <GoogleIcon /> },
]

/**
 * The BugBerry sign-in page, without router or network: provider buttons for the methods the server
 * enables, then the email and emailed-code steps, beside a showcase of what a report captures. LoginPage
 * wires it to the API.
 */
export function LoginView({
  methods,
  message,
  onProvider,
  onSendCode,
  onVerifyCode,
}: {
  methods: AuthMethods
  /** An error to show above the form, or null. */
  message: string | null
  onProvider: (provider: SocialProvider) => void
  onSendCode: (email: string) => Promise<void>
  onVerifyCode: (email: string, code: string) => Promise<void>
}) {
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [codeSent, setCodeSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resendIn, setResendIn] = useState(0)

  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((seconds) => seconds - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  const providers = PROVIDERS.filter((provider) => methods[provider.id])
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      await onSendCode(email.trim())
      setCodeSent(true)
      setResendIn(RESEND_AFTER_SECONDS)
    })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!codeSent) void sendCode()
    else void run(() => onVerifyCode(email.trim(), code.trim()))
  }

  const shown = error ?? message
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[560px_minmax(0,1fr)] lg:p-5">
      <div className="flex min-h-screen flex-col lg:min-h-[calc(100vh-2.5rem)] justify-between gap-12 px-6 pt-9 pb-7 sm:px-[60px]">
        {/* The name alone in the corner, as in the design; the berry has the showcase. */}
        <img src="/assets/bugberry_typeface_small.webp" alt="BugBerry" className="h-9 w-auto self-start" />

        <div className="flex w-full max-w-[440px] flex-col gap-6">
          <header className="flex flex-col items-start gap-2.5">
            <span className="flex items-center gap-1.5 rounded-full bg-[#E4F4DA] px-2.5 py-[5px] text-xs font-semibold text-[#2F7A17]">
              <RiSeedlingLine aria-hidden className="size-3.5" />
              Your bugs are waiting
            </span>
            <h1 className="font-heading text-[32px] font-bold tracking-[-0.6px] text-foreground">Welcome back</h1>
            <p className="text-[15px]/[23px] text-muted-foreground">Log in or sign up with your work account.</p>
          </header>

          {shown && (
            <p role="alert" className="w-full rounded-xl bg-danger-subtle p-3 text-sm text-danger-subtle-foreground">
              {shown}
            </p>
          )}

          {providers.length > 0 && (
            <div className="flex w-full flex-col gap-2">
              {providers.map(({ id, label, icon }) => (
                <Button key={id} intent="secondary" isDisabled={busy} onPress={() => onProvider(id)} className={providerButton}>
                  {icon}
                  {`Continue with ${label}`}
                </Button>
              ))}
            </div>
          )}

          {providers.length > 0 && methods.emailOtp && (
            <div className="flex w-full items-center gap-3 text-[13px] text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              or
              <span className="h-px flex-1 bg-border" />
            </div>
          )}

          {methods.emailOtp && (
            <form onSubmit={submit} className="flex w-full flex-col gap-6">
              <TextField
                type="email"
                isRequired
                autoComplete="email"
                value={email}
                onChange={(value) => {
                  setEmail(value)
                  setCodeSent(false)
                  setCode("")
                }}
                className={field}
              >
                <Label>Work email</Label>
                <Input placeholder="you@company.com" className={input} />
              </TextField>
              {codeSent && (
                <div className="-mt-2 flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">If this address can sign in, we sent it a code.</p>
                  <TextField
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    isRequired
                    value={code}
                    onChange={(value) => setCode(value.replace(/\D/g, ""))}
                    className={field}
                  >
                    <Label>Verification code</Label>
                    <Input placeholder="Enter code" className={`${input} font-mono tracking-[0.3em]`} />
                  </TextField>
                  <div className="-mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Didn't receive the code?</span>
                    <AriaButton
                      isDisabled={busy || resendIn > 0}
                      onPress={() => void sendCode()}
                      className="font-medium text-foreground hover:text-primary disabled:text-muted-foreground"
                    >
                      {resendIn > 0 ? `Resend code (${resendIn}s)` : "Resend code"}
                    </AriaButton>
                  </div>
                </div>
              )}
              <Button type="submit" isDisabled={busy} className={continueButton}>
                Continue
                <RiArrowRightLine aria-hidden className="size-[18px]" />
              </Button>
            </form>
          )}

          <p className="text-xs/[18px] text-muted-foreground">
            By continuing, you agree to BugBerry's Terms of Service and{" "}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} BugBerry</p>
          <Link href={DOCS_URL} className="hover:text-foreground">
            Documentation
          </Link>
        </div>
      </div>

      <Showcase />
    </main>
  )
}

/** Soft dots behind the berry: position (in % of the panel), size in px, and colour. */
const SPOTS: Array<[left: number, top: number, size: number, color: string]> = [
  [5.6, 9.3, 180, "#D61F6912"],
  [81.9, 6.3, 240, "#D61F690E"],
  [86.1, 72.9, 150, "#D61F6914"],
  [4.2, 71.8, 120, "#4CA62C14"],
  [20.8, 18.8, 26, "#D61F6935"],
  [75.7, 34.3, 18, "#D61F6945"],
  [15.2, 54.1, 14, "#4CA62C50"],
  [79.9, 58.4, 30, "#D61F6930"],
  [26.4, 86.4, 22, "#D61F6930"],
  [68.1, 15.7, 12, "#4CA62C55"],
  [10.5, 37.5, 48, "#D61F691C"],
  [90.2, 43.8, 10, "#D61F6955"],
]

/** A captured event as a card pinned to the panel. */
function Chip({
  icon: Icon,
  color,
  primary,
  value,
  secondary,
  className,
}: {
  icon: RemixiconComponentType
  color: string
  primary: string
  value?: string
  secondary: string
  className: string
}) {
  return (
    <div
      className={`absolute z-20 flex items-center gap-2.5 rounded-xl border border-border bg-background/95 px-3.5 py-2.5 shadow-[0_12px_30px_#5A1E3A1F] ${className}`}
    >
      <Icon aria-hidden className="size-4 shrink-0" style={{ color }} />
      <span className="flex flex-col gap-0.5 whitespace-nowrap">
        <span className="flex gap-3 font-mono text-xs text-foreground">
          <span>{primary}</span>
          {value && <span className="font-semibold">{value}</span>}
        </span>
        <span className="text-[11px] text-muted-foreground">{secondary}</span>
      </span>
    </div>
  )
}

/** The right half on wide screens: the berry, what a report catches, and the pitch. Hidden on narrow screens. */
function Showcase() {
  return (
    <section className="relative hidden min-h-[640px] flex-col justify-end gap-3 overflow-hidden rounded-[28px] border border-[#F9D3E2] bg-[#FDF4F8] p-14 lg:flex">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {SPOTS.map(([left, top, size, color]) => (
          <span
            key={`${left}-${top}`}
            className="absolute rounded-full"
            style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, backgroundColor: color }}
          />
        ))}
        <img
          src="/assets/bugberry_icon_medium.webp"
          alt=""
          className="absolute top-[20%] left-1/4 z-10 h-[43%] w-1/2 object-contain"
        />
        <Chip
          icon={RiTerminalLine}
          color="#E5484D"
          primary="TypeError: cart is undefined"
          secondary="Console · checkout.js:42"
          className="top-[30%] left-[4.3%] origin-top-left -rotate-3"
        />
        <Chip
          icon={RiGlobalLine}
          color="#D9952B"
          primary="POST /api/checkout"
          value="500"
          secondary="Network · 1.2s"
          className="top-[12.5%] right-[3%] origin-top-left rotate-4"
        />
        <Chip
          icon={RiRecordCircleLine}
          color="#2E9E6A"
          primary="Recording"
          value="00:42"
          secondary="Screen + DOM + logs"
          className="top-[55%] right-[10.5%] origin-top-left -rotate-4"
        />
        <p className="absolute top-[38.6%] left-[7.1%] z-20 w-[190px] origin-top-left -rotate-4 font-hand text-2xl/6 font-semibold text-primary">
          all captured, no repro needed
        </p>
      </div>
      <h2 className="relative z-30 max-w-[520px] font-heading text-5xl/[50px] font-bold tracking-[-1.2px] text-foreground">
        Every bug, picked fresh.
      </h2>
      <p className="relative z-30 max-w-[460px] text-base/6 text-muted-foreground">
        One click turns a weird glitch into a full report.
        <br />
        Video, console, network and device info included.
      </p>
    </section>
  )
}

