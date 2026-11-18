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

describe("Markdown: links", () => {
  const link = (name: string) => screen.getByRole("link", { name }) as HTMLAnchorElement

  test("http, https and mailto links open in a new tab and pass nothing on", () => {
    show("[site](https://a.test/x) [mail](mailto:a@b.test) lihat http://c.test/p")
    expect(link("site").getAttribute("href")).toBe("https://a.test/x")
    expect(link("site").target).toBe("_blank")
    expect(link("site").rel).toBe("noopener noreferrer nofollow")
    expect(link("mail").getAttribute("href")).toBe("mailto:a@b.test")
    expect(link("http://c.test/p").getAttribute("href")).toBe("http://c.test/p")
  })
  test("any other target shows its label as text", () => {
    const box = show("[a](javascript:alert(1)) [b](data:text/html,hi) [c](/relative) [d](ftp://a.test) [e](#top)")
    expect(box.querySelector("a")).toBeNull()
    expect(box.textContent).toBe("a b c d e")
  })
  test("a label that names another site shows the real target", () => {
    show("[https://bank.com](https://evil.example/login) [www.bank.com](https://evil.example/2)")
    expect(link("https://evil.example/login")).toBeTruthy()
    expect(link("https://evil.example/2")).toBeTruthy()
    expect(screen.queryByText(/bank\.com/)).toBeNull()
  })
  test("spaces or invisible characters before a URL label do not hide it", () => {
    show("[ https://bank.com](https://evil.example/s) [​https://bank.com](https://evil.example/z) [⁠www.bank.com](https://evil.example/w)")
    expect(link("https://evil.example/s")).toBeTruthy()
    expect(link("https://evil.example/z")).toBeTruthy()
    expect(link("https://evil.example/w")).toBeTruthy()
    expect(screen.queryByText(/bank\.com/)).toBeNull()
  })
  test("an image whose alt names another site shows the real target", () => {
    show("![https://bank.com/login](https://evil.example/x.png) ![https://a.test/p](https://a.test/p.png)")
    expect(link("https://evil.example/x.png")).toBeTruthy()
    expect(link("https://a.test/p").getAttribute("href")).toBe("https://a.test/p.png")
    expect(screen.queryByText(/bank\.com/)).toBeNull()
  })
  test("a label on the same host, or one that is not a URL, stays", () => {
    show("[https://a.test/docs](https://a.test/other) [Bank](https://evil.example)")
    expect(link("https://a.test/docs").getAttribute("href")).toBe("https://a.test/other")
    expect(link("Bank").getAttribute("href")).toBe("https://evil.example")
  })
  test("an image is a link to it, never a loaded image", () => {
    const box = show("![diagram](https://a.test/p.png) ![](https://a.test/q.png) ![bad](javascript:1)")
    expect(box.querySelector("img")).toBeNull()
    expect(link("diagram").getAttribute("href")).toBe("https://a.test/p.png")
    expect(link("https://a.test/q.png")).toBeTruthy()
    expect(box.querySelectorAll("a")).toHaveLength(2)
    expect(box.textContent).toContain("bad")
  })
  test("an image inside a link is the link's label, not a second link", () => {
    const box = show(
      "[![build](https://a.test/b.png)](https://a.test/ci) [![](https://a.test/c.png)](https://a.test/d) [![https://bank.com](https://a.test/x.png)](https://evil.example/z)",
    )
    expect(box.querySelector("a a, img")).toBeNull()
    expect(box.querySelectorAll("a")).toHaveLength(3)
    expect(link("build").getAttribute("href")).toBe("https://a.test/ci")
    expect(link("https://a.test/c.png").getAttribute("href")).toBe("https://a.test/d")
    expect(link("https://evil.example/z")).toBeTruthy()
    expect(screen.queryByText(/bank\.com/)).toBeNull()
  })
})
