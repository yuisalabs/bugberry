import { describe, expect, test } from "bun:test"
import { pageOf, unmatchedPages } from "../src/modules/projects/unmatched"

const at = (day: number) => new Date(Date.UTC(2026, 9, day))

describe("unmatchedPages", () => {
  test("a page is its host and path, without scheme, query or trailing slash", () => {
    expect(pageOf("https://staging.quinella.ai/checkout/?step=pay")).toBe("staging.quinella.ai/checkout")
    expect(pageOf("http://localhost:3000/")).toBe("localhost:3000")
    expect(pageOf("chrome://extensions")).toBeNull()
    expect(pageOf("not a url")).toBeNull()
  })

  test("groups what no pattern catches, most reports first, and suggests the project most of them went to", () => {
    const projects = [
      { id: "shop", urlPatterns: ["shop.test/*"] },
      { id: "docs", urlPatterns: [] },
    ]
    const pages = unmatchedPages(
      [
        { pageUrl: "https://shop.test/cart", projectId: "shop", reports: 9, lastReportAt: at(1) },
        { pageUrl: "https://docs.test/a", projectId: "docs", reports: 2, lastReportAt: at(2) },
        { pageUrl: "https://docs.test/a?q=1", projectId: "shop", reports: 1, lastReportAt: at(5) },
        { pageUrl: "https://blog.test/", projectId: null, reports: 1, lastReportAt: at(3) },
      ],
      projects,
    )
    expect(pages).toEqual([
      { page: "docs.test/a", reports: 3, lastReportAt: at(5), suggestedProjectId: "docs" },
      { page: "blog.test", reports: 1, lastReportAt: at(3), suggestedProjectId: null },
    ])
  })
})
