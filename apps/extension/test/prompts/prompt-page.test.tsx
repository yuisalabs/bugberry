import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act, render, screen } from "@testing-library/react"
import { useRef, useState } from "react"
import { useUnobscured } from "../../lib/prompts/prompt-page"

let visible = true
let observed: Element[] = []
const original = globalThis.IntersectionObserver

beforeEach(() => {
  observed = []
  globalThis.IntersectionObserver = class {
    constructor(private readonly callback: (entries: Array<{ isVisible: boolean }>) => void) {}
    observe(element: Element) {
      observed.push(element)
      this.callback([{ isVisible: visible }])
    }
    disconnect() {}
  } as unknown as typeof IntersectionObserver
})

afterEach(() => {
  globalThis.IntersectionObserver = original
})

/** Like the confirmation page: nothing renders until its ticket arrives, so the buttons come a render later. */
function LatePrompt({ ready }: { ready: boolean }) {
  const actions = useRef<HTMLDivElement>(null)
  const seen = useUnobscured(actions, true)
  if (!ready) return null
  return (
    <div ref={actions}>
      <button type="button" disabled={!seen}>
        Use this server
      </button>
    </div>
  )
}

function Toggle() {
  const [ready, setReady] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setReady(true)}>
        ticket
      </button>
      <LatePrompt ready={ready} />
    </>
  )
}

describe("useUnobscured", () => {
  test("watches buttons that render after the first render", async () => {
    visible = true
    render(<Toggle />)
    await act(async () => screen.getByRole("button", { name: "ticket" }).click())
    expect(observed).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Use this server" }).hasAttribute("disabled")).toBe(false)
  })

  test("keeps late buttons off while something covers them", async () => {
    visible = false
    render(<Toggle />)
    await act(async () => screen.getByRole("button", { name: "ticket" }).click())
    expect(observed).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Use this server" }).hasAttribute("disabled")).toBe(true)
  })
})
