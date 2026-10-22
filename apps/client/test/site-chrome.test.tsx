import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { DOCS_URL } from "../src/lib/docs-url"
import { FinalCta } from "../src/pages/landing/FinalCta"
import { SiteChrome } from "../src/pages/landing/SiteChrome"
import { CHANGELOG, CHROME_WEB_STORE_URL, INTEGRATION_DOCS, installHref } from "../src/pages/landing/site-links"

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
        href === CHROME_WEB_STORE_URL ||
        href === "https://github.com/yuisalabs/bugberry"
      expect(ok ? href : `unexpected ${href}`).toBe(href)
    }
  })

  test("the header sticks to the top and, once the page scrolls, floats as a rounded pill", () => {
    const scrollTo = (y: number) => {
      Object.defineProperty(window, "scrollY", { value: y, configurable: true })
      fireEvent.scroll(window)
    }
    scrollTo(0)
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const header = screen.getByRole("banner")
    const nav = screen.getByRole("navigation", { name: "Main" })
    expect(header.className).toContain("sticky")
    expect(header.className).toContain("top-0")
    expect(header.dataset.scrolled).toBe("false")
    expect(nav.className).not.toContain("rounded-full")
    scrollTo(120)
    expect(header.dataset.scrolled).toBe("true")
    expect(nav.className).toContain("rounded-full")
    expect(nav.className).toContain("backdrop-blur")
    scrollTo(0)
    expect(header.dataset.scrolled).toBe("false")
  })

  test("behind the floating header the page stays dark at the top, so no light strip flashes while scrolling", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const page = screen.getByRole("banner").parentElement!
    expect(page.className).toContain("bg-[linear-gradient(#1C1022_0_68px,#F7F6FA_68px)]")
  })

  test("the footer has the changelog and privacy, and no About, Status, Security or Terms", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const footer = screen.getByRole("navigation", { name: "Footer" })
    expect(linkNamed(footer, "Changelog")?.getAttribute("href")).toBe(CHANGELOG)
    expect(CHANGELOG).toBe(`${DOCS_URL}/changelog`)
    expect(linkNamed(footer, "Privacy")?.getAttribute("href")).toBe("/privacy")
    for (const gone of ["About", "Status", "Security", "Terms"]) expect(linkNamed(footer, gone)).toBeUndefined()
  })

  test("the footer's integrations open their own section of the integrations docs", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const footer = screen.getByRole("navigation", { name: "Footer" })
    const docs = readFileSync(join(import.meta.dir, "..", "..", "docs", "content", "docs", "self-host", "integrations.mdx"), "utf8")
    // Fumadocs gives each heading an id: lower case, punctuation dropped, spaces as dashes.
    const anchors = [...docs.matchAll(/^#{2,3} (.+)$/gm)].map(([, title]) => title!.toLowerCase().replace(/[^a-z0-9 -]/g, "").trim().replace(/ +/g, "-"))
    for (const [name, anchor] of [["GitHub", "github-issues"], ["GitLab", "gitlab"], ["Jira", "jira-cloud"], ["Linear", "linear"], ["Slack", "slack"]]) {
      expect(linkNamed(footer, name!)?.getAttribute("href")).toBe(`${INTEGRATION_DOCS}#${anchor}`)
      expect(anchors).toContain(anchor!)
    }
    expect(linkNamed(footer, "All integrations")?.getAttribute("href")).toBe(INTEGRATION_DOCS)
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

  test("pointing at Product opens its menu, and moving away closes it", async () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.pointerOver(product, { pointerType: "mouse" })
    expect(product.getAttribute("aria-expanded")).toBe("true")
    // A click while it is open from pointing keeps it open.
    fireEvent.click(product)
    expect(product.getAttribute("aria-expanded")).toBe("true")
    // Moving into the menu keeps it; leaving both closes it after a short grace.
    const menu = document.getElementById(product.getAttribute("aria-controls") ?? "")!
    fireEvent.pointerOut(product, { pointerType: "mouse", relatedTarget: menu })
    fireEvent.pointerOver(menu, { pointerType: "mouse" })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(product.getAttribute("aria-expanded")).toBe("true")
    fireEvent.pointerOut(menu, { pointerType: "mouse", relatedTarget: document.body })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(product.getAttribute("aria-expanded")).toBe("false")
  })

  test("a touch on Product doesn't count as pointing; a tap toggles it", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.pointerOver(product, { pointerType: "touch" })
    expect(product.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(product)
    expect(product.getAttribute("aria-expanded")).toBe("true")
  })

  test("the header's links light up like Request a demo when pointed at", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const main = screen.getByRole("navigation", { name: "Main" })
    for (const name of ["Integrations", "AI Agents", "Pricing", "Docs"]) expect(linkNamed(main, name)?.className).toContain("hover:bg-[#FFFFFF]/[0.06]")
    expect(screen.getByRole("button", { name: "Product" }).className).toContain("hover:bg-[#FFFFFF]/[0.06]")
  })

  test("the Product menu eases in, and eases out before it goes", async () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.click(product)
    const panel = () => document.querySelector<HTMLElement>("[data-product-panel]")
    expect(panel()?.dataset.state).toBe("open")
    expect(panel()?.className).toContain("animate-in")
    expect(panel()?.className).toContain("motion-reduce:animate-none")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(product.getAttribute("aria-expanded")).toBe("false")
    expect(panel()?.dataset.state).toBe("closed")
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(panel()).toBeNull()
  })

  test("closing never drops the menu for a frame before it eases out", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.click(product)
    const panel = document.querySelector<HTMLElement>("[data-product-panel]")!
    const watch = new MutationObserver(() => {})
    watch.observe(document.body, { subtree: true, childList: true })
    fireEvent.keyDown(document, { key: "Escape" })
    const removed = watch.takeRecords().flatMap((record) => [...record.removedNodes])
    watch.disconnect()
    // The same panel stays and turns to closing; taking it out and putting it back is the flicker.
    expect(removed).not.toContain(panel)
    expect(document.querySelector("[data-product-panel]")).toBe(panel)
    expect(panel.dataset.state).toBe("closed")
  })

  test("pointing back while it eases out brings it back without fading in from nothing", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.click(product)
    fireEvent.keyDown(document, { key: "Escape" })
    fireEvent.click(product)
    const panel = document.querySelector<HTMLElement>("[data-product-panel]")!
    expect(panel.dataset.state).toBe("open")
    expect(panel.dataset.motion).toBe("still")
  })

  test("the menu's card says Free to start, and its features line up: titles on one line, two lines under each", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    fireEvent.click(screen.getByRole("button", { name: "Product" }))
    const panel = document.querySelector<HTMLElement>("[data-product-panel]")!
    expect(within(panel).getByText("Free to start")).toBeTruthy()
    expect(panel.textContent).not.toContain("Free for Chrome")
    const titles = [...panel.querySelectorAll<HTMLElement>("[data-menu-title]")]
    const bodies = [...panel.querySelectorAll<HTMLElement>("[data-menu-body]")]
    expect(titles).toHaveLength(9)
    expect(bodies).toHaveLength(9)
    for (const title of titles) expect(title.className).toContain("whitespace-nowrap")
    for (const body of bodies) {
      expect(body.className).toContain("line-clamp-2")
      expect(body.className).toContain("h-[38px]")
    }
  })

  test("a click outside closes the Product menu", () => {
    render(<SiteChrome signedIn={false} installUrl={null}><p>outside</p></SiteChrome>)
    const product = screen.getByRole("button", { name: "Product" })
    fireEvent.click(product)
    fireEvent.pointerDown(screen.getByText("outside"))
    expect(product.getAttribute("aria-expanded")).toBe("false")
  })

  test("the footer links BugBerry's repository on GitHub", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const repo = screen.getByRole("link", { name: "BugBerry on GitHub" })
    expect(repo.getAttribute("href")).toBe("https://github.com/yuisalabs/bugberry")
    expect(repo.closest("footer")).toBeTruthy()
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
    const sheet = document.getElementById(button.getAttribute("aria-controls") ?? "")!
    for (const href of ["/integrations", "/ai-agents", "/pricing", "/demo", "/login", DOCS_URL]) expect(hrefs(sheet)).toContain(href)
    // Product is a group, closed at first, like the docs' sections.
    const product = within(sheet).getByRole("button", { name: "Product" })
    expect(product.getAttribute("aria-expanded")).toBe("false")
    fireEvent.click(product)
    expect(product.getAttribute("aria-expanded")).toBe("true")
    expect(within(sheet).getByText("Voice narration")).toBeTruthy()
  })

  test("the phone menu covers the whole screen and holds the page still behind it", async () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    const button = screen.getByRole("button", { name: "Menu" })
    fireEvent.click(button)
    const sheet = screen.getByRole("dialog", { name: "Menu" })
    expect(sheet.getAttribute("aria-modal")).toBe("true")
    expect(sheet.className).toContain("fixed")
    expect(sheet.className).toContain("inset-0")
    expect(document.documentElement.style.overflow).toBe("hidden")
    fireEvent.click(within(sheet).getByRole("button", { name: "Close menu" }))
    // It eases out first, then goes and lets the page move again; focus goes back to the Menu button.
    expect(sheet.dataset.state).toBe("closed")
    expect(document.activeElement).toBe(button)
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull()
    expect(document.documentElement.style.overflow).toBe("")
  })

  test("the phone menu moves: the sheet slides in, its rows follow one by one, Product unfolds", () => {
    render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
    fireEvent.click(screen.getByRole("button", { name: "Menu" }))
    const sheet = screen.getByRole("dialog", { name: "Menu" })
    expect(sheet.dataset.state).toBe("open")
    expect(sheet.className).toContain("data-[state=open]:animate-in")
    expect(sheet.className).toContain("motion-reduce:animate-none")
    const rows = [...sheet.querySelectorAll<HTMLElement>("[data-menu-row]")]
    expect(rows.length).toBeGreaterThanOrEqual(5)
    const delays = rows.map((row) => Number.parseInt(row.style.animationDelay, 10))
    expect(delays).toEqual([...delays].sort((a, b) => a - b))
    expect(delays.at(-1)!).toBeGreaterThan(delays[0]!)
    fireEvent.click(within(sheet).getByRole("button", { name: "Product" }))
    expect(sheet.querySelector("[data-product-group]")?.className).toContain("animate-in")
  })

  test("the phone menu marks the page you are on", () => {
    window.history.pushState({}, "", "/pricing")
    try {
      render(<SiteChrome signedIn={false} installUrl={null}>page</SiteChrome>)
      fireEvent.click(screen.getByRole("button", { name: "Menu" }))
      const sheet = screen.getByRole("dialog", { name: "Menu" })
      expect(within(sheet).getByRole("link", { name: "Pricing" }).getAttribute("aria-current")).toBe("page")
      expect(within(sheet).getByRole("link", { name: "Integrations" }).getAttribute("aria-current")).toBeNull()
    } finally {
      window.history.pushState({}, "", "/")
    }
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
