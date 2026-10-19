import { describe, expect, test } from "bun:test"
import { annotationsReducer, EMPTY_ANNOTATIONS, isMeaningful, normalizeRect, type Shape } from "../lib/annotations"

const box: Shape = { kind: "box", color: "#ef4444", from: { x: 10, y: 10 }, to: { x: 60, y: 40 } }
const text: Shape = { kind: "text", color: "#111827", at: { x: 5, y: 5 }, text: "Di sini" }

describe("annotationsReducer", () => {
  test("adds, undoes and redoes shapes", () => {
    let state = annotationsReducer(EMPTY_ANNOTATIONS, { type: "add", shape: box })
    state = annotationsReducer(state, { type: "add", shape: text })
    state = annotationsReducer(state, { type: "undo" })
    expect(state.shapes).toEqual([box])
    state = annotationsReducer(state, { type: "redo" })
    expect(state.shapes).toEqual([box, text])
  })

  test("a new shape clears the redo history", () => {
    let state = annotationsReducer(EMPTY_ANNOTATIONS, { type: "add", shape: box })
    state = annotationsReducer(state, { type: "undo" })
    state = annotationsReducer(state, { type: "add", shape: text })
    expect(annotationsReducer(state, { type: "redo" }).shapes).toEqual([text])
  })

  test("ignores accidental shapes and undo/redo with nothing to do", () => {
    const tiny: Shape = { kind: "blur", from: { x: 1, y: 1 }, to: { x: 2, y: 2 } }
    expect(annotationsReducer(EMPTY_ANNOTATIONS, { type: "add", shape: tiny })).toBe(EMPTY_ANNOTATIONS)
    expect(annotationsReducer(EMPTY_ANNOTATIONS, { type: "undo" })).toBe(EMPTY_ANNOTATIONS)
    expect(annotationsReducer(EMPTY_ANNOTATIONS, { type: "redo" })).toBe(EMPTY_ANNOTATIONS)
  })

  test("clear removes everything", () => {
    const state = annotationsReducer(annotationsReducer(EMPTY_ANNOTATIONS, { type: "add", shape: box }), { type: "clear" })
    expect(state).toEqual({ shapes: [], undone: [] })
  })
})

describe("helpers", () => {
  test("normalizeRect works in any drag direction", () => {
    expect(normalizeRect({ x: 50, y: 40 }, { x: 10, y: 10 })).toEqual({ x: 10, y: 10, width: 40, height: 30 })
  })

  test("isMeaningful rejects empty pen strokes and text", () => {
    expect(isMeaningful({ kind: "pen", color: "#ef4444", points: [{ x: 1, y: 1 }] })).toBe(false)
    expect(isMeaningful({ ...text, text: "   " })).toBe(false)
    expect(isMeaningful(box)).toBe(true)
  })
})
