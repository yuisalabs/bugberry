import { describe, expect, mock, test } from "bun:test"
import { renderHook, waitFor } from "@testing-library/react"
import { useSlugCheck } from "../src/lib/workspace-slug"

describe("useSlugCheck", () => {
  test("slug status from the server", async () => {
    const check = mock(async () => ({ slug: "javan-qa-2", available: true, reason: null }))
    const { result } = renderHook(() => useSlugCheck({ name: "Javan QA", slug: "", edited: false }, check))
    await waitFor(() => expect(result.current.status).toBe("available"), { timeout: 2000 })
    expect(result.current.slug).toBe("javan-qa-2")
    expect(check).toHaveBeenCalledWith({ name: "Javan QA" })
  })

  test("an answer is asked for once, even when the check function is a new one on every render", async () => {
    let calls = 0
    const { result } = renderHook(() =>
      useSlugCheck({ name: "Javan QA", slug: "", edited: false }, async () => {
        calls += 1
        return { slug: "javan-qa", available: true, reason: null }
      }),
    )
    await waitFor(() => expect(result.current.status).toBe("available"), { timeout: 2000 })
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(calls).toBe(1)
  })

  test("a typed slug is checked as typed, and rule breaks never reach the server", async () => {
    const check = mock(async () => ({ slug: "javan-qa", available: false, reason: "taken" as const }))
    const { result, rerender } = renderHook((props: { slug: string }) => useSlugCheck({ name: "X", slug: props.slug, edited: true }, check), {
      initialProps: { slug: "api" },
    })
    expect(result.current.status).toBe("reserved")
    rerender({ slug: "a" })
    expect(result.current.status).toBe("invalid")
    expect(check).not.toHaveBeenCalled()
    rerender({ slug: "javan-qa" })
    await waitFor(() => expect(result.current.status).toBe("taken"), { timeout: 2000 })
    expect(check).toHaveBeenCalledWith({ slug: "javan-qa" })
  })
})
