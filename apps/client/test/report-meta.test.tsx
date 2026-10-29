import { describe, expect, test } from "bun:test"
import { render, screen } from "@testing-library/react"
import { ReportMeta, reportedVia } from "../src/features/reports/detail/ReportMeta"
import { reportFixture } from "./fixtures"

describe("ReportMeta", () => {
  test("says who reported it, when, and on what", () => {
    const report = reportFixture({ createdAt: new Date(Date.now() - 5 * 60_000) })
    render(<ReportMeta report={report} issues={[]} />)
    expect(screen.getByText("Ana via Chrome extension · 5 minutes ago")).toBeTruthy()
    expect(screen.getByText("Chrome 140")).toBeTruthy()
    expect(screen.getByText("Windows 11")).toBeTruthy()
    expect(screen.getByText("1440 × 900")).toBeTruthy()
  })

  test("byline says who recorded an agent report", () => {
    const report = reportFixture({ createdAt: new Date(Date.now() - 5 * 60_000), viaAgent: "Claude Code" })
    render(<ReportMeta report={report} issues={[]} />)
    expect(screen.getByText("Ana · Recorded by Claude Code · 5 minutes ago")).toBeTruthy()
  })

  test("byline is unchanged without viaAgent", () => {
    const report = reportFixture({ createdAt: new Date(Date.now() - 5 * 60_000), viaAgent: null })
    render(<ReportMeta report={report} issues={[]} />)
    expect(screen.getByText("Ana via Chrome extension · 5 minutes ago")).toBeTruthy()
  })

  test("names the browser the report came from", () => {
    const report = reportFixture({ createdAt: new Date(Date.now() - 5 * 60_000) })
    render(<ReportMeta report={{ ...report, device: { ...report.device, browser: "Firefox 131" } }} issues={[]} />)
    expect(screen.getByText("Ana via Firefox extension · 5 minutes ago")).toBeTruthy()
  })

  test("reportedVia drops the version, and an unknown browser reads as the BugBerry extension", () => {
    expect(reportedVia("Chrome 140")).toBe("Chrome extension")
    expect(reportedVia("Opera 124")).toBe("Opera extension")
    expect(reportedVia("Unknown browser")).toBe("the BugBerry extension")
    expect(reportedVia("")).toBe("the BugBerry extension")
  })

  test("links each sent issue and leaves out those without a safe link", () => {
    render(
      <ReportMeta
        report={reportFixture()}
        issues={[
          { provider: "github", externalId: "142", externalUrl: "https://github.com/acme/web/issues/142" },
          { provider: "activecollab", externalId: "WEB-9", externalUrl: "javascript:alert(1)" },
          { provider: "activecollab", externalId: "ENG-3", externalUrl: null },
        ]}
      />,
    )
    const chip = screen.getByRole("link", { name: "GitHub #142" }) as HTMLAnchorElement
    expect(chip.href).toBe("https://github.com/acme/web/issues/142")
    expect(screen.queryByText(/WEB-9/)).toBeNull()
    expect(screen.queryByText(/ENG-3/)).toBeNull()
  })

  test("each tracker's issue reads the way that tracker names it", () => {
    render(
      <ReportMeta
        report={reportFixture()}
        issues={[
          { provider: "linear", externalId: "ENG-142", externalUrl: "https://linear.app/kantor/issue/ENG-142" },
          { provider: "gitlab", externalId: "42", externalUrl: "https://gitlab.com/kantor/web/-/issues/42" },
        ]}
      />,
    )
    expect(screen.getByRole("link", { name: "Linear ENG-142" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "GitLab #42" })).toBeTruthy()
  })

  test("an issue from a tracker the project no longer has reads Issue #id", () => {
    render(<ReportMeta report={reportFixture()} issues={[{ provider: null, externalId: "42", externalUrl: "https://github.com/a/b/issues/42" }]} />)
    expect(screen.getByRole("link", { name: "Issue #42" })).toBeTruthy()
  })
})
