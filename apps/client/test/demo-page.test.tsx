import { describe, expect, test } from "bun:test"
import type { DemoRequestInput } from "@bugberry/shared"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { ApiError } from "../src/lib/api"
import { DemoView } from "../src/pages/landing/DemoView"
import { CHROME_WEB_STORE_URL } from "../src/pages/landing/site-links"

function fill() {
  fireEvent.change(screen.getByLabelText("First name"), { target: { value: " Hannan " } })
  fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Rozen" } })
  fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "hannan@northwind.test" } })
  fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Northwind Commerce" } })
  fireEvent.change(screen.getByLabelText("Issue tracker"), { target: { value: "Jira" } })
  fireEvent.click(screen.getByLabelText("11–50"))
  fireEvent.change(screen.getByLabelText("What would you like to see?"), { target: { value: "Checkout bugs to Jira" } })
  fireEvent.click(screen.getByLabelText("I’m interested in self-hosting BugBerry"))
}

describe("DemoView", () => {
  test("sends the request once, then thanks the visitor", async () => {
    const sent: DemoRequestInput[] = []
    let finish = () => {}
    const submit = (input: DemoRequestInput) => {
      sent.push(input)
      return new Promise<void>((resolve) => (finish = resolve))
    }
    render(<DemoView signedIn={false} installUrl={null} submit={submit} />)
    fill()
    const button = screen.getByRole("button", { name: "Book my demo" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(sent).toEqual([
      {
        firstName: "Hannan",
        lastName: "Rozen",
        email: "hannan@northwind.test",
        company: "Northwind Commerce",
        tracker: "Jira",
        teamSize: "11–50",
        message: "Checkout bugs to Jira",
        selfHosting: true,
        website: "",
      },
    ])
    expect((screen.getByRole("button", { name: /Book my demo|Sending/ }) as HTMLButtonElement).disabled).toBe(true)
    finish()
    await waitFor(() => expect(screen.getByText("We’ll reply within one business day.")).toBeTruthy())
    expect(screen.queryByRole("button", { name: "Book my demo" })).toBeNull()
  })

  test("a failed request says why and keeps what was typed", async () => {
    render(<DemoView signedIn={false} installUrl={null} submit={() => Promise.reject(new Error("Too many requests, try again later"))} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: "Book my demo" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Too many requests"))
    expect((screen.getByLabelText("Company") as HTMLInputElement).value).toBe("Northwind Commerce")
  })

  test("an empty work email is not sent", () => {
    const sent: DemoRequestInput[] = []
    render(<DemoView signedIn={false} installUrl={null} submit={async (input) => void sent.push(input)} />)
    fill()
    fireEvent.change(screen.getByLabelText("Work email"), { target: { value: "" } })
    fireEvent.click(screen.getByRole("button", { name: "Book my demo" }))
    expect(sent).toEqual([])
  })

  test("a name of only spaces is caught here, with a message on that field", () => {
    const sent: DemoRequestInput[] = []
    render(<DemoView signedIn={false} installUrl={null} submit={async (input) => void sent.push(input)} />)
    fill()
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "   " } })
    fireEvent.click(screen.getByRole("button", { name: "Book my demo" }))
    expect(sent).toEqual([])
    const field = screen.getByLabelText("First name")
    expect(field.getAttribute("aria-invalid")).toBe("true")
    expect(document.getElementById(field.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Enter your first name.")
    // Fixing it clears the message.
    fireEvent.change(field, { target: { value: "Hannan" } })
    expect(field.getAttribute("aria-invalid")).toBeNull()
  })

  test("when the server turns a field down, the message names it", async () => {
    const refused = new ApiError(422, "validation", "Invalid request", {
      code: "validation",
      details: [{ path: "/company", message: "Expected string to match pattern" }],
    })
    render(<DemoView signedIn={false} installUrl={null} submit={() => Promise.reject(refused)} />)
    fill()
    fireEvent.click(screen.getByRole("button", { name: "Book my demo" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Check your company and try again."))
    expect(screen.getByLabelText("Company").getAttribute("aria-invalid")).toBe("true")
  })

  test("the quote is Hannan Rozen's, and the page offers trying it alone", () => {
    render(<DemoView signedIn={false} installUrl={null} submit={async () => {}} />)
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("See BugBerry on your own bugs")
    const text = document.body.textContent ?? ""
    expect(text).toContain("Hannan Rozen")
    for (const gone of ["Rozen Han", "15-min", "Try it with your team"]) expect(text).not.toContain(gone)
    expect(screen.getByRole("link", { name: /Add BugBerry to Chrome, it’s free/ }).getAttribute("href")).toBe(CHROME_WEB_STORE_URL)
    // Example values are hints, never typed in for the visitor.
    expect((screen.getByLabelText("First name") as HTMLInputElement).value).toBe("")
  })
})
