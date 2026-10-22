import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { ApiError } from "../src/lib/api"
import { lastSessionEnd, sessionEndTarget } from "../src/lib/session-end"
import { maintenanceOf, statusKind } from "../src/lib/status"

describe("statusKind", () => {
  test("names the page for each answer the server can give", () => {
    expect(statusKind(new ApiError(400, "bad_request", "Malformed request body"))).toBe("400")
    expect(statusKind(new ApiError(422, "validation", "Invalid request"))).toBe("400")
    expect(statusKind(new ApiError(401, "unauthorized", "Login required"))).toBe("401")
    expect(statusKind(new ApiError(403, "forbidden", "You are not allowed to do this"))).toBe("403")
    expect(statusKind(new ApiError(404, "report_not_found", "Report not found"))).toBe("404")
    expect(statusKind(new ApiError(500, "internal", "Internal server error"))).toBe("500")
    expect(statusKind(new ApiError(504, "error", "The request failed. Try again."))).toBe("504")
  })

  test("a server that can't be reached, or a proxy with nothing behind it, is a 503", () => {
    expect(statusKind(new ApiError(0, "network", "BugBerry can't be reached."))).toBe("503")
    expect(statusKind(new ApiError(502, "error", "The request failed. Try again."))).toBe("503")
    expect(statusKind(new ApiError(503, "error", "The request failed. Try again."))).toBe("503")
  })

  test("maintenance is its own page, whatever the status", () => {
    expect(statusKind(new ApiError(503, "maintenance", "BugBerry is down for maintenance"))).toBe("maintenance")
  })

  test("a crash in the page itself, or an answer no page fits, is a 500", () => {
    expect(statusKind(new TypeError("x is undefined"))).toBe("500")
    expect(statusKind(new ApiError(409, "slug_taken", "Taken"))).toBe("500")
    expect(statusKind(new ApiError(0, "empty", "The server sent an empty response"))).toBe("500")
  })
})

describe("maintenanceOf", () => {
  test("reads the message and the time BugBerry should be back", () => {
    const error = new ApiError(503, "maintenance", "Upgrading the database", {
      code: "maintenance",
      message: "Upgrading the database",
      until: "2026-10-24T14:30:00Z",
    })
    expect(maintenanceOf(error)).toEqual({ message: "Upgrading the database", until: new Date("2026-10-24T14:30:00Z") })
  })

  test("a missing or broken time is left out rather than guessed", () => {
    const error = new ApiError(503, "maintenance", "", { code: "maintenance", until: "soon" })
    expect(maintenanceOf(error)).toEqual({ message: null, until: null })
  })

  test("anything else is not maintenance", () => {
    expect(maintenanceOf(new ApiError(503, "error", "down"))).toBeNull()
    expect(maintenanceOf(new Error("boom"))).toBeNull()
  })
})

describe("sessionEndTarget", () => {
  const signedIn = () => {
    const client = new QueryClient()
    client.setQueryData(["me"], { id: "u1", name: "Hannan Rozen", email: "hannan@northwind.test", image: null, lastWorkspaceId: null })
    return client
  }

  test("someone whose session ended mid-use sees the 401 page, which remembers who they were", () => {
    const client = signedIn()
    const at = new Date("2026-10-23T09:15:00Z")
    expect(sessionEndTarget(client, { pathname: "/app/p/web", href: "/app/p/web?status=open" }, at)).toEqual({
      to: "/session-ended",
      search: { next: "/app/p/web?status=open" },
    })
    expect(lastSessionEnd()).toEqual({ name: "Hannan Rozen", email: "hannan@northwind.test", at })
    // The old session's answer is dropped, so the dashboard asks again after the next sign-in.
    expect(client.getQueryData(["me"])).toBeUndefined()
  })

  test("someone who never signed in goes straight to sign-in", () => {
    expect(sessionEndTarget(new QueryClient(), { pathname: "/s/abc", href: "/s/abc" })).toEqual({
      to: "/login",
      search: { next: "/s/abc" },
    })
  })

  test("nothing happens on the sign-in page or the 401 page itself", () => {
    expect(sessionEndTarget(signedIn(), { pathname: "/login", href: "/login" })).toBeNull()
    expect(sessionEndTarget(signedIn(), { pathname: "/session-ended", href: "/session-ended?next=/app" })).toBeNull()
  })
})
