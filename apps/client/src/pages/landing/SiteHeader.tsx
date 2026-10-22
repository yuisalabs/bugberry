import { RiArrowDownSLine, RiCloseLine, RiMenuLine } from "@remixicon/react"
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Link } from "@bugberry/ui/link"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { DOCS_URL } from "../../lib/docs-url"
import { ProductMenu } from "./ProductMenu"
import { MobileMenu } from "./MobileMenu"
import { usePresence } from "./usePresence"
import { SITE_PAGES, siteButton, siteContainer, siteOutlineButton } from "./site-links"

/** Header links light up like "Request a demo" when pointed at. */
const navLink =
  "rounded-[10px] px-3 py-1.5 text-[14px] font-medium whitespace-nowrap text-[#D9CFE0] transition hover:bg-[#FFFFFF]/[0.06] hover:text-white"
/** How long the Product menu stays after the pointer leaves, so it can cross the gap into the panel. */
const HOVER_GRACE_MS = 200
/** The phone menu's way out (MobileMenu's sheet eases out this long). */
const MOBILE_OUT_MS = 200
/** The Product menu's way out; it stays on screen this long so it can ease out (see `panelMotion`). */
const PANEL_OUT_MS = 150
/**
 * Eases in and out (tw-animate-css, loaded by the theme); still for people who asked for less motion, and when it
 * comes back while easing out (it is already on screen).
 */
const panelMotion =
  "duration-200 ease-out data-[motion=in]:animate-in data-[motion=in]:fade-in-0 data-[motion=in]:slide-in-from-top-2 data-[motion=in]:zoom-in-[0.98] data-[state=closed]:pointer-events-none data-[motion=out]:animate-out data-[motion=out]:fade-out-0 data-[motion=out]:slide-out-to-top-1 data-[motion=out]:duration-150 data-[motion=out]:[animation-fill-mode:forwards] motion-reduce:animate-none"

type Panel = { state: "open"; motion: "in" | "still" } | { state: "closed"; motion: "out" } | null
const primaryButton = siteButton
const outlineButton = siteOutlineButton

const PAGES = SITE_PAGES

/** How far the page scrolls before the header leaves its band and floats as a pill. */
const FLOAT_AFTER_PX = 8

/** Whether the page has scrolled past FLOAT_AFTER_PX. */
function useScrolled() {
  const [scrolled, setScrolled] = useState(() => typeof window !== "undefined" && window.scrollY > FLOAT_AFTER_PX)
  useEffect(() => {
    const check = () => setScrolled(window.scrollY > FLOAT_AFTER_PX)
    check()
    window.addEventListener("scroll", check, { passive: true })
    return () => window.removeEventListener("scroll", check)
  }, [])
  return scrolled
}

/**
 * The bar in its two looks: a full-width band at the top of the page, and a rounded pill floating 12px below the
 * top once scrolled. Both are 68px tall in all (12 + 56), so nothing under the header moves when it changes.
 */
const navAtTop = "h-[68px] w-full max-w-[1120px] px-4 sm:px-6 lg:px-0"
const navFloating =
  "mt-3 h-14 w-[calc(100%-24px)] max-w-[1180px] rounded-full bg-[#2A1B31]/80 px-4 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.6)] outline outline-1 -outline-offset-1 outline-white/10 backdrop-blur-md sm:px-5"

/** Closes `open` on Escape (then `onEscape`) and on a press outside `area`. */
function useDismiss(open: boolean, close: () => void, area: React.RefObject<HTMLElement | null>, onEscape: () => void) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      onEscape()
    }
    const onPointer = (event: PointerEvent) => {
      if (area.current && !area.current.contains(event.target as Node)) close()
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("pointerdown", onPointer)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("pointerdown", onPointer)
    }
  }, [open, close, area, onEscape])
}

