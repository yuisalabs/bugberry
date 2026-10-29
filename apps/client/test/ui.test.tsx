import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { Button } from "@bugberry/ui/button"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { EmptyState, Loading, PageLoading } from "../src/components/ui"

describe("ui wrappers", () => {
  test("an Intent Button submits its form and honours isDisabled", () => {
    const onSubmit = mock((event: Event) => event.preventDefault())
    const onClick = mock()
    render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent)}>
        <Button type="submit">Send</Button>
        <Button onPress={onClick} isDisabled>
          Delete
        </Button>
      </form>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Send" }))
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const disabled = screen.getByRole("button", { name: "Delete" })
    fireEvent.click(disabled)
    expect(onClick).not.toHaveBeenCalled()
    expect((disabled as HTMLButtonElement).disabled).toBe(true)
  })

  test("an Intent Button click reaches its onPress", () => {
    const onClick = mock()
    render(<Button onPress={onClick}>Save</Button>)
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  test("a caller's classes win over the Intent button's own, instead of both landing", () => {
    render(<Button className="px-2">Sign out</Button>)
    const classes = screen.getByRole("button", { name: "Sign out" }).className.split(/\s+/)
    expect(classes).toContain("px-2")
    expect(classes.filter((name) => /^px-/.test(name))).toEqual(["px-2"])
  })

  test("Loading and EmptyState keep their accessible text", () => {
    render(
      <>
        <Loading />
        <EmptyState title="No reports yet">Content</EmptyState>
      </>,
    )
    expect(screen.getByRole("status").textContent).toContain("Loading")
    expect(screen.getByText("No reports yet")).toBeTruthy()
  })

  test("a page that has nothing else to show yet waits in the middle of the screen", () => {
    render(<PageLoading label="Redirecting to sign in…" />)
    const status = screen.getByRole("status")
    expect(status.textContent).toContain("Redirecting to sign in…")
    for (const name of ["min-h-dvh", "items-center", "justify-center"]) expect(status.className).toContain(name)
  })

  test("the pages that wait before showing anything use the centred loading", () => {
    const page = (path: string) => readFileSync(join(import.meta.dir, "..", "src", path), "utf8")
    for (const name of ["features/auth/LoginPage.tsx", "features/reports/share/SharePage.tsx"]) {
      expect(page(name)).toContain("return <PageLoading")
      expect(page(name)).not.toContain("return <Loading")
    }
  })
})
