import { describe, expect, test } from "bun:test"
import { act, render, screen } from "@testing-library/react"
import { useNow } from "../src/hooks/useNow"

function Clock({ every }: { every: number }) {
  const now = useNow(every)
  return <p>{now}</p>
}

describe("useNow", () => {
  test("ticks on its own, so relative times move while the page stays open", async () => {
    render(<Clock every={20} />)
    const first = Number(screen.getByRole("paragraph").textContent)
    await act(() => Bun.sleep(60))
    expect(Number(screen.getByRole("paragraph").textContent)).toBeGreaterThan(first)
  })
})
