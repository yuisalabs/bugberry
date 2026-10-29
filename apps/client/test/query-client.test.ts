import { describe, expect, mock, test } from "bun:test"
import { createQueryClient } from "../src/lib/query/client"
import { ApiError } from "../src/lib/query/unwrap"

const unauthorized = () => Promise.reject(new ApiError(401, "unauthorized", "Unauthorized"))

describe("createQueryClient", () => {
  test("a 401 sends the person to sign in", async () => {
    const onUnauthorized = mock()
    const client = createQueryClient(onUnauthorized)
    await client.fetchQuery({ queryKey: ["x"], queryFn: unauthorized, retry: false }).catch(() => {})
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  test("a query that only asks whether someone is signed in never redirects", async () => {
    const onUnauthorized = mock()
    const client = createQueryClient(onUnauthorized)
    await client
      .fetchQuery({ queryKey: ["y"], queryFn: unauthorized, retry: false, meta: { signedOutIsFine: true } })
      .catch(() => {})
    expect(onUnauthorized).not.toHaveBeenCalled()
  })
})
