/** Decorative product shot for the hero: a checkout page being reported, with the report panel beside it. */

const LOGS: Array<{ level: "ERR" | "WARN" | "LOG"; text: string; time: string }> = [
  { level: "ERR", text: "POST /api/orders 500 (Internal Server Error)", time: "00:41.2" },
  { level: "ERR", text: "Uncaught TypeError: cannot read 'id' of undefined", time: "00:41.3" },
  { level: "WARN", text: "Stripe.js: payment intent requires_action", time: "00:40.8" },
  { level: "LOG", text: "cart: 1 item, total=19440", time: "00:38.1" },
  { level: "LOG", text: "route change → /checkout", time: "00:31.6" },
]

const LEVEL_STYLE = {
  ERR: "bg-[#FDF3F3] text-[#E5484D]",
  WARN: "bg-[#FBF0DB] text-[#8A5A0B]",
  LOG: "bg-[#F0EDF3] text-[#635A6B]",
} as const

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground">{value}</span>
    </div>
  )
}

/** The product in a browser window, sitting on the hero's bottom edge; its shadow rises, so none falls on the next section. */
export function HeroMockup() {
  return (
    <div aria-hidden className="w-full overflow-hidden rounded-t-[20px] border border-b-0 border-border bg-background shadow-[0_-24px_60px_-30px_rgba(28,16,34,0.3)]">
      <div className="flex items-center gap-3 border-b border-border bg-muted px-4 py-3">
        <span className="flex gap-1.5">
          <span className="size-3 rounded-full bg-[#E5675B]" />
          <span className="size-3 rounded-full bg-[#E8B04B]" />
          <span className="size-3 rounded-full bg-[#5DBB63]" />
        </span>
        <span className="flex-1 rounded-md bg-background px-3 py-1 font-mono text-xs text-muted-foreground">
          shop.northwind.co/checkout
        </span>
        <span className="flex items-center gap-1.5 rounded-full bg-[#1C1022] px-2.5 py-1 font-mono text-[11px] font-semibold text-white">
          <span className="size-2 rounded-full bg-[#E5484D]" />
          REC 00:42
        </span>
      </div>
      <div className="grid grid-cols-[1fr_420px]">
        <div className="flex flex-col gap-5 p-8">
          <p className="font-heading text-2xl font-bold text-foreground">Checkout</p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Email" value="dana@acme.io" />
            <Field label="Card number" value="4242 4242 4242 4242" />
            <Field label="Name on card" value="Dana Whitfield" />
            <div className="flex flex-col gap-2 rounded-xl bg-muted p-4 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Linen overshirt</span>
                <span>$168.00</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Shipping + tax</span>
                <span>$26.40</span>
              </div>
              <div className="flex justify-between font-semibold text-foreground">
                <span>Total</span>
                <span>$194.40</span>
              </div>
            </div>
          </div>
          <div className="relative">
            <span className="block w-full rounded-xl bg-primary py-3 text-center text-sm font-semibold text-primary-foreground opacity-80">
              Processing…
            </span>
            <span className="absolute -top-3 -right-3 grid size-7 place-content-center rounded-full bg-[#1C1022] text-xs font-bold text-white ring-4 ring-background">
              1
            </span>
          </div>
          <div className="w-fit rounded-xl bg-[#1C1022] px-4 py-3 text-sm text-white">
            <p className="font-semibold">Spins forever after clicking Pay</p>
            <p className="text-xs text-[#B6A7BE]">Dana · QA · just now</p>
          </div>
        </div>
        <div className="flex flex-col border-l border-border">
          <div className="flex flex-col gap-2 border-b border-border p-5">
            <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
              <span>BB-1042 · NEW REPORT</span>
              <span className="rounded-full bg-[#FDF3F3] px-2 py-0.5 font-semibold text-[#E5484D]">High</span>
            </div>
            <p className="font-heading text-lg leading-snug font-bold text-foreground">
              Checkout hangs on “Pay”: POST /api/orders returns 500
            </p>
            <div className="flex flex-wrap gap-1.5 font-mono text-[11px] text-muted-foreground">
              {["Chrome 131", "macOS", "1440×900"].map((item) => (
                <span key={item} className="rounded-md bg-muted px-2 py-0.5">
                  {item}
                </span>
              ))}
            </div>
          </div>
          <div className="flex gap-4 border-b border-border px-5 pt-3 text-sm">
            <span className="border-b-2 border-primary pb-2 font-semibold text-foreground">
              Console <span className="text-primary">3</span>
            </span>
            <span className="text-muted-foreground">Network 24</span>
            <span className="text-muted-foreground">Actions 11</span>
          </div>
          <ul className="flex flex-1 flex-col">
            {LOGS.map((log) => (
              <li key={log.text} className="flex items-center gap-2.5 border-b border-border px-5 py-2.5 font-mono text-[11.5px]">
                <span className={`rounded px-1.5 py-0.5 font-bold ${LEVEL_STYLE[log.level]}`}>{log.level}</span>
                <span className="flex-1 truncate text-foreground">{log.text}</span>
                <span className="text-muted-foreground">{log.time}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between p-4">
            <span className="text-xs text-muted-foreground">GitHub · web</span>
            <span className="rounded-lg bg-[#1C1022] px-4 py-2 text-xs font-semibold text-white">Create issue</span>
          </div>
        </div>
      </div>
    </div>
  )
}
