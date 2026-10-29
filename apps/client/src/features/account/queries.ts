import { type QueryClient, queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"

export const me = () => unwrap(eden.api.me.get())
export const myLimits = () => unwrap(eden.api.me.limits.get())
export const updateName = (name: string) => unwrap(eden.api.me.patch({ name }))
export const avatarUploadTarget = (contentType: "image/png" | "image/jpeg", size: number) =>
  unwrap(eden.api.me.avatar.post({ contentType, size }))
export const confirmAvatar = (avatarId: string) => unwrap(eden.api.me.avatar({ avatarId }).post())
export const removeAvatar = () => unwrap(eden.api.me.avatar.delete())
export const signInMethods = () => unwrap(eden.api.me["sign-in-methods"].get())

export type Me = Awaited<ReturnType<typeof me>>
export type MyLimits = Awaited<ReturnType<typeof myLimits>>

export const accountQueries = {
  me: () => queryOptions({ queryKey: qk.me, queryFn: () => me(), staleTime: 60_000 }),
  /** Whether "Create workspace" is offered (ACCOUNT_LIMITS). */
  myLimits: () => queryOptions({ queryKey: qk.myLimits, queryFn: () => myLimits(), staleTime: 60_000 }),
  signInMethods: () => queryOptions({ queryKey: qk.signInMethods, queryFn: () => signInMethods() }),
}

/** Names and photos show in the menu, members, comments and cards. */
export const refreshPeople = (queryClient: QueryClient) =>
  queryClient.invalidateQueries({
    predicate: (query) =>
      [qk.me[0], qk.members("")[0], qk.workspaces[0], qk.reports.all[0], qk.comments("")[0]].includes(String(query.queryKey[0])),
  })

export function useUpdateName() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: (name: string) => updateName(name), onSuccess: () => refreshPeople(queryClient) })
}

export function useRemoveAvatar() {
  const queryClient = useQueryClient()
  return useMutation({ mutationFn: () => removeAvatar(), onSuccess: () => refreshPeople(queryClient) })
}
