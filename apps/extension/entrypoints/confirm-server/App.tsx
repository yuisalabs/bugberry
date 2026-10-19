import { Button } from "@bugberry/ui/button"
import { useEffect, useState } from "react"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage } from "../../lib/browser-settings"
import { confirmNotes, switchServer } from "../../lib/bridge"
import { createIndexedDbDraftStore } from "../../lib/draft-store"
import { isBugBerryServer, serverLabel } from "../../lib/session"
import { loadSettings, normalizeServerUrl } from "../../lib/settings"

const store = createIndexedDbDraftStore()

function requestedServer(): string | null {
  try {
    return normalizeServerUrl(new URLSearchParams(location.search).get("server") ?? "")
  } catch {
    return null
  }
}

/** Opened by the background when a BugBerry dashboard asks; only the click here changes the server. */
export function App() {
  const server = requestedServer()
  const [notes, setNotes] = useState<string[]>([])
  const [state, setState] = useState<"asking" | "saving" | "done" | { error: string }>("asking")

  useEffect(() => {
    if (!server) return
    void Promise.all([loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN), store.list()]).then(([settings, drafts]) => {
      const current = settings?.serverUrl ?? null
      setNotes(confirmNotes(drafts, server, current, current ? serverLabel(current, BUILD_SERVER_ORIGIN) : ""))
    })
  }, [server])

  if (!server) return <p className="p-6">This request has no valid server address.</p>
  const host = new URL(server).host

  const confirm = async () => {
    setState("saving")
    if (!(await isBugBerryServer(server))) return setState({ error: "That address is not a BugBerry server" })
    const current = (await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN))?.serverUrl ?? null
    await switchServer(server, current, store, (value) => browserSettingsStorage.set(value))
    setState("done")
  }

  if (state === "done") {
    return (
      <main className="mx-auto flex max-w-lg flex-col gap-3 p-6">
        <p role="status" className="text-success-subtle-foreground">
          Done. Reports now go to {host}.
        </p>
      </main>
    )
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Send your BugBerry reports to {host}?</h1>
      {notes.map((note) => (
        <p key={note} className="text-sm text-muted-foreground">
          {note}
        </p>
      ))}
      {typeof state === "object" && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {state.error}
        </p>
      )}
      <div className="flex gap-3">
        <Button size="sm" isDisabled={state === "saving"} onPress={() => void confirm()}>
          Use this server
        </Button>
        <Button size="sm" intent="outline" onPress={() => window.close()}>
          Cancel
        </Button>
      </div>
    </main>
  )
}
