import { describe, expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { Markdown } from "@bugberry/ui/markdown"

/** The component's own root element. */
const show = (text: string, look: "description" | "comment" = "description") =>
  render(<Markdown look={look}>{text}</Markdown>).container.firstElementChild as HTMLElement

describe("Markdown: syntax", () => {
  test("lists, emphasis, strikethrough and inline code are elements", () => {
    const box = show("1. one\n2. two\n\n**bold** _it_ ~~gone~~ `code`")
    expect(screen.getAllByRole("listitem")).toHaveLength(2)
    for (const tag of ["strong", "em", "del", "code"]) expect(box.querySelector(tag)).not.toBeNull()
  })
  test("a fenced block keeps its lines and indentation, and scrolls sideways", () => {
    const pre = show("```\na\n  b\n```").querySelector("pre")
    expect(pre?.textContent).toBe("a\n  b\n")
    expect(pre?.className).toContain("overflow-x-auto")
  })
  test("a table scrolls inside its own box", () => {
    const table = show("| a | b |\n| - | - |\n| 1 | 2 |").querySelector("table")
    expect(table?.querySelectorAll("td")).toHaveLength(2)
    expect(table?.closest(".overflow-x-auto")).not.toBeNull()
  })
  test("a task list shows checkboxes that cannot be clicked", () => {
    const box = show("- [x] done\n- [ ] todo")
    const boxes = [...box.querySelectorAll<HTMLInputElement>("input[type=checkbox]")]
    expect(boxes.map((input) => [input.checked, input.disabled])).toEqual([[true, true], [false, true]])
  })
})

describe("Markdown: text written before Markdown", () => {
  test("one line break is one line break, also with Windows line endings", () => {
    expect(show("satu\ndua").querySelectorAll("p br")).toHaveLength(1)
    expect(show("satu\r\ndua").querySelectorAll("p br")).toHaveLength(1)
  })
  test("identifiers, arithmetic and Windows paths are left alone", () => {
    const box = show("snake_case_name dan 2 * 3 * 4 di C:\\Users\\erval")
    expect(box.querySelector("em, strong")).toBeNull()
    expect(box.textContent).toBe("snake_case_name dan 2 * 3 * 4 di C:\\Users\\erval")
  })
  test("raw HTML is shown as the characters typed", () => {
    const box = show('<script>alert(1)</script> <img src=x onerror=alert(1)> <iframe src="https://x.test"></iframe> <b>tebal</b>')
    expect(box.querySelector("script, img, iframe, b")).toBeNull()
    expect(box.textContent).toContain("<b>tebal</b>")
    expect(box.textContent).toContain("<script>alert(1)</script>")
  })
  test("a raw HTML block is a paragraph of text that keeps its line breaks", () => {
    const box = show("<div>\nsatu\ndua")
    expect(box.querySelectorAll("p br")).toHaveLength(2)
    expect(box.querySelector("p")?.textContent).toContain("<div>")
  })
  test("empty and half-written text renders without throwing", () => {
    for (const text of ["", "**", "```", "[](", "> "]) expect(() => show(text)).not.toThrow()
  })
})

describe("Markdown: looks", () => {
  test("a description's headings sit below the page title", () => {
    show("# A\n\n## B\n\n### C\n\n###### F")
    const levels = screen.getAllByRole("heading").map((heading) => heading.tagName)
    expect(levels).toEqual(["H2", "H2", "H3", "H4"])
  })
  test("a comment's headings are bold text, not headings", () => {
    const box = show("# Besar", "comment")
    expect(screen.queryByRole("heading")).toBeNull()
    expect(box.querySelector("strong")?.textContent).toBe("Besar")
  })
  test("long words break instead of widening the box", () => {
    expect(show("x").className).toContain("break-words")
  })
})
