import { RiArrowDownSLine, RiCloseLine, RiMenuLine } from "@remixicon/react"
import { useEffect, useId, useRef, useState } from "react"
import { Link } from "@bugberry/ui/link"
import { BugBerryLogo } from "../../components/BugBerryLogo"
import { DOCS_URL } from "../../lib/docs-url"
import { PRODUCT_MENU, ProductMenu } from "./ProductMenu"
import { siteContainer } from "./site-links"

const navLink = "text-[14px] font-medium whitespace-nowrap text-[#D9CFE0] transition hover:text-white"
const primaryButton =
  "inline-flex h-9 items-center justify-center rounded-[10px] bg-[#D61F69] px-3.5 text-[14px] font-semibold whitespace-nowrap text-white transition hover:bg-[#C01A5E]"
const outlineButton =
  "inline-flex h-9 items-center justify-center rounded-[10px] bg-[#FFFFFF]/[0.06] px-3.5 text-[14px] font-semibold whitespace-nowrap text-white outline outline-1 -outline-offset-1 outline-white/20 transition hover:bg-[#FFFFFF]/10"

const PAGES = [
  { label: "Integrations", href: "/integrations" },
  { label: "AI Agents", href: "/ai-agents" },
  { label: "Pricing", href: "/pricing" },
  { label: "Docs", href: DOCS_URL },
]

/** Closes `open` on Escape and on a press outside `area`. */
function useDismiss(open: boolean, close: () => void, area: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close()
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
  }, [open, close, area])
}

/** The public site's top bar: pages, the Product menu, and sign-up (or the dashboard, for someone signed in). */
export function SiteHeader({ signedIn, installUrl, minimal = false }: { signedIn: boolean; installUrl: string | null; minimal?: boolean }) {
  const [menu, setMenu] = useState<"product" | "mobile" | null>(null)
  const close = useRef(() => setMenu(null)).current
  const header = useRef<HTMLElement>(null)
  useDismiss(menu !== null, close, header)
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
    <header ref={header} className="relative z-40 bg-[#1C1022]">
      <nav aria-label="Main" className={`${siteContainer} flex h-[68px] items-center justify-between gap-6`}>
        <div className="flex items-center gap-11">
          <Link href="/" aria-label="BugBerry home" className="shrink-0">
            <BugBerryLogo className="h-[30px]" />
          </Link>
          {!minimal && (
            <div className="hidden items-center gap-7 lg:flex">
              <button
                type="button"
                aria-expanded={menu === "product"}
                aria-controls={productId}
                onClick={() => setMenu(menu === "product" ? null : "product")}
                className={`${navLink} inline-flex cursor-pointer items-center gap-1 ${menu === "product" ? "text-white" : ""}`}
              >
                Product
                <RiArrowDownSLine className={`size-4 text-[#B6A7BE] transition ${menu === "product" ? "rotate-180" : ""}`} aria-hidden />
              </button>
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

      {menu === "product" && (
        <div className={`${siteContainer} absolute inset-x-0 top-full z-50 hidden pt-2 lg:block`}>
          <ProductMenu id={productId} installUrl={installUrl} onPick={close} />
        </div>
      )}

      {menu === "mobile" && (
        <div id={mobileId} className="absolute inset-x-0 top-full z-50 max-h-[calc(100dvh-68px)] overflow-y-auto border-t border-[#3D2B46] bg-[#1C1022] lg:hidden">
          <div className={`${siteContainer} flex flex-col gap-6 py-6`}>
            {PRODUCT_MENU.map((column) => (
              <div key={column.label} className="flex flex-col gap-1">
                <p className="text-[12px] font-medium tracking-[1.4px] text-[#8C7C95] uppercase">{column.label}</p>
                {column.items.map((item) => (
                  <Link key={item.title} href={item.href} onPress={close} className="py-1.5 text-[15px] font-medium text-white">
                    {item.title}
                  </Link>
                ))}
              </div>
            ))}
            <div className="flex flex-col gap-1 border-t border-[#3D2B46] pt-5">
              {PAGES.map((page) => (
                <Link key={page.label} href={page.href} onPress={close} className="py-1.5 text-[15px] font-medium text-white">
                  {page.label}
                </Link>
              ))}
            </div>
            <div className="flex flex-col gap-2.5">
              {signedIn ? (
                <Link href="/app" onPress={close} className={`${primaryButton} h-11`}>
                  Open dashboard
                </Link>
              ) : (
                <Link href="/login" onPress={close} className={`${primaryButton} h-11`}>
                  Get started
                </Link>
              )}
              <Link href="/demo" onPress={close} className={`${outlineButton} h-11`}>
                Request a demo
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
