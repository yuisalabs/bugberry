import { Button } from "@bugberry/ui/button"
import { Checkbox, CheckboxField } from "@bugberry/ui/checkbox"
import { Description, Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { Textarea } from "@bugberry/ui/textarea"
import { MAX_SENDER_NAME_LENGTH } from "@bugberry/shared"
import { useState } from "react"
import { BugBerryLogo } from "../../components/layout/BugBerryLogo"
import { Loading } from "../../components/ui/loading"
import { formatLength } from "../../lib/format"
import type { CaptureSupport } from "./screen-capture"

export type RequestState = "loading" | "unavailable" | "unreachable" | "unsupported" | "intro" | "recording" | "review" | "sending" | "sent" | "closed"

export interface RequestLink {
  workspaceName: string
  requesterName: string
  note: string
  pageUrl: string | null
  maxSeconds: number
  maxBytes: number
}

export interface Capture {
  kind: "video" | "screenshot"
  blob: Blob
  /** An object URL of the blob, for the preview and the download link. */
  url: string
  durationMs: number | null
}

export interface RequestForm {
  name: string
  email: string
  description: string
  pageUrl: string
}

export interface RequestViewProps {
  state: RequestState
  link: RequestLink | null
  support: CaptureSupport
  mic: boolean
  elapsedMs: number
  capture: Capture | null
  form: RequestForm
  progress: number
  /** Why the last try failed, in words for the sender; shown on the intro and the review. */
  sendError: string | null
  canSendAnother: boolean
  /** Why the page closed: the link stopped taking recordings, or the workspace keeps no more. */
  closedReason?: "link" | "full"
  onMic(on: boolean): void
  onRecord(): void
  onScreenshot(): void
  onStop(): void
  onForm(patch: Partial<RequestForm>): void
  onSend(): void
  onDiscard(): void
  onAnother(): void
  /** Looks the link up again after a lookup that got no answer. */
  onRetry(): void
}

function lengthLabel(seconds: number): string {
  if (seconds % 60 === 0) return `${seconds / 60} ${seconds === 60 ? "minute" : "minutes"}`
  return formatLength(seconds * 1000)
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p role="alert" className="text-sm text-danger-subtle-foreground">
      {text}
    </p>
  )
}

function Intro(props: RequestViewProps & { link: RequestLink }) {
  const { link, support } = props
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {link.requesterName} from {link.workspaceName} asked you for a recording
        </h1>
        {link.note && <p className="whitespace-pre-wrap border-l-2 border-border pl-3 text-foreground">{link.note}</p>}
        {link.pageUrl && (
          <p className="text-sm text-muted-foreground">
            It's about{" "}
            <a href={link.pageUrl} target="_blank" rel="noopener noreferrer" className="break-all text-foreground underline">
              {link.pageUrl}
            </a>
          </p>
        )}
      </div>
      <p className="text-sm text-foreground">
        Your browser will ask what to share: a tab, a window or the whole screen. Only what you pick is recorded, and nothing is sent until you press Send.
      </p>
      {support === "video" ? (
        <>
          <CheckboxField isSelected={props.mic} onChange={props.onMic}>
            <Checkbox>Record my voice too</Checkbox>
          </CheckboxField>
          <div className="flex flex-wrap gap-3">
            <Button onPress={props.onRecord}>Record my screen</Button>
            <Button intent="outline" onPress={props.onScreenshot}>
              Take a screenshot
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            A recording can be up to {lengthLabel(link.maxSeconds)}. You don't need an account.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">This browser can't record video. You can send a screenshot.</p>
          <Button className="self-start" onPress={props.onScreenshot}>
            Take a screenshot
          </Button>
        </>
      )}
      <ErrorLine text={props.sendError} />
    </div>
  )
}

function Recording(props: RequestViewProps & { link: RequestLink }) {
  const left = Math.max(0, props.link.maxSeconds * 1000 - props.elapsedMs)
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold text-foreground">Recording</h1>
      <p className="font-mono text-lg text-foreground tabular-nums">{formatLength(left)} left</p>
      <p className="text-sm text-muted-foreground">Show the problem, then stop. Your browser's Stop sharing button works too.</p>
      <Button intent="danger" className="self-start" onPress={props.onStop}>
        Stop recording
      </Button>
    </div>
  )
}

function Preview({ capture }: { capture: Capture }) {
  return capture.kind === "video" ? (
    // biome-ignore lint/a11y/useMediaCaption: the sender's own recording has no captions to offer.
    <video src={capture.url} controls className="w-full rounded-lg bg-muted" />
  ) : (
    <img src={capture.url} alt="Your screenshot" className="w-full rounded-lg border border-border" />
  )
}

