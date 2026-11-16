import { describe, expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { LABEL_COLORS } from "@bugberry/shared"
import { LabelChip, LabelChips } from "../src/features/labels/LabelChip"
import { labelColorClass } from "../src/features/labels/label-colors"

const label = (name: string, color = "gray" as const) => ({ id: name.toLowerCase(), name, color })
const fiveLabels = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((name) => label(name))

describe("label chips", () => {
  test("a chip shows the label's name in its color", () => {
    render(<LabelChip label={{ name: "Checkout", color: "red" }} />)
    const chip = screen.getByText("Checkout")
    expect(chip.className).toContain(labelColorClass("red").split(" ")[0]!)
    expect(chip.getAttribute("title")).toBe("Checkout")
  })

  test("three chips, then how many more", () => {
    render(<LabelChips labels={fiveLabels} max={3} />)
    expect(screen.getByText("Alpha")).toBeTruthy()
    expect(screen.queryByText("Delta")).toBeNull()
    expect(screen.getByText("+2").getAttribute("title")).toBe("Delta, Echo")
  })

  test("no labels: nothing at all", () => {
    const { container } = render(<LabelChips labels={[]} max={3} />)
    expect(container.innerHTML).toBe("")
  })

  test("every color has its own classes", () => {
    const classes = LABEL_COLORS.map(labelColorClass)
    expect(new Set(classes).size).toBe(LABEL_COLORS.length)
  })
})
