import { REPLAY_BUFFER_MAX_BYTES, REPLAY_FRAME_INTERVAL_MS, REPLAY_FRAME_TAG, type ReplayEvent } from "@bugberry/shared"
import { isReplayPageMessage } from "../shared/messages"
import { createReplayBuffer } from "./replay-buffer"

/** The part of rrweb's record options the recorder sets. */
export interface ReplayRecordOptions {
  emit(event: ReplayEvent, isCheckout?: boolean): void
  checkoutEveryNms: number
  inlineStylesheet: boolean
  collectFonts: boolean
  maskAllInputs: boolean
  recordCanvas: boolean
  recordCrossOriginIframes: boolean
}

export interface ReplayPageDeps {
  /** @rrweb/record's record; returns its stop function. */
  record(options: ReplayRecordOptions): (() => void) | undefined
  addCustomEvent(tag: string, payload: unknown): void
  /** record.takeFullSnapshot(true): a checkout outside rrweb's own schedule. */
  takeFullSnapshot(): void
  /** Asks the background for a screenshot of the visible tab; null when it couldn't take one. */
  requestFrame(): Promise<string | null>
  visible(): boolean
  onMessage(handler: (message: unknown, reply: (value: unknown) => void) => boolean | undefined): void
  now(): number
  setInterval: typeof setInterval
  clearInterval: typeof clearInterval
  intervalMs?: number
  maxBytes?: number
}

/** The recorder in an armed page: idle until the background says start, then a rolling buffer and a frame every few seconds. */
export function installReplayRecorder(deps: ReplayPageDeps): { stop(): void } {
  const buffer = createReplayBuffer({ maxBytes: deps.maxBytes ?? REPLAY_BUFFER_MAX_BYTES })
  let stopRecord: (() => void) | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const stop = () => {
    stopRecord?.()
    stopRecord = null
    if (timer !== null) deps.clearInterval(timer)
    timer = null
    buffer.clear()
  }

  const tick = async (windowMs: number) => {
    // rrweb only checks out on DOM activity, while frames keep a quiet page's segment growing.
    const last = buffer.lastCheckoutAt()
    if (buffer.overCap() || (last !== null && deps.now() - last >= windowMs)) deps.takeFullSnapshot()
    if (!deps.visible()) return
    const jpeg = await deps.requestFrame()
    // rrweb throws on a custom event once recording has stopped.
    if (jpeg && stopRecord) deps.addCustomEvent(REPLAY_FRAME_TAG, { jpeg })
  }

  const start = (windowMs: number) => {
    if (stopRecord) return
    stopRecord =
      deps.record({
        emit: (event, isCheckout) => buffer.push(event, isCheckout === true),
        checkoutEveryNms: windowMs,
        inlineStylesheet: true,
        collectFonts: true,
        maskAllInputs: true,
        recordCanvas: false,
        recordCrossOriginIframes: false,
      }) ?? null
    if (!stopRecord) return
    timer = deps.setInterval(() => tick(windowMs).catch(() => {}), deps.intervalMs ?? REPLAY_FRAME_INTERVAL_MS)
  }

  deps.onMessage((message, reply) => {
    if (!isReplayPageMessage(message)) return undefined
    if (message.type === "bugberry:replay-start") start(message.windowMs)
    else if (message.type === "bugberry:replay-stop") stop()
    reply(message.type === "bugberry:replay-snapshot" ? buffer.snapshot() : { ok: true })
    return false
  })

  return { stop }
}
