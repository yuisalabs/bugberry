import { deviceInfoFrom } from "@bugberry/capture"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { qk } from "../../lib/query/keys"
import { frameToPng, putWithProgress, videoThumbnail } from "./frames"
import { requestApi, requestLink, requestQueries } from "./queries"
import { sendRecording } from "./request-upload"
import { useLeaveWarning } from "./leave-warning"
import { captureFailure, lookupFailure, sendFailure } from "./send-failure"
import { type Capture, type RequestForm, type RequestState, RequestView } from "./RequestView"
import { type CaptureDeps, captureSupport, type RecordingHandle, startRecording, takeScreenshot } from "./screen-capture"

const routeApi = getRouteApi("/request/$token")

function browserCapture(): CaptureDeps {
  return {
    getDisplayMedia: (constraints) => navigator.mediaDevices.getDisplayMedia(constraints),
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createRecorder: (stream, options) => new MediaRecorder(stream, options),
    now: () => Date.now(),
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    clearTimeout: (id) => window.clearTimeout(id as number),
  }
}

function browserSupport() {
  if (typeof navigator === "undefined") return "none" as const
  return captureSupport({
    mediaDevices: navigator.mediaDevices,
    isTypeSupported: typeof MediaRecorder === "undefined" ? undefined : (type) => MediaRecorder.isTypeSupported(type),
  })
}

/** Search engines never list a request link's page. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex"
    document.head.append(meta)
    return () => meta.remove()
  }, [])
}

const EMPTY_FORM: RequestForm = { name: "", email: "", description: "", pageUrl: "" }

/** `/request/<token>`: someone without an account records their screen for the member who sent the link. */
export function RequestPage() {
  const { token } = routeApi.useParams()
  const queryClient = useQueryClient()
  const link = useQuery(requestQueries.link(token))
  const [support] = useState(browserSupport)
  const [step, setStep] = useState<"intro" | "recording" | "review" | "sending" | "sent" | "closed">("intro")
  const [mic, setMic] = useState(false)
  const [capture, setCapture] = useState<Capture | null>(null)
  const [form, setForm] = useState<RequestForm>(EMPTY_FORM)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [progress, setProgress] = useState(0)
  const [sendError, setSendError] = useState<string | null>(null)
  const [canSendAnother, setCanSendAnother] = useState(false)
  const [closedReason, setClosedReason] = useState<"link" | "full">("link")
  const recording = useRef<RecordingHandle | null>(null)

  useNoIndex()
  useLeaveWarning(step === "recording" || step === "review" || step === "sending")

  useEffect(() => {
    if (link.data && !form.pageUrl) setForm((current) => ({ ...current, pageUrl: link.data.pageUrl ?? "" }))
  }, [link.data])

  useEffect(() => {
    if (step !== "recording") return
    const started = Date.now()
    const tick = window.setInterval(() => setElapsedMs(Date.now() - started), 500)
    return () => window.clearInterval(tick)
  }, [step])

  // The object URL lives as long as the capture it shows.
  useEffect(() => () => (capture ? URL.revokeObjectURL(capture.url) : undefined), [capture])

  const keep = (kind: Capture["kind"], blob: Blob, durationMs: number | null) => {
    setCapture({ kind, blob, url: URL.createObjectURL(blob), durationMs })
    setStep("review")
  }

  const record = async () => {
    if (!link.data) return
    setSendError(null)
    try {
      const handle = await startRecording(browserCapture(), { mic, maxMs: link.data.maxSeconds * 1000, maxBytes: link.data.maxBytes })
      recording.current = handle
      setElapsedMs(0)
      setStep("recording")
      const done = await handle.done
      recording.current = null
      keep("video", done.video, done.durationMs)
    } catch (error) {
      recording.current = null
      setStep("intro")
      setSendError(captureFailure(error, "video"))
    }
  }

  const screenshot = async () => {
    setSendError(null)
    try {
      keep("screenshot", await takeScreenshot(browserCapture(), frameToPng), null)
    } catch (error) {
      setSendError(captureFailure(error, "screenshot"))
    }
  }

  const send = async () => {
    if (!capture) return
    setSendError(null)
    setProgress(0)
    setStep("sending")
    try {
      await sendRecording(
        { api: requestApi, put: putWithProgress, storage: window.sessionStorage, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
        token,
        {
          media: capture.blob,
          thumbnail: capture.kind === "video" ? await videoThumbnail(capture.blob) : null,
          captureType: capture.kind,
          durationMs: capture.durationMs,
          ...form,
          device: deviceInfoFrom(navigator.userAgent, { width: window.innerWidth, height: window.innerHeight }),
        },
        setProgress,
      )
      // Still answering means the link has a use left.
      const again = await requestLink(token).then(() => true, () => false)
      setCanSendAnother(again)
      setStep("sent")
    } catch (error) {
      const failure = sendFailure(error)
      if ("closed" in failure) {
        setClosedReason(failure.closed)
        setStep("closed")
        return
      }
      setSendError(failure.message)
      setStep("review")
    }
  }

  const discard = () => {
    setCapture(null)
    setSendError(null)
    setStep("intro")
  }

  const another = () => {
    setCapture(null)
    setForm((current) => ({ ...current, description: "" }))
    void queryClient.invalidateQueries({ queryKey: qk.requestLink(token) })
    setStep("intro")
  }

  const state: RequestState = link.isPending || (link.isError && link.isFetching)
    ? "loading"
    : link.isError && step !== "closed"
      ? lookupFailure(link.error)
      : support === "none"
        ? "unsupported"
        : step

  return (
    <RequestView
      state={state}
      link={link.data ?? null}
      support={support}
      mic={mic}
      elapsedMs={elapsedMs}
      capture={capture}
      form={form}
      progress={progress}
      sendError={sendError}
      canSendAnother={canSendAnother}
      closedReason={closedReason}
      onMic={setMic}
      onRecord={() => void record()}
      onScreenshot={() => void screenshot()}
      onStop={() => recording.current?.stop()}
      onForm={(patch) => setForm((current) => ({ ...current, ...patch }))}
      onSend={() => void send()}
      onDiscard={discard}
      onAnother={another}
      onRetry={() => void link.refetch()}
    />
  )
}
