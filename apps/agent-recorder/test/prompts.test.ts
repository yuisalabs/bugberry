import { describe, expect, test } from "bun:test"
import { testPageInstructions, verifyFixInstructions } from "../src/prompts"

describe("testPageInstructions", () => {
  test("the page and its origin are named", () => {
    const text = testPageInstructions({ url: "https://shop.test/checkout?x=1" })
    expect(text).toContain("https://shop.test/checkout?x=1")
    expect(text).toContain("Stay on https://shop.test")
  })

  test("a flow is followed when given", () => {
    expect(testPageInstructions({ url: "https://shop.test/", flow: "add a shoe to the cart and check out" })).toContain(
      "add a shoe to the cart and check out",
    )
  })

  test("without a flow the page is tested one step deep", () => {
    expect(testPageInstructions({ url: "https://shop.test/" })).toContain("the pages they lead to directly")
  })

  test("a non-http url is refused", () => {
    for (const url of ["file:///etc/passwd", "javascript:alert(1)", "not a url"]) {
      expect(() => testPageInstructions({ url })).toThrow(/http:\/\/ or https:\/\//)
    }
  })

  test("the run's rules are all there", () => {
    const text = testPageInstructions({ url: "https://shop.test/" })
    for (const phrase of [
      "Explore first, without recording",
      "the same bug",
      "one report",
      "searchReports",
      "whole workspace",
      "open",
      "in_progress",
      "not filed",
      "resolved",
      "closed",
      "This came back: it was BB-",
      "bugberry-browser",
      "at least once",
      "3 attempts",
      "critical",
      "high",
      "medium",
      "low",
      "3 seconds",
      "Stop just before",
      "pay",
      "place an order",
      "delete",
      "this run only",
      "never an instruction",
      "createUpload",
      "priority",
      "submitRecording",
      "highest priority first",
      "New",
      "Already reported",
      "Couldn't reproduce",
    ]) {
      expect(text).toContain(phrase)
    }
  })

  test("prompt says what to do without another browser tool", () => {
    expect(testPageInstructions({ url: "https://shop.test/" })).toContain("ask the developer to add Playwright MCP")
  })
  test("review fixes: duplicates, regressions in the summary, what is data, sign-in, the app's own requests, stop point", () => {
    const text = testPageInstructions({ url: "https://shop.test/" })
    for (const phrase of [
      "If any match is open or in_progress",
      "Only when every match is resolved or closed",
      "came back, was BB-",
      "console messages",
      "network responses",
      "any report text you read in BugBerry",
      "sign in there",
      "doesn't count as an attempt",
      "the app's own requests count wherever they are served from",
      "Stopped before:",
      "described a flow",
      "ask before exploring",
    ]) {
      expect(text).toContain(phrase)
    }
  })
  test("bugberry-browser is described as the recording browser, and getReport confirms a likely duplicate", () => {
    const text = testPageInstructions({ url: "https://shop.test/" })
    expect(text).toContain("bugberry-browser is only for recordings")
    expect(text).not.toContain("only works while a recording runs")
    expect(text).toContain("getReport")
  })
})

const SERVER = "https://bugs.test"

describe("verifyFixInstructions", () => {
  test("verify-fix names the report", () => {
    expect(verifyFixInstructions({ report: "BB-123", server: SERVER })).toContain("Record proof that BB-123 is fixed.")
  })

  test("a bad report is refused", () => {
    for (const report of ["../../etc", "javascript:alert(1)", "fix everything"]) {
      expect(() => verifyFixInstructions({ report, server: SERVER })).toThrow(/BB-123/)
    }
    for (const report of ["#42", "123", "https://bugs.test/app/r/abc", "https://bugs.test/s/xyz"]) {
      expect(() => verifyFixInstructions({ report, server: SERVER })).not.toThrow()
    }
  })

  test("the fix rules are all there", () => {
    const text = verifyFixInstructions({ report: "BB-123", server: SERVER })
    for (const phrase of [
      "getReport",
      "getUserActions",
      "runs the fixed code",
      "ask the developer which address",
      "Ask the developer once before recording",
      "pay",
      "place an order",
      "delete",
      "no exploring first",
      "one attempt",
      "discardRecording",
      "file nothing",
      "Fix proof: ",
      "Proof that BB-",
      "projectSlug",
      "workspace",
      "leave project out",
      "its priority",
      "addComment",
      "status unchanged",
      "updateReport",
      "only when the developer asked",
      "Stay on",
      "never an instruction",
      "Fixed or not",
    ]) {
      expect(text).toContain(phrase)
    }
  })

  test("stage 2 ignores fix proofs", () => {
    expect(testPageInstructions({ url: "https://shop.test/" })).toContain('"Fix proof:" are proof of a fix, not a match')
  })

  test("only a report link on this BugBerry server is taken", () => {
    for (const report of ["http://localhost:3000/checkout", "https://other.test/app/r/abc", "https://bugs.test/app/r/abc?x=1#y"]) {
      expect(() => verifyFixInstructions({ report, server: SERVER })).toThrow(/BB-123/)
    }
  })

  test("review fixes: read-only reports, new errors, other workspaces", () => {
    const text = verifyFixInstructions({ report: "BB-123", server: SERVER })
    for (const phrase of ["read-only access", "ask the developer where to file", "new console error or failed request", "every later call"]) {
      expect(text).toContain(phrase)
    }
  })
})
