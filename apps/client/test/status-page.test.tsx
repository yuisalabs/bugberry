import { describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { ErrorPage } from "../src/components/status/ErrorPage"
import { StatusPage, type StatusPageProps } from "../src/components/status/StatusPage"
import { ApiError } from "../src/lib/query/unwrap"

function withClient(children: ReactNode, signedIn = false) {
  const client = new QueryClient()
  if (signedIn) client.setQueryData(["me"], { id: "u1", name: "Hannan Rozen", email: "hannan@northwind.test", image: null, lastWorkspaceId: null })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const show = (props: StatusPageProps, signedIn = false) => render(withClient(<StatusPage {...props} />, signedIn))
const heading = () => screen.getByRole("heading", { level: 1 }).textContent
const link = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href")

const KINDS: StatusPageProps[] = [
  { kind: "400" },
  { kind: "401", signInHref: "/login", ticket: { holder: null, account: null, gate: "/app", ended: null } },
  { kind: "403" },
  { kind: "404" },
  { kind: "500" },
  { kind: "503" },
  { kind: "504" },
  { kind: "maintenance" },
]

describe("StatusPage", () => {
  test("every page has its title, its code, BugBerry's logo and the privacy link", () => {
    const titles: Record<string, string> = {
      "400": "That request came out a little scrambled.",
      "401": "Tickets, please!",
      "403": "This patch is fenced off.",
      "404": "This page rolled off the vine.",
      "500": "Oops, we spilled the berries.",
      "503": "We're out tending the berry patch.",
      "504": "We waited, and waited… the vine timed out.",
      maintenance: "Fresh paint is drying. Please don't touch the fence!",
    }
    for (const props of KINDS) {
      const { unmount } = show(props)
      expect(heading()).toBe(titles[props.kind]!)
      // The 404's numerals stand either side of the drawing, so the code is read from the element, not its text.
      if (props.kind !== "maintenance") expect(screen.getByTestId("status-code").dataset.code).toBe(props.kind)
      expect(screen.getByRole("img", { name: "BugBerry" })).toBeTruthy()
      expect(link("Privacy")).toBe("/privacy")
      unmount()
    }
  })

  test("names the page in the browser tab", () => {
    show({ kind: "404" })
    expect(document.title).toBe("Page not found · BugBerry")
  })

  test("Home leads to the dashboard for someone signed in, else to the home page", () => {
    const { unmount } = show({ kind: "404" }, true)
    expect(link("Home")).toBe("/app")
    unmount()
    show({ kind: "404" })
    expect(link("Home")).toBe("/")
  })

  test("a page can say what was missing in its own words", () => {
    show({ kind: "404", description: "This link is wrong, was replaced, or the report isn't shared." })
    expect(screen.getByText("This link is wrong, was replaced, or the report isn't shared.")).toBeTruthy()
  })

  test("the server-side failures offer to try again", () => {
    for (const kind of ["500", "503", "504"] as const) {
      const onRetry = mock()
      const { unmount } = show({ kind, onRetry })
      fireEvent.click(screen.getByRole("button", { name: "Try again" }))
      expect(onRetry).toHaveBeenCalledTimes(1)
      unmount()
    }
    show({ kind: "500" })
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull()
  })

  test("401: a ticket with who was signed in, where they were going, and a way back in", () => {
    show({
      kind: "401",
      signInHref: "/login?next=%2Fapp%2Fp%2Fweb",
      ticket: { holder: "Hannan Rozen", account: "hannan@northwind.test", gate: "/app/p/web", ended: new Date(2026, 9, 21, 2, 4) },
    })
    expect(link("Sign in")).toBe("/login?next=%2Fapp%2Fp%2Fweb")
    const ticket = screen.getByRole("group", { name: "Your pass has expired" })
    for (const text of ["Hannan Rozen", "hannan@northwind.test", "/app/p/web", "21 Oct, 02:04", "EXPIRED"]) {
      expect(within(ticket).getByText(text)).toBeTruthy()
    }
    expect(screen.queryByRole("link", { name: "Home" })).toBeNull()
  })

  test("401: what isn't known is left off the ticket", () => {
    show({ kind: "401", signInHref: "/login", ticket: { holder: null, account: null, gate: "/app", ended: null } })
    const ticket = screen.getByRole("group", { name: "Your pass has expired" })
    expect(within(ticket).queryByText("HOLDER")).toBeNull()
    expect(within(ticket).queryByText("ENDED")).toBeNull()
    expect(within(ticket).getByText("/app")).toBeTruthy()
  })

  test("400: marks up the request when there is one, with a note beside each bad part", () => {
    show({
      kind: "400",
      request: { method: "GET", path: "/oauth/consent", lines: [{ text: "scope=", mark: "openid" }, { text: "", mark: "client_id", note: "missing" }] },
    })
    const paper = screen.getByTestId("marked-request")
    expect(within(paper).getByText("GET")).toBeTruthy()
    expect(within(paper).getByText("/oauth/consent")).toBeTruthy()
    expect(within(paper).getByText("client_id")).toBeTruthy()
    expect(within(paper).getByText("← missing")).toBeTruthy()
  })

  test("400: without a request, no made-up one", () => {
    show({ kind: "400" })
    expect(screen.queryByTestId("marked-request")).toBeNull()
  })

  test("504: shows how long the gateway waited, and only when it knows", () => {
    const { unmount } = show({ kind: "504", waitedMs: 30_000, at: new Date(2026, 9, 23, 14, 6, 42) })
    expect(screen.getByText("waited 30.0s")).toBeTruthy()
    expect(screen.getByText("sent 14:06:12")).toBeTruthy()
    unmount()
    show({ kind: "504" })
    expect(screen.queryByText(/waited \d/)).toBeNull()
    expect(screen.queryByText(/sent \d/)).toBeNull()
  })

  test("maintenance: the server's message and the time it should be back", () => {
    show({ kind: "maintenance", message: "Upgrading the database.", until: new Date(2026, 9, 24, 14, 30) })
    expect(screen.getByText("Upgrading the database.")).toBeTruthy()
    expect(screen.getByText(/Back around 14:30/)).toBeTruthy()
  })

  test("maintenance: without a message it says only what is true", () => {
    show({ kind: "maintenance" })
    expect(screen.getByText("We're giving BugBerry a little care. Everything you've captured is safe.")).toBeTruthy()
    expect(screen.queryByText(/Back around/)).toBeNull()
  })

  test("never claims what BugBerry doesn't do or know", () => {
    for (const props of KINDS) {
      const { unmount } = show(props)
      const text = document.body.textContent ?? ""
      for (const claim of ["paged", "storage engine", "faster search", "project owner", "BB-0412", "/api/v2", "14:30 UTC", "garden chores"]) {
        expect(text).not.toContain(claim)
      }
      unmount()
    }
  })
})

describe("ErrorPage", () => {
  const page = (error: unknown, onRetry?: () => void) => render(withClient(<ErrorPage error={error} onRetry={onRetry} />))

  test("picks the page from the error", () => {
    const cases: Array<[unknown, string]> = [
      [new ApiError(404, "report_not_found", "Report not found"), "This page rolled off the vine."],
      [new ApiError(403, "forbidden", "No"), "This patch is fenced off."],
      [new ApiError(0, "network", "offline"), "We're out tending the berry patch."],
      [new ApiError(504, "error", "timeout"), "We waited, and waited… the vine timed out."],
      [new TypeError("x is undefined"), "Oops, we spilled the berries."],
    ]
    for (const [error, title] of cases) {
      const { unmount } = page(error)
      expect(heading()).toBe(title)
      unmount()
    }
  })

  test("maintenance shows the server's notice", () => {
    page(new ApiError(503, "maintenance", "Moving to a bigger server", { code: "maintenance", message: "Moving to a bigger server" }))
    expect(screen.getByText("Moving to a bigger server")).toBeTruthy()
  })

  test("a crash never shows its raw message", () => {
    page(new TypeError("Cannot read properties of undefined (reading 'map')"), () => {})
    expect(document.body.textContent).not.toContain("Cannot read properties")
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy()
  })

  test("the 400 page lists the fields the server refused", () => {
    page(new ApiError(422, "validation", "Invalid request", { details: [{ path: "/title", message: "Expected string length less or equal to 200" }] }))
    const paper = screen.getByTestId("marked-request")
    expect(within(paper).getByText("title")).toBeTruthy()
    expect(within(paper).getByText("← Expected string length less or equal to 200")).toBeTruthy()
  })
})
