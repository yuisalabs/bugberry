import { Button } from "@bugberry/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@bugberry/ui/toggle-group"
import { forwardRef, type PointerEvent, useEffect, useImperativeHandle, useReducer, useRef, useState } from "react"
import {
  annotationsReducer,
  type Color,
  COLORS,
  EMPTY_ANNOTATIONS,
  type Point,
  type Shape,
  type Tool,
} from "../../lib/annotations"
import { renderAnnotated } from "../../lib/render"

export interface AnnotationCanvasHandle {
  /** The screenshot with every annotation burned in, as PNG. */
  exportPng(): Promise<Blob>
  /** The current shapes, to keep them with the draft. */
  getShapes(): Shape[]
}

const TOOLS: Array<[Tool, string]> = [
  ["pen", "Pen"],
  ["box", "Box"],
  ["arrow", "Arrow"],
  ["text", "Text"],
  ["blur", "Blur"],
]

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

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = toImagePoint(event)
    if (tool === "text") {
      const text = window.prompt("Annotation text")
      if (text) dispatch({ type: "add", shape: { kind: "text", color, at: point, text } })
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

  return (
    <div className="flex flex-col">
      <div role="toolbar" aria-label="Annotation tools" className="flex flex-wrap items-center gap-2 border-b border-border bg-muted px-2 py-1.5">
        <ToggleGroup
          aria-label="Tool"
          size="xs"
          disallowEmptySelection
          selectedKeys={[tool]}
          onSelectionChange={(keys) => {
            const [key] = keys
            const next = TOOLS.find(([value]) => value === key)
            if (next) setTool(next[0])
          }}
          className="bg-background"
        >
          {TOOLS.map(([value, label]) => (
            <ToggleGroupItem key={value} id={value}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          aria-label="Color"
          size="sq-xs"
          disallowEmptySelection
          selectedKeys={[color]}
          onSelectionChange={(keys) => {
            const [key] = keys
            const next = COLORS.find((value) => value === key)
            if (next) setColor(next)
          }}
          className="bg-background"
        >
          {COLORS.map((value) => (
            <ToggleGroupItem key={value} id={value} aria-label={`Color ${value}`}>
              <span aria-hidden className="size-4 rounded-sm ring-1 ring-foreground/15" style={{ backgroundColor: value }} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="flex gap-1">
          <Button intent="plain" size="xs" onPress={() => dispatch({ type: "undo" })} isDisabled={state.shapes.length === 0}>
            Undo
          </Button>
          <Button intent="plain" size="xs" onPress={() => dispatch({ type: "redo" })} isDisabled={state.undone.length === 0}>
            Redo
          </Button>
        </span>
      </div>
      <canvas
        ref={canvasRef}
        width={image.width}
        height={image.height}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        // A gesture the browser cancels ends the stroke instead of leaving it hanging.
        onPointerCancel={onPointerUp}
        className="h-auto w-full cursor-crosshair bg-background"
      />
    </div>
  )
})
