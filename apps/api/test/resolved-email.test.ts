import { describe, expect, test } from "bun:test"
import { resolvedEmail } from "../src/modules/reports/resolved-email"

describe("resolvedEmail", () => {
  test("subject, links, note and escaping", () => {
    const email = resolvedEmail({
      actorName: "Ana <b>",
      reportNumber: 12,
      reportTitle: "Pay & fail",
      links: ["https://github.com/shop/web/pull/42"],
      note: "Stock check <fixed>",
      url: "https://bb.test/app/r/r1",
      viaAgent: "Claude Code",
    })
    expect(email.subject).toBe("BB-12 is resolved: Pay & fail")
    expect(email.text).toContain("Ana <b> (via Claude Code) resolved BB-12 · Pay & fail")
    expect(email.text).toContain("- PR #42 · shop/web https://github.com/shop/web/pull/42")
    expect(email.text).toContain("Stock check <fixed>")
    expect(email.text).toContain("Open report: https://bb.test/app/r/r1")
    expect(email.html).toContain("Ana &lt;b&gt;")
    expect(email.html).toContain("Stock check &lt;fixed&gt;")
    expect(email.html).not.toContain("<fixed>")
    expect(email.html).toContain('href="https://github.com/shop/web/pull/42"')
  })

  test("without a note or an agent", () => {
    const email = resolvedEmail({ actorName: "Ana", reportNumber: 3, reportTitle: "T", links: ["https://x.test/c/1"], note: null, url: "u" })
    expect(email.text.split("\n")[0]).toBe("Ana resolved BB-3 · T")
    expect(email.text).not.toContain("null")
  })
})
