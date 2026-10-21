import { Button } from "@bugberry/ui/button"
import { useState } from "react"
import { capturePrefsStorage } from "../../lib/browser-settings"
import { micAccess, micErrorText } from "../../lib/microphone"

/**
 * Opened by the popup the first time the microphone is turned on: the popup can't show Chrome's
 * permission prompt, this page can. Once allowed, the default microphone is on and the page closes itself.
 */
export function App() {
  const [error, setError] = useState<string | null>(null)
  const allow = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      for (const track of stream.getTracks()) track.stop()
      await capturePrefsStorage.set({ mic: true, micDeviceId: null })
      window.close()
    } catch (cause) {
      const access = await micAccess((name) => navigator.permissions.query({ name: name as PermissionName }))
      setError(micErrorText(cause, access))
    }
  }
  return (
    <main className="mx-auto mt-24 flex max-w-md flex-col gap-4 rounded-2xl border border-border bg-overlay p-8">
      <img src="/assets/bugberry_icon_small.webp" alt="" className="size-8 object-contain" />
      <h1 className="font-heading text-2xl font-bold">Allow microphone</h1>
      <p className="text-sm text-muted-foreground">BugBerry records your voice with the video when the microphone is on.</p>
      <Button size="sm" className="self-start" onPress={() => void allow()}>
        Allow microphone
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
    </main>
  )
}
