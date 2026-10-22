import { describe, expect, test } from "bun:test"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DOCS_URL } from "../src/lib/docs-url"
import { FinalCta } from "../src/pages/landing/FinalCta"
import { SiteChrome } from "../src/pages/landing/SiteChrome"
import { CHANGELOG, CHROME_WEB_STORE_URL, installHref } from "../src/pages/landing/site-links"

const STORE = "https://chromewebstore.google.com/detail/x"
const PUBLIC_ROUTES = ["/", "/login", "/app", "/pricing", "/integrations", "/ai-agents", "/demo", "/privacy"]

const hrefs = (root: ParentNode = document) => Array.from(root.querySelectorAll("a")).map((link) => link.getAttribute("href") ?? "")
const linkNamed = (root: HTMLElement, name: string) => Array.from(root.querySelectorAll("a")).find((link) => link.textContent?.trim() === name)

describe("site chrome", () => {
  test("every link goes to a public page, a docs page or the install link", () => {
    render(<SiteChrome signedIn={false} installUrl={STORE}>page</SiteChrome>)
    fireEvent.click(screen.getByRole("button", { name: "Product" }))
    for (const href of hrefs()) {
      const ok =
        PUBLIC_ROUTES.includes(href) ||
        href.startsWith("/#") ||
        href.startsWith("/integrations#") ||
        href.startsWith(DOCS_URL) ||
        href === STORE ||
        href === CHROME_WEB_STORE_URL
      expect(ok ? href : `unexpected ${href}`).toBe(href)
    }
  })

  test("the footer has the changelog and privacy, and no About, Status, Security or Terms", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const footer = screen.getByRole("navigation", { name: "Footer" })
    expect(linkNamed(footer, "Changelog")?.getAttribute("href")).toBe(CHANGELOG)
    expect(CHANGELOG).toBe(`${DOCS_URL}/changelog`)
    expect(linkNamed(footer, "Privacy")?.getAttribute("href")).toBe("/privacy")
    for (const gone of ["About", "Status", "Security", "Terms"]) expect(linkNamed(footer, gone)).toBeUndefined()
  })

  test("Product opens the menu with its nine features, and Escape closes it", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    expect(product.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(product)
    expect(product.getAttribute("aria-expanded")).toBe("true")
    const menu = document.getElementById(product.getAttribute("aria-controls") ?? "")!
    for (const title of [
      "Browser extension",
      "Screenshot & annotate",
      "Voice narration",
      "Console logs",
      "Network requests",
      "User steps",
      "Comments & mentions",
      "Share links",
      "Projects & URL patterns",
    ]) {
      expect(within(menu).getByText(title)).toBeTruthy()
    }
    expect(linkNamed(menu, "See all integrations")?.getAttribute("href")).toBe("/integrations")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(product.getAttribute("aria-expanded")).toBe("false")
  })

  test("the menu comes right after Product for the keyboard, and Escape puts focus back on Product", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.click(product)
    const focusable = [...document.querySelectorAll<HTMLElement>("a[href], button")]
    expect(focusable[focusable.indexOf(product) + 1]?.textContent).toContain("Browser extension")
    focusable[focusable.indexOf(product) + 1]?.focus()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(document.activeElement).toBe(product)
  })

  test("a click outside closes the Product menu", () => {
    render(<SiteChrome signedIn={false} installUrl={null}><p>outside</p></SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.click(product)
    fireEvent.pointerDown(screen.getByText("outside"))
    expect(product.getAttribute("aria-expanded")).toBe("false")
  })

  test("Add to Chrome goes to BugBerry's Chrome Web Store page when the server names no install link", () => {
    expect(CHROME_WEB_STORE_URL).toBe("https://chromewebstore.google.com/detail/bugberry/cccfgmgmmejlciecjipkcbabhdljhihi")
    expect(installHref(null)).toBe(CHROME_WEB_STORE_URL)
    expect(installHref(STORE)).toBe(STORE)
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    expect(linkNamed(screen.getByRole("contentinfo"), "Chrome Web Store")?.getAttribute("href")).toBe(CHROME_WEB_STORE_URL)
  })

  test("the main menu offers sign-up and a demo; a signed-in visitor gets the dashboard instead", () => {
    const { unmount } = render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const main = screen.getByRole("navigation", { name: "Main" })
    expect(linkNamed(main, "Get started")?.getAttribute("href")).toBe("/login")
    expect(linkNamed(main, "Request a demo")?.getAttribute("href")).toBe("/demo")
    for (const [name, href] of [["Integrations", "/integrations"], ["AI Agents", "/ai-agents"], ["Pricing", "/pricing"], ["Docs", DOCS_URL]]) {
      expect(linkNamed(main, name!)?.getAttribute("href")).toBe(href!)
    }
    unmount()
    render(<SiteChrome signedIn installUrl={null}>page</SiteChrome>)
    const signedIn = screen.getByRole("navigation", { name: "Main" })
    expect(linkNamed(signedIn, "Open dashboard")?.getAttribute("href")).toBe("/app")
    expect(linkNamed(signedIn, "Get started")).toBeUndefined()
  })

  test("on a phone the menu button reaches every page", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const button = screen.getByRole("button", { name: "Menu" })
    fireEvent.click(button)
    const panel = document.getElementById(button.getAttribute("aria-controls") ?? "")!
    for (const href of ["/integrations", "/ai-agents", "/pricing", "/demo", "/login", DOCS_URL]) expect(hrefs(panel)).toContain(href)
    expect(within(panel).getByText("Voice narration")).toBeTruthy()
  })

  test("the minimal chrome of a self-hosted server links only docs, privacy and sign-in", () => {
    render(<SiteChrome signedIn={false} installUrl={null} minimal>page</SiteChrome>)
    expect(screen.queryByRole("button", { name: "Product" })).toBeNull()
    expect(new Set(hrefs())).toEqual(new Set(["/", "/login", DOCS_URL, "/privacy"]))
  })
})

describe("FinalCta", () => {
  test("offers the extension and a 30-minute demo, with no reporter limit", () => {
    render(<FinalCta installUrl={null} />)
    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("Stop describing bugs.Start showing them.")
    expect(screen.getByRole("link", { name: /Add to Chrome/ }).getAttribute("href")).toBe(CHROME_WEB_STORE_URL)
    expect(screen.getByRole("link", { name: "Book a 30-minute demo" }).getAttribute("href")).toBe("/demo")
    const text = document.body.textContent ?? ""
    expect(text).not.toContain("15-min")
    expect(text).not.toContain("reporters")
  })
})