function Review(props: RequestViewProps & { link: RequestLink; capture: Capture }) {
  const { form, onForm, capture, link } = props
  const sending = props.state === "sending"
  const [discarding, setDiscarding] = useState(false)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (form.name.trim()) props.onSend()
      }}
    >
      <h1 className="font-heading text-2xl font-bold text-foreground">Check it, then send</h1>
      <Preview capture={capture} />
      <TextField value={form.name} onChange={(name) => onForm({ name })} maxLength={MAX_SENDER_NAME_LENGTH} isDisabled={sending}>
        <Label>Your name</Label>
        <Input autoComplete="name" />
      </TextField>
      <TextField value={form.email} onChange={(email) => onForm({ email })} maxLength={200} type="email" isDisabled={sending}>
        <Label>Your email</Label>
        <Input autoComplete="email" />
        <Description>Optional, so they can reply. Only the team at {link.workspaceName} sees it.</Description>
      </TextField>
      <TextField value={form.description} onChange={(description) => onForm({ description })} maxLength={5000} isDisabled={sending}>
        <Label>What happened</Label>
        <Textarea rows={4} />
      </TextField>
      <TextField value={form.pageUrl} onChange={(pageUrl) => onForm({ pageUrl })} maxLength={2048} type="url" isDisabled={sending}>
        <Label>Page address</Label>
        <Input />
      </TextField>
      {sending ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-foreground">Sending… {Math.round(props.progress * 100)}%</p>
          <p className="text-xs text-muted-foreground">Keep this page open until it's done.</p>
        </div>
      ) : discarding ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">Throw this {capture.kind === "video" ? "recording" : "screenshot"} away?</p>
          <div className="flex flex-wrap gap-3">
            <Button intent="danger" onPress={props.onDiscard}>
              Throw it away
            </Button>
            <Button intent="outline" onPress={() => setDiscarding(false)}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" isDisabled={!form.name.trim()}>
            Send
          </Button>
          <Button intent="outline" onPress={() => setDiscarding(true)}>
            {capture.kind === "video" ? "Record again" : "Take again"}
          </Button>
        </div>
      )}
      <ErrorLine text={props.sendError} />
    </form>
  )
}

function Body(props: RequestViewProps) {
  const { state, link, capture } = props
  if (state === "loading") return <Loading />
  if (state === "unreachable") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-foreground">The link couldn't be checked. Wait a moment, then try again.</p>
        <Button intent="outline" className="self-start" onPress={props.onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  if (state === "unavailable" || !link) {
    return <p className="text-foreground">This link doesn't take recordings. Ask the person who sent it for a new one.</p>
  }
  if (state === "unsupported") {
    return <p className="text-foreground">Recording your screen needs a computer. Open this link in Chrome, Edge or Firefox on a laptop or desktop.</p>
  }
  if (state === "recording") return <Recording {...props} link={link} />
  if ((state === "review" || state === "sending") && capture) return <Review {...props} link={link} capture={capture} />
  if (state === "sent") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-bold text-foreground">Thank you</h1>
        <p className="text-foreground">Sent. {link.requesterName} will find it in BugBerry.</p>
        {props.canSendAnother && (
          <Button intent="outline" className="self-start" onPress={props.onAnother}>
            Send another
          </Button>
        )}
      </div>
    )
  }
  if (state === "closed" && capture) {
    const file = capture.kind === "video" ? "recording.webm" : "screenshot.png"
    return (
      <div className="flex flex-col gap-4">
        <p className="text-foreground">
          {props.closedReason === "full"
            ? `${link.requesterName}'s BugBerry can't take more recordings right now. Save yours to your computer and send it to them another way.`
            : `This link stopped taking recordings before yours was sent. Save it to your computer and send it to ${link.requesterName} another way.`}
        </p>
        <a href={capture.url} download={file} className="self-start text-sm font-medium text-foreground underline">
          {capture.kind === "video" ? "Save the recording" : "Save the screenshot"}
        </a>
      </div>
    )
  }
  return <Intro {...props} link={link} />
}

/** The page a request link opens, one state at a time, without network or browser capture. */
export function RequestView(props: RequestViewProps) {
  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 py-12 sm:py-16">
      <main className="flex w-full max-w-lg flex-col gap-8 rounded-2xl border border-border bg-background p-6 sm:p-8">
        <BugBerryLogo />
        <Body {...props} />
      </main>
    </div>
  )
}
