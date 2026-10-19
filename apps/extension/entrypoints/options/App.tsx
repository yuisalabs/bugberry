import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { type FormEvent, useCallback, useEffect, useState } from "react"
import { browser } from "wxt/browser"
import { createBugberryApi } from "../../lib/api"
import { BUILD_SERVER_ORIGIN, browserSettingsStorage } from "../../lib/browser-settings"
import { switchServer } from "../../lib/bridge"
import { createIndexedDbDraftStore } from "../../lib/draft-store"
import { checkSession, isBugBerryServer, type SessionState, serverLabel, signInUrl } from "../../lib/session"
import { loadSettings, normalizeServerUrl, type Settings } from "../../lib/settings"

const store = createIndexedDbDraftStore()
const card = "flex flex-col gap-3 rounded-xl border border-border bg-overlay p-4"

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [session, setSession] = useState<SessionState | null>(null)
  const [address, setAddress] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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
    void useServer(address)
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-6">
      <h1 className="font-heading text-xl font-semibold">BugBerry settings</h1>
      {settings && (
        <section className={card}>
          <p className="text-sm">Server: {serverLabel(settings.serverUrl, BUILD_SERVER_ORIGIN)}</p>
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
            <Button size="sm" intent="outline" className="self-start" isDisabled={busy} onPress={() => void useServer(BUILD_SERVER_ORIGIN)}>
              Use BugBerry cloud
            </Button>
          )}
        </section>
      )}
      <form onSubmit={save} className={card}>
        <h2 className="text-sm font-semibold">{settings ? "Change server" : "Choose your BugBerry server"}</h2>
        <TextField isRequired value={address} onChange={setAddress}>
          <Label>Server address</Label>
          <Input placeholder="https://bugberry.example.com" />
        </TextField>
        <Button size="sm" type="submit" className="self-start" isDisabled={busy}>
          Save
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {error}
          </p>
        )}
      </form>
    </main>
  )
}
