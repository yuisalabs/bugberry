import { expect, test } from "bun:test"
import { STROKE_LIFE_MS, type Stroke, visibleStrokes } from "../../lib/annotate/strokes"

const pen = (at: number): Stroke => ({ tool: "pen", points: [[0, 0], [10, 10]], at })

test("strokes stay, fade over their last half second, then go", () => {
  expect(STROKE_LIFE_MS).toBe(3000)
  expect(visibleStrokes([pen(0)], 0)).toEqual([{ stroke: pen(0), opacity: 1 }])
  expect(visibleStrokes([pen(0)], 2500)[0]?.opacity).toBe(1)
  expect(visibleStrokes([pen(0)], 2750)[0]?.opacity).toBeCloseTo(0.5)
  expect(visibleStrokes([pen(0)], 3000)).toEqual([])
  expect(visibleStrokes([pen(0), pen(2000)], 3500).map((entry) => entry.stroke.at)).toEqual([2000])
})
