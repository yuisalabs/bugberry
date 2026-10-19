import { fireEvent, screen } from "@testing-library/react"

/** Opens the Intent Select labelled `label` and picks `option`, the way a click does. */
export function choose(label: string, option: string) {
  fireEvent.click(screen.getByLabelText(label))
  fireEvent.click(screen.getByRole("option", { name: option }))
}

/** Intent's FileTrigger keeps its file input hidden behind the button; tests hand files to that input. */
export function fileInput(index = 0) {
  const input = document.querySelectorAll<HTMLInputElement>('input[type="file"]')[index]
  if (!input) throw new Error("no file input")
  return input
}
