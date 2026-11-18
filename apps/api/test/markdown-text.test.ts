import { describe, expect, test } from "bun:test"
import { stripMarkdown } from "../src/lib/markdown-text"
import { snippetOf } from "../src/modules/comments/mentions"

describe("stripMarkdown", () => {
  const cases: Array<[string, string]> = [
    ["**bold** __also__ _it_ *it* ~~gone~~ `code`", "bold also it it gone code"],
    ["## Steps\n- one\n* two\n1. three\n2) four\n> quote", "Steps\none\ntwo\nthree\nfour\nquote"],
    ["```ts\nconst a = `x`\n  **kept**\n```", "const a = `x`\n  **kept**"],
    ["~~~\nfoo\n~~~", "foo"],
    ["[PR #88](https://g.test/88)", "PR #88"],
    ["![shot](https://a.test/p.png)", "shot"],
    ["[](https://a.test)", "https://a.test"],
    ["<https://a.test>", "https://a.test"],
    ["\\*not bold\\* dan \\_ini\\_", "*not bold* dan _ini_"],
    ["satu\r\n**dua**", "satu\ndua"],
  ]
  for (const [input, output] of cases) test(JSON.stringify(input), () => expect(stripMarkdown(input)).toBe(output))

  const unchanged = ["snake_case_name", "2 * 3 * 4", "a\n\n\nb", "<b>x</b>", "#42 is a number", "1.5 seconds", "- ", ""]
  for (const text of unchanged) test(`leaves ${JSON.stringify(text)} alone`, () => expect(stripMarkdown(text)).toBe(text))

  test("half-written marks do not throw", () => {
    for (const text of ["**", "```", "[](", "`", "> ", "[x](", "*".repeat(5000)]) expect(() => stripMarkdown(text)).not.toThrow()
  })
  test("keepLayout keeps list and quote markers and writes link targets", () => {
    const note = "**Fixed** in `createOrder`:\n- stock check\n1. see [PR #88](https://g.test/88)\n> thanks\n[https://g.test](https://g.test)"
    expect(stripMarkdown(note, { keepLayout: true })).toBe(
      "Fixed in createOrder:\n- stock check\n1. see PR #88 (https://g.test/88)\n> thanks\nhttps://g.test",
    )
  })
})

describe("snippetOf", () => {
  test("drops marks, keeps names whatever characters they hold", () => {
    const names = new Map([["_a_", "_ana_"], ["b", "Budi"]])
    expect(snippetOf("**hi** @[user:_a_] lihat `POST /api`, cc @[user:b](tadi)", names)).toBe("hi @_ana_ lihat POST /api, cc @Budi(tadi)")
    expect(snippetOf("@[user:x] halo", names)).toBe("@former member halo")
  })
  test("a comment that is only code or only a link still has a snippet", () => {
    expect(snippetOf("```\nfoo()\n```", new Map())).toBe("foo()")
    expect(snippetOf("[](https://a.test/x)", new Map())).toBe("https://a.test/x")
  })
  test("whitespace still collapses and long text is still cut at 140 with an ellipsis", () => {
    expect(snippetOf("a\n\n  b", new Map())).toBe("a b")
    const long = snippetOf(`**${"x".repeat(300)}**`, new Map())
    expect(long).toHaveLength(140)
    expect(long.endsWith("…")).toBe(true)
  })
  test("placeholder characters typed into a comment cannot become a mention", () => {
    const names = new Map([["b", "Budi"]])
    expect(snippetOf("x \uE0000\uE001 y @[user:b]", names)).toBe("x 0 y @Budi")
    expect(snippetOf("\uE0005\uE001 halo", names)).toBe("5 halo")
  })
})
