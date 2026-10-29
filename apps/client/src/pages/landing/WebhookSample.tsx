/**
 * What a webhook receives for a new report: the same fields as webhookClient in
 * apps/api/src/modules/notifiers/channels.ts (a test keeps them in step).
 */
const LINES: Array<[string, string]> = [
  ['"event": "report.created",', "event"],
  ['"report": {', "plain"],
  ['  "number": 142,', "plain"],
  ['  "title": "Checkout hangs on Pay",', "plain"],
  ['  "project": "Quinella AI",', "plain"],
  ['  "reporter": "Dina W.",', "plain"],
  ['  "browser": "Chrome 129",', "plain"],
  ['  "consoleErrors": 1,', "plain"],
  ['  "failedRequests": 1,', "plain"],
  ['  "pageUrl": "https://app.example.com/checkout",', "plain"],
  ['  "url": "https://bugberry.yuisalabs.com/app/r/…"', "plain"],
  ["}", "plain"],
]

/** `surface` is the box colour: dark on a light card, a lighter dark on a dark section. */
export function WebhookSample({ className = "", surface = "bg-[#1C1022]" }: { className?: string; surface?: string }) {
  return (
    <div data-testid="webhook-sample" className={`flex flex-col gap-1.5 overflow-x-auto rounded-[14px] ${surface} p-5 font-mono text-[12.5px] ${className}`}>
      <div className="flex justify-between gap-4 pb-2 text-[12px]">
        <span className="text-[#F37BAA]">POST your-app.com/hooks/bugberry</span>
        <span className="text-[#4CA62C]">200 OK</span>
      </div>
      <span className="text-[#E9E2EF]">{"{"}</span>
      {LINES.map(([line, tone]) => (
        <span key={line} className={`pl-4 whitespace-pre ${tone === "event" ? "text-[#FF8AB8]" : "text-[#E9E2EF]"}`}>
          {line}
        </span>
      ))}
      <span className="text-[#E9E2EF]">{"}"}</span>
    </div>
  )
}
