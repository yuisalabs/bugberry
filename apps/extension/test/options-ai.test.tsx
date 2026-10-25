import { describe, expect, mock, test } from "bun:test"
import type { ProviderConfig } from "@bugberry/ai-write"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { AiKeySection } from "../entrypoints/options/AiKeySection"
import type { AiKeyStorage } from "../lib/ai-key"
import type { AiTestReply } from "../lib/ai-relay"

const saved: ProviderConfig = { preset: "custom", baseUrl: "http://localhost:11434/v1", model: "q", apiKey: "k-1234abcd" }

function storage(initial: ProviderConfig | null) {
  let value = initial
  return {
    get: mock(async () => value),
    set: mock(async (next: ProviderConfig) => {
      value = next
    }),
    clear: mock(async () => {
      value = null
    }),
  } satisfies AiKeyStorage
}

const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

async function show(store: ReturnType<typeof storage>, check = mock(async (provider: ProviderConfig): Promise<AiTestReply> => ({ ok: true, provider }))) {
  await act(async () => {
    render(<AiKeySection storage={store} test={check} disabled={false} />)
  })
  return check
}

describe("the personal AI key", () => {
  test("saving tests the key first and stores what the test returned", async () => {
    const store = storage(null)
    const check = await show(store)
    fireEvent.click(screen.getByRole("radio", { name: "OpenAI-compatible" }))
    type("Base URL", "http://localhost:11434/v1")
    type("Model", "q")
    type("API key", "k-1234abcd")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(check).toHaveBeenCalledWith({ preset: "custom", baseUrl: "http://localhost:11434/v1", model: "q", apiKey: "k-1234abcd" })
    expect(store.set).toHaveBeenCalledWith(saved)
    expect(screen.getByText("k-1…abcd")).toBeTruthy()
  })

  test("a failing key is not stored and the reason is shown", async () => {
    const store = storage(null)
    await show(store, mock(async (): Promise<AiTestReply> => ({ ok: false, error: "The AI server didn't answer. Try again." })))
    type("Model", "gpt-4.1-mini")
    type("API key", "sk-1")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(store.set).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe("The AI server didn't answer. Try again.")
  })

  test("a saved key shows its hint and can be removed", async () => {
    const store = storage(saved)
    await show(store)
    expect(screen.getByText("k-1…abcd")).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Remove" })))
    expect(store.clear).toHaveBeenCalled()
    expect(screen.queryByText("k-1…abcd")).toBeNull()
  })

  test("the saved key isn't sent to a new address without typing it again", async () => {
    const store = storage(saved)
    const check = await show(store)
    type("Base URL", "https://elsewhere.test/v1")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(check).not.toHaveBeenCalled()
    expect(screen.getByRole("alert").textContent).toBe("Enter the API key again for a new provider address")
  })

  test("a local server without keys can be saved without an API key", async () => {
    const store = storage(null)
    const check = await show(store)
    fireEvent.click(screen.getByRole("radio", { name: "OpenAI-compatible" }))
    type("Base URL", "http://localhost:11434/v1")
    type("Model", "qwen3")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Test and save" })))
    expect(check).toHaveBeenCalledWith({ preset: "custom", baseUrl: "http://localhost:11434/v1", model: "qwen3", apiKey: "" })
    expect(store.set).toHaveBeenCalled()
  })

  test("says where the key goes", async () => {
    await show(storage(null))
    expect(screen.getByText(/stays in this browser and goes only to your AI provider/)).toBeTruthy()
  })
})
