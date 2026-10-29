import { describe, expect, mock, test } from "bun:test"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen } from "@testing-library/react"
import { ReportUnavailable } from "../src/pages/ReportPage"
import { ApiError } from "../src/lib/query/unwrap"

function show(error: unknown, onRetry = () => {}) {
  const client = new QueryClient()
  client.setQueryData(["me"], { id: "u1", name: "Ana", email: "ana@kantor.test", image: null, lastWorkspaceId: "w1" })
  return render(
    <QueryClientProvider client={client}>
      <ReportUnavailable error={error} onRetry={onRetry} />
    </QueryClientProvider>,
  )
}

describe("ReportUnavailable", () => {
  test("a report that isn't there gets the 404 page, whose Home leads back to the reports", () => {
    show(new ApiError(404, "report_not_found", "Report not found"))
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This page rolled off the vine.")
    expect(screen.getByText("This report was deleted, or it isn't in a workspace you're in.")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/app")
  })

  test("a server that can't be reached offers to try again", () => {
    const onRetry = mock()
    show(new ApiError(0, "network", "offline"), onRetry)
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
