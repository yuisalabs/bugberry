import type { ReactNode } from "react"
import { SiteFooter } from "./SiteFooter"
import { SiteHeader } from "./SiteHeader"

/** Header, page and footer of every public page. `minimal` is the self-hosted variant (see SiteFooter). */
export function SiteChrome({
  signedIn,
  installUrl,
  minimal = false,
  children,
}: {
  signedIn: boolean
  installUrl: string | null
  minimal?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-[#F7F6FA] font-sans text-[#1C1022]">
      <SiteHeader signedIn={signedIn} installUrl={installUrl} minimal={minimal} />
      <main className="flex-1">{children}</main>
      <SiteFooter installUrl={installUrl} minimal={minimal} />
    </div>
  )
}
