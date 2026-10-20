import { Button } from "@bugberry/ui/button"
import { useEffect, useRef, useState } from "react"
import { browser } from "wxt/browser"
import { isOffscreenMessage, type OffscreenMessage, type RecorderReadyNotice } from "../../lib/messages"
import { keepBackgroundAwake } from "../../lib/keep-alive"
import type { RecorderReply } from "../../lib/recorder-handler"

type Phase = "waiting" | "choose" | "starting" | "recording" | "done"

const TEXT: Record<Phase, { title: string; detail: string }> = {
  waiting: { title: "Getting ready…", detail: "" },
  choose: { title: "Choose what to record", detail: "Firefox will ask which screen or window to share." },
  starting: { title: "Starting…", detail: "" },
  recording: { title: "Recording", detail: "Keep this window open. You can minimise it." },
  done: { title: "Done", detail: "" },
}

const failure = (error: unknown): RecorderReply => ({ ok: false, error: error instanceof Error ? error.message : String(error) })

/**
 * Answers the background's `bugberry:offscreen-*` messages. `open` waits for the click on "Choose screen or
 * window": Firefox only shows its share picker after a click on a page the reporter sees.
 */
export function App({ handle }: { handle(message: OffscreenMessage): Promise<RecorderReply> }) {
  const [phase, setPhase] = useState<Phase>("waiting")
  const pending = useRef<{ message: OffscreenMessage; respond(reply: RecorderReply): void } | null>(null)

  useEffect(() => {
    const listener = (message: unknown, _sender: unknown, sendResponse: (reply: RecorderReply) => void) => {
      if (!isOffscreenMessage(message)) return undefined
      if (message.type === "bugberry:offscreen-open") {
        pending.current = { message, respond: sendResponse }
        setPhase("choose")
        return true
      }
      handle(message).then((reply) => {
        if (reply.ok && message.type === "bugberry:offscreen-begin") setPhase("recording")
        if (message.type === "bugberry:offscreen-stop" || message.type === "bugberry:offscreen-discard") setPhase("done")
        if (message.type === "bugberry:offscreen-restart") setPhase("starting")
        sendResponse(reply)
      }, (error: unknown) => sendResponse(failure(error)))
      return true // keeps the channel open for the async response
    }
    browser.runtime.onMessage.addListener(listener)
    const ready: RecorderReadyNotice = { type: "bugberry:recorder-ready" }
    browser.runtime.sendMessage(ready).catch(() => {})
    return () => browser.runtime.onMessage.removeListener(listener)
  }, [handle])

  // While the reporter is choosing, nothing else reaches the background: keep it from being unloaded.
  useEffect(() => {
    if (phase !== "choose" && phase !== "starting") return
    return keepBackgroundAwake(
      // Any message resets Firefox's idle timer; the background ignores this one.
      () => browser.runtime.sendMessage({ type: "bugberry:recorder-keepalive" }),
      (run, ms) => {
        const id = setInterval(run, ms)
        return () => clearInterval(id)
      },
    )
  }, [phase])

  const choose = () => {
    const request = pending.current
    if (!request) return
    pending.current = null
    setPhase("starting")
    handle(request.message).then(
      (reply) => {
        if (!reply.ok) setPhase("waiting")
        request.respond(reply)
      },
      (error: unknown) => {
        setPhase("waiting")
        request.respond(failure(error))
      },
    )
  }

  return (
    <main className="flex min-h-screen flex-col justify-center gap-3 p-6">
      <div className="flex items-center gap-2">
        <img src="/assets/bugberry_icon_small.webp" alt="" className="size-6 object-contain" />
        <h1 className="font-heading text-lg font-bold">{TEXT[phase].title}</h1>
      </div>
      {TEXT[phase].detail && <p className="text-sm text-muted-foreground">{TEXT[phase].detail}</p>}
      {phase === "choose" && (
        <Button size="sm" className="self-start" onPress={choose}>
          Choose screen or window
        </Button>
      )}
    </main>
  )
}
