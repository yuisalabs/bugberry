import { describe, expect, test } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { ReportsView } from "../src/components/ReportsView"
import { APP_MAIN_ID } from "../src/lib/app-scroll"
import { createAppRouter } from "../src/router"

function props(): ComponentProps<typeof ReportsView> {
  return {
    title: "All reports",
    members: [],
    search: {},
    list: { items: [], total: 0, hasMore: false, loadingMore: false, moreFailed: false },
    now: 0,
    canInvite: false,
    onInvite: () => {},
    newReport: null,
    layout: "grid",
    onLayout: () => {},
    onSearch: () => {},
    onLoadMore: () => {},
  }
}

describe("the app's scrolling", () => {
  test("the title, search and filters of a report list stay at the top while the reports scroll", () => {
    render(<ReportsView {...props()} />)
    const bar = screen.getByRole("heading", { name: "All reports" }).closest("[data-sticky-bar]") as HTMLElement
    expect(bar.className).toContain("md:sticky")
    // The main column has 24 px of padding on top, and a sticky element stops below it; -24 px puts the bar at
    // the very top, so no report shows above it.
    expect(bar.className).toContain("md:-top-6")
    expect(bar.contains(screen.getByRole("button", { name: /Status/ }))).toBe(true)
  })

  test("moving to another page starts the main content at its top", () => {
    const router = createAppRouter(new QueryClient())
    expect(router.options.scrollToTopSelectors).toContain(`#${APP_MAIN_ID}`)
  })
})
