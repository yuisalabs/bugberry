import { describe, expect, test } from "bun:test"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { usePageDrawer } from "../src/hooks/usePageDrawer"
import { APP_MAIN_ID, mayRestoreScroll } from "../src/lib/app-scroll"

function Page() {
  const drawer = usePageDrawer()
  return (
    <div>
      <p>{drawer.open ? "drawer open" : "drawer closed"}</p>
      <button type="button" onClick={() => drawer.setOpen(true)}>
        Open
      </button>
      <button type="button" onClick={() => drawer.setOpen(false)}>
        Close
      </button>
    </div>
  )
}

async function renderAt(path: string) {
  const router = createRouter({ routeTree: createRootRoute({ component: Page }), history: createMemoryHistory({ initialEntries: [path] }) })
  render(<RouterProvider router={router} />)
  await screen.findByText("drawer closed")
  return router
}

describe("usePageDrawer", () => {
  test("opens and closes on the same page", async () => {
    await renderAt("/app")
    fireEvent.click(screen.getByText("Open"))
    expect(screen.getByText("drawer open")).toBeTruthy()
    fireEvent.click(screen.getByText("Close"))
    expect(screen.getByText("drawer closed")).toBeTruthy()
  })

  test("a navigation closes it once the new page is drawn, and it opens again there", async () => {
    const router = await renderAt("/app")
    fireEvent.click(screen.getByText("Open"))

    await act(() => router.navigate({ to: "/app/settings/members" }))
    expect(await screen.findByText("drawer closed")).toBeTruthy()

    fireEvent.click(screen.getByText("Open"))
    expect(screen.getByText("drawer open")).toBeTruthy()
  })

  test("a change of search alone closes it too", async () => {
    const router = await renderAt("/app")
    fireEvent.click(screen.getByText("Open"))

    await act(() => router.navigate({ to: "/app", search: { q: "cart" } }))
    expect(await screen.findByText("drawer closed")).toBeTruthy()
  })
})

describe("mayRestoreScroll", () => {
  test("lets the router restore scroll positions when no drawer is shown", () => {
    expect(mayRestoreScroll()).toBe(true)
  })

  test("keeps the router away from a drawer that is still on screen, and puts the new page at the top", () => {
    const main = document.createElement("main")
    main.id = APP_MAIN_ID
    const sheet = document.createElement("div")
    sheet.dataset.slot = "sheet"
    document.body.append(main, sheet)
    const scrolled: unknown[] = []
    main.scrollTo = ((options: unknown) => void scrolled.push(options)) as typeof main.scrollTo
    try {
      expect(mayRestoreScroll()).toBe(false)
      expect(scrolled).toEqual([{ top: 0, left: 0 }])
    } finally {
      main.remove()
      sheet.remove()
    }
  })
})
