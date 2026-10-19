export type Tool = "pen" | "box" | "arrow" | "text" | "blur"

export const COLORS = ["#ef4444", "#eab308", "#22c55e", "#111827"] as const
export type Color = (typeof COLORS)[number]

export interface Point {
  x: number
  y: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type Shape =
  | { kind: "pen"; color: Color; points: Point[] }
  | { kind: "box" | "arrow"; color: Color; from: Point; to: Point }
  | { kind: "text"; color: Color; at: Point; text: string }
  | { kind: "blur"; from: Point; to: Point }

export interface AnnotationState {
  shapes: Shape[]
  undone: Shape[]
}

export type AnnotationAction = { type: "add"; shape: Shape } | { type: "undo" } | { type: "redo" } | { type: "clear" }

export const EMPTY_ANNOTATIONS: AnnotationState = { shapes: [], undone: [] }

const MIN_SIZE = 4

export function normalizeRect(from: Point, to: Point): Rect {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}

/** Filters out clicks that were not meant to draw anything. */
export function isMeaningful(shape: Shape): boolean {
  switch (shape.kind) {
    case "pen":
      return shape.points.length >= 2
    case "text":
      return shape.text.trim().length > 0
    case "arrow":
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) >= MIN_SIZE
    case "box":
    case "blur": {
      const rect = normalizeRect(shape.from, shape.to)
      return rect.width >= MIN_SIZE && rect.height >= MIN_SIZE
    }
  }
}

export function annotationsReducer(state: AnnotationState, action: AnnotationAction): AnnotationState {
  switch (action.type) {
    case "add":
      return isMeaningful(action.shape) ? { shapes: [...state.shapes, action.shape], undone: [] } : state
    case "undo": {
      const last = state.shapes.at(-1)
      return last ? { shapes: state.shapes.slice(0, -1), undone: [...state.undone, last] } : state
    }
    case "redo": {
      const next = state.undone.at(-1)
      return next ? { shapes: [...state.shapes, next], undone: state.undone.slice(0, -1) } : state
    }
    case "clear":
      return { shapes: [], undone: [] }
  }
}
