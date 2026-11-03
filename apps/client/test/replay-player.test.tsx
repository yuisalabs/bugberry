import { describe, expect, mock, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { createRef } from "react"
import type { ReplayPlayerHandle } from "@bugberry/replay-player"
import { ReplayPlayer } from "@bugberry/replay-player/replay-player"

const EVENTS = [
  { type: 4, timestamp: 10_000, data: { href: "http://localhost:3000/", width: 800, height: 600 } },
  { type: 2, timestamp: 10_000, data: {} },
]
const FRAMES = [
  { atMs: 0, jpeg: "A" },
  { atMs: 5_000, jpeg: "B" },
]

function fakePlayer() {
  const goto = mock()
  const destroy = mock()
  let onTime: (detail: { payload: number }) => void = () => {}
  const createPlayer = mock(() => ({
    goto,
    play: mock(),
    pause: mock(),
    $destroy: destroy,
    getReplayer: () => ({ getCurrentTime: () => 7_000 }),
    addEventListener: (name: string, handler: (detail: { payload: number }) => void) => {
      if (name === "ui-update-current-time") onTime = handler
    },
  }))
  return { goto, destroy, createPlayer, time: (ms: number) => act(() => onTime({ payload: ms })) }
}

describe("ReplayPlayer", () => {
  test("the strip seeks and marks the active frame; the handle seeks the rrweb player", () => {
    const player = fakePlayer()
    const ref = createRef<ReplayPlayerHandle>()
    const onTime = mock()
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} playerRef={ref} onTime={onTime} createPlayer={player.createPlayer} />)

    fireEvent.click(screen.getByRole("listitem", { name: "Screenshot at 0:05" }))
    expect(player.goto).toHaveBeenCalledWith(5_000)

    player.time(7_000)
    expect(onTime).toHaveBeenLastCalledWith(7_000)
    expect(screen.getByRole("listitem", { name: "Screenshot at 0:05" }).getAttribute("aria-current")).toBe("true")
    expect(screen.getByRole("listitem", { name: "Screenshot at 0:00" }).getAttribute("aria-current")).toBeNull()

    act(() => ref.current?.seek(9_000))
    expect(player.goto).toHaveBeenLastCalledWith(9_000)
    expect(ref.current?.currentMs()).toBe(7_000)
  })

  test("the rrweb player is built with the replay's events, without autoplay or skipping idle time", () => {
    const player = fakePlayer()
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} />)
    const [, props] = player.createPlayer.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>]
    expect(props).toMatchObject({ events: EVENTS, autoPlay: false, skipInactive: false, showController: true, tags: { "bugberry:frame": "#2563eb" } })
  })

  test("starts at a shared time once, with the strip and the page following before playback", () => {
    const player = fakePlayer()
    const onTime = mock()
    render(
      <ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} startAtSeconds={6} onTime={onTime} createPlayer={player.createPlayer} />,
    )
    expect(player.goto).toHaveBeenCalledWith(6_000)
    expect(onTime).toHaveBeenLastCalledWith(6_000)
    expect(screen.getByRole("listitem", { name: "Screenshot at 0:05" }).getAttribute("aria-current")).toBe("true")
  })

  test("the bar above the replay shows the reporter and actions for the current time", () => {
    const player = fakePlayer()
    render(
      <ReplayPlayer
        events={EVENTS}
        durationMs={12_000}
        frames={FRAMES}
        createPlayer={player.createPlayer}
        topLeft={<span>Ana</span>}
        topRight={(seconds) => <button type="button">Share at {seconds}</button>}
      />,
    )
    expect(screen.getByText("Ana")).toBeTruthy()
    player.time(7_000)
    expect(screen.getByRole("button", { name: "Share at 7" })).toBeTruthy()
  })

  test("a marker seeks and is reported", () => {
    const player = fakePlayer()
    const onMarkerClick = mock()
    const marker = { id: "m1", atMs: 6_000, kind: "error" as const, label: "err", detail: "TypeError: x" }
    render(
      <ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} markers={[marker]} onMarkerClick={onMarkerClick} createPlayer={player.createPlayer} />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Jump to: TypeError: x" }))
    expect(player.goto).toHaveBeenCalledWith(6_000)
    expect(onMarkerClick).toHaveBeenCalledWith(marker)
  })

  test("a stream rrweb can't play says so instead of building a player", () => {
    const player = fakePlayer()
    render(<ReplayPlayer events={EVENTS.slice(0, 1)} durationMs={0} frames={[]} createPlayer={player.createPlayer} />)
    expect(screen.getByText("This replay is too short to play.")).toBeTruthy()
    expect(player.createPlayer).not.toHaveBeenCalled()
  })

  test("no frames, no strip", () => {
    const player = fakePlayer()
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={[]} createPlayer={player.createPlayer} />)
    expect(screen.queryByRole("list", { name: "Screenshots" })).toBeNull()
  })

  test("a new width rescales the player there is instead of building another", () => {
    const original = globalThis.ResizeObserver
    let resize: (width: number) => void = () => {}
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width) => callback([{ contentRect: { width } } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    try {
      const player = fakePlayer()
      const set = mock()
      const createPlayer = mock((...args: Parameters<typeof player.createPlayer>) => ({ ...player.createPlayer(...args), $set: set }))
      render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={createPlayer} />)
      act(() => resize(960))
      expect(set).toHaveBeenLastCalledWith({ width: 960, height: 540 })
      expect(createPlayer).toHaveBeenCalledTimes(1)
    } finally {
      globalThis.ResizeObserver = original
    }
  })

  test("unmounting destroys the rrweb player", () => {
    const player = fakePlayer()
    const { unmount } = render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} />)
    unmount()
    expect(player.destroy).toHaveBeenCalled()
  })
})
