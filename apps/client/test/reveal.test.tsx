import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { act, render, screen, waitFor } from "@testing-library/react"
import { LandingView } from "../src/pages/landing/LandingView"
import { type RevealOptions, useReveal } from "../src/pages/landing/useReveal"

/** Stands in for the browser's IntersectionObserver; `scrollIntoView()` says the newest target came into view. */
class FakeObserver {
  static all: FakeObserver[] = []
  targets: Element[] = []
  live = true
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(target: Element) {
    this.targets.push(target)
  }
  unobserve() {}
  disconnect() {
    this.live = false
  }
  takeRecords() {
    return []
  }
}
function enter(visible = true) {
  const observer = FakeObserver.all.at(-1)
  const target = observer?.targets[0]
  if (!observer || !target) throw new Error("nothing is watched")
  act(() => observer.callback([{ isIntersecting: visible, target } as IntersectionObserverEntry], observer as never))
}

const original = globalThis.IntersectionObserver
beforeEach(() => {
  FakeObserver.all = []
  globalThis.IntersectionObserver = FakeObserver as never
})
afterEach(() => {
  globalThis.IntersectionObserver = original
})

function Probe(options: RevealOptions) {
  return <p {...useReveal(options)}>Hello</p>
}

describe("useReveal", () => {
  test("on scroll: hidden until it comes into view, then shown for good", () => {
    render(<Probe variant="up" delay={120} />)
    const element = screen.getByText("Hello")
    expect(element.getAttribute("data-reveal")).toBe("up")
    expect(element.style.getPropertyValue("--reveal-delay")).toBe("120ms")
    expect(element.hasAttribute("data-shown")).toBe(false)
    enter(false)
    expect(element.hasAttribute("data-shown")).toBe(false)
    enter()
    expect(element.hasAttribute("data-shown")).toBe(true)
    expect(FakeObserver.all.at(-1)?.live).toBe(false)
  })

  test("on first show: shown right after the page draws, without waiting for a scroll", async () => {
    render(<Probe variant="blur" immediate />)
    await waitFor(() => expect(screen.getByText("Hello").hasAttribute("data-shown")).toBe(true))
    expect(FakeObserver.all).toHaveLength(0)
  })

  test("on first show it still appears when frames are held back (a tab opened in the background)", async () => {
    const raf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (() => 0) as never
    try {
      render(<Probe variant="blur" immediate />)
      await waitFor(() => expect(screen.getByText("Hello").hasAttribute("data-shown")).toBe(true), { timeout: 1500 })
    } finally {
      globalThis.requestAnimationFrame = raf
    }
  })

  test("a browser that cannot watch the scroll shows everything at once", () => {
    globalThis.IntersectionObserver = undefined as never
    render(<Probe variant="up" />)
    expect(screen.getByText("Hello").hasAttribute("data-shown")).toBe(true)
  })
})

describe("the landing page's motion", () => {
  test("the hero plays on first show, in order; the sections wait for the scroll", async () => {
    render(<LandingView signedIn={false} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Stop describing bugs. Show them.")
    const delays = (selector: string) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element) => Number.parseInt(element.style.getPropertyValue("--reveal-delay"), 10))
    const hero = delays("header[data-reveal], h1 [data-reveal], main > section:first-child [data-reveal]")
    expect(hero.length).toBeGreaterThanOrEqual(5)
    expect([...hero].sort((a, b) => a - b)).toEqual(hero)
    await waitFor(() => expect(document.querySelectorAll("h1 [data-shown]")).toHaveLength(2))
    // The three steps and the four cards each reveal on their own, one after another.
    expect(delays("#how-it-works li[data-reveal]")).toEqual([0, 120, 240])
    expect(document.querySelectorAll("#features .grid > [data-reveal]")).toHaveLength(4)
    expect(document.querySelector("#how-it-works li[data-shown]")).toBeNull()
  })

  test("people who asked for less motion see it all still: every rule sits inside a no-preference query", () => {
    const css = readFileSync(join(import.meta.dir, "..", "src", "styles.css"), "utf8")
    const block = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"))
    expect(block).toContain("[data-reveal]")
    expect(css.slice(0, css.indexOf("@media (prefers-reduced-motion: no-preference)"))).not.toContain("[data-reveal]")
  })
})
