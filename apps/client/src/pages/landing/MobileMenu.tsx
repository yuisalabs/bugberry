import { RiArrowRightSLine, RiCloseLine } from "@remixicon/react"
import { useEffect, useRef, useState } from "react"
import { Link } from "@bugberry/ui/link"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { PRODUCT_MENU } from "./ProductMenu"
import { SITE_PAGES, siteButton, siteContainer, siteOutlineButton } from "./site-links"

const row =
  "flex w-full items-center justify-between rounded-[10px] px-3 py-2.5 text-left text-[15px] font-medium text-[#D9CFE0] transition hover:bg-[#FFFFFF]/[0.06] hover:text-white"
/** The sheet slides down into place and eases back out; still for people who asked for less motion. */
const sheetMotion =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-3 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=closed]:duration-200 data-[state=closed]:[animation-fill-mode:forwards] ease-out motion-reduce:animate-none"
/** Each row comes in a beat after the one above it. */
const rowMotion = "animate-in fade-in-0 slide-in-from-left-2 duration-300 ease-out [animation-fill-mode:both] motion-reduce:animate-none"
const ROW_STEP_MS = 40
const rowDelay = (index: number) => ({ animationDelay: `${80 + index * ROW_STEP_MS}ms` })

/** The page you are on, as the docs mark theirs. */
const here = "bg-[#D61F69]/15 text-[#FF4F8B] hover:bg-[#D61F69]/20 hover:text-[#FF4F8B]"

/**
 * The phone menu: a sheet over the whole screen, laid out like the docs' sidebar. The page behind it stays still
 * while it is open, so nothing shows through when its list scrolls.
 */
export function MobileMenu({
  id,
  state,
  signedIn,
  onClose,
  onDismiss,
}: {
  id: string
  state: "open" | "closed"
  signedIn: boolean
  /** Following a link: the menu just goes. */
  onClose: () => void
  /** The close button: the menu goes and focus returns to the button that opened it. */
  onDismiss: () => void
}) {
  const [productOpen, setProductOpen] = useState(false)
  const closeButton = useRef<HTMLButtonElement>(null)
  const path = typeof window === "undefined" ? "" : window.location.pathname

  useEffect(() => {
    const page = document.documentElement
    const before = page.style.overflow
    page.style.overflow = "hidden"
    closeButton.current?.focus()
    return () => {
      page.style.overflow = before
    }
  }, [])

  return (
    <div
      id={id}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      data-state={state}
      className={`fixed inset-0 z-50 flex flex-col bg-[#1C1022] lg:hidden ${sheetMotion} ${state === "closed" ? "pointer-events-none" : ""}`}
    >
      <div className="border-b border-[#3D2B46]">
        <div className={`${siteContainer} flex h-[68px] items-center justify-between`}>
          <Link href="/" aria-label="BugBerry home" onPress={onClose} className="shrink-0">
            <BugBerryLogo className="h-[30px]" />
          </Link>
          <button
            ref={closeButton}
            type="button"
            aria-label="Close menu"
            onClick={onDismiss}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-[10px] text-white outline outline-1 -outline-offset-1 outline-white/20"
          >
            <RiCloseLine className="size-5" aria-hidden />
          </button>
        </div>
      </div>
      <nav aria-label="Menu pages" className="flex-1 overflow-y-auto overscroll-contain">
        <div className={`${siteContainer} flex flex-col gap-1 py-4`}>
          <button
            type="button"
            data-menu-row
            aria-expanded={productOpen}
            onClick={() => setProductOpen(!productOpen)}
            className={`${row} ${rowMotion} cursor-pointer`}
            style={rowDelay(0)}
          >
            Product
            <RiArrowRightSLine className={`size-5 text-[#8C7C95] transition ${productOpen ? "rotate-90" : ""}`} aria-hidden />
          </button>
          {productOpen && (
            <div
              data-product-group
              className="flex origin-top flex-col gap-3 pt-1 pb-2 pl-3 animate-in fade-in-0 slide-in-from-top-2 duration-200 ease-out motion-reduce:animate-none"
            >
              {PRODUCT_MENU.map((column) => (
                <div key={column.label} className="flex flex-col">
                  <p className="px-3 pt-2 pb-1 text-[11px] font-medium tracking-[1.4px] text-[#8C7C95] uppercase">{column.label}</p>
                  {column.items.map((item) => (
                    <Link key={item.title} href={item.href} onPress={onClose} className={`${row} py-2 text-[14px]`}>
                      {item.title}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          )}
          {SITE_PAGES.map((page, index) => {
            const current = page.href === path
            return (
              <Link
                key={page.label}
                href={page.href}
                onPress={onClose}
                aria-current={current ? "page" : undefined}
                data-menu-row
                className={`${row} ${rowMotion} ${current ? here : ""}`}
                style={rowDelay(index + 1)}
              >
                {page.label}
              </Link>
            )
          })}
        </div>
      </nav>
      <div className="border-t border-[#3D2B46] pb-[env(safe-area-inset-bottom)]">
        <div className={`${siteContainer} flex flex-col gap-2.5 py-4 ${rowMotion}`} style={rowDelay(SITE_PAGES.length + 1)}>
          <Link href={signedIn ? "/app" : "/login"} onPress={onClose} className={`${siteButton} h-11`}>
            {signedIn ? "Open dashboard" : "Get started"}
          </Link>
          <Link href="/demo" onPress={onClose} className={`${siteOutlineButton} h-11`}>
            Request a demo
          </Link>
        </div>
      </div>
    </div>
  )
}
