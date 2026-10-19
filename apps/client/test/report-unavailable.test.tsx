import { describe, expect, test } from "bun:test"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import { ReportUnavailable } from "../src/pages/ReportPage"

describe("ReportUnavailable", () => {
  test("a report that cannot be shown still leads back to all reports", async () => {
    const rootRoute = createRootRoute({
      component: () => <ReportUnavailable error={new Error("Report not found")} onRetry={() => {}} />,
    })
    const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ["/app/r/gone"] }) })
    render(<RouterProvider router={router} />)
    const back = (await screen.findByRole("link", { name: "All reports" })) as HTMLAnchorElement
    expect(new URL(back.href).pathname).toBe("/app")
    expect(screen.getByText("Report not found")).toBeTruthy()
  })
})
