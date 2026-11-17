import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { ApiError } from "@bugberry/shared"
import { warnBeforeLeaving } from "../src/features/requests/leave-warning"
import { captureFailure, lookupFailure, sendFailure } from "../src/features/requests/send-failure"
import { RequestClosed } from "../src/features/requests/request-upload"
import { CaptureDenied, EmptyRecording } from "../src/features/requests/screen-capture"
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
    onRetry: mock(),
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

  test("closed because the workspace is full: the recording can still be saved", () => {
    view({ state: "closed", closedReason: "full", capture: video })
    expect(screen.getByText("Ana's BugBerry can't take more recordings right now. Save yours to your computer and send it to them another way.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Save the recording" })).toBeTruthy()
  })

  test("a full workspace closes the page instead of asking to send again", () => {
    expect(sendFailure(new ApiError(403, "report_limit_reached", "full"))).toEqual({ closed: "full" })
    expect(sendFailure(new ApiError(403, "duration_limit_reached", "long"))).toEqual({ closed: "full" })
    expect(sendFailure(new RequestClosed())).toEqual({ closed: "link" })
    expect(sendFailure(new ApiError(0, "network", "offline"))).toEqual({ message: "BugBerry can't be reached. Check your connection, then press Send again." })
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

  test("a link that couldn't be checked offers Try again instead of calling it dead", () => {
    const props = view({ state: "unreachable", link: null })
    expect(screen.getByText("The link couldn't be checked. Wait a moment, then try again.")).toBeTruthy()
    expect(screen.queryByText(/doesn't take recordings/)).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(props.onRetry).toHaveBeenCalled()
  })

  test("Record again asks before it throws the recording away", () => {
    const props = view({ state: "review", capture: video })
    fireEvent.click(screen.getByRole("button", { name: "Record again" }))
    expect(props.onDiscard).not.toHaveBeenCalled()
    expect(screen.getByText("Throw this recording away?")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }))
    expect(screen.queryByText("Throw this recording away?")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Record again" }))
    fireEvent.click(screen.getByRole("button", { name: "Throw it away" }))
    expect(props.onDiscard).toHaveBeenCalled()
  })
})

describe("what the page makes of a failure", () => {
  test("only a 404 means the link is dead; anything else can be tried again", () => {
    expect(lookupFailure(new ApiError(404, "request_unavailable", "gone"))).toBe("unavailable")
    expect(lookupFailure(new ApiError(429, "too_many_requests", "slow down"))).toBe("unreachable")
    expect(lookupFailure(new ApiError(0, "network", "offline"))).toBe("unreachable")
  })

  test("a cancelled picker says nothing; an empty recording says what happened", () => {
    expect(captureFailure(new CaptureDenied(), "video")).toBeNull()
    expect(captureFailure(new EmptyRecording(), "video")).toBe("Nothing was recorded. Record again, and keep it going for a second or two.")
    expect(captureFailure(new Error("codec"), "video")).toBe("The recording couldn't start. Try again, or take a screenshot.")
    expect(captureFailure(new Error("frame"), "screenshot")).toBe("The screenshot couldn't be taken. Try again.")
  })

  test("leaving asks first, in the old browsers too", () => {
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent
    warnBeforeLeaving(event)
    expect(event.defaultPrevented).toBe(true)
    expect(event.returnValue).toBeTruthy()
  })
})
