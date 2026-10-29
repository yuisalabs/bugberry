import { RiLink, RiLoginBoxLine } from "@remixicon/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useEffect, useRef, useState } from "react"
import { Dialog, DialogBody, DialogHeader, DialogTitle } from "@bugberry/ui/dialog"
import { Button } from "@bugberry/ui/button"
import { Label } from "@bugberry/ui/field"
import { Input, InputGroup } from "@bugberry/ui/input"
import { TextField } from "@bugberry/ui/text-field"
import { plausibleJoinValue } from "./join-value"
import { WorkspaceTile } from "./WorkspaceMenu"
import { ApiError, errorMessage } from "../../lib/query/unwrap"
import { accountQueries } from "../account/queries"
import {
  acceptMyInvitation,
  join,
  joinByDomain,
  type JoinPreview,
  joinPreview,
  type MyInvitation,
  useCancelJoinRequest,
  workspaceQueries,
} from "./queries"
import { qk } from "../../lib/query/keys"

export type PreviewState = { status: "idle" | "checking" | "invalid" } | { status: "found"; data: JoinPreview }
export type DomainWorkspace = {
  workspace: { id: string; name: string; logoUrl: string | null; memberCount: number }
  mode: "direct" | "approval"
  requested: boolean
}

const members = (count: number) => `${count} ${count === 1 ? "member" : "members"}`

/**
 * Every way into a workspace: paste an invite link or code (personal or shared), accept an invitation
 * waiting for my email, or join a workspace that takes my email domain. Network calls come in through props.
 */
