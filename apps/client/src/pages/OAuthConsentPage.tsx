import { useQuery } from "@tanstack/react-query"
import { Button } from "@bugberry/ui/button"
import { useEffect, useState } from "react"
import { BugBerryLogo } from "../components/BugBerryLogo"
import { Loading } from "../components/ui"
import { ApiError } from "../lib/api"
import { answerConsent, fetchOAuthClient, redirectHost, scopeLines } from "../lib/oauth"
import { queries } from "../lib/queries"

export function ConsentView({
  appName,
  appUri,
  redirectHost,
  email,
  scope,
  busy,
  error,
  onAllow,
  onDeny,
}: {
  appName: string
  appUri: string | null
  redirectHost: string | null
  email: string
  scope: string
  busy: boolean
  error: string | null
  onAllow(): void
  onDeny(): void
}) {
  const lines = scopeLines(scope)
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-bold text-foreground">{appName} wants to use BugBerry</h1>
        {appUri && <p className="text-sm text-muted-foreground">{appUri} (not verified)</p>}
      </div>
      <p className="text-sm text-muted-foreground">Signed in as {email}</p>
      {redirectHost && (
        <p className="text-sm font-medium text-foreground">After you allow it, you'll be sent to {redirectHost}</p>
      )}
      <p className="text-sm text-muted-foreground">
        The app chose its own name. Only allow it if you just started connecting it yourself.
      </p>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-foreground">It will be able to:</p>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-foreground">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <p className="text-sm text-muted-foreground">
          It sees only what you can see. You can disconnect it any time under Account → AI agents (MCP).
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" isDisabled={busy} onPress={onAllow}>
          Allow
        </Button>
        <Button size="sm" intent="outline" isDisabled={busy} onPress={onDeny}>
          Deny
        </Button>
      </div>
    </div>
  )
}

/** `/oauth/consent`: where Better Auth sends an AI app's sign-in for the person to approve. */
export function OAuthConsentPage() {
  const [search] = useState(() => window.location.search)
  const params = new URLSearchParams(search)
  const clientId = params.get("client_id") ?? ""
  const me = useQuery({ ...queries.me(), retry: false, meta: { signedOutIsFine: true } })
  const app = useQuery({ queryKey: ["oauth-client", clientId], queryFn: () => fetchOAuthClient(clientId), enabled: Boolean(clientId) && me.isSuccess })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Not signed in: sign in first; the login page sends the person back to this request.
  const signedOut = me.error instanceof ApiError && me.error.status === 401
  useEffect(() => {
    if (signedOut) window.location.assign(`/login${search}`)
  }, [signedOut, search])

  const answer = (accept: boolean) => {
    setBusy(true)
    setError(null)
    answerConsent(accept, search)
      .then((url) => window.location.assign(url))
      .catch((caught: unknown) => {
        setBusy(false)
        setError(caught instanceof Error ? caught.message : String(caught))
      })
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 py-16">
      <div className="flex w-full max-w-md flex-col gap-8 rounded-2xl border border-border bg-background p-8">
        <BugBerryLogo />
        {!clientId ? (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            This link is incomplete. Start again from your AI app.
          </p>
        ) : me.isPending || signedOut || app.isPending ? (
          <Loading />
        ) : app.isError || !me.data || !app.data ? (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {app.error instanceof Error ? app.error.message : "Something went wrong. Start again from your AI app."}
          </p>
        ) : (
          <ConsentView
            appName={app.data.name}
            appUri={app.data.uri}
            redirectHost={redirectHost(search)}
            email={me.data.email}
            scope={params.get("scope") ?? ""}
            busy={busy}
            error={error}
            onAllow={() => answer(true)}
            onDeny={() => answer(false)}
          />
        )}
      </div>
    </div>
  )
}
