import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { api } from "../lib/client"
import { queries } from "../lib/queries"
import { roleIn } from "../lib/workspace"
import { CommentsSection } from "./comments/CommentsSection"
import { PeopleRowsSkeleton } from "./Skeletons"
import { ErrorState } from "./ui"
import { errorMessage } from "../lib/query/unwrap"
import { accountQueries } from "../features/account/queries"

/** This browser remembers whether the feed shows All activity; Comments only is the default. */
const TAB_KEY = "bugberry.commentsTab"

function readShowActivity(): boolean {
  try {
    return localStorage.getItem(TAB_KEY) === "activity"
  } catch {
    return false
  }
}

function saveShowActivity(on: boolean): void {
  try {
    localStorage.setItem(TAB_KEY, on ? "activity" : "comments")
  } catch {
    // Blocked storage just forgets the choice.
  }
}

export function ReportComments({ reportId, workspaceId }: { reportId: string; workspaceId: string }) {
  const queryClient = useQueryClient()
  const [showActivity, setShowActivity] = useState(readShowActivity)
  const me = useQuery(accountQueries.me())
  const workspaces = useQuery(queries.workspaces())
  const comments = useQuery(queries.comments(reportId))
  const activity = useQuery({ ...queries.activity(reportId), enabled: showActivity })
  const members = useQuery(queries.members(workspaceId))
  const hash = useLocation({ select: (location) => location.hash })
  const loaded = comments.isSuccess
  // A link to "#comment-<id>" (from the bell or an email) lands on that comment once comments load.
  useEffect(() => {
    if (!loaded || !hash.startsWith("comment-")) return
    document.getElementById(hash)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [loaded, hash])
  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.comments(reportId).queryKey })
  const add = useMutation({
    mutationFn: ({ body, replyTo }: { body: string; replyTo?: string }) => api.addComment(reportId, body, replyTo),
    onSuccess: refresh,
  })
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.editComment(id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteComment(id), onSuccess: refresh })
  const react = useMutation({
    mutationFn: ({ commentId, emoji }: { commentId: string; emoji: string }) => api.react(commentId, emoji),
    onSuccess: refresh,
  })

  if (comments.isPending || me.isPending) return <PeopleRowsSkeleton label="Loading comments…" />
  if (comments.isError) return <ErrorState error={comments.error} onRetry={() => void comments.refetch()} />
  if (me.isError) return <ErrorState error={me.error} />
  const error = add.error ?? edit.error ?? remove.error ?? react.error

  return (
    <div className="flex flex-col gap-2">
      <CommentsSection
        threads={comments.data}
        activity={activity.data ?? null}
        people={(members.data ?? []).map(({ id, name, email }) => ({ id, name, email }))}
        me={{
          id: me.data.id,
          role: roleIn(workspaces.data ?? [], workspaceId) ?? "member",
          name: me.data.name,
          image: me.data.image,
        }}
        busy={add.isPending || edit.isPending || remove.isPending}
        showActivity={showActivity}
        onShowActivity={(on) => {
          setShowActivity(on)
          saveShowActivity(on)
        }}
        onAdd={(body, replyTo) => add.mutateAsync({ body, replyTo })}
        onEdit={(id, body) => edit.mutateAsync({ id, body })}
        onDelete={(id) => remove.mutate(id)}
        onReact={(commentId, emoji) => react.mutate({ commentId, emoji })}
      />
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}
    </div>
  )
}
