import { useQuery } from "@tanstack/react-query"
import { getRouteApi, useRouter } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { LoginView } from "../components/LoginView"
import { ErrorState, Loading } from "../components/ui"
import { sendLoginCode, signInWithProvider, verifyLoginCode } from "../lib/auth"
import { loginErrorMessage } from "../lib/login"
import { queries } from "../lib/queries"
import { safeNext } from "../lib/urls"

const routeApi = getRouteApi("/login")

export function LoginPage() {
  const router = useRouter()
  const { next, error, error_description: errorDescription } = routeApi.useSearch()
  const me = useQuery({ ...queries.me(), retry: false })
  const methods = useQuery(queries.authMethods())
  const [startError, setStartError] = useState<string | null>(null)

  // Already signed in (e.g. a stale tab): continue to where the person was going.
  useEffect(() => {
    if (me.isSuccess && !error) router.history.replace(safeNext(next))
  }, [me.isSuccess, error, next, router])

  if (methods.isPending) return <Loading />
  if (methods.isError) {
    return (
      <div className="p-6">
        <ErrorState error={methods.error} onRetry={() => void methods.refetch()} />
      </div>
    )
  }

  return (
    <LoginView
      methods={methods.data}
      message={startError ?? loginErrorMessage(error, errorDescription)}
      onProvider={(provider) => {
        setStartError(null)
        signInWithProvider(provider, next).catch((caught: unknown) =>
          setStartError(caught instanceof Error ? caught.message : String(caught)),
        )
      }}
      onSendCode={(email) => sendLoginCode(email)}
      onVerifyCode={(email, code) => verifyLoginCode(email, code, next)}
    />
  )
}
