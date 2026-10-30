import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react"
import { browser } from "wxt/browser"
import type { AiTestReply } from "../../lib/ai/ai-relay"
import { createBugberryApi } from "../../lib/server/api"
import { browserAiKeyStorage } from "../../lib/ai/browser-ai-key"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage } from "../../lib/server/browser-settings"
import { switchServer } from "../../lib/server/bridge"
import { createIndexedDbDraftStore } from "../../lib/drafts/draft-store"
import { closePrompt, CoveredNote, PromptShell, usePromptTicket, useUnobscured } from "../../lib/prompts/prompt-page"
import { checkSession, isBugBerryServer, type SessionState, serverLabel, signInUrl } from "../../lib/server/session"
import { loadSettings, normalizeServerUrl, type Settings } from "../../lib/server/settings"
import { AiKeySection } from "./AiKeySection"

const store = createIndexedDbDraftStore()
const card = "flex flex-col gap-3 rounded-xl border border-border bg-overlay p-4"

/**
 * The settings: from the popup, over the page the reporter is on (or in a tab where that page can't show
 * them); from the browser's extensions page, a page of their own.
 */
export function App({ token, embedded }: { token: string; embedded: boolean }) {
  const ticket = usePromptTicket(token, "options")
  // Another site can frame this page (it is web accessible): the settings show only under a ticket for this tab.
  if (!embedded) return window.top === window ? <SettingsPage /> : null
  if (ticket === null) return null
  const close = () => void closePrompt(token, embedded)
  if (ticket === "invalid") {
    return (
      <PromptShell embedded labelledBy="settings-title" onClose={close}>
        <h1 id="settings-title" className="font-heading text-xl font-bold">
          This request has expired
        </h1>
        <p className="text-sm text-muted-foreground">Open the settings again from the BugBerry icon.</p>
      </PromptShell>
    )
  }
  return (
    <PromptShell embedded labelledBy="settings-title" onClose={close}>
      <SettingsBody embedded token={token} />
    </PromptShell>
  )
}

function SettingsPage() {
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <SettingsBody embedded={false} token="" />
    </main>
  )
}

function SettingsBody({ embedded, token }: { embedded: boolean; token: string }) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [session, setSession] = useState<SessionState | null>(null)
  const [address, setAddress] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  // Over someone else's page, the buttons work only while nothing covers them.
  const seen = useUnobscured(body, embedded)

  const refresh = useCallback(async () => {
    const loaded = await loadSettings(browserSettingsStorage, BUILD_SERVER_ORIGIN)
    setSettings(loaded)
    setSession(await checkSession(loaded, () => createBugberryApi(loaded as Settings).me()))
  }, [])

  useEffect(() => {
    void refresh()
    // A dashboard can switch the server through the confirmation page; show it when it lands.
    const onChanged = (changes: Record<string, unknown>, area: string) => {
      if (area === "local" && "serverUrl" in changes) void refresh()
    }
    browser.storage.onChanged.addListener(onChanged)
    return () => browser.storage.onChanged.removeListener(onChanged)
  }, [refresh])

  const useServer = async (raw: string) => {
    setError(null)
    setBusy(true)
    try {
      const serverUrl = normalizeServerUrl(raw)
      if (!(await isBugBerryServer(serverUrl))) throw new Error("That address is not a BugBerry server")
      await switchServer(serverUrl, settings?.serverUrl ?? null, store, (value) => browserSettingsStorage.set(value))
      setAddress("")
      await refresh()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (seen) void useServer(address)
  }

  return (
    <div ref={body} className="flex flex-col gap-4">
      <h1 id="settings-title" className="font-heading text-xl font-semibold">
        BugBerry settings
      </h1>
      {settings && (
        <section className={card}>
          <p className="text-sm">Server: {serverLabel(settings.serverUrl)}</p>
          {session?.kind === "signed-in" && (
            <p role="status" className="text-sm text-success-subtle-foreground">
              Signed in as {session.name} ({session.email})
            </p>
          )}
          {session?.kind === "signed-out" && (
            <>
              <p role="status" className="text-sm text-danger-subtle-foreground">
                Not signed in
              </p>
              <Button size="sm" className="self-start" onPress={() => void browser.tabs.create({ url: signInUrl(settings.serverUrl) })}>
                Sign in
              </Button>
            </>
          )}
          {session?.kind === "unreachable" && (
            <p role="status" className="text-sm text-danger-subtle-foreground">
              Can't reach {session.host}
            </p>
          )}
          {BUILD_SERVER_ORIGIN && settings.serverUrl !== BUILD_SERVER_ORIGIN && (
            <Button size="sm" intent="outline" className="self-start" isDisabled={busy || !seen} onPress={() => void useServer(BUILD_SERVER_ORIGIN)}>
              Use {serverLabel(BUILD_SERVER_ORIGIN)}
            </Button>
          )}
        </section>
      )}
      {embedded && !seen && <CoveredNote token={token} />}
      <form onSubmit={save} className={card}>
        <h2 className="text-sm font-semibold">{settings ? "Change server" : "Choose your BugBerry server"}</h2>
        <TextField isRequired value={address} onChange={setAddress}>
          <Label>Server address</Label>
          <Input placeholder="https://bugberry.example.com" />
        </TextField>
        <Button size="sm" type="submit" className="self-start" isDisabled={busy || !seen}>
          Save
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {error}
          </p>
        )}
      </form>
      <AiKeySection
        storage={browserAiKeyStorage}
        test={(provider) => browser.runtime.sendMessage({ type: "bugberry:ai-test", provider }) as Promise<AiTestReply>}
        disabled={!seen}
      />
    </div>
  )
}
