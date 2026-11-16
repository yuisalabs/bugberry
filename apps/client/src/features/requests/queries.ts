import { queryOptions } from "@tanstack/react-query"
import { eden } from "../../lib/query/eden"
import { qk } from "../../lib/query/keys"
import { unwrap } from "../../lib/query/unwrap"
import type { RequestApi, StartBody } from "./request-upload"

const byToken = (token: string) => eden.api["recording-requests"]["by-token"]({ token })

export const requestLink = (token: string) => unwrap(byToken(token).get())

/** The public side of a request link, and the upload ticket it hands out; no session is needed. */
export const requestApi: RequestApi = {
  start: (token: string, body: StartBody) => unwrap(byToken(token).uploads.post(body)),
  ticket: (uploadToken: string) => unwrap(eden.api["agent-uploads"]({ token: uploadToken }).get()),
  finalize: (uploadToken: string) => unwrap(eden.api["agent-uploads"]({ token: uploadToken }).finalize.post()),
}

export type RequestLinkInfo = Awaited<ReturnType<typeof requestLink>>

export const requestQueries = {
  link: (token: string) => queryOptions({ queryKey: qk.requestLink(token), queryFn: () => requestLink(token), retry: false, staleTime: Infinity }),
}
