import { useQuery } from "@tanstack/react-query"
import { getRouteApi } from "@tanstack/react-router"
import { useState } from "react"
import { LoginView } from "./LoginView"
import { ErrorPage } from "../../components/layout/ErrorPage"
import { PageLoading } from "../../components/ui/loading"
import { sendLoginCode, signInWithProvider, verifyLoginCode } from "./auth"
import { loginErrorMessage } from "./login"
import { loginTarget } from "./oauth"
import { authQueries } from "./queries"

const routeApi = getRouteApi("/login")

export function LoginPage() {
  const { next, error, error_description: errorDescription } = routeApi.useSearch()
  const methods = useQuery(authQueries.authMethods())
  const [startError, setStartError] = useState<string | null>(null)
  // An AI app's sign-in arrives with its signed request in the URL; after signing in it continues there.
  const [target] = useState(() => loginTarget(window.location.search, next))

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
