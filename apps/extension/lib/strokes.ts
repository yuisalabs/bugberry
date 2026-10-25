/** A stroke is gone this long after it was drawn, like a laser pointer. */
export const STROKE_LIFE_MS = 3000
/** A note has text to read, so it stays a little longer, then fades the same way. */
export const NOTE_LIFE_MS = 5000
export const FADE_MS = 500

type Point = [number, number]

export type Stroke =
  | { tool: "pen"; points: Point[]; at: number }
  | { tool: "arrow" | "circle"; from: Point; to: Point; at: number }

/** The strokes still on screen at `now`, each with its opacity: full, then fading over the last half second. */
export function visibleStrokes(strokes: readonly Stroke[], now: number): Array<{ stroke: Stroke; opacity: number }> {
  return strokes.flatMap((stroke) => {
    const left = STROKE_LIFE_MS - (now - stroke.at)
    if (left <= 0) return []
    return [{ stroke, opacity: Math.min(1, left / FADE_MS) }]
  })
}
