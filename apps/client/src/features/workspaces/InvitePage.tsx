import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Link } from "@bugberry/ui/link"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { Loading } from "../../components/ui"
import { buttonStyles, Button } from "@bugberry/ui/button"
import { signOut } from "../auth/auth"
import { inviteView } from "./invite"
import { ApiError, errorMessage } from "../../lib/query/unwrap"
import { accountQueries } from "../account/queries"
import { acceptInvitation, type InvitationInfo, workspaceQueries } from "./queries"

const routeApi = getRouteApi("/invite/$token")
const primaryLink = `${buttonStyles({ intent: "primary", size: "sm" })}`

export function InviteView({
  token,
  info,
  meEmail,
  onJoin,
  onSignOut,
  busy = false,
}: {
  token: string
  info: InvitationInfo | "not_found"
  meEmail: string | null
  onJoin(): void
  onSignOut(): void
  busy?: boolean
}) {
  const state = inviteView(info, meEmail === null ? null : { email: meEmail })
  if (state === "unavailable" || info === "not_found") {
    return (
      <div className="flex flex-col gap-4">
        <p>This invite has expired or was withdrawn. Ask for a new one.</p>
        <Link href="/app" className={`${primaryLink} self-start`}>
          Go to BugBerry
        </Link>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-bold text-foreground">
        {info.inviterName} invited you to {info.workspaceName}
      </h1>
      {state === "sign-in" && (
        <>
          <p className="text-muted-foreground">Sign in as {info.email} to join.</p>
          <Link href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`} className={`${primaryLink} self-start`}>
            Sign in
          </Link>
        </>
      )}
      {state === "join" && (
        <Button size="sm" className="self-start" isDisabled={busy} onPress={onJoin}>
          Join {info.workspaceName}
        </Button>
      )}
      {state === "wrong-account" && (
        <>
          <p className="text-muted-foreground">
            This invite is for {info.email}; you're signed in as {meEmail}.
          </p>
          <Button size="sm" intent="outline" className="self-start" onPress={onSignOut}>
            Sign out
          </Button>
        </>
      )}
    </div>
  )
}

/** `/invite/<token>`: the link in an invitation email. Works signed out, so the person can sign in first. */
export function InvitePage() {
  const { token } = routeApi.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ ...accountQueries.me(), retry: false, meta: { signedOutIsFine: true } })
  const invite = useQuery(workspaceQueries.invitation(token))
  const join = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth-methods" })
      await navigate({ to: "/app" })
    },
  })

  const notFound = invite.error instanceof ApiError && invite.error.status === 404
  const loading = me.isPending || (invite.isPending && !notFound)
  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 py-16">
      <div className="flex w-full max-w-md flex-col gap-8 rounded-2xl border border-border bg-background p-8">
        <BugBerryLogo />
        {loading ? (
          <Loading />
        ) : invite.isError && !notFound ? (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {errorMessage(invite.error)}
          </p>
        ) : (
          <InviteView
            token={token}
            info={notFound || !invite.data ? "not_found" : invite.data}
            meEmail={me.data?.email ?? null}
            busy={join.isPending}
            onJoin={() => join.mutate()}
            onSignOut={() => {
              void signOut().then(() => {
                queryClient.clear()
                window.location.reload()
              })
            }}
          />
        )}
        {join.error && (
          <p role="alert" className="text-sm text-danger-subtle-foreground">
            {errorMessage(join.error)}
          </p>
        )}
      </div>
    </div>
  )
}
