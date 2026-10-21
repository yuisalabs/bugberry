import { describe, expect, test } from "bun:test"
import { act, fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { useConfirm } from "@bugberry/ui/confirm-dialog"

/** A button that asks before acting, the way the app's delete buttons do. */
function Asker() {
  const { confirm, dialog } = useConfirm()
  const [answer, setAnswer] = useState("none")
  return (
    <>
      <button
        type="button"
        onClick={async () =>
          setAnswer(
            String(
              await confirm({
                title: "Delete this comment?",
                description: "Replies under it stay.",
                confirmLabel: "Delete",
              }),
            ),
          )
        }
      >
        Ask
      </button>
      <output>{answer}</output>
      {dialog}
    </>
  )
}

const ask = () => fireEvent.click(screen.getByRole("button", { name: "Ask" }))
const answer = () => screen.getByRole("status").textContent

describe("useConfirm", () => {
  test("asks in an alert dialog and answers yes when confirmed", async () => {
    render(<Asker />)
    ask()
    const dialog = screen.getByRole("alertdialog", { name: "Delete this comment?" })
    expect(dialog.textContent).toContain("Replies under it stay.")
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete" })))
    expect(answer()).toBe("true")
  })

  test("Cancel answers no", async () => {
    render(<Asker />)
    ask()
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Cancel" })))
    expect(answer()).toBe("false")
  })

  test("Escape answers no", async () => {
    render(<Asker />)
    ask()
    await act(async () => fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" }))
    expect(answer()).toBe("false")
  })
})
