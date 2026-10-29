import { RiChromeFill } from "@remixicon/react"
import { Link } from "@bugberry/ui/link"
import { Reveal } from "./Reveal"
import { installHref } from "./site-links"

/** The closing band of every public page: install the extension, or book a demo. */
export function FinalCta({ installUrl }: { installUrl: string | null }) {
  return (
    <section className="bg-[#1C1022] bg-[url(/assets/site/cta-gradient.webp)] bg-cover bg-center px-4 py-20 sm:px-6 md:py-[104px]">
      <Reveal className="mx-auto flex max-w-[820px] flex-col items-center gap-7 text-center">
        <h2 className="font-heading text-[40px]/[44px] font-semibold tracking-[-1.4px] text-white md:text-[60px]/[62px] md:tracking-[-2px]">
          <span className="block">Stop describing bugs.</span>
          <span className="block">Start showing them.</span>
        </h2>
        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
          <Link
            href={installHref(installUrl)}
            className="inline-flex h-12 items-center justify-center gap-2.5 rounded-xl bg-[#FFFFFF] px-5 text-[15px] font-semibold text-[#1C1022] transition hover:bg-[#FFFFFF]/90"
          >
            <RiChromeFill className="size-[18px]" aria-hidden />
            Add to Chrome, it’s free
          </Link>
          <Link
            href="/demo"
            className="inline-flex h-12 items-center justify-center rounded-xl bg-[#1C1022]/40 px-5 text-[15px] font-semibold text-white outline outline-1 -outline-offset-1 outline-white/25 transition hover:bg-[#1C1022]/60"
          >
            Book a 30-minute demo
          </Link>
        </div>
        <p className="text-[13px] text-white/70">No credit card · Works on Chrome, Edge, Arc and Brave</p>
      </Reveal>
    </section>
  )
}
