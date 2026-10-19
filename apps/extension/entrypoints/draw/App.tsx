import { useEffect, useRef, useState } from "react"
import { browser } from "wxt/browser"
import type { BarRequest } from "../../lib/messages"
import { type Stroke, visibleStrokes } from "../../lib/strokes"
import type { DrawSignal } from "../recorder-bar/App"
import type { DrawTool } from "../recorder-bar/BarView"
import { NotesLayer, type NotesLayerHandle } from "./NotesLayer"

const COLOR = "#d61f69"
const WIDTH = 4

const ask = (request: BarRequest) => browser.runtime.sendMessage(request).catch(() => undefined)

function paint(context: CanvasRenderingContext2D, strokes: readonly Stroke[], now: number) {
  context.clearRect(0, 0, context.canvas.width, context.canvas.height)
  for (const { stroke, opacity } of visibleStrokes(strokes, now)) {
    context.globalAlpha = opacity
    context.strokeStyle = COLOR
    context.lineWidth = WIDTH
    context.lineCap = "round"
    context.lineJoin = "round"
    context.beginPath()
    if (stroke.tool === "pen") {
      stroke.points.forEach(([x, y], index) => (index === 0 ? context.moveTo(x, y) : context.lineTo(x, y)))
    } else if (stroke.tool === "circle") {
      const [x1, y1] = stroke.from
      const [x2, y2] = stroke.to
      context.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2)
    } else {
      const [x1, y1] = stroke.from
      const [x2, y2] = stroke.to
      const angle = Math.atan2(y2 - y1, x2 - x1)
      context.moveTo(x1, y1)
      context.lineTo(x2, y2)
      for (const side of [-1, 1]) {
        context.moveTo(x2, y2)
        context.lineTo(x2 - 16 * Math.cos(angle + side * 0.45), y2 - 16 * Math.sin(angle + side * 0.45))
      }
    }
    context.stroke()
  }
  context.globalAlpha = 1
}

/** The drawing layer over the recorded page: fading strokes and numbered notes, both seen in the video. */
export function App({ session }: { session: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const notes = useRef<NotesLayerHandle>(null)
  const strokes = useRef<Stroke[]>([])
  const current = useRef<Stroke | null>(null)
  const frame = useRef<number | null>(null)
  const [tool, setTool] = useState<DrawTool>("pen")
  const [drawing, setDrawing] = useState(false)
  const [author, setAuthor] = useState("")

  // Repaints only while something is still on screen.
  const repaint = () => {
    if (frame.current !== null) return
    const step = () => {
      const context = canvas.current?.getContext("2d")
      if (!context) return
      const all = current.current ? [...strokes.current, current.current] : strokes.current
      paint(context, all, Date.now())
      strokes.current = strokes.current.filter((stroke) => visibleStrokes([stroke], Date.now()).length > 0)
      frame.current = all.length > 0 ? requestAnimationFrame(step) : null
    }
    frame.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    const channel = new BroadcastChannel(`bugberry-rec-${session}`)
    channel.onmessage = (event: MessageEvent<DrawSignal>) => {
      const signal = event.data
      if ("exitDraw" in signal) return
      if ("clear" in signal) {
        strokes.current = []
        notes.current?.clear()
        repaint()
      } else {
        setTool(signal.tool)
        setDrawing(signal.drawing)
      }
    }
    void ask({ type: "bugberry:me-name" }).then((name) => setAuthor(typeof name === "string" ? name : ""))
    const size = () => {
      if (!canvas.current) return
      canvas.current.width = window.innerWidth
      canvas.current.height = window.innerHeight
    }
    size()
    window.addEventListener("resize", size)
    // Esc leaves Draw; an Esc a note's input already used (dropping the note) doesn't.
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) channel.postMessage({ exitDraw: true } satisfies DrawSignal)
    }
    window.addEventListener("keydown", onKey)
    return () => {
      channel.close()
      window.removeEventListener("resize", size)
      window.removeEventListener("keydown", onKey)
    }
  }, [session])

  const shapes = drawing && tool !== "note"
  const point = (event: React.PointerEvent): [number, number] => [event.clientX, event.clientY]

  return (
    <>
      <canvas
        ref={canvas}
        className="fixed inset-0"
        style={{ pointerEvents: shapes ? "auto" : "none", cursor: shapes ? "crosshair" : "default" }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          const at = Date.now()
          current.current = tool === "pen" ? { tool, points: [point(event)], at } : { tool: tool === "circle" ? "circle" : "arrow", from: point(event), to: point(event), at }
          repaint()
        }}
        onPointerMove={(event) => {
          const stroke = current.current
          if (!stroke) return
          // The stroke's life starts when it is finished, so a slow drawing doesn't fade while drawn.
          if (stroke.tool === "pen") current.current = { ...stroke, points: [...stroke.points, point(event)], at: Date.now() }
          else current.current = { ...stroke, to: point(event), at: Date.now() }
        }}
        onPointerUp={() => {
          if (current.current) strokes.current = [...strokes.current, { ...current.current, at: Date.now() }]
          current.current = null
          repaint()
        }}
      />
      <NotesLayer
        ref={notes}
        active={drawing && tool === "note"}
        author={author}
        addNote={async (text) => {
          const saved = (await ask({ type: "bugberry:record-note", text, session })) as { n?: unknown } | null | undefined
          return typeof saved?.n === "number" ? { n: saved.n } : null
        }}
      />
    </>
  )
}
