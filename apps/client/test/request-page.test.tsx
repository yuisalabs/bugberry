import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { RequestView, type RequestViewProps } from "../src/features/requests/RequestView"

const link = { workspaceName: "Acme QA", requesterName: "Ana", note: "The checkout bug, please", pageUrl: "https://shop.test/cart", maxSeconds: 300, maxBytes: 99_614_720 }

function view(props: Partial<RequestViewProps> & Pick<RequestViewProps, "state">) {
  const all: RequestViewProps = {
    link,
    support: "video",
    mic: false,
    elapsedMs: 0,
    capture: null,
    form: { name: "", email: "", description: "", pageUrl: link.pageUrl },
    progress: 0,
    sendError: null,
    canSendAnother: false,
    onMic: mock(),
    onRecord: mock(),
    onScreenshot: mock(),
    onStop: mock(),
    onForm: mock(),
    onSend: mock(),
    onDiscard: mock(),
    onAnother: mock(),
    ...props,
  }
  render(<RequestView {...all} />)
  return all
}

const video = { kind: "video" as const, blob: new Blob([new Uint8Array(4)], { type: "video/webm" }), url: "blob:video", durationMs: 4000 }

describe("the request page", () => {
  test("intro: who asks, their note, and what the browser will ask", () => {
    const props = view({ state: "intro" })
    expect(screen.getByText("Ana from Acme QA asked you for a recording")).toBeTruthy()
    expect(screen.getByText("The checkout bug, please")).toBeTruthy()
    expect(
      screen.getByText(
        "Your browser will ask what to share: a tab, a window or the whole screen. Only what you pick is recorded, and nothing is sent until you press Send.",
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Record my screen" }))
    expect(props.onRecord).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Take a screenshot" }))
    expect(props.onScreenshot).toHaveBeenCalled()
  })

  test("a dead link says so and names nobody", () => {
    view({ state: "unavailable", link: null })
    expect(screen.getByText("This link doesn't take recordings. Ask the person who sent it for a new one.")).toBeTruthy()
    expect(screen.queryByText(/Acme/)).toBeNull()
  })

  test("a phone or an old browser is told to use a computer", () => {
    view({ state: "unsupported", support: "none" })
    expect(screen.getByText("Recording your screen needs a computer. Open this link in Chrome, Edge or Firefox on a laptop or desktop.")).toBeTruthy()
  })

  test("a browser without WebM offers the screenshot only", () => {
    view({ state: "intro", support: "screenshot" })
    expect(screen.queryByRole("button", { name: "Record my screen" })).toBeNull()
    expect(screen.getByRole("button", { name: "Take a screenshot" })).toBeTruthy()
    expect(screen.getByText("This browser can't record video. You can send a screenshot.")).toBeTruthy()
  })

  test("review: Send needs a name; the page address is filled from the link", () => {
    const props = view({ state: "review", capture: video })
    const send = screen.getByRole("button", { name: "Send" })
    expect(send.hasAttribute("disabled") || send.getAttribute("aria-disabled") === "true" || send.hasAttribute("data-disabled")).toBe(true)
    expect((screen.getByLabelText("Page address") as HTMLInputElement).value).toBe("https://shop.test/cart")
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Budi" } })
    expect(props.onForm).toHaveBeenCalledWith({ name: "Budi" })
  })

  test("review with a name sends", () => {
    const props = view({ state: "review", capture: video, form: { name: "Budi", email: "", description: "", pageUrl: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(props.onSend).toHaveBeenCalled()
  })

  test("recording shows the time left and stops at the limit", () => {
    const props = view({ state: "recording", elapsedMs: 48_000 })
    expect(screen.getByText("4:12 left")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }))
    expect(props.onStop).toHaveBeenCalled()
  })

  test("sending shows how far it got", () => {
    view({ state: "sending", capture: video, progress: 0.42 })
    expect(screen.getByText("Sending… 42%")).toBeTruthy()
  })

  test("closed: the recording can be saved as a file", () => {
    view({ state: "closed", capture: video })
    expect(screen.getByRole("link", { name: "Save the recording" }).getAttribute("download")).toBe("recording.webm")
  })

  test("sent: thanks, and Send another while the link has uses left", () => {
    const props = view({ state: "sent", canSendAnother: true })
    expect(screen.getByText("Sent. Ana will find it in BugBerry.")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Send another" }))
    expect(props.onAnother).toHaveBeenCalled()
  })

  test("sent, with no uses left: no Send another", () => {
    view({ state: "sent", canSendAnother: false })
    expect(screen.queryByRole("button", { name: "Send another" })).toBeNull()
  })
})
