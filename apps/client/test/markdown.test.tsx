import { describe, expect, spyOn, test } from "bun:test"
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
  test("paragraphs inside a list item or a quote keep the same gap as at the top", () => {
    const box = show("- one\n\n  two\n\n> three\n>\n> four")
    for (const element of [box.querySelector("li"), box.querySelector("blockquote")]) {
      expect(element?.querySelectorAll(":scope > p")).toHaveLength(2)
      expect(element?.className).toContain("[&>*+*]:mt-3")
    }
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
    show("[ https://bank.com](https://evil.example/s) [\u200Bhttps://bank.com](https://evil.example/z) [\u2060www.bank.com](https://evil.example/w)")
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
  test("a URL anywhere in the label is checked, not only at its start", () => {
    show(
      [
        "[→ https://bank.com/login](https://evil.example/1)",
        "[(https://bank.com)](https://evil.example/2)",
        "[Visit https://bank.com](https://evil.example/3)",
        "[\u3164https://bank.com](https://evil.example/4)",
        "[\u034Fhttps://bank.com](https://evil.example/5)",
        "[<b>https://bank.com</b>](https://evil.example/6)",
      ].join(" "),
    )
    for (const n of [1, 2, 3, 4, 5, 6]) expect(link(`https://evil.example/${n}`)).toBeTruthy()
    expect(screen.queryByText(/bank\.com/)).toBeNull()
  })
  test("variation selectors, combining marks and other invisible characters do not hide a URL in a label", () => {
    for (const label of ["h\uFE0Fttps://bank.com/login", "h\u0301ttps://bank.com", "h\u180Bttps://bank.com"]) {
      show(`[${label}](https://evil.example/1)`)
      expect(link("https://evil.example/1")).toBeTruthy()
      expect(document.body.textContent).not.toContain("bank.com")
      document.body.innerHTML = ""
    }
  })
  test("every URL in a label is checked, not only the first", () => {
    show("[https://evil.example/ \u2192 https://bank.com](https://evil.example/2)")
    expect(link("https://evil.example/2")).toBeTruthy()
    expect(document.body.textContent).not.toContain("bank.com")
  })
  test("a label of URLs that all name the target's host stays", () => {
    show("[https://a.test/a and https://a.test/b](https://a.test/c)")
    expect(link("https://a.test/a and https://a.test/b").getAttribute("href")).toBe("https://a.test/c")
  })
  test("a label of only a Braille blank counts as empty", () => {
    show("[\u2800](https://a.test)")
    expect(link("https://a.test").getAttribute("href")).toBe("https://a.test")
  })
  test("a mention whose name is a URL cannot name another site", () => {
    const box = render(
      <Markdown look="comment" literalText={(value) => value.replace("\uE000", "@https://bank.com")}>
        {"[\uE000](https://evil.example/m)"}
      </Markdown>,
    ).container
    expect(link("https://evil.example/m")).toBeTruthy()
    expect(box.textContent).not.toContain("bank.com")
  })
  test("a label on the same host, or one that is not a URL, stays", () => {
    show("[https://a.test/docs](https://a.test/other) [Bank](https://evil.example) [docs at https://a.test/x](https://a.test/y)")
    expect(link("https://a.test/docs").getAttribute("href")).toBe("https://a.test/other")
    expect(link("Bank").getAttribute("href")).toBe("https://evil.example")
    expect(link("docs at https://a.test/x").getAttribute("href")).toBe("https://a.test/y")
  })
  test("a link with an empty label shows its target", () => {
    show("[](https://a.test) [![][i]][r]\n\n[i]: https://a.test/i.png\n[r]: https://a.test/r")
    expect(link("https://a.test").getAttribute("href")).toBe("https://a.test")
    const reference = screen.getAllByRole("link").find((a) => a.getAttribute("href") === "https://a.test/r")
    expect(reference?.textContent?.trim()).not.toBe("")
  })
  test("reference links and images obey the same URL rule", () => {
    const bad = show("[x][r]\n\n[r]: javascript:alert(1)")
    expect(bad.querySelector("a")).toBeNull()
    expect(bad.textContent).toBe("x")
    const image = show("![x][p]\n\n[p]: https://a.test/p.png")
    expect(image.querySelector("img")).toBeNull()
    expect(image.querySelector("a")?.getAttribute("href")).toBe("https://a.test/p.png")
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

describe("Markdown: the caller's text", () => {
  const shout = (text: string) => <mark>{text.toUpperCase()}</mark>
  const marked = (text: string) =>
    render(<Markdown look="comment" renderText={shout} literalText={(value) => value.replaceAll("x", "LIT")}>{text}</Markdown>).container
      .firstElementChild as HTMLElement

  test("running text is replaced in every place a sentence can be", () => {
    const cases = ["satu", "- satu", "- satu\n\n- dua", "| satu |\n| - |\n| dua |", "# satu", "> satu", "**satu**", "_satu_", "~~satu~~"]
    for (const text of cases) {
      const box = marked(text)
      expect(box.textContent?.replace(/\s/g, "")).toMatch(/^(SATU)(DUA)?$/)
      expect(box.querySelector("mark")).not.toBeNull()
    }
  })
  test("text from a raw HTML block is running text too", () => {
    expect(marked("<div>satu").querySelector("mark")?.textContent).toBe("<DIV>SATU")
  })
  test("code and link labels are never replaced; they are rewritten instead", () => {
    const box = marked("`x1` [x2](https://a.test) ![x3](https://a.test/p.png)\n\n```\nx4\n```")
    expect(box.querySelector("code mark, pre mark, a mark")).toBeNull()
    expect(box.querySelector("p code")?.textContent).toBe("LIT1")
    expect([...box.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["LIT2", "LIT3"])
    expect(box.querySelector("pre")?.textContent).toBe("LIT4\n")
  })
  test("formatted text, images and dropped links inside a label are rewritten, not replaced", () => {
    const box = marked("[**x5** _x6_](https://a.test) [![x7](https://a.test/i.png)](https://a.test/l) [x8](/relative) ![x9](javascript:1)")
    expect([...box.querySelectorAll("mark")].map((mark) => mark.textContent?.trim())).toEqual(["", "", ""])
    expect([...box.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["LIT5 LIT6", "LIT7"])
    expect(box.textContent).toContain("LIT8")
    expect(box.textContent).toContain("LIT9")
  })
  test("the label check judges the label after it is rewritten", () => {
    const hooks = { literalText: (value: string) => value.replace("site", "https://bank.com") }
    const box = render(
      <Markdown look="comment" {...hooks}>
        {"[site](https://evil.example/a) ![site](https://evil.example/b.png) [![site](https://a.test/c.png)](https://evil.example/c)"}
      </Markdown>,
    ).container
    expect([...box.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "https://evil.example/a",
      "https://evil.example/b.png",
      "https://evil.example/c",
    ])
  })
  test("without the hooks text is untouched", () => {
    expect(show("satu `x`").textContent).toBe("satu x")
  })
})

/** The longest chain of nested block quotes and lists, counted without recursion. */
const deepestNesting = (root: Element) => {
  let deepest = 0
  const stack: [Element, number][] = [[root, 0]]
  while (stack.length > 0) {
    const [element, depth] = stack.pop() as [Element, number]
    const here = depth + (["BLOCKQUOTE", "UL", "OL"].includes(element.tagName) ? 1 : 0)
    deepest = Math.max(deepest, here)
    for (const child of element.children) stack.push([child, here])
  }
  return deepest
}

describe("Markdown: deep nesting", () => {
  const cases = [
    ">".repeat(2500) + " x",
    "- ".repeat(1100) + "x",
    "1. ".repeat(1000) + "x",
    "> - ".repeat(800) + "x",
    "* ".repeat(2499) + "x",
    "-\t".repeat(2499) + "x",
  ]
  for (const text of cases) {
    test(`${JSON.stringify(text.slice(0, 4))} x ${text.length} chars is shown as typed, fast, without nesting`, () => {
      const start = performance.now()
      const box = show(text)
      expect(performance.now() - start).toBeLessThan(1000)
      expect(box.textContent).toBe(text)
      expect(box.querySelector("blockquote, ul, ol")).toBeNull()
    })
  }
  test("16 markers on one line are still Markdown; 17 are text", () => {
    expect(show("> ".repeat(16) + "x").querySelectorAll("blockquote")).toHaveLength(16)
    const box = show("> ".repeat(17) + "x")
    expect(box.querySelector("blockquote")).toBeNull()
    expect(box.textContent).toBe("> ".repeat(17) + "x")
  })
  test("a long rule of spaced dashes, stars or underscores is still a rule", () => {
    for (const mark of ["-", "*", "_"]) expect(show(Array(20).fill(mark).join(" ")).querySelector("hr")).not.toBeNull()
  })
  test("one line with too many markers turns the whole text into text", () => {
    const text = `# Judul\n\n**tebal**\n\n${"- ".repeat(20)}x\n\nakhir`
    const box = show(text)
    expect(box.querySelector("h2, strong, ul")).toBeNull()
    expect(box.textContent).toBe(text)
  })
  test("nesting spread over lines stops at 16 levels and keeps the text", () => {
    const text = Array.from({ length: 40 }, (_, level) => `${"  ".repeat(level)}- x${level}`).join("\n")
    const box = show(text)
    expect(deepestNesting(box)).toBeLessThanOrEqual(16)
    expect(box.textContent).toContain("x39")
  })
  test("a three-level list inside a quote keeps its three levels", () => {
    const box = show("> - one\n>   - two\n>     - three")
    expect(box.querySelector("blockquote > ul > li > ul > li > ul > li")?.textContent).toBe("three")
  })
  test("if rendering throws, the text is shown as typed and nothing crashes", () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {})
    const fail = () => {
      throw new Error("boom")
    }
    const box = render(
      <Markdown look="comment" className="text-sm" renderText={fail}>
        {"**satu**\n<b>dua</b>"}
      </Markdown>,
    ).container.firstElementChild as HTMLElement
    quiet.mockRestore()
    expect(box.textContent).toBe("**satu**\n<b>dua</b>")
    expect(box.className).toContain("whitespace-pre-wrap")
    expect(box.className).toContain("text-sm")
    expect(box.querySelector("b, strong")).toBeNull()
  })
  test("text shown as typed goes through literalText, or stays as given when literalText throws", () => {
    const quiet = spyOn(console, "error").mockImplementation(() => {})
    const fail = () => {
      throw new Error("boom")
    }
    const rewritten = render(
      <Markdown look="comment" renderText={fail} literalText={(value) => value.replace("P", "@Ana")}>
        {"**P**"}
      </Markdown>,
    ).container
    const unrewritten = render(
      <Markdown look="comment" literalText={fail}>
        {`P\n${"> ".repeat(17)}x`}
      </Markdown>,
    ).container
    quiet.mockRestore()
    expect(rewritten.textContent).toBe("**@Ana**")
    expect(unrewritten.textContent).toBe(`P\n${"> ".repeat(17)}x`)
  })
  test("deep indentation scrolls inside the component instead of widening the page", () => {
    expect(show("x").className).toContain("overflow-x-auto")
  })
})

describe("Markdown: code", () => {
  test("a fenced block with a language keeps the code styling next to its language class", () => {
    const code = show("```js\nlet a\n```").querySelector("pre code")
    expect(code?.className).toContain("language-js")
    expect(code?.className).toContain("font-mono")
  })
})
