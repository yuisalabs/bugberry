import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useLocation } from "@tanstack/react-router"
import { useEffect } from "react"
import { errorMessage } from "../lib/api"
import { api } from "../lib/client"
import { queries } from "../lib/queries"
import { roleIn } from "../lib/workspace"
import { CommentList } from "./CommentList"
import { ErrorState, Loading } from "./ui"

export function ReportComments({ reportId, workspaceId }: { reportId: string; workspaceId: string }) {
  const queryClient = useQueryClient()
  const me = useQuery(queries.me())
  const workspaces = useQuery(queries.workspaces())
  const comments = useQuery(queries.comments(reportId))
  const members = useQuery(queries.members(workspaceId))
  const hash = useLocation({ select: (location) => location.hash })
  const loaded = comments.isSuccess
  // A link to "#comment-<id>" (from the bell or an email) lands on that comment once comments load.
  useEffect(() => {
    if (!loaded || !hash.startsWith("comment-")) return
    document.getElementById(hash)?.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [loaded, hash])
  const refresh = () => queryClient.invalidateQueries({ queryKey: queries.comments(reportId).queryKey })
  const add = useMutation({ mutationFn: (body: string) => api.addComment(reportId, body), onSuccess: refresh })
  const edit = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => api.editComment(id, body),
    onSuccess: refresh,
  })
  const remove = useMutation({ mutationFn: (id: string) => api.deleteComment(id), onSuccess: refresh })

  if (comments.isPending || me.isPending) return <Loading label="Loading comments…" />
  if (comments.isError) return <ErrorState error={comments.error} onRetry={() => void comments.refetch()} />
  if (me.isError) return <ErrorState error={me.error} />
  const error = add.error ?? edit.error ?? remove.error

  return (
    <div className="flex flex-col gap-2">
      <CommentList
        comments={comments.data}
        people={(members.data ?? []).map(({ id, name, email }) => ({ id, name, email }))}
        me={{ id: me.data.id, role: roleIn(workspaces.data ?? [], workspaceId) ?? "member" }}
        busy={add.isPending || edit.isPending || remove.isPending}
        onAdd={(body) => add.mutateAsync(body)}
        onEdit={(id, body) => edit.mutateAsync({ id, body })}
        onDelete={(id) => remove.mutate(id)}
      />
      {error && (
        <p role="alert" className="text-sm text-danger-subtle-foreground">
          {errorMessage(error)}
        </p>
      )}
    </div>
  )
}
