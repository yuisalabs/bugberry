import { describe, expect, mock, test } from "bun:test"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { LogoPicker } from "../src/components/LogoPicker"
import { fileInput } from "./fields"

const png = (name = "logo.png", type = "image/png") => new File([new Uint8Array(100)], name, { type })
const sized = (width: number, height: number) => async () => ({ width, height })

describe("LogoPicker", () => {
  test("the logo picker checks the file", async () => {
    const onChange = mock()
    const { rerender } = render(<LogoPicker file={null} name="Javan QA" onChange={onChange} measure={sized(64, 64)} />)
    expect(screen.getByText("Using the first letter for now")).toBeTruthy()
    const input = fileInput()
    fireEvent.change(input, { target: { files: [png()] } })
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("PNG or JPG, at least 128 × 128 px"))
    expect(onChange).not.toHaveBeenCalled()

    rerender(<LogoPicker file={null} name="Javan QA" onChange={onChange} measure={sized(256, 256)} />)
    fireEvent.change(input, { target: { files: [png("logo.svg", "image/svg+xml")] } })
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(onChange).not.toHaveBeenCalled()

    const good = png()
    fireEvent.change(input, { target: { files: [good] } })
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(good))
  })

  test("a chosen logo shows as a preview", () => {
    render(<LogoPicker file={png()} name="Javan QA" onChange={mock()} measure={sized(256, 256)} />)
    expect(document.querySelector("img")).toBeTruthy()
    expect(screen.queryByText("Using the first letter for now")).toBeNull()
  })
})