export function JoinWorkspaceBody({
  invitations,
  domainWorkspaces,
  domain = null,
  preview,
  busy,
  onValue,
  onJoinCode,
  onJoinInvitation,
  onDomain,
  onCancelRequest,
}: {
  invitations: readonly MyInvitation[]
  domainWorkspaces: readonly DomainWorkspace[]
  /** My email domain, for "Anyone with @domain can join". */
  domain?: string | null
  preview: PreviewState
  busy: boolean
  onValue(value: string): void
  onJoinCode(): void
  onJoinInvitation(id: string): void
  onDomain(workspaceId: string): void
  onCancelRequest(workspaceId: string): void
}) {
  const [value, setValue] = useState("")
  const found = preview.status === "found" ? preview.data : null

  return (
    <div className="flex flex-col gap-4">
      <TextField
        value={value}
        onChange={(next) => {
          setValue(next)
          onValue(next)
        }}
      >
        <Label>Invite link or code</Label>
        <InputGroup>
          <RiLink aria-hidden data-slot="icon" />
          <Input placeholder="https://…/invite/… or 7KX-29QF" className="font-mono placeholder:font-sans" />
        </InputGroup>
        {preview.status === "invalid" && <p className="text-xs text-danger-subtle-foreground">This link or code doesn't work</p>}
        {preview.status === "checking" && <p className="text-xs text-muted-foreground">Checking…</p>}
      </TextField>

      {found && (
        <section aria-label={found.workspace.name} className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-subtle/50 p-3">
          <WorkspaceTile workspace={found.workspace} size="size-9" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold text-foreground">{found.workspace.name}</span>
            <span className="text-xs text-muted-foreground">
              {found.via === "invitation" ? `Invited by ${found.inviterName ?? "someone"} · ` : "Shared invite · "}
              {members(found.workspace.memberCount)}
            </span>
          </span>
          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground">Member</span>
        </section>
      )}
      {found && !found.alreadyMember && (
        <Button size="sm" className="self-end" isDisabled={busy} onPress={onJoinCode}>
          {`Join ${found.workspace.name}`}
        </Button>
      )}
      {found?.alreadyMember && <p className="text-sm text-muted-foreground">You're already in {found.workspace.name}.</p>}

      {invitations.length > 0 && (
        <ul className="flex flex-col gap-2">
          {invitations.map((invitation) => (
            <li key={invitation.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-medium text-foreground">{invitation.workspaceName}</span>
                <span className="text-xs text-muted-foreground">Invited by {invitation.inviterName ?? "someone"}</span>
              </span>
              <Button size="sm" isDisabled={busy} aria-label={`Join ${invitation.workspaceName}`} onPress={() => onJoinInvitation(invitation.id)}>
                Join
              </Button>
            </li>
          ))}
        </ul>
      )}

      {domainWorkspaces.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            or join with your email domain
            <span className="h-px flex-1 bg-border" />
          </div>
          <ul className="flex flex-col gap-2">
            {domainWorkspaces.map((row) => (
              <li key={row.workspace.id} className="flex items-center gap-3 rounded-lg border border-border p-3">
                <WorkspaceTile workspace={row.workspace} size="size-8" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{row.workspace.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.mode === "direct" ? `Anyone with @${domain ?? "your domain"} can join` : "Needs approval from an admin"}
                  </span>
                </span>
                {row.requested ? (
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Requested</span>
                    <Button size="sm" intent="plain" isDisabled={busy} onPress={() => onCancelRequest(row.workspace.id)}>
                      Cancel request
                    </Button>
                  </span>
                ) : (
                  <Button size="sm" intent="outline" isDisabled={busy} onPress={() => onDomain(row.workspace.id)}>
                    {row.mode === "direct" ? "Join" : "Request"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

const PREVIEW_DEBOUNCE_MS = 400

/** JoinWorkspaceBody wired to the API; `onJoined` runs after any join (the workspace is now the current one). */
export function JoinWorkspacePanel({ onJoined }: { onJoined(): void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const me = useQuery(accountQueries.me())
  const invitations = useQuery(workspaceQueries.myInvitations())
  const domainWorkspaces = useQuery(workspaceQueries.domainWorkspaces())
  const [value, setValue] = useState("")
  const [preview, setPreview] = useState<PreviewState>({ status: "idle" })
  const [rateError, setRateError] = useState<string | null>(null)
  const latest = useRef(0)

  useEffect(() => {
    const text = value.trim()
    if (!plausibleJoinValue(text)) {
      // Drop any answer still on its way for an earlier value.
      latest.current += 1
      return setPreview({ status: "idle" })
    }
    setPreview({ status: "checking" })
    const ticket = ++latest.current
    const timer = setTimeout(() => {
      joinPreview(text).then(
        (data) => ticket === latest.current && setPreview({ status: "found", data }),
        (error: unknown) => {
          if (ticket !== latest.current) return
          // A 429 (too many tries) also reads as "doesn't work"; the error line below says why.
          setPreview({ status: "invalid" })
          if (error instanceof ApiError && error.status === 429) setRateError(errorMessage(error))
        },
      )
    }, PREVIEW_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [value])

  const joined = async () => {
    await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "auth-methods" })
    onJoined()
    await navigate({ to: "/app" })
  }
  const byCode = useMutation({ mutationFn: () => join(value.trim()), onSuccess: joined })
  const byInvitation = useMutation({ mutationFn: (id: string) => acceptMyInvitation(id), onSuccess: joined })
  const byDomain = useMutation({
    mutationFn: (workspaceId: string) => joinByDomain(workspaceId),
    onSuccess: async (result) => {
      if ("requested" in result) await queryClient.invalidateQueries({ queryKey: qk.domainWorkspaces })
      else await joined()
    },
  })
  const cancel = useCancelJoinRequest()

  const error = byCode.error ?? byInvitation.error ?? byDomain.error ?? cancel.error
  return (
    <>
      <JoinWorkspaceBody
        invitations={invitations.data ?? []}
        domainWorkspaces={domainWorkspaces.data ?? []}
        domain={me.data?.email.split("@")[1] ?? null}
        preview={preview}
        busy={byCode.isPending || byInvitation.isPending || byDomain.isPending || cancel.isPending}
        onValue={(next) => {
          setRateError(null)
          setValue(next)
        }}
        onJoinCode={() => byCode.mutate()}
        onJoinInvitation={(id) => byInvitation.mutate(id)}
        onDomain={(id) => byDomain.mutate(id)}
        onCancelRequest={(id) => cancel.mutate(id)}
      />
      {(error || rateError) && (
        <p role="alert" className="mt-2 text-sm text-danger-subtle-foreground">
          {rateError ?? errorMessage(error)}
        </p>
      )}
    </>
  )
}

export function JoinWorkspaceDialog({ isOpen, onOpenChange }: { isOpen: boolean; onOpenChange(open: boolean): void }) {
  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} aria-label="Join a workspace" size="lg">
      <DialogHeader className="flex flex-row items-start gap-3">
        <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
          <RiLoginBoxLine className="size-4" />
        </span>
        <span className="flex flex-col gap-0.5">
          <DialogTitle>Join a workspace</DialogTitle>
          <span className="text-sm text-muted-foreground">Paste the invite link or code a teammate sent you.</span>
        </span>
      </DialogHeader>
      <DialogBody>{isOpen && <JoinWorkspacePanel onJoined={() => onOpenChange(false)} />}</DialogBody>
    </Dialog>
  )
}
