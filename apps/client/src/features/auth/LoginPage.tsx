import { useQuery } from "@tanstack/react-query"
import { getRouteApi, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { LoginView } from "./LoginView"
import { ErrorPage } from "../../components/status/ErrorPage"
import { PageLoading } from "../../components/ui"
import { sendLoginCode, signInWithProvider, verifyLoginCode } from "./auth"
import { loginErrorMessage } from "./login"
import { loginTarget, oauthResumeUrl } from "./oauth"
import { safeNext } from "../../lib/urls"
import { authQueries } from "./queries"
import { queries } from "../../lib/queries"

const routeApi = getRouteApi("/login")

export function LoginPage() {
  const router = useRouter()
  const { next, error, error_description: errorDescription } = routeApi.useSearch()
  const me = useQuery({ ...queries.me(), retry: false })
  const methods = useQuery(authQueries.authMethods())
  const [startError, setStartError] = useState<string | null>(null)
  // An AI app's sign-in arrives with its signed request in the URL; after signing in it continues there.
  const [target] = useState(() => loginTarget(window.location.search, next))
  const resumesOAuth = oauthResumeUrl(window.location.search) !== null

  // Already signed in (e.g. a stale tab): continue to where the person was going.
  useEffect(() => {
    if (!me.isSuccess || error) return
    if (resumesOAuth) window.location.assign(target)
    else router.history.replace(safeNext(next))
  }, [me.isSuccess, error, next, router, resumesOAuth, target])

  if (methods.isPending) return <PageLoading />
  if (methods.isError) return <ErrorPage error={methods.error} onRetry={() => void methods.refetch()} />

  return (
    <LoginView
      methods={methods.data}
      message={startError ?? loginErrorMessage(error, errorDescription)}
      onProvider={(provider) => {
        setStartError(null)
        signInWithProvider(provider, target).catch((caught: unknown) =>
          setStartError(caught instanceof Error ? caught.message : String(caught)),
        )
      }}
      onSendCode={(email) => sendLoginCode(email)}
      onVerifyCode={(email, code) => verifyLoginCode(email, code, target)}
    />
  )
}
