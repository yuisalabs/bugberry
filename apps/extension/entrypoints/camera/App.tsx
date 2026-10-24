import { Button } from "@bugberry/ui/button"
import { RiVideoOnLine } from "@remixicon/react"
import { useState } from "react"
import { capturePrefsStorage } from "../../lib/browser-settings"
import { cameraAccess, cameraErrorText } from "../../lib/camera"
import { closePrompt, PromptShell, usePromptTicket } from "../../lib/prompt-page"

/**
 * Asked for from the popup the first time the camera is turned on: the popup can't show the browser's
 * permission prompt, this page can. It opens over the page the reporter is on (or in a tab where that page
 * can't show it). Once allowed, the default camera is on and the prompt goes away.
 */
export function App({ token, embedded }: { token: string; embedded: boolean }) {
  const ticket = usePromptTicket(token, "camera")
  const [error, setError] = useState<string | null>(null)
  // No cover-up check here: the browser's own prompt, which a page can't fake or click through, is the consent.

  const allow = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      for (const track of stream.getTracks()) track.stop()
      await capturePrefsStorage.set({ camera: true, cameraDeviceId: null })
      await closePrompt(token, embedded)
    } catch (cause) {
      const access = await cameraAccess((name) => navigator.permissions.query({ name: name as PermissionName }))
      setError(cameraErrorText(cause, access))
    }
  }

  if (ticket === null) return null
  if (ticket === "invalid") {
    return (
      <PromptShell embedded={embedded} labelledBy="camera-title">
        <h1 id="camera-title" className="font-heading text-xl font-bold">
          This request has expired
        </h1>
        <p className="text-sm text-muted-foreground">Turn the camera on again from the BugBerry icon.</p>
        <Button size="sm" intent="outline" className="self-end" onPress={() => void closePrompt(token, embedded)}>
          Close
        </Button>
      </PromptShell>
    )
  }

  return (
    <PromptShell embedded={embedded} labelledBy="camera-title">
      <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
        <RiVideoOnLine size={22} aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 id="camera-title" className="font-heading text-xl font-bold">
          Allow camera
        </h1>
        <p className="text-sm text-muted-foreground">
          BugBerry shows your camera in a bubble on the page while you record a tab. Your browser will ask you once.
        </p>
      </div>
      {error && (
        <div role="alert" className="flex flex-col gap-2 rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-subtle-foreground">
          {error}
          {embedded && (
            <button type="button" className="self-start font-semibold underline" onClick={() => void closePrompt(token, embedded, "tab")}>
              Ask in a new tab instead
            </button>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" intent="outline" onPress={() => void closePrompt(token, embedded)}>
          Not now
        </Button>
        <Button size="sm" onPress={() => void allow()}>
          Allow camera
        </Button>
      </div>
    </PromptShell>
  )
}
