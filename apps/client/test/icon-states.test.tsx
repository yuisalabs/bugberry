import { describe, expect, test } from "bun:test"
import {
  RiEqualizerFill,
  RiEqualizerLine,
  RiLayoutGridFill,
  RiLayoutGridLine,
  RiLayoutRightFill,
  RiLayoutRightLine,
  type RemixiconComponentType,
} from "@remixicon/react"
import { render, screen } from "@testing-library/react"
import { renderToStaticMarkup } from "react-dom/server"
import { ActiveIcon } from "../src/components/ActiveIcon"
import { DevtoolsToggle } from "../src/components/DevtoolsLayout"
import { LayoutToggle, ReportFilters } from "../src/components/ReportFilters"

/** The shape an icon draws, to tell its line and fill variants apart. */
const shape = (Icon: RemixiconComponentType) => renderToStaticMarkup(<Icon />).match(/ d="([^"]+)"/)?.[1] ?? "none"
const draws = (element: Element, Icon: RemixiconComponentType) => element.innerHTML.includes(shape(Icon))

describe("icons are line, and fill when what they stand for is on", () => {
  test("ActiveIcon picks the variant", () => {
    const { container, rerender } = render(<ActiveIcon active={false} line={RiLayoutGridLine} fill={RiLayoutGridFill} className="size-4" />)
    expect(draws(container, RiLayoutGridLine)).toBe(true)
    rerender(<ActiveIcon active line={RiLayoutGridLine} fill={RiLayoutGridFill} className="size-4" />)
    expect(draws(container, RiLayoutGridFill)).toBe(true)
    expect(container.querySelector("svg")?.getAttribute("class")).toContain("size-4")
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true")
  })

  test("the chosen layout's button is filled", () => {
    const { rerender } = render(<LayoutToggle layout="grid" onLayout={() => {}} />)
    expect(draws(screen.getByRole("radio", { name: "Grid view" }), RiLayoutGridFill)).toBe(true)
    rerender(<LayoutToggle layout="list" onLayout={() => {}} />)
    expect(draws(screen.getByRole("radio", { name: "Grid view" }), RiLayoutGridLine)).toBe(true)
  })

  test("the DevTools button is filled while the panel shows", () => {
    const { rerender } = render(<DevtoolsToggle open onToggle={() => {}} />)
    expect(draws(screen.getByRole("button", { name: "Hide DevTools" }), RiLayoutRightFill)).toBe(true)
    rerender(<DevtoolsToggle open={false} onToggle={() => {}} />)
    expect(draws(screen.getByRole("button", { name: "Show DevTools" }), RiLayoutRightLine)).toBe(true)
  })

  test("More filters is filled while one of its filters is set", () => {
    const { rerender } = render(<ReportFilters search={{}} members={[]} onChange={() => {}} />)
    expect(draws(screen.getByRole("button", { name: /More filters/ }), RiEqualizerLine)).toBe(true)
    rerender(<ReportFilters search={{ priority: ["high"] }} members={[]} onChange={() => {}} />)
    expect(draws(screen.getByRole("button", { name: /More filters/ }), RiEqualizerFill)).toBe(true)
    rerender(<ReportFilters search={{ assigneeId: "u1" }} members={[]} onChange={() => {}} />)
    expect(draws(screen.getByRole("button", { name: /More filters/ }), RiEqualizerFill)).toBe(true)
  })
})
