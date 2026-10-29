/** Marks a feature the copy names that BugBerry does not have yet. */
export function ComingSoon({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full bg-[#FFE3EE] px-2 py-0.5 align-middle font-sans text-[11px] font-bold tracking-normal whitespace-nowrap text-[#B3175A] ${className}`}
    >
      Coming soon
    </span>
  )
}