/** The public site's top bar: pages, the Product menu, and sign-up (or the dashboard, for someone signed in). */
export function SiteHeader({ signedIn, installUrl, minimal = false }: { signedIn: boolean; installUrl: string | null; minimal?: boolean }) {
  const [menu, setMenu] = useState<"product" | "mobile" | null>(null)
  // Product opens on pointing (mouse or pen) as well as on a click; a touch or the keyboard uses the click.
  const openedByPointing = useRef(false)
  const leaving = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stopLeaving = () => {
    if (leaving.current) clearTimeout(leaving.current)
    leaving.current = null
  }
  const close = useRef(() => {
    openedByPointing.current = false
    setMenu(null)
  }).current
  useEffect(() => stopLeaving, [])
  // The panel outlives a close by PANEL_OUT_MS, so it can ease out instead of vanishing. Settled before paint, so it
  // never leaves the page for a frame between open and closing (that frame was a flicker).
  const [panel, setPanel] = useState<Panel>(null)
  useLayoutEffect(() => {
    if (menu === "product") {
      setPanel((now) => (now?.state === "open" ? now : { state: "open", motion: now ? "still" : "in" }))
      return
    }
    setPanel((now) => (now?.state === "open" ? { state: "closed", motion: "out" } : now))
  }, [menu])
  useEffect(() => {
    if (panel?.state !== "closed") return
    const gone = setTimeout(() => setPanel(null), PANEL_OUT_MS)
    return () => clearTimeout(gone)
  }, [panel])
  // Until the layout effect has run, a fresh open shows as easing in and a fresh close as still open.
  const shown: Panel = panel ?? (menu === "product" ? { state: "open", motion: "in" } : null)
  const pointAt = (event: React.PointerEvent) => {
    if (event.pointerType === "touch") return
    stopLeaving()
    if (menu === "product") return
    openedByPointing.current = true
    setMenu("product")
  }
  const pointAway = (event: React.PointerEvent) => {
    if (event.pointerType === "touch" || !openedByPointing.current) return
    stopLeaving()
    leaving.current = setTimeout(close, HOVER_GRACE_MS)
  }
  const clickProduct = () => {
    // Already open from pointing at it: a click there means "yes, this one", not "close".
    if (menu === "product" && openedByPointing.current) return
    openedByPointing.current = false
    setMenu(menu === "product" ? null : "product")
  }
  const header = useRef<HTMLElement>(null)
  const productButton = useRef<HTMLButtonElement>(null)
  const mobileButton = useRef<HTMLButtonElement>(null)
  const openMenu = useRef(menu)
  openMenu.current = menu
  // Escape hands focus back to the button that opened the menu, not to the page.
  const refocus = useRef(() => (openMenu.current === "product" ? productButton : mobileButton).current?.focus()).current
  useDismiss(menu !== null, close, header, refocus)
  const mobile = usePresence(menu === "mobile", MOBILE_OUT_MS)
  const scrolled = useScrolled()
  const productId = useId()
  const mobileId = useId()

  const account = signedIn ? (
    <Link href="/app" className={primaryButton}>
      Open dashboard
    </Link>
  ) : (
    <Link href="/login" className={primaryButton}>
      Get started
    </Link>
  )

  return (
    <header
      ref={header}
      data-scrolled={scrolled}
      className={`sticky top-0 z-40 transition-colors duration-300 motion-reduce:transition-none ${scrolled ? "bg-transparent" : "bg-[#1C1022]"}`}
    >
      <nav
        aria-label="Main"
        className={`mx-auto flex items-center justify-between gap-6 transition-all duration-300 ease-out motion-reduce:transition-none ${scrolled ? navFloating : navAtTop}`}
      >
        <div className="flex items-center gap-8">
          <Link href="/" aria-label="BugBerry home" className="shrink-0">
            <BugBerryLogo className="h-[30px]" />
          </Link>
          {!minimal && (
            <div className="hidden items-center gap-1 lg:flex">
              {/* The button and its panel are one area for pointing: moving from one to the other keeps it open. */}
              <div className="contents" onPointerEnter={pointAt} onPointerLeave={pointAway}>
                <button
                  ref={productButton}
                  type="button"
                  aria-expanded={menu === "product"}
                  aria-controls={productId}
                  onClick={clickProduct}
                  className={`${navLink} inline-flex cursor-pointer items-center gap-1 ${menu === "product" ? "bg-[#FFFFFF]/[0.06] text-white" : ""}`}
                >
                  Product
                  <RiArrowDownSLine className={`size-4 text-[#B6A7BE] transition ${menu === "product" ? "rotate-180" : ""}`} aria-hidden />
                </button>
                {/* Right after its button, so the keyboard reaches it next; placed under the header bar. */}
                {shown && (
                  <div
                    data-product-panel
                    data-state={shown.state}
                    data-motion={shown.motion}
                    className={`${siteContainer} absolute inset-x-0 top-full z-50 origin-top pt-2 ${panelMotion}`}
                  >
                    <ProductMenu id={productId} installUrl={installUrl} onPick={close} />
                  </div>
                )}
              </div>
              {PAGES.map((page) => (
                <Link key={page.label} href={page.href} className={navLink}>
                  {page.label}
                </Link>
              ))}
            </div>
          )}
          {minimal && (
            <Link href={DOCS_URL} className={navLink}>
              Docs
            </Link>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {minimal ? (
            signedIn ? (
              account
            ) : (
              <Link href="/login" className={primaryButton}>
                Sign in
              </Link>
            )
          ) : (
            <>
              <div className="hidden items-center gap-2.5 sm:flex">
                {account}
                <Link href="/demo" className={outlineButton}>
                  Request a demo
                </Link>
              </div>
              <button
                ref={mobileButton}
                type="button"
                aria-label="Menu"
                aria-expanded={menu === "mobile"}
                aria-controls={mobileId}
                onClick={() => setMenu(menu === "mobile" ? null : "mobile")}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-[10px] text-white outline outline-1 -outline-offset-1 outline-white/20 lg:hidden"
              >
                {menu === "mobile" ? <RiCloseLine className="size-5" aria-hidden /> : <RiMenuLine className="size-5" aria-hidden />}
              </button>
            </>
          )}
        </div>
      </nav>

      {mobile && (
        <MobileMenu
          id={mobileId}
          state={mobile}
          signedIn={signedIn}
          onClose={close}
          onDismiss={() => {
            close()
            mobileButton.current?.focus()
          }}
        />
      )}
    </header>
  )
}
