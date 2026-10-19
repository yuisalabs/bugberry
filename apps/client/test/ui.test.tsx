import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { Button } from "@bugberry/ui/button"
import { EmptyState, Loading } from "../src/components/ui"

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
})
