import { Button } from "@bugberry/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import {
  type RemixiconComponentType,
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiArrowRightUpLine,
  RiEyeOffLine,
  RiPencilLine,
  RiRectangleLine,
  RiText,
} from "@remixicon/react"
import { forwardRef, type PointerEvent, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react"
import {
  annotationsReducer,
  type Color,
  COLORS,
  EMPTY_ANNOTATIONS,
  type Point,
  type Shape,
  type Tool,
} from "../../lib/annotate/annotations"
import { renderAnnotated } from "../../lib/annotate/render"

export interface AnnotationCanvasHandle {
  /** The screenshot with every annotation burned in, as PNG. */
  exportPng(): Promise<Blob>
  /** The current shapes, to keep them with the draft. */
  getShapes(): Shape[]
}

const TOOLS: Array<[Tool, string, RemixiconComponentType]> = [
  ["pen", "Pen", RiPencilLine],
  ["box", "Box", RiRectangleLine],
  ["arrow", "Arrow", RiArrowRightUpLine],
  ["text", "Text", RiText],
  ["blur", "Blur", RiEyeOffLine],
]

const COLOR_NAMES: Record<Color, string> = { "#ef4444": "Red", "#eab308": "Yellow", "#22c55e": "Green", "#111827": "Black" }

export const AnnotationCanvas = forwardRef<
  AnnotationCanvasHandle,
  { image: ImageBitmap; initialShapes: Shape[] }
>(function AnnotationCanvas({ image, initialShapes }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [tool, setTool] = useState<Tool>("box")
  const [color, setColor] = useState<Color>(COLORS[0])
  const [state, dispatch] = useReducer(annotationsReducer, initialShapes, (shapes) =>
    shapes.length > 0 ? { shapes, undone: [] } : EMPTY_ANNOTATIONS,
  )
  const [drawing, setDrawing] = useState<Shape | null>(null)
  /** A text annotation being typed: where it goes on the picture, and the text so far. */
  const [typing, setTyping] = useState<{ at: Point; text: string } | null>(null)
  const size = { width: image.width, height: image.height }

  useEffect(() => {
    const context = canvasRef.current?.getContext("2d", { willReadFrequently: true })
    if (context) renderAnnotated(context, image, size, drawing ? [...state.shapes, drawing] : state.shapes)
  })

  useImperativeHandle(ref, () => ({
    exportPng: () =>
      new Promise<Blob>((resolve, reject) => {
        const canvas = canvasRef.current
        const context = canvas?.getContext("2d")
        if (!canvas || !context) return reject(new Error("Canvas isn't ready"))
        renderAnnotated(context, image, size, state.shapes)
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Couldn't create the PNG"))), "image/png")
      }),
    getShapes: () => state.shapes,
  }))

  const toImagePoint = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * image.width,
      y: ((event.clientY - bounds.top) / bounds.height) * image.height,
    }
  }

  /** Adds what was typed (nothing when it is blank) and closes the box. */
  const finishTyping = () => {
    const text = typing?.text.trim()
    if (typing && text) dispatch({ type: "add", shape: { kind: "text", color, at: typing.at, text } })
    setTyping(null)
  }

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = toImagePoint(event)
    if (tool === "text") {
      // The box opens where the picture was clicked; a click elsewhere first keeps the text being typed.
      event.preventDefault()
      finishTyping()
      setTyping({ at: point, text: "" })
      return
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (tool === "pen") setDrawing({ kind: "pen", color, points: [point] })
    else if (tool === "blur") setDrawing({ kind: "blur", from: point, to: point })
    else setDrawing({ kind: tool, color, from: point, to: point })
  }

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    const point = toImagePoint(event)
    if (drawing.kind === "pen") setDrawing({ ...drawing, points: [...drawing.points, point] })
    else if (drawing.kind !== "text") setDrawing({ ...drawing, to: point })
  }

  const onPointerUp = () => {
    if (drawing) dispatch({ type: "add", shape: drawing })
    setDrawing(null)
  }

  // The picture fills the media area at its own shape; the tools float over its foot.
  return (
    <div className="relative flex h-full min-h-0 w-full items-center justify-center pb-16">
      <div className="relative max-h-full max-w-full">
        <canvas
          ref={canvasRef}
          width={image.width}
          height={image.height}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          // A gesture the browser cancels ends the stroke instead of leaving it hanging.
          onPointerCancel={onPointerUp}
          className={`block h-auto max-h-[min(66vh,48rem)] w-auto max-w-full rounded-lg bg-background shadow-lg ring-1 ring-foreground/10 ${tool === "text" ? "cursor-text" : "cursor-crosshair"}`}
        />
        {typing && (
          // Placed by share of the picture, so it sits where the text will be drawn at any zoom.
          <div
            data-slot="text-annotation"
            className="absolute -translate-y-1/2"
            style={{ left: `${(typing.at.x / image.width) * 100}%`, top: `${(typing.at.y / image.height) * 100}%` }}
          >
            <input
              aria-label="Annotation text"
              // biome-ignore lint/a11y/noAutofocus: the person just clicked the picture to write here
              autoFocus
              value={typing.text}
              onChange={(event) => setTyping({ ...typing, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault()
                  finishTyping()
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  setTyping(null)
                }
              }}
              onBlur={finishTyping}
              placeholder="Type, then Enter"
              className="w-56 rounded-md border-2 bg-background px-2 py-1 text-sm text-foreground shadow-lg outline-hidden placeholder:text-muted-foreground"
              style={{ borderColor: color }}
            />
          </div>
        )}
      </div>
      <div
        role="toolbar"
        aria-label="Annotation tools"
        className="absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-overlay px-2 py-1.5 shadow-lg ring-1 ring-foreground/10"
      >
        <ToggleGroup
          aria-label="Color"
          size="sq-sm"
          disallowEmptySelection
          selectedKeys={[color]}
          onSelectionChange={(keys) => {
            const [key] = keys
            const next = COLORS.find((value) => value === key)
            if (next) setColor(next)
          }}
          className="inset-ring-0 [--toggle-selected-bg:var(--color-secondary)]"
        >
          {COLORS.map((value) => (
            <ToggleGroupItem key={value} id={value} aria-label={COLOR_NAMES[value]}>
              <span aria-hidden className="size-4.5 rounded-full ring-1 ring-foreground/15" style={{ backgroundColor: value }} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        <ToggleGroup
          aria-label="Tool"
          size="sq-sm"
          disallowEmptySelection
          selectedKeys={[tool]}
          onSelectionChange={(keys) => {
            const [key] = keys
            const next = TOOLS.find(([value]) => value === key)
            if (next) setTool(next[0])
          }}
          className="inset-ring-0 [--toggle-selected-bg:color-mix(in_oklab,var(--color-primary)_14%,transparent)] [--toggle-selected-foreground:var(--color-primary)]"
        >
          {TOOLS.map(([value, label, Icon]) => (
            <ToggleGroupItem key={value} id={value} aria-label={label}>
              <Icon aria-hidden />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span aria-hidden className="mx-1 h-6 w-px bg-border" />
        <Button intent="plain" size="sq-sm" aria-label="Undo" onPress={() => dispatch({ type: "undo" })} isDisabled={state.shapes.length === 0}>
          <RiArrowGoBackLine aria-hidden />
        </Button>
        <Button intent="plain" size="sq-sm" aria-label="Redo" onPress={() => dispatch({ type: "redo" })} isDisabled={state.undone.length === 0}>
          <RiArrowGoForwardLine aria-hidden />
        </Button>
      </div>
    </div>
  )
})
