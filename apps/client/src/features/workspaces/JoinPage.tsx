import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { getRouteApi, useNavigate } from "@tanstack/react-router"
import { Link } from "@bugberry/ui/link"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { Loading } from "../../components/ui"
import { WorkspaceTile } from "./WorkspaceMenu"
import { buttonStyles, Button } from "@bugberry/ui/button"
import { errorMessage } from "../../lib/query/unwrap"
import { accountQueries } from "../account/queries"
import { join as joinWorkspace, type JoinPreview, workspaceQueries } from "./queries"

const routeApi = getRouteApi("/join/$code")
const primaryLink = `${buttonStyles({ intent: "primary", size: "sm" })}`

/** The shared-link page without router or network: sign in, join, or "doesn't work". */
export function JoinView({
  code,
  signedIn,
  preview,
  busy = false,
  onJoin,
}: {
  code: string
  signedIn: boolean
  preview: JoinPreview | "invalid" | null
  busy?: boolean
  onJoin(): void
}) {
  if (!signedIn) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="font-heading text-2xl font-bold text-foreground">Join a workspace on BugBerry</h1>
        <Link href={`/login?next=${encodeURIComponent(`/join/${code}`)}`} className={`${primaryLink} self-start`}>
          Sign in to join
        </Link>
      </div>
    )
  }
  if (preview === "invalid") {
    return (
      <div className="flex flex-col gap-4">
        <p>This link or code doesn't work</p>
        <Link href="/app" className={`${primaryLink} self-start`}>
          Go to BugBerry
        </Link>
      </div>
    )
  }
  if (!preview) return <Loading />
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <WorkspaceTile workspace={preview.workspace} size="size-10" />
        <div className="min-w-0">
          <h1 className="truncate font-heading text-xl font-bold text-foreground">{preview.workspace.name}</h1>
          <p className="text-sm text-muted-foreground">
            Shared invite · {preview.workspace.memberCount} {preview.workspace.memberCount === 1 ? "member" : "members"}
          </p>
        </div>
      </div>
      {preview.alreadyMember ? (
        <Link href="/app" className={`${primaryLink} self-start`}>
          Open {preview.workspace.name}
        </Link>
      ) : (
        <Button size="sm" className="self-start" isDisabled={busy} onPress={onJoin}>
          {`Join ${preview.workspace.name}`}
        </Button>
      )}
    </div>
  )
}

/** `/join/<code>`: a workspace's shared invite link. Works signed out, so the person can sign in first. */
export function JoinPage() {
  const { code } = routeApi.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ ...accountQueries.me(), retry: false, meta: { signedOutIsFine: true } })
  const preview = useQuery({ ...workspaceQueries.sharedInvite(code), enabled: Boolean(me.data) })
  const join = useMutation({
    mutationFn: () => joinWorkspace(`/join/${code}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth-methods" })
      await navigate({ to: "/app" })
    },
  })

  return (
    <div className="flex min-h-screen flex-col items-center bg-muted px-4 py-16">
      <div className="flex w-full max-w-md flex-col gap-8 rounded-2xl border border-border bg-background p-8">
        <BugBerryLogo />
        {me.isPending ? (
          <Loading />
        ) : (
          <JoinView
            code={code}
            signedIn={Boolean(me.data)}
            preview={preview.isError ? "invalid" : (preview.data ?? null)}
            busy={join.isPending}
            onJoin={() => join.mutate()}
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
