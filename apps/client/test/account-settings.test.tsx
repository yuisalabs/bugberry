import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen } from "@testing-library/react"
import { AccountSettingsView } from "../src/pages/settings/AccountSettingsPage"
import { fileInput } from "./fields"

const me = { id: "u1", name: "Budi", email: "budi@kantor.test", image: null }

function view(overrides: Partial<Parameters<typeof AccountSettingsView>[0]> = {}) {
  const props = {
    me,
    methods: ["google", "email"] as Array<"google" | "github" | "gitlab" | "email">,
    busy: false,
    onSaveName: mock(),
    onUpload: mock(async () => {}),
    onRemovePhoto: mock(),
    ...overrides,
  }
  render(<AccountSettingsView {...props} />)
  return props
}

const pick = (input: HTMLElement, file: File) => fireEvent.change(input, { target: { files: [file] } })

describe("AccountSettingsView", () => {
  test("account settings shows and saves the profile", () => {
    const props = view()
    expect(screen.getByRole("heading", { name: "Account settings" })).toBeTruthy()
    const name = screen.getByRole("textbox", { name: "Display name" }) as HTMLInputElement
    expect(name.value).toBe("Budi")
    fireEvent.change(name, { target: { value: "  Budi S " } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    expect(props.onSaveName).toHaveBeenCalledWith("Budi S")
    fireEvent.change(name, { target: { value: "   " } })
    expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true)

    const email = screen.getByRole("textbox", { name: "Email" }) as HTMLInputElement
    expect(email.value).toBe("budi@kantor.test")
    expect(email.readOnly).toBe(true)
    expect(screen.getByText("Your email comes from how you sign in and can't be changed here.")).toBeTruthy()
    const methods = screen.getByRole("list", { name: "Sign-in methods" })
    expect(methods.textContent).toContain("Google")
    expect(methods.textContent).toContain("Email code")
  })

  test("photo upload checks the file first", () => {
    const props = view()
    expect(screen.getByRole("button", { name: "Upload photo" })).toBeTruthy()
    const input = fileInput()
    pick(input, new File([new Uint8Array(3 * 1024 * 1024)], "big.png", { type: "image/png" }))
    expect(screen.getByRole("alert").textContent).toBe("PNG or JPG, up to 2 MB")
    pick(input, new File([new Uint8Array(10)], "cat.gif", { type: "image/gif" }))
    expect(props.onUpload).not.toHaveBeenCalled()
    const small = new File([new Uint8Array(10)], "me.png", { type: "image/png" })
    pick(input, small)
    expect(props.onUpload).toHaveBeenCalledWith(small)
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull()
  })

  test("Remove shows only with a photo", () => {
    const props = view({ me: { ...me, image: "http://localhost:3000/api/avatars/u1/a.png" } })
    fireEvent.click(screen.getByRole("button", { name: "Remove" }))
    expect(props.onRemovePhoto).toHaveBeenCalled()
  })
})
