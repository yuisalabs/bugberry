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
  const play = mock()
  const pause = mock()
  const setConfig = mock()
  const handlers = new Map<string, (detail: { payload: number | string }) => void>()
  const createPlayer = mock(() => ({
    goto,
    play,
    pause,
    $destroy: destroy,
    getReplayer: () => ({ getCurrentTime: () => 7_000, setConfig }),
    addEventListener: (name: string, handler: (detail: { payload: number | string }) => void) => {
      handlers.set(name, handler)
    },
  }))
  const emit = (name: string, payload: number | string) => act(() => handlers.get(name)?.({ payload }))
  return {
    goto,
    play,
    pause,
    setConfig,
    destroy,
    createPlayer,
    time: (ms: number) => emit("ui-update-current-time", ms),
    state: (state: "playing" | "paused") => emit("ui-update-player-state", state),
  }
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
    expect(props).toMatchObject({ events: EVENTS, autoPlay: false, skipInactive: false, showController: false })
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

  function withResize(run: (resize: (size: { width: number; height: number }) => void) => void) {
    const original = globalThis.ResizeObserver
    let resize: (size: { width: number; height: number }) => void = () => {}
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = (size) => callback([{ contentRect: size } as ResizeObserverEntry], this as unknown as ResizeObserver)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver
    try {
      run((size) => resize(size))
    } finally {
      globalThis.ResizeObserver = original
    }
  }

  test("a new width rescales the player there is, in the recorded page's aspect, instead of building another", () => {
    withResize((resize) => {
      const player = fakePlayer()
      const set = mock()
      const createPlayer = mock((...args: Parameters<typeof player.createPlayer>) => ({ ...player.createPlayer(...args), $set: set }))
      render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={createPlayer} />)
      // The stage's height follows the player in normal flow, so it doesn't bound it.
      act(() => resize({ width: 960, height: 400 }))
      expect(set).toHaveBeenLastCalledWith({ width: 960, height: 720 })
      expect(createPlayer).toHaveBeenCalledTimes(1)
    })
  })

  test("a new size rescales the replayed page too, not only the player's box", () => {
    withResize((resize) => {
      const player = fakePlayer()
      const triggerResize = mock()
      const createPlayer = mock((...args: Parameters<typeof player.createPlayer>) => ({ ...player.createPlayer(...args), $set: mock(), triggerResize }))
      render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={createPlayer} />)
      triggerResize.mockClear()
      act(() => resize({ width: 960, height: 400 }))
      expect(triggerResize).toHaveBeenCalledTimes(1)
    })
  })

  test("the player is built at the stage's size, not at the 320 px floor", () => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 960 })
    try {
      const player = fakePlayer()
      render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} />)
      const [, props] = player.createPlayer.mock.calls[0] as unknown as [HTMLElement, Record<string, unknown>]
      expect(props).toMatchObject({ width: 960, height: 720 })
    } finally {
      if (original) Object.defineProperty(HTMLElement.prototype, "clientWidth", original)
    }
  })

  test("a bounded player fits the stage's height as well", () => {
    withResize((resize) => {
      const player = fakePlayer()
      const set = mock()
      const createPlayer = mock((...args: Parameters<typeof player.createPlayer>) => ({ ...player.createPlayer(...args), $set: set }))
      render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={createPlayer} bounded />)
      act(() => resize({ width: 1180, height: 600 }))
      expect(set).toHaveBeenLastCalledWith({ width: 800, height: 600 })
      expect(createPlayer).toHaveBeenCalledTimes(1)
    })
  })

  test("the big play button plays, and the bar then offers Pause", () => {
    const player = fakePlayer()
    const onPlayingChange = mock()
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} onPlayingChange={onPlayingChange} />)
    fireEvent.click(screen.getByRole("button", { name: "Play" }))
    expect(player.play).toHaveBeenCalledTimes(1)
    player.state("playing")
    expect(onPlayingChange).toHaveBeenLastCalledWith(true)
    fireEvent.click(screen.getByRole("button", { name: "Pause" }))
    expect(player.pause).toHaveBeenCalledTimes(1)
  })

  test("the bar shows the time against the length", () => {
    const player = fakePlayer()
    render(<ReplayPlayer events={EVENTS} durationMs={42_000} frames={FRAMES} createPlayer={player.createPlayer} />)
    player.state("playing")
    player.time(19_000)
    expect(screen.getByText("0:19 / 0:42")).toBeTruthy()
  })

  test("a click on the progress line seeks to the time at that percent", () => {
    const player = fakePlayer()
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} />)
    player.state("playing")
    const progress = screen.getByRole("slider", { name: "Progress" })
    progress.getBoundingClientRect = () => ({ left: 0, width: 400, top: 0, height: 10, right: 400, bottom: 10, x: 0, y: 0, toJSON() {} })
    fireEvent.pointerDown(progress, { clientX: 100, pointerId: 1 })
    expect(player.goto).toHaveBeenLastCalledWith(3_000)
  })

  test("the speed button goes 1x, 2x, 4x, 8x and round", () => {
    const player = fakePlayer()
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} />)
    player.state("playing")
    fireEvent.click(screen.getByRole("button", { name: "Speed 1x" }))
    expect(player.setConfig).toHaveBeenLastCalledWith({ speed: 2 })
    fireEvent.click(screen.getByRole("button", { name: "Speed 2x" }))
    fireEvent.click(screen.getByRole("button", { name: "Speed 4x" }))
    fireEvent.click(screen.getByRole("button", { name: "Speed 8x" }))
    expect(player.setConfig).toHaveBeenLastCalledWith({ speed: 1 })
  })

  test("markers are dots on the progress line, with their labels", () => {
    const player = fakePlayer()
    const markers = [
      { id: "m1", atMs: 3_000, kind: "network" as const, label: "500", detail: "POST /api/pay 500" },
      { id: "m2", atMs: 9_000, kind: "error" as const, label: "err", detail: "TypeError: x" },
    ]
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} markers={markers} strip={false} createPlayer={player.createPlayer} />)
    player.state("playing")
    const dot = screen.getByRole("button", { name: "Jump to: POST /api/pay 500" })
    expect(dot.textContent).toBe("500")
    expect(dot.style.left).toBe("25%")
    fireEvent.click(screen.getByRole("button", { name: "Jump to: TypeError: x" }))
    expect(player.goto).toHaveBeenLastCalledWith(9_000)
  })

  test("space on the player toggles it, the arrows seek by five seconds", () => {
    const player = fakePlayer()
    const { container } = render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} />)
    const stage = container.querySelector(".bb-replay-stage") as HTMLElement
    fireEvent.keyDown(stage, { key: " " })
    expect(player.play).toHaveBeenCalledTimes(1)
    player.time(2_000)
    fireEvent.keyDown(stage, { key: "ArrowRight" })
    expect(player.goto).toHaveBeenLastCalledWith(7_000)
  })

  test("strip={false} leaves the screenshots and the marker row to the page", () => {
    const player = fakePlayer()
    const marker = { id: "m1", atMs: 6_000, kind: "error" as const, label: "err", detail: "TypeError: x" }
    render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} markers={[marker]} strip={false} createPlayer={player.createPlayer} />)
    expect(screen.queryByRole("list", { name: "Screenshots" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Jump to: TypeError: x" })).toBeNull()
  })

  test("unmounting destroys the rrweb player", () => {
    const player = fakePlayer()
    const { unmount } = render(<ReplayPlayer events={EVENTS} durationMs={12_000} frames={FRAMES} createPlayer={player.createPlayer} />)
    unmount()
    expect(player.destroy).toHaveBeenCalled()
  })
})
