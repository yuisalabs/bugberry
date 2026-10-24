import { Button } from "@bugberry/ui/button"
import { RiServerLine } from "@remixicon/react"
import { useEffect, useRef, useState } from "react"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage } from "../../lib/browser-settings"
import { confirmNotes, switchServer } from "../../lib/bridge"
import { createIndexedDbDraftStore } from "../../lib/draft-store"
import { closePrompt, CoveredNote, PromptShell, usePromptTicket, useUnobscured } from "../../lib/prompt-page"
import { isBugBerryServer, serverLabel } from "../../lib/session"
import { loadSettings, normalizeServerUrl } from "../../lib/settings"

const store = createIndexedDbDraftStore()

function validServer(value: string | null): string | null {
  try {
    return value ? normalizeServerUrl(value) : null
  } catch {
    return null
  }
}

/**
 * Asked when a BugBerry dashboard wants the extension to send there: over that dashboard (or in a tab of its
 * own). The server comes from the background's ticket, never the page's URL, and only the click here changes it.
 */
export function App({ token, embedded }: { token: string; embedded: boolean }) {
  const ticket = usePromptTicket(token, "confirm-server")
  const server = ticket && ticket !== "invalid" ? validServer(ticket.server) : null
  const [notes, setNotes] = useState<string[]>([])
  const [state, setState] = useState<"asking" | "saving" | "done" | { error: string }>("asking")
  const actions = useRef<HTMLDivElement>(null)
  const seen = useUnobscured(actions, embedded)

  useEffect(() => {
    if (!server) return
    void Promise.all([loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN), store.list()]).then(([settings, drafts]) => {
      const current = settings?.serverUrl ?? null
      setNotes(confirmNotes(drafts, server, current, current ? serverLabel(current) : ""))
    })
  }, [server])

  if (ticket === null) return null
  const close = () => void closePrompt(token, embedded)
  if (!server) {
    return (
      <PromptShell embedded={embedded} labelledBy="server-title">
        <h1 id="server-title" className="font-heading text-xl font-bold">
          This request has expired
        </h1>
        <p className="text-sm text-muted-foreground">Click “Use this server” on the dashboard again.</p>
        <Button size="sm" intent="outline" className="self-end" onPress={close}>
          Close
        </Button>
      </PromptShell>
    )
  }
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
      <PromptShell embedded={embedded} labelledBy="server-title">
        <h1 id="server-title" className="font-heading text-xl font-bold">
          Server changed
        </h1>
        <p role="status" className="text-sm text-success-subtle-foreground">
          Reports now go to {host}.
        </p>
        <Button size="sm" className="self-end" onPress={close}>
          Done
        </Button>
      </PromptShell>
    )
  }

  return (
    <PromptShell embedded={embedded} labelledBy="server-title">
      <span className="grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
        <RiServerLine size={22} aria-hidden />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 id="server-title" className="font-heading text-xl font-bold">
          Send your BugBerry reports to {host}?
        </h1>
        {notes.map((note) => (
          <p key={note} className="text-sm text-muted-foreground">
            {note}
          </p>
        ))}
      </div>
      {typeof state === "object" && (
        <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-subtle-foreground">
          {state.error}
        </p>
      )}
      {embedded && !seen && <CoveredNote token={token} />}
      <div ref={actions} className="flex justify-end gap-2">
        <Button size="sm" intent="outline" onPress={close}>
          Cancel
        </Button>
        <Button size="sm" isDisabled={state === "saving" || !seen} onPress={() => void confirm()}>
          Use this server
        </Button>
      </div>
    </PromptShell>
  )
}
