import { useEffect, useRef, useState } from "react"
import { browser } from "wxt/browser"
import { type BarDragMessage, startBarDrag } from "../../lib/recording/bar-drag"
import type { BarRequest } from "../../lib/shared/messages"
import type { BarStatus } from "../../lib/recording/recording-state"
import { BarView, type DrawTool } from "./BarView"

const POLL_MS = 1000
const QUIET: BarStatus = { recording: true, elapsedMs: 0, paused: false, errors: 0, micOn: false, micAvailable: false, maxMs: null }

/** What the bar tells the drawing layer of the same recording. */
export type DrawSignal = { tool: DrawTool; drawing: boolean } | { clear: true } | { exitDraw: true }

const send = (request: BarRequest) => browser.runtime.sendMessage(request).catch(() => undefined)

/** A status answer, or null for anything else (a refusal, no answer): those never reach the clock. */
export function barStatusFrom(value: unknown): BarStatus | null {
  const status = value as Partial<BarStatus> | null | undefined
  return typeof status?.elapsedMs === "number" && typeof status.recording === "boolean" ? (status as BarStatus) : null
}
/** Only sizes and the drawing switch go to the page layer; nothing about the report does. */
const tellPage = (message: ({ bugberry: "bar-size" | "drawing" | "escape" } & Record<string, unknown>) | BarDragMessage) =>
  window.parent.postMessage(message, "*")

/** What the iframe is sized to: the bar's content, which is fixed in the frame's corner (the body has no size of its own). */
export function barContent(doc: Document): Element {
  return doc.querySelector("[data-bar-content]") ?? doc.body
}

/** The Recording Bar page, shown in an iframe on the recorded tab. */
export function App({ session }: { session: string }) {
  const [status, setStatus] = useState<BarStatus>(QUIET)
  const [drawing, setDrawing] = useState(false)
  const [tool, setTool] = useState<DrawTool>("pen")
  const channel = useRef<BroadcastChannel | null>(null)

  useEffect(() => {
    channel.current = new BroadcastChannel(`bugberry-rec-${session}`)
    // Esc on the drawing layer (it has the focus while drawing) leaves Draw here.
    channel.current.onmessage = (event: MessageEvent<DrawSignal>) => {
      if ("exitDraw" in event.data) leaveDraw.current()
    }
    let alive = true
    const poll = async () => {
      const value = barStatusFrom(await send({ type: "bugberry:bar-status", session }))
      if (alive && value) setStatus(value)
    }
    void poll()
    const timer = setInterval(() => void poll(), POLL_MS)
    // The page layer sizes the iframe to the bar: toolbars and confirmations open above it.
    const content = barContent(document)
    const observer = new ResizeObserver(() => {
      const box = content.getBoundingClientRect()
      tellPage({ bugberry: "bar-size", width: Math.ceil(box.width), height: Math.ceil(box.height) })
    })
    observer.observe(content)
    return () => {
      alive = false
      clearInterval(timer)
      observer.disconnect()
      channel.current?.close()
    }
  }, [session])

  const signal = (message: DrawSignal) => channel.current?.postMessage(message)
  const changeDrawing = (on: boolean) => {
    setDrawing(on)
    signal({ tool, drawing: on })
    tellPage({ bugberry: "drawing", on })
  }
  const leaveDraw = useRef(() => {})
  leaveDraw.current = () => changeDrawing(false)
  // An answer arrives at the next poll; showing it at once keeps the buttons from feeling slow.
  const act = (request: BarRequest, optimistic: Partial<BarStatus> = {}) => {
    setStatus((current) => ({ ...current, ...optimistic }))
    void send(request)
  }

  return (
    <BarView
      status={status}
      drawing={drawing}
      tool={tool}
      onPause={() => act({ type: "bugberry:record-pause", session }, { paused: true })}
      onResume={() => act({ type: "bugberry:record-resume", session }, { paused: false })}
      onMic={(on) => act({ type: "bugberry:record-mic", on, session }, { micOn: on })}
      onDraw={changeDrawing}
      onTool={(next) => {
        setTool(next)
        signal({ tool: next, drawing })
      }}
      onClear={() => signal({ clear: true })}
      onRestart={() => act({ type: "bugberry:record-restart", session }, { elapsedMs: 0, paused: false, errors: 0 })}
      onDiscard={() => act({ type: "bugberry:record-discard", session })}
      onStop={() => act({ type: "bugberry:bar-stop", session })}
      onEscape={() => tellPage({ bugberry: "escape" })}
      onDragStart={(event) => startBarDrag(event.nativeEvent, event.currentTarget, { post: tellPage })}
    />
  )
}
