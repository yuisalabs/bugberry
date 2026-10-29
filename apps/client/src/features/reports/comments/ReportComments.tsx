import { useQuery } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { reportQueries, useAddComment, useDeleteComment, useEditComment, useReact } from "../queries"
import { roleIn } from "../../workspaces/workspace"
import { CommentsSection } from "./CommentsSection"
import { PeopleRowsSkeleton } from "../../../components/Skeletons"
import { ErrorState } from "../../../components/ui"
import { errorMessage } from "../../../lib/query/unwrap"
import { accountQueries } from "../../account/queries"
import { workspaceQueries } from "../../workspaces/queries"

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
  const [showActivity, setShowActivity] = useState(readShowActivity)
  const me = useQuery(accountQueries.me())
  const workspaces = useQuery(workspaceQueries.workspaces())
  const comments = useQuery(reportQueries.comments(reportId))
  const activity = useQuery({ ...reportQueries.activity(reportId), enabled: showActivity })
  const members = useQuery(workspaceQueries.members(workspaceId))
  const hash = useLocation({ select: (location) => location.hash })
  const loaded = comments.isSuccess
  // A link to "#comment-<id>" (from the bell or an email) lands on that comment once comments load.
  useEffect(() => {
    if (!loaded || !hash.startsWith("comment-")) return
    document.getElementById(hash)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [loaded, hash])
  const add = useAddComment(reportId)
  const edit = useEditComment(reportId)
  const remove = useDeleteComment(reportId)
  const react = useReact(reportId)

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
